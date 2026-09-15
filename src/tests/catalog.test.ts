import assert from "node:assert/strict";
import test from "node:test";
import { MaimaiCatalog } from "../catalog.js";

test("無料同期は不正な末尾バージョン一覧で新旧を推測しない", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    versions: [{ version: "current" }, {}],
    songs: [{ title: "Test", version: "current", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14 }] }]
  }))) as typeof fetch;
  try {
    const catalog = new MaimaiCatalog("https://example.invalid/dxdata.json");
    await assert.rejects(catalog.enrich([{
      title: "Test", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "unknown", chartType: "dx"
    }]), /譜面定数またはバージョン/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
