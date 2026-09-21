import assert from "node:assert/strict";
import test from "node:test";
import { renderCandidate, renderDxScore, renderDxStarCandidate, renderNewConstantScore } from "../commands.js";
import { difficultyAccent, renderScoreCardImages } from "../best-image.js";

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
  const played = renderNewConstantScore({ title: "Played", difficulty: "MASTER", rating: 0, internalLevel: 14.5, achievements: 100 }, 0);
  const unplayed = renderNewConstantScore({ title: "Unplayed", difficulty: "MASTER", rating: 0, internalLevel: 14.4 }, 1);
  assert.equal(played, "# 1 [14.5] 100.0000% / Played");
  assert.equal(unplayed, "# 2 [14.4]        -% / Unplayed");
  assert.equal(played.indexOf("%"), unplayed.indexOf("%"));
});
