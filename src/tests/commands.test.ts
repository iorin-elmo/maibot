import assert from "node:assert/strict";
import test from "node:test";
import { maimaiCommand, renderCandidate, renderDxScore, renderDxStarCandidate, renderNewConstantScore, renderProgressScore } from "../commands.js";
import { difficultyAccent, newConstantCards, progressCards, renderScoreCardImages } from "../best-image.js";

test("maimai command is available in bot DMs", () => {
  const command = maimaiCommand.toJSON() as { contexts?: number[]; options: Array<{ name: string; options?: Array<{ name: string }> }> };
  assert.deepEqual(command.contexts, [0, 1]);
  assert.ok(command.options.find((option) => option.name === "sync")?.options?.some((option) => option.name === "image"));
  assert.ok(!command.options.some((option) => option.name === "fsync"));
});

test("候補表示は達成率とランクの桁数に関係なく列がそろう", () => {
  const under100 = renderCandidate({
    score: { title: "Under", difficulty: "MASTER", rating: 290, chartKind: "new", achievements: 99.5, internalLevel: 14.4 },
    nextAchievement: 100, nextRank: "SSS", ratingAtNextRank: 310, ratingGain: 3, achievementGap: 0.5
  }, 0);
  const over100 = renderCandidate({
    score: { title: "Over", difficulty: "MASTER", rating: 310, chartKind: "new", achievements: 100, internalLevel: 14.4 },
    nextAchievement: 100.5, nextRank: "SSS+", ratingAtNextRank: 323, ratingGain: 13, achievementGap: 0.5
  }, 1);

  assert.match(under100, /^#01 \[14\.4\]  99\.5000% → SSS  \(\+ 3\) \/ Under$/);
  assert.match(over100, /^#02 \[14\.4\] 100\.0000% → SSS\+ \(\+13\) \/ Over$/);
  assert.equal(under100.indexOf("%"), over100.indexOf("%"));
  assert.equal(under100.indexOf("→"), over100.indexOf("→"));
  assert.equal(under100.indexOf("(+"), over100.indexOf("(+"));
  assert.equal(under100.indexOf("/ "), over100.indexOf("/ "));
});

test("DX score rows use the requested percent, score fraction, and star formats", () => {
  const score = { title: "DX Song", difficulty: "MASTER", rating: 0, dxScore: 969, dxScoreMax: 1000 };
  const fourDigitAligned = { title: "Low DX Song", difficulty: "MASTER", rating: 0, dxScore: 969, dxScoreMax: 2229 };
  assert.equal(renderDxScore(score, 0), "# 1  969/1000 (96.900%) ☆4 / DX Song");
  assert.equal(renderDxScore(fourDigitAligned, 1), "# 2  969/2229 (43.472%) ☆0 / Low DX Song");
  assert.equal(renderDxStarCandidate({ score, currentStars: 4, targetStars: 5, missingScore: 1 }, 0), "# 1  969/1000 (96.900%) ☆5 -1 / DX Song");
  assert.equal(renderDxStarCandidate({ score, currentStars: 4, targetStars: 5, missingScore: 1 }, 0, 2), "# 1  969/1000 (96.900%) ☆5  -1 / DX Song");
});

test("score cards render 50 songs as a single sheet even when jackets are unavailable", async () => {
  const cards = Array.from({ length: 50 }, (_, index) => ({
    score: { title: `No Jacket ${index + 1}`, difficulty: "MASTER", rating: 0 },
    topLeft: `#${index + 1} Lv14`,
    topRight: "☆5",
    bottom: "1000/1000 (100.000%)"
  }));
  const images = await renderScoreCardImages("Tester", "DXスコア%順", cards);
  assert.equal(images.length, 1);
  assert.ok(images[0].length > 10_000);
});

test("score card frames use the maimai difficulty colours", () => {
  assert.equal(difficultyAccent("BASIC"), "#48c95a");
  assert.equal(difficultyAccent("ADVANCED"), "#f49a36");
  assert.equal(difficultyAccent("EXPERT"), "#ed4c55");
  assert.equal(difficultyAccent("MASTER"), "#9a62db");
  assert.equal(difficultyAccent("RE:MASTER"), "#ffffff");
});

test("new chart constant rows distinguish unplayed scores while keeping achievements aligned", () => {
  const played = renderNewConstantScore({ title: "Played", difficulty: "MASTER", rating: 0, internalLevel: 14.5, achievements: 100, chartType: "dx" }, 0);
  const unplayed = renderNewConstantScore({ title: "Unplayed", difficulty: "MASTER", rating: 0, internalLevel: 14.4, chartType: "standard" }, 1);
  assert.equal(played, "# 1 [14.5] 100.0000% / DX MASTER / Played");
  assert.equal(unplayed, "# 2 [14.4]        -% / STD MASTER / Unplayed");
  assert.equal(played.indexOf("%"), unplayed.indexOf("%"));
});

test("progress rows keep achievement and status columns aligned", () => {
  const combo = renderProgressScore({ title: "Combo", difficulty: "MASTER", rating: 0, internalLevel: 14.4, achievements: 100.9999, comboStatus: "AP", syncStatus: "FDX" }, 0, "AP");
  const missingCombo = renderProgressScore({ title: "Missing", difficulty: "MASTER", rating: 0, internalLevel: 14.3 }, 1, "FC");
  const rank = renderProgressScore({ title: "Rank", difficulty: "MASTER", rating: 0, internalLevel: 14.4, achievements: 100.9999 }, 0, "SSS+");
  const missingRank = renderProgressScore({ title: "Unplayed", difficulty: "MASTER", rating: 0, internalLevel: 14.3 }, 1, "SSS");
  assert.equal(combo, "#01 [14.4] 100.9999% (AP ) (FDX) / Combo");
  assert.equal(missingCombo, "#02 [14.3]        -% ( - ) ( - ) / Missing");
  assert.equal(rank, "#01 [14.4] 100.9999% (SSS+) / Rank");
  assert.equal(missingRank, "#02 [14.3]        -% ( -- ) / Unplayed");
  assert.equal(combo.indexOf("%"), missingCombo.indexOf("%"));
  assert.equal(rank.indexOf("%"), missingRank.indexOf("%"));
});

test("plate and level commands use their required inputs and 30-to-50 count range", () => {
  const command = maimaiCommand.toJSON() as { options: Array<{ name: string; options?: Array<{ name: string; required?: boolean; autocomplete?: boolean; min_value?: number; max_value?: number }> }> };
  const plate = command.options.find((option) => option.name === "plate");
  const level = command.options.find((option) => option.name === "level");
  assert.equal(plate?.options?.find((option) => option.name === "version")?.required, true);
  assert.equal(plate?.options?.find((option) => option.name === "version")?.autocomplete, true);
  assert.equal(plate?.options?.find((option) => option.name === "kind")?.required, true);
  const plateCount = plate?.options?.find((option) => option.name === "count");
  assert.equal(plateCount?.min_value, 1);
  assert.equal(plateCount?.max_value, 50);
  assert.ok(plate?.options?.find((option) => option.name === "image"));
  assert.equal(level?.options?.find((option) => option.name === "level")?.required, true);
  assert.equal(level?.options?.find((option) => option.name === "kind")?.required, true);
  assert.ok(level?.options?.find((option) => option.name === "image"));
  assert.ok(command.options.find((option) => option.name === "newconstant")?.options?.find((option) => option.name === "image"));
  const settings = command.options.find((option) => option.name === "settings");
  assert.ok(settings?.options?.find((option) => option.name === "image" && !option.required));
  assert.ok(settings?.options?.find((option) => option.name === "count" && !option.required));
});

test("new constant and progress cards retain the requested score details", () => {
  const score = { title: "Card", difficulty: "MASTER", rating: 0, internalLevel: 14.4, achievements: 100.5, chartType: "dx" as const, comboStatus: "AP" as const, syncStatus: "FDX" as const };
  assert.deepEqual(newConstantCards([score])[0], {
    score, topLeft: "#1 Lv14.4", topRight: "DX", bottom: "100.5000%", accent: "#9a62db"
  });
  assert.deepEqual(progressCards([score], true)[0], {
    score, topLeft: "#1 Lv14.4", topRight: "AP / FDX", bottom: "100.5000%", accent: "#9a62db"
  });
  assert.equal(progressCards([{ ...score, achievements: 96 }], false)[0].topRight, "AAA");
});
