import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleMaimai, handleMaimaiAutocomplete, maimaiCommand, renderCandidate, renderDifficultyScore, renderDxScore, renderDxStarCandidate, renderNewConstantScore, renderProgressScore } from "../commands.js";
import { difficultyAccent, newConstantCards, progressCards, renderScoreCardImages } from "../best-image.js";
import { BotDatabase } from "../database.js";

function syncInteraction(subcommand: "sync" | "sync-reset", channelId: string, image: boolean | null = null) {
  const replies: Array<{ content?: string; ephemeral?: boolean }> = [];
  return {
    interaction: {
      user: { id: "discord-user" },
      channelId,
      options: {
        getSubcommand: () => subcommand,
        getBoolean: (name: string) => name === "image" ? image : null
      },
      reply: async (message: { content?: string; ephemeral?: boolean }) => { replies.push(message); }
    },
    replies
  };
}

function bookmarkToken(content: string): string {
  const match = content.match(/"X-Import-Token":"([A-Za-z0-9_-]+)"/);
  assert.ok(match);
  return match[1];
}

test("maimai command is available in bot DMs", () => {
  const command = maimaiCommand.toJSON() as { contexts?: number[]; options: Array<{ name: string; options?: Array<{ name: string }> }> };
  assert.deepEqual(command.contexts, [0, 1]);
  assert.ok(command.options.find((option) => option.name === "sync")?.options?.some((option) => option.name === "image"));
  assert.ok(!command.options.some((option) => option.name === "fsync"));
});

test("plate autocomplete prioritizes 舞 and 廻 within Discord's 25-choice limit", async () => {
  const responses: Array<{ name: string; value: string }> = [];
  const interaction = {
    commandName: "maimai",
    options: {
      getSubcommand: () => "plate",
      getFocused: () => ({ name: "version", value: "" })
    },
    respond: async (choices: Array<{ name: string; value: string }>) => { responses.push(...choices); }
  };
  await handleMaimaiAutocomplete(interaction as never);
  assert.equal(responses.length, 25);
  assert.ok(responses.some((choice) => choice.value === "舞"));
  assert.ok(responses.some((choice) => choice.value === "廻"));

  const typedResponses: Array<{ name: string; value: string }> = [];
  await handleMaimaiAutocomplete({ ...interaction, options: { ...interaction.options, getFocused: () => ({ name: "version", value: "真" }) }, respond: async (choices: Array<{ name: string; value: string }>) => { typedResponses.push(...choices); } } as never);
  assert.deepEqual(typedResponses.map((choice) => choice.value), ["真"]);
});

test("真将 is explicitly rejected as a nonexistent plate", async () => {
  let reply: { content?: string } | undefined;
  const interaction = {
    user: { id: "discord-user" }, channelId: "channel",
    options: {
      getSubcommand: () => "plate",
      getString: (name: string) => name === "version" ? "真" : "将",
      getInteger: () => null,
      getBoolean: () => null
    },
    reply: async (message: { content?: string }) => { reply = message; }
  };
  const catalog = { excludeLocked: async <T>(scores: T) => scores, enrich: async <T>(scores: T) => scores };
  await handleMaimai(interaction as never, { getAccount: () => ({ rating: 0 }), getDefaultImage: () => false, getDefaultCount: () => undefined, getScores: () => [] } as never, "https://sync.example.com", catalog as never);
  assert.match(reply?.content ?? "", /真将は存在しない/);
});

test("difficulty lists charts by constant and then achievement", async () => {
  let requestedDifficulty: string | undefined;
  let reply: { embeds?: Array<{ toJSON(): { description?: string } }> } | undefined;
  const scores = [
    { title: "Lower", difficulty: "EXPERT", level: "13", internalLevel: 13.7, achievements: 100, rating: 0, chartKind: "old" as const },
    { title: "Same Constant Lower", difficulty: "EXPERT", level: "14", internalLevel: 14, achievements: 98, rating: 0, chartKind: "old" as const },
    { title: "Same Constant Higher", difficulty: "EXPERT", level: "14", internalLevel: 14, achievements: 99, rating: 0, chartKind: "old" as const }
  ];
  const interaction = {
    user: { id: "discord-user" }, channelId: "channel",
    options: {
      getSubcommand: () => "difficulty",
      getString: (name: string) => name === "difficulty" ? "EXPERT" : null,
      getInteger: () => null,
      getBoolean: () => null
    },
    reply: async (message: typeof reply) => { reply = message; }
  };
  const catalog = {
    excludeLocked: async <T>(value: T) => value,
    enrich: async <T>(value: T) => value,
    difficultyProgressRanking: async (difficulty: string) => { requestedDifficulty = difficulty; return scores; }
  };
  const db = { getAccount: () => ({ rating: 0, playerName: "Tester" }), getDefaultImage: () => false, getDefaultCount: () => undefined, getScores: () => [] };
  await handleMaimai(interaction as never, db as never, "https://sync.example.com", catalog as never);
  assert.equal(requestedDifficulty, "EXPERT");
  const description = reply?.embeds?.[0].toJSON().description ?? "";
  assert.ok(description.indexOf("Same Constant Higher") < description.indexOf("Same Constant Lower"));
  assert.ok(description.indexOf("Same Constant Lower") < description.indexOf("Lower"));
});

test("level and plate report an empty difficulty filter instead of false completion", async () => {
  const score = { title: "MASTER only", difficulty: "MASTER", level: "13", internalLevel: 13, rating: 0, chartKind: "old" as const };
  const catalog = {
    excludeLocked: async <T>(value: T) => value,
    enrich: async <T>(value: T) => value,
    levelProgressRanking: async () => [score],
    plateProgressRanking: async () => [score]
  };
  const db = { getAccount: () => ({ rating: 0, playerName: "Tester" }), getDefaultImage: () => false, getDefaultCount: () => undefined, getScores: () => [] };
  for (const subcommand of ["level", "plate"] as const) {
    let reply = "";
    const interaction = {
      user: { id: "discord-user" }, channelId: "channel",
      options: {
        getSubcommand: () => subcommand,
        getString: (name: string) => name === "difficulty" ? "RE:MASTER" : name === "level" ? "13" : name === "version" ? "熊" : subcommand === "plate" ? "神" : "AP",
        getInteger: () => null,
        getBoolean: () => null
      },
      deferReply: async () => {},
      editReply: async (message: string) => { reply = message; }
    };
    await handleMaimai(interaction as never, db as never, "https://sync.example.com", catalog as never);
    assert.match(reply, /RE:MASTER.*(?:対象譜面|譜面).*ありません/);
  }
});

test("level and plate scope completion messages to the selected difficulty", async () => {
  const score = { title: "EXPERT complete", difficulty: "EXPERT", level: "13", internalLevel: 13, rating: 0, chartKind: "old" as const, comboStatus: "AP" as const };
  const catalog = {
    excludeLocked: async <T>(value: T) => value,
    enrich: async <T>(value: T) => value,
    levelProgressRanking: async () => [score],
    plateProgressRanking: async () => [score]
  };
  const db = { getAccount: () => ({ rating: 0, playerName: "Tester" }), getDefaultImage: () => false, getDefaultCount: () => undefined, getScores: () => [] };
  for (const subcommand of ["level", "plate"] as const) {
    let reply = "";
    const interaction = {
      user: { id: "discord-user" }, channelId: "channel",
      options: {
        getSubcommand: () => subcommand,
        getString: (name: string) => name === "difficulty" ? "EXPERT" : name === "level" ? "13" : name === "version" ? "熊" : subcommand === "plate" ? "神" : "AP",
        getInteger: () => null,
        getBoolean: () => null
      },
      deferReply: async () => {},
      editReply: async (message: string) => { reply = message; }
    };
    await handleMaimai(interaction as never, db as never, "https://sync.example.com", catalog as never);
    assert.match(reply, /EXPERT/);
  }
});

test("sync issues one persistent bookmarklet, updates its destination, and sync-reset rotates it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-command-test-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  try {
    const first = syncInteraction("sync", "first-channel", true);
    await handleMaimai(first.interaction as never, db, "https://sync.example.com");
    assert.equal(first.replies.length, 1);
    const firstToken = bookmarkToken(first.replies[0].content ?? "");
    assert.deepEqual(db.consumeImportTokenWithRecipient(firstToken), {
      discordUserId: "discord-user", notificationChannelId: "first-channel", wantsImage: true
    });

    const repeated = syncInteraction("sync", "second-channel", false);
    await handleMaimai(repeated.interaction as never, db, "https://sync.example.com");
    assert.match(repeated.replies[0].content ?? "", /作成済み/);
    assert.doesNotMatch(repeated.replies[0].content ?? "", /javascript:/);
    assert.deepEqual(db.consumeImportTokenWithRecipient(firstToken), {
      discordUserId: "discord-user", notificationChannelId: "second-channel", wantsImage: false
    });

    const reset = syncInteraction("sync-reset", "reset-channel");
    await handleMaimai(reset.interaction as never, db, "https://sync.example.com");
    const resetToken = bookmarkToken(reset.replies[0].content ?? "");
    assert.notEqual(resetToken, firstToken);
    assert.equal(db.consumeImportTokenWithRecipient(firstToken), undefined);
    assert.deepEqual(db.consumeImportTokenWithRecipient(resetToken), {
      discordUserId: "discord-user", notificationChannelId: "reset-channel", wantsImage: false
    });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
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

test("difficulty rows omit the selected difficulty and align chart type to three characters", () => {
  const dx = renderDifficultyScore({ title: "DX", difficulty: "EXPERT", rating: 0, internalLevel: 13.9, achievements: 99.6866, chartType: "dx" }, 0);
  const standard = renderDifficultyScore({ title: "STD", difficulty: "EXPERT", rating: 0, internalLevel: 13.9, achievements: 99.5, chartType: "standard" }, 1);
  assert.equal(dx, "# 1 [13.9]  99.6866% / DX  / DX");
  assert.equal(standard, "# 2 [13.9]  99.5000% / STD / STD");
  assert.equal(dx.indexOf("/ "), standard.indexOf("/ "));
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
  assert.ok(plate?.options?.find((option) => option.name === "difficulty"));
  assert.equal(level?.options?.find((option) => option.name === "level")?.required, true);
  assert.equal(level?.options?.find((option) => option.name === "kind")?.required, true);
  assert.ok(level?.options?.find((option) => option.name === "image"));
  assert.ok(level?.options?.find((option) => option.name === "difficulty"));
  const difficulty = command.options.find((option) => option.name === "difficulty");
  assert.equal(difficulty?.options?.find((option) => option.name === "difficulty")?.required, true);
  assert.ok(command.options.find((option) => option.name === "newconstant")?.options?.find((option) => option.name === "image"));
  assert.ok(command.options.find((option) => option.name === "sync-reset"));
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
