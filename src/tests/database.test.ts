import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BotDatabase } from "../database.js";

test("プロフィールの再インポートは前のスコアを置き換える", () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-test-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  try {
    db.link("discord-user", "sega-id");
    assert.equal(db.getDefaultImage("discord-user"), false);
    db.setDefaultImage("discord-user", true);
    assert.equal(db.getDefaultImage("discord-user"), true);
    assert.equal(db.getDefaultCount("discord-user"), undefined);
    db.setDefaultCount("discord-user", 25);
    assert.equal(db.getDefaultCount("discord-user"), 25);
    const firstBookmark = db.createPersistentSyncToken("discord-user", { channelId: "channel", wantsImage: true });
    assert.equal(firstBookmark.created, true);
    assert.ok(firstBookmark.token);
    const secondBookmark = db.createPersistentSyncToken("discord-user", { channelId: "other-channel", wantsImage: false });
    assert.deepEqual(secondBookmark, { created: false });
    const recipient = db.consumeImportTokenWithRecipient(firstBookmark.token!);
    assert.deepEqual(recipient, { discordUserId: "discord-user", notificationChannelId: "other-channel", wantsImage: false });
    assert.ok(db.consumeImportTokenWithRecipient(firstBookmark.token!));
    const resetBookmark = db.createPersistentSyncToken("discord-user", { channelId: "channel", wantsImage: false }, true);
    assert.equal(resetBookmark.created, true);
    assert.equal(db.consumeImportTokenWithRecipient(firstBookmark.token!), undefined);
    assert.throws(() => db.link("another-user", "sega-id"));
    const importToken = db.createImportToken("discord-user");
    assert.equal(db.consumeImportToken(importToken), "discord-user");
    assert.equal(db.consumeImportToken(importToken), undefined);
    db.importProfile("discord-user", {
      playerName: "Player", rating: 1000,
      scores: [{ title: "old", difficulty: "MASTER", rating: 100, chartKind: "old" }]
    });
    db.importProfile("discord-user", {
      playerName: "Player", rating: 1200,
      scores: [{ title: "new", difficulty: "EXPERT", rating: 120, chartKind: "new", comboStatus: "FC+", syncStatus: "FDX" }]
    });
    assert.equal(db.getAccount("discord-user")?.rating, 1200);
    assert.deepEqual(db.getScores("discord-user").map((score) => score.title), ["new"]);
    assert.deepEqual(db.getScores("discord-user").map(({ comboStatus, syncStatus }) => ({ comboStatus, syncStatus })), [{ comboStatus: "FC+", syncStatus: "FDX" }]);
    assert.equal(db.unlink("discord-user"), true);
    assert.equal(db.getScores("discord-user").length, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("同期トークンは連携コマンドなしでDiscordアカウントを作成する", () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-test-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  try {
    const token = db.createImportToken("discord-user");
    assert.equal(db.consumeImportToken(token), "discord-user");
    db.importProfile("discord-user", {
      playerName: "Player", rating: 15000,
      scores: [{ title: "song", difficulty: "MASTER", rating: 300, chartKind: "new" }]
    });
    assert.equal(db.getAccount("discord-user")?.rating, 15000);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
