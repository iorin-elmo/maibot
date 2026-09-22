import assert from "node:assert/strict";
import test from "node:test";
import { createSyncSummary, syncSummaryEmbed } from "../sync-summary.js";

const account = { discordUserId: "user", segaId: "sega", playerName: "Player", rating: 1000, updatedAt: "2026-01-01" };

test("first sync sends an onboarding summary", () => {
  const summary = createSyncSummary(undefined, [], "Player", 1234, [{ title: "First", difficulty: "MASTER", level: "14", achievements: 99, rating: 300, chartKind: "new", chartType: "dx" }]);
  assert.equal(summary.initial, true);
  assert.equal(summary.updates.length, 0);
  const embed = syncSummaryEmbed(summary).toJSON();
  assert.match(embed.description ?? "", /\/maimai best/);
});

test("later sync reports score, rank, AP, and FDX improvements", () => {
  const previous = [{ title: "Improved", difficulty: "MASTER", level: "14", achievements: 99.5, dxScore: 2000, comboStatus: "FC" as const, syncStatus: "FS" as const, rating: 300, chartKind: "new" as const, chartType: "dx" as const }];
  const current = [{ ...previous[0], achievements: 100.5, dxScore: 2100, comboStatus: "AP" as const, syncStatus: "FDX" as const }];
  const summary = createSyncSummary(account, previous, "Player", 1012, current);
  assert.equal(summary.initial, false);
  assert.equal(summary.ratingGain, 12);
  assert.equal(summary.updates.length, 1);
  assert.equal(summary.updates[0].rankChanged, true);
  assert.equal(summary.updates[0].comboImproved, true);
  assert.equal(summary.updates[0].syncImproved, true);
  assert.equal(summary.newApCount, 1);
  assert.equal(summary.newFdxCount, 1);
  const embed = syncSummaryEmbed(summary).toJSON();
  assert.equal(embed.title, "Player の同期結果");
  const fields = embed.fields ?? [];
  assert.match(fields.find((field) => field.name === "更新された譜面（1）")?.value ?? "", /SS\+ → SSS\+/);
});

test("later sync ignores score regressions and unchanged charts", () => {
  const previous = [{ title: "Stable", difficulty: "EXPERT", level: "13", achievements: 100, dxScore: 1000, rating: 250, chartKind: "old" as const, chartType: "dx" as const }];
  const current = [{ ...previous[0], achievements: 99.9, dxScore: 999 }];
  const summary = createSyncSummary(account, previous, "Player", 1000, current);
  assert.equal(summary.updates.length, 0);
});
