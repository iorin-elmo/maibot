import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeFreeBookmarklet, makePremiumBookmarklet, startBrowserSyncServer } from "../browser-sync.js";
import type { MaimaiCatalog } from "../catalog.js";
import { BotDatabase } from "../database.js";
import { createSyncSummary } from "../sync-summary.js";

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
  assert.ok(bookmarklet.includes("div.w_450.m_15,div.screw_block"));
  assert.ok(!bookmarklet.includes("i<15"));
  assert.ok(bookmarklet.length < 4_000);
});

test("browser sync sends a persisted notification after a restart and only on success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-sync-notification-"));
  const databasePath = join(directory, "test.sqlite");
  let db = new BotDatabase(databasePath);
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const payload = { playerName: "Player", rating: 1000, scores: [{ title: "Song", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "unknown", chartType: "dx" }] };
  const successfulToken = db.createImportToken("discord-user", { channelId: "channel-id", wantsImage: true });
  db.close();
  db = new BotDatabase(databasePath);
  const delivered: Array<{ channelId?: string; wantsImage: boolean; playerName: string }> = [];
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, { enrich: async (scores: unknown[]) => scores } as unknown as MaimaiCatalog,
    async (recipient, summary) => { delivered.push({ channelId: recipient.notificationChannelId, wantsImage: recipient.wantsImage, playerName: summary.playerName }); });
  try {
    const successful = await postWithRetry(`${origin}/v1/browser-sync`, successfulToken, payload);
    assert.equal(successful.status, 200);
    assert.deepEqual(delivered, [{ channelId: "channel-id", wantsImage: true, playerName: "Player" }]);

    const failedToken = db.createImportToken("discord-user", { channelId: "channel-id", wantsImage: false });
    const failed = await postWithRetry(`${origin}/v1/browser-sync`, failedToken, { ...payload, scores: [] });
    assert.equal(failed.status, 400);
    assert.equal(delivered.length, 1);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed sync notifications remain queued and are delivered after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-sync-outbox-"));
  const databasePath = join(directory, "test.sqlite");
  const db = new BotDatabase(databasePath);
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const payload = { playerName: "Player", rating: 1000, scores: [{ title: "Song", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "unknown", chartType: "dx" }] };
  const catalog = { enrich: async (scores: unknown[]) => scores } as unknown as MaimaiCatalog;
  const stopFailing = startBrowserSyncServer(origin, "127.0.0.1", port, db, catalog, async () => { throw new Error("temporary Discord failure"); });
  try {
    const synced = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user", { channelId: "channel-id", wantsImage: false }), payload);
    assert.equal(synced.status, 200);
    assert.equal(db.getPendingSyncNotifications().length, 1);
  } finally {
    stopFailing();
  }

  const delivered: string[] = [];
  const recoveredPort = await unusedPort();
  const recoveredOrigin = `http://127.0.0.1:${recoveredPort}`;
  const stopRecovered = startBrowserSyncServer(recoveredOrigin, "127.0.0.1", recoveredPort, db, catalog, async (_recipient, summary) => { delivered.push(summary.playerName); });
  try {
    for (let attempt = 0; attempt < 10 && (!delivered.length || db.getPendingSyncNotifications().length); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(delivered, ["Player"]);
    assert.equal(db.getPendingSyncNotifications().length, 0);
  } finally {
    stopRecovered();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("sync notifications for one user are delivered in import order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-sync-notification-order-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const catalog = { enrich: async (scores: unknown[]) => scores } as unknown as MaimaiCatalog;
  const delivered: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let firstStarted: (() => void) | undefined;
  const firstSending = new Promise<void>((resolve) => { firstStarted = resolve; });
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, catalog, async (_recipient, summary) => {
    delivered.push(summary.playerName);
    if (summary.playerName === "First") {
      firstStarted?.();
      await firstMayFinish;
    }
  });
  try {
    const payload = (playerName: string) => ({ playerName, rating: 1000, scores: [{ title: playerName, difficulty: "MASTER", level: "14", achievements: 100, chartKind: "unknown", chartType: "dx" }] });
    const first = postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user", { channelId: "channel-id", wantsImage: false }), payload("First"));
    await firstSending;
    const second = postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user", { channelId: "channel-id", wantsImage: false }), payload("Second"));
    releaseFirst?.();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.deepEqual(delivered, ["First", "Second"]);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a dead-lettered notification does not block later notifications", async () => {
  const directory = mkdtempSync(join(tmpdir(), "maibot-sync-dead-letter-"));
  const db = new BotDatabase(join(directory, "test.sqlite"));
  const firstSummary = createSyncSummary(undefined, [], "First", 1000, []);
  const secondSummary = createSyncSummary(undefined, [], "Second", 1000, []);
  const recipient = { discordUserId: "discord-user", notificationChannelId: "channel-id", wantsImage: false };
  db.createImportToken(recipient.discordUserId);
  db.queueSyncNotification(recipient, firstSummary);
  db.queueSyncNotification(recipient, secondSummary);
  const first = db.getPendingSyncNotifications()[0];
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal(db.recordSyncNotificationFailure(first.id), true);

  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const delivered: string[] = [];
  const stop = startBrowserSyncServer(origin, "127.0.0.1", port, db, { enrich: async (scores: unknown[]) => scores } as unknown as MaimaiCatalog,
    async (_recipient, summary) => {
      if (summary.playerName === "First") throw new Error("deleted channel");
      delivered.push(summary.playerName);
    });
  try {
    for (let attempt = 0; attempt < 10 && (!delivered.length || db.getPendingSyncNotifications().length); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(delivered, ["Second"]);
    assert.equal(db.getPendingSyncNotifications().length, 0);
  } finally {
    stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Standard bookmarklet assigns ranks within the page's new and old sections", async () => {
  const bookmarklet = makePremiumBookmarklet("http://127.0.0.1:31337", "test-token");
  const browser = globalThis as unknown as Record<string, unknown>;
  const original = { fetch: globalThis.fetch, location: browser.location, document: browser.document, alert: browser.alert };
  const row = (title: string) => ({
    classList: { contains: () => false },
    querySelector: (selector: string) => {
      if (selector === "div.music_name_block") return { textContent: title };
      if (selector === "div.music_lv_block") return { textContent: "14" };
      if (selector === "div.music_score_block") return { textContent: "100.0000%" };
      if (selector === ".music_dx_score_block") return { textContent: "969" };
      if (selector === "img.h_20.f_l") return { getAttribute: () => "master.png" };
      if (selector === "img.music_kind_icon") return { getAttribute: () => "dx.png" };
      return null;
    }
  });
  const heading = (textContent: string) => ({ textContent, classList: { contains: (name: string) => name === "screw_block" } });
  try {
    let resolveAlert: ((message: string) => void) | undefined;
    const alerted = new Promise<string>((resolve) => { resolveAlert = resolve; });
    let payload: { scores: Array<{ title: string; chartKind: string; officialRank: number }> } | undefined;
    browser.location = { hostname: "maimaidx.jp" };
    browser.document = {
      querySelectorAll: (selector: string) => selector === "div.w_450.m_15,div.screw_block"
        ? [heading("新曲ベスト"), row("Only New"), heading("旧曲ベスト"), row("First Old"), row("Second Old")]
        : [],
      querySelector: (selector: string) => selector === "div.rating_block" ? { textContent: "12345" }
        : selector === "div.name_block" ? { textContent: "Fixture Player" } : null
    };
    browser.alert = (message: unknown) => resolveAlert?.(String(message));
    globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
      assert.equal((init?.headers as Record<string, string>)["X-Import-Token"], "test-token");
      payload = JSON.parse(String(init?.body));
      return { ok: true, json: async () => ({ count: payload?.scores.length ?? 0 }) } as Response;
    }) as typeof fetch;

    Function(bookmarklet.slice("javascript:".length))();
    await Promise.race([alerted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Standard bookmarklet did not finish")), 1_000))]);
    assert.deepEqual(payload?.scores.map(({ title, chartKind, officialRank }) => ({ title, chartKind, officialRank })), [
      { title: "Only New", chartKind: "new", officialRank: 1 },
      { title: "First Old", chartKind: "old", officialRank: 1 },
      { title: "Second Old", chartKind: "old", officialRank: 2 }
    ]);
    assert.equal((payload?.scores[0] as { dxScore?: number } | undefined)?.dxScore, 969);
  } finally {
    globalThis.fetch = original.fetch;
    browser.location = original.location;
    browser.document = original.document;
    browser.alert = original.alert;
  }
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
        { title: "Standard Runner", difficulty: "MASTER", level: "14", achievements: 99.5, chartKind: "new", chartType: "dx", officialRank: 2 },
        ...Array.from({ length: 13 }, (_, index) => ({
          title: `Standard ${index + 3}`, difficulty: "MASTER", level: "14", achievements: 99, chartKind: "new", chartType: "dx", officialRank: index + 3
        }))
      ]
    });
    assert.equal(standard.status, 200);
    assert.equal((await standard.json() as { count: number }).count, 15);
    assert.equal(db.getScores("discord-user").length, 31);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Unmatched")?.rating, 235);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Unmatched")?.officialRank, undefined);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Outside 0")?.officialRank, undefined);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Best")?.officialRank, 1);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Runner")?.officialRank, 2);

    const allUnmatched = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1200,
      scores: [{ title: "Unmatched", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1, internalLevel: 14 }]
    });
    assert.equal(allUnmatched.status, 400);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Best")?.officialRank, 1);

    const truncated = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1200,
      scores: [{ title: "Standard Best", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 }]
    });
    assert.equal(truncated.status, 400);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Runner")?.officialRank, 2);

    const oversized = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("discord-user"), {
      playerName: "Standard", rating: 1200,
      scores: Array.from({ length: 16 }, (_, index) => ({
        title: `Oversized ${index + 1}`, difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: index + 1
      }))
    });
    assert.equal(oversized.status, 400);
    assert.equal(db.getScores("discord-user").find((score) => score.title === "Standard Runner")?.officialRank, 2);

    db.importProfile("legacy-user", {
      playerName: "Legacy", rating: 900,
      scores: [{ title: "Legacy Song", difficulty: "MASTER", level: "14", rating: 200, chartKind: "new" }]
    });
    const legacy = await postWithRetry(`${origin}/v1/browser-sync`, db.createImportToken("legacy-user"), {
      playerName: "Legacy", rating: 1000,
      scores: [{ title: "Legacy Song", difficulty: "MASTER", level: "14", achievements: 100, chartKind: "new", chartType: "dx", officialRank: 1 }]
    });
    assert.equal(legacy.status, 200);
    assert.deepEqual(db.getScores("legacy-user").map((score) => score.chartType), ["dx"]);
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
    assert.match(script, /integer=value/);
    const requestedDifficulties: number[] = [];
    const sentPayloads: Array<{ scores: Array<{ title: string; achievements: number; dxScore?: number; comboStatus?: string; syncStatus?: string; chartType: string }> }> = [];
    let mode: "valid" | "invalid" = "valid";
    let resolvePost: (() => void) | undefined;
    const posted = new Promise<void>((resolve) => { resolvePost = resolve; });
    let resolveAlert: ((message: string) => void) | undefined;
    const successAlert = new Promise<string>((resolve) => { resolveAlert = resolve; });

    const row = (achievements: number, dxScore: number) => ({
      id: "sta_fixture",
      firstElementChild: { className: "music_master_score_back" },
      querySelector: (selector: string) => {
        if (selector === ".music_name_block") return { textContent: "Fixture Song" };
        if (selector === ".music_lv_block") return { textContent: "14" };
        if (selector === ".music_score_block.w_120" || selector === ".music_score_block") return { textContent: `${achievements}%` };
        if (selector === "img.h_20.f_l") return { getAttribute: () => "master.png" };
        if (selector === "img.music_kind_icon") return { getAttribute: () => "standard.png" };
        return null;
      },
      querySelectorAll: (selector: string) => selector === ".music_score_block"
        ? [{ textContent: `${achievements}%` }, { textContent: `DX SCORE ${dxScore} / 2193` }]
        : selector === "img" ? [{ getAttribute: () => "music_icon_allperfectplus.png" }, { getAttribute: () => "music_icon_fullsyncdx.png" }]
          : []
    });
    const scorePage = {
      querySelector: (selector: string) => selector === ".main_wrapper" ? {} : null,
      querySelectorAll: () => [row(99, 1111), row(100, 2222)]
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
        const payload = JSON.parse(String(init?.body)) as { scores: Array<{ title: string; achievements: number; dxScore?: number; chartType: string }> };
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
    assert.equal(sentPayloads[0].scores[0].dxScore, 2222);
    assert.equal(sentPayloads[0].scores[0].comboStatus, "AP+");
    assert.equal(sentPayloads[0].scores[0].syncStatus, "FDX");

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
