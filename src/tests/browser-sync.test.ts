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

async function getWithRetry(url: string, token: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await fetch(url, { headers: { "X-Import-Token": token } });
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
    enrich: async (scores: Array<{ title: string; rating: number; chartKind?: "unknown" | "new" | "old" }>) => scores.map((score, index) =>
      score.title === "Unmatched" ? score : {
        ...score, rating: 300 - index, internalLevel: 14, chartKind: score.chartKind === "unknown" ? (index === 0 ? "new" : "old") : score.chartKind
      })
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

    db.importProfile("discord-user", {
      playerName: "Free snapshot", rating: 1000,
      scores: Array.from({ length: 16 }, (_, index) => ({
        title: index === 15 ? "Unmatched" : `Outside ${index}`, difficulty: "MASTER", level: "14", rating: 250 - index,
        chartKind: "new" as const, chartType: "dx" as const, officialRank: index === 0 ? 1 : undefined
      }))
    });
    const standard = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1100,
      scores: [
        { title: "Standard Best", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 },
        { title: "Standard Runner", difficulty: "MASTER", level: "14", achievements: 99.5, chartKind: "new", chartType: "dx", officialRank: 2 }
      ]
    });
    assert.equal(standard.status, 200);
    assert.equal((await standard.json() as { count: number }).count, 2);
    assert.equal(db.getScores("discord-user").length, 18);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Unmatched")?.rating, 235);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Unmatched")?.officialRank, undefined);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Outside 0")?.officialRank, undefined);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Best")?.officialRank, 1);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Runner")?.officialRank, 2);

    const allUnmatched = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1200,
      scores: [{ title: "Unmatched", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 }]
    });
    assert.equal(allUnmatched.status, 400);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Best")?.officialRank, 1);

    const truncated = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1200,
      scores: [{ title: "Standard Best", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 }]
    });
    assert.equal(truncated.status, 400);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Runner")?.officialRank, 2);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("生成した無料同期スクリプトは全難易度を収集し、異常ページでは送信しない", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-free-script-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const catalog = { enrich: async () => [] } as unknown as MaimaiCatalog;
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, catalog);
  const browser = globalThis as unknown as Record<string, unknown>;
  const original = { fetch: globalThis.fetch, location: browser.location, document: browser.document, DOMParser: browser.DOMParser, alert: browser.alert };
  try {
    const token = db.createImportToken("discord-user");
    const scriptResponse = await getWithRetry(`${origin}/v1/free-bookmarklet`, token);
    assert.equal(scriptResponse.status, 200);
    const script = await scriptResponse.text();
    const requestedDifficulties: number[] = [];
    const sentPayloads: Array<{ scores: Array<{ title: string; achievements: number; chartType: string }> }> = [];
    let mode: "valid" | "invalid" = "valid";
    let resolvePost: (() => void) | undefined;
    const posted = new Promise<void>((resolve) => { resolvePost = resolve; });
    let resolveAlert: ((message: string) => void) | undefined;
    const successAlert = new Promise<string>((resolve) => { resolveAlert = resolve; });

    const row = (achievements: number) => ({
      id: "sta_fixture",
      firstElementChild: { className: "music_master_score_back" },
      querySelector: (selector: string) => {
        if (selector === ".music_name_block") return { textContent: "Fixture Song" };
        if (selector === ".music_lv_block") return { textContent: "14" };
        if (selector === ".music_score_block.w_120" || selector === ".music_score_block") return { textContent: `${achievements}%` };
        if (selector === "img.h_20.f_l") return { getAttribute: () => "master.png" };
        if (selector === "img.music_kind_icon") return { getAttribute: () => "standard.png" };
        return null;
      }
    });
    const scorePage = {
      querySelector: (selector: string) => selector === ".main_wrapper" ? {} : null,
      querySelectorAll: () => [row(99), row(100)]
    };
    const invalidPage = { querySelector: () => null, querySelectorAll: () => [] };
    class FixtureDOMParser {
      parseFromString(html: string) { return html === "invalid" ? invalidPage : scorePage; }
    }
    browser.location = { hostname: "maimaidx.jp", origin: "https://maimaidx.jp" };
    browser.document = {
      createElement: () => ({ style: {}, remove: () => undefined }),
      body: { append: () => undefined },
      querySelector: (selector: string) => selector === ".name_block"
        ? { textContent: "Fixture Player" }
        : selector === ".rating_block" ? { textContent: "12345" } : null
    };
    browser.DOMParser = FixtureDOMParser;
    browser.alert = (message: unknown) => resolveAlert?.(String(message));
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/record/musicGenre/search/")) {
        const difficulty = Number(url.searchParams.get("diff"));
        requestedDifficulties.push(difficulty);
        return { ok: true, text: async () => mode === "invalid" && difficulty === 3 ? "invalid" : "scores" } as Response;
      }
      if (url.pathname === "/v1/browser-sync") {
        assert.equal((init?.headers as Record<string, string>)["X-Import-Token"], token);
        const payload = JSON.parse(String(init?.body)) as { scores: Array<{ title: string; achievements: number; chartType: string }> };
        sentPayloads.push(payload);
        resolvePost?.();
        return { ok: true, json: async () => ({ count: payload.scores.length }) } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    Function(script)();
    await Promise.race([posted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("free script did not post")), 1_000))]);
    assert.match(await successAlert, /Botへ1件を同期しました/);
    assert.deepEqual(requestedDifficulties, [0, 1, 2, 3, 4]);
    assert.deepEqual(sentPayloads[0].scores.map(({ title, achievements, chartType }) => ({ title, achievements, chartType })), [
      { title: "Fixture Song", achievements: 100, chartType: "standard" }
    ]);

    mode = "invalid";
    requestedDifficulties.length = 0;
    const invalidAlert = new Promise<string>((resolve) => { resolveAlert = resolve; });
    Function(script)();
    const message = await Promise.race([invalidAlert, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("free script did not fail")), 1_000))]);
    assert.match(message, /同期できませんでした/);
    assert.deepEqual(requestedDifficulties, [0, 1, 2, 3]);
    assert.equal(sentPayloads.length, 1);
  } finally {
    globalThis.fetch = original.fetch;
    browser.location = original.location;
    browser.document = original.document;
    browser.DOMParser = original.DOMParser;
    browser.alert = original.alert;
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("同一ユーザーの無料同期と通常同期は到着順に保存する", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-import-order-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  let releaseFree: (() => void) | undefined;
  const freeCanFinish = new Promise<void>((resolve) => { releaseFree = resolve; });
  let signalFreeStarted: (() => void) | undefined;
  const freeStarted = new Promise<void>((resolve) => { signalFreeStarted = resolve; });
  const catalog = {
    enrich: async (scores: Array<{ chartKind?: "unknown" | "new" | "old"; rating: number }>) => {
      if (scores[0]?.chartKind === "unknown") {
        signalFreeStarted?.();
        await freeCanFinish;
      }
      return scores.map((score) => ({ ...score, rating: 300, internalLevel: 14, chartKind: "new" as const }));
    }
  } as unknown as MaimaiCatalog;
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, catalog);
  try {
    const freeImport = postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Player", rating: 1000,
      scores: [{ title: "Slow Free", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "unknown", chartType: "dx" }]
    });
    await freeStarted;
    const standardImport = postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Player", rating: 1100,
      scores: [{ title: "Standard Best", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 }]
    });
    releaseFree?.();
    assert.equal((await freeImport).status, 200);
    assert.equal((await standardImport).status, 200);
    const scores = db.getScores("discord-user");
    assert.deepEqual(scores.map((score) => score.title).sort(), ["Slow Free", "Standard Best"]);
    assert.equal(scores.find((score) => score.title === "Standard Best")?.officialRank, 1);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
