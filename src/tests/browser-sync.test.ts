import assert from "node:assert/strict";
import test from "node:test";
import { makeFreeBookmarklet, makePremiumBookmarklet } from "../browser-sync.js";

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
