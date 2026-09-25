import assert from "node:assert/strict";
import test from "node:test";
import { singleChartRating } from "../analysis.js";
import { MaimaiCatalog } from "../catalog.js";

test("無料同期は不正なバージョン一覧をキャッシュせず、復旧後に新旧と定数を照合する", async () => {
  let document: unknown = {
    versions: [{ version: "current" }, {}],
    songs: [{ title: "Test", imageName: "test-jacket", version: "current", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14, noteCounts: { total: 743 } }] }]
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
    assert.equal(standardScore[0].dxScoreMax, 2229);
    assert.equal(standardScore[0].jacketImageName, "test-jacket");
    assert.equal(fetchCount, 1);

    document = {
      versions: [{ version: "old" }, { version: "new-1" }, { version: "new-2" }],
      songs: [
        { title: "New", version: "new-1", isLocked: true, sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14.2 }] },
        { title: "Unplayed", version: "new-2", sheets: [{ type: "dx", difficulty: "EXPERT", level: "14", internalLevelValue: 14.1 }] },
        { title: "UTAGE", version: "new-2", sheets: [{ type: "utage", difficulty: "宴", level: "?", internalLevelValue: 15 }] },
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

    const newChartRanking = await catalog.newestChartConstantRanking([{
      title: "New", difficulty: "MASTER", achievements: 98, rating: 0, chartKind: "new"
    }]);
    assert.deepEqual(newChartRanking.map((score) => score.title), ["New", "Unplayed"]);
    assert.deepEqual(newChartRanking.map((score) => score.achievements), [98, undefined]);
    assert.deepEqual(newChartRanking.map((score) => score.internalLevel), [14.2, 14.1]);

    const progressScores = [{
      title: "New", difficulty: "MASTER", level: "14", achievements: 98, comboStatus: "FC" as const, syncStatus: "FS" as const,
      rating: 0, chartKind: "new" as const, chartType: "dx" as const
    }];
    const levelProgress = await catalog.levelProgressRanking("14", progressScores);
    assert.deepEqual(levelProgress.map((score) => score.title), ["New", "Unplayed"]);
    assert.deepEqual(levelProgress.map((score) => score.comboStatus), ["FC", undefined]);
    const plateProgress = await catalog.plateProgressRanking(["new-1"], progressScores);
    assert.deepEqual(plateProgress.map((score) => score.title), ["New"]);
    assert.equal(plateProgress[0].syncStatus, "FS");

    const typedLevelLessRanking = await catalog.newestChartConstantRanking([{
      title: "New", difficulty: "MASTER", achievements: 97, rating: 0, chartKind: "new", chartType: "dx"
    }]);
    assert.deepEqual(typedLevelLessRanking.map((score) => score.achievements), [97, undefined]);

    document = {
      versions: [{ version: "old" }, { version: "new-1" }, { version: "new-2" }],
      songs: [{ title: "Ambiguous", version: "new-2", sheets: [
        { type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14 },
        { type: "std", difficulty: "MASTER", level: "14", internalLevelValue: 14 },
        { type: "std", difficulty: "RE:MASTER", level: "14", internalLevelValue: 14 },
        { type: "dx", difficulty: "RE:MASTER", level: "14", internalLevelValue: 14 }
      ] }]
    };
    const ambiguousCatalog = new MaimaiCatalog("https://example.invalid/dxdata.json");
    const ambiguousRanking = await ambiguousCatalog.newestChartConstantRanking([{
      title: "Ambiguous", difficulty: "MASTER", achievements: 98, rating: 0, chartKind: "new"
    }]);
    assert.deepEqual(ambiguousRanking.map((score) => score.achievements), [undefined, undefined, undefined, undefined]);
    assert.equal((await ambiguousCatalog.plateProgressRanking(["new-2"], [])).length, 2);
    assert.deepEqual((await ambiguousCatalog.plateProgressRanking(["new-2"], [], true, [], true))
      .map((score) => score.difficulty), ["MASTER", "RE:MASTER"]);
    const remasterProgress = await ambiguousCatalog.levelProgressRanking("14", [{
      title: "Ambiguous", difficulty: "REMASTER", level: "14", achievements: 98, rating: 0, chartKind: "new", chartType: "dx"
    }]);
    assert.equal(remasterProgress.find((score) => score.difficulty === "RE:MASTER" && score.chartType === "dx")?.achievements, 98);
    const masterDifficulty = await ambiguousCatalog.difficultyProgressRanking("MASTER", [{
      title: "Ambiguous", difficulty: "MASTER", level: "14", achievements: 99, rating: 0, chartKind: "new", chartType: "standard"
    }]);
    assert.equal(masterDifficulty.length, 2);
    assert.equal(masterDifficulty.find((score) => score.chartType === "standard")?.achievements, 99);

    document = {
      versions: [{ version: "old" }, { version: "new-1" }, { version: "new-2" }],
      songs: [{ title: "Unlisted", version: "not-in-version-list", sheets: [{ type: "dx", difficulty: "MASTER", level: "14", internalLevelValue: 14 }] }]
    };
    const unlistedCatalog = new MaimaiCatalog("https://example.invalid/dxdata.json");
    await assert.rejects(unlistedCatalog.enrich([{
      title: "Unlisted", difficulty: "MASTER", level: "14", achievements: 100, rating: 0, chartKind: "unknown", chartType: "dx"
    }]), /譜面定数またはバージョン/);
    assert.equal(fetchCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
