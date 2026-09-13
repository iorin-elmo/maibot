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
      scores: [{ title: "new", difficulty: "EXPERT", rating: 120, chartKind: "new" }]
    });
    assert.equal(db.getAccount("discord-user")?.rating, 1200);
    assert.deepEqual(db.getScores("discord-user").map((score) => score.title), ["new"]);
    assert.equal(db.unlink("discord-user"), true);
    assert.equal(db.getScores("discord-user").length, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
