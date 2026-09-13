import assert from "node:assert/strict";
import test from "node:test";
import { makeBookmarklet } from "../browser-sync.js";

test("無料コース同期用ブックマークレットはDiscord本文に収まる", () => {
  const bookmarklet = makeBookmarklet("http://127.0.0.1:31337", "test-token");
  assert.ok(bookmarklet.startsWith("javascript:"));
  assert.ok(bookmarklet.includes("/v1/bookmarklet?token=test-token"));
  assert.ok(bookmarklet.length < 2_000);
});
