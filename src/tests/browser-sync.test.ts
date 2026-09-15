import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeFreeBookmarklet, makePremiumBookmarklet, startBrowserSyncServer } from "../browser-sync.js";
import type { MaimaiCatalog } from "../catalog.js";
import { BotDatabase } from "../database.js";

async function unusedPort(): Promise<number> {
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("port unavailable"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function postWithRetry(url: string, token: string, payload: object): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Import-Token": token }, body: JSON.stringify(payload) });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

test("無料コース同期用ブックマークレットはDiscord本文に収まる", () => {
  const bookmarklet = makeFreeBookmarklet("http://127.0.0.1:31337", "test-token");
  assert.ok(bookmarklet.startsWith("javascript:"));
  assert.ok(bookmarklet.includes("/v1/free-bookmarklet"));
  assert.ok(bookmarklet.includes("X-Import-Token"));
  assert.ok(bookmarklet.includes('redirect:"error"'));
  assert.ok(!bookmarklet.includes("?token="));
  assert.ok(bookmarklet.length < 2_000);
});

test("Standardコース同期用ブックマークレットもDiscord本文に収まる", () => {
  const bookmarklet = makePremiumBookmarklet("http://127.0.0.1:31337", "test-token");
  assert.ok(bookmarklet.startsWith("javascript:"));
  assert.ok(bookmarklet.includes("/v1/browser-sync"));
  assert.ok(bookmarklet.includes('redirect:"error"'));
  assert.ok(bookmarklet.length < 2_000);
});

test("無料同期の空・不足スナップショットは保存済み譜面を置き換えない", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-browser-sync-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const catalog = {
    enrich: async (scores: Array<{ rating: number; chartKind?: "unknown" | "new" | "old" }>) => scores.map((score, index) => ({
      ...score, rating: 300 - index, internalLevel: 14, chartKind: index === 0 ? "new" : "old"
    }))
  } as unknown as MaimaiCatalog;
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, catalog);
  const payload = {
    playerName: "Player", rating: 1000,
    scores: [
      { title: "Incoming A", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "unknown", chartType: "dx" },
      { title: "Incoming B", difficulty: "EXPERT", level: "13", achievements: 99.5, chartKind: "unknown", chartType: "dx" }
    ]
  };
  try {
    db.importProfile("discord-user", { playerName: "Before", rating: 900, scores: [
      { title: "Before A", difficulty: "MASTER", rating: 200, chartKind: "new" },
      { title: "Before B", difficulty: "EXPERT", rating: 190, chartKind: "old" }
    ] });

    const valid = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), payload);
    assert.equal(valid.status, 200);
    assert.deepEqual(db.getScores("discord-user").map((score) => score.title), ["Incoming A", "Incoming B"]);

    const empty = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), { ...payload, scores: [] });
    assert.equal(empty.status, 400);
    const short = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), { ...payload, scores: [payload.scores[0]] });
    assert.equal(short.status, 400);
    assert.deepEqual(db.getScores("discord-user").map((score) => score.title), ["Incoming A", "Incoming B"]);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
