import assert from "node:assert/strict";
import test from "node:test";
import { singleChartRating } from "../analysis.js";
import { MaimaiCatalog } from "../catalog.js";

test("無料同期は不正なバージョン一覧をキャッシュせず、復旧後に新旧と定数を照合する", async () => {
  let document: unknown = {
    versions: [{ version: "current" }, {}],
    songs: [{ title: "Test", version: "current", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14 }] }]
  };
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response(JSON.stringify(document));
  }) as typeof fetch;
  try {
    const catalog = new MaimaiCatalog("https://example.invalid/dxdata.json");
    await assert.rejects(catalog.enrich([{
      title: "Test", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "unknown", chartType: "dx"
    }]), /譜面定数またはバージョン/);
    const standardScore = await catalog.enrich([{
      title: "Test", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "new", chartType: "dx"
    }]);
    assert.equal(standardScore[0].internalLevel, 14);
    assert.equal(fetchCount, 1);

    document = {
      versions: [{ version: "old" }, { version: "new-1" }, { version: "new-2" }],
      songs: [
        { title: "New", version: "new-1", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14.2 }] },
        { title: "Old", version: "old", sheets: [{ type: "dx", difficulty: "EXPERT", level: "13", internalLevelValue: 13.4 }] }
      ]
    };
    const [newScore, oldScore] = await catalog.enrich([
      { title: "New", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "unknown", chartType: "dx" },
      { title: "Old", difficulty: "EXPERT", level: "13", achievements: 99.5, rating: 0, chartKind: "unknown", chartType: "dx" }
    ]);
    assert.deepEqual([newScore.chartKind, oldScore.chartKind], ["new", "old"]);
    assert.deepEqual([newScore.internalLevel, oldScore.internalLevel], [14.2, 13.4]);
    assert.equal(newScore.rating, singleChartRating(14.2, 100));
    assert.equal(oldScore.rating, singleChartRating(13.4, 99.5));
    assert.equal(fetchCount, 2);

    document = {
      versions: [{ version: "old" }, { version: "new-1" }, { version: "new-2" }],
      songs: [{ title: "Unlisted", version: "not-in-version-list", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14 }] }]
    };
    const unlistedCatalog = new MaimaiCatalog("https://example.invalid/dxdata.json");
    await assert.rejects(unlistedCatalog.enrich([{
      title: "Unlisted", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "unknown", chartType: "dx"
    }]), /譜面定数またはバージョン/);
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
