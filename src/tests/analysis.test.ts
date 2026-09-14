import assert from "node:assert/strict";
import test from "node:test";
import { bestCandidates, bestScores, totalBestRating, validateProfile } from "../analysis.js";

test("new/old ごとにレート順でベストを切り出す", () => {
  const scores = [
    { title: "A", difficulty: "MASTER", rating: 100, chartKind: "new" as const },
    { title: "B", difficulty: "MASTER", rating: 200, chartKind: "new" as const },
    { title: "C", difficulty: "MASTER", rating: 300, chartKind: "old" as const }
  ];
  assert.deepEqual(bestScores(scores, "new", 1).map((score) => score.title), ["B"]);
  assert.equal(totalBestRating(scores, 1, 1), 500);
});

test("不正なプロフィールJSONを拒否する", () => {
  assert.throws(() => validateProfile({ playerName: "x", rating: 1, scores: [{ title: "x", difficulty: "M" }] }));
});

test("候補は次ランクで枠入りする譜面だけを、必要達成率差優先で出す", () => {
  const currentBest = Array.from({ length: 15 }, (_, index) => ({
    title: `Best ${index}`, difficulty: "MASTER", rating: 280, chartKind: "new" as const
  }));
  const candidates = [
    { title: "Near", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.99, internalLevel: 14 },
    { title: "High RA", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.4, internalLevel: 14.5 },
    { title: "Low RA", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.4, internalLevel: 14 },
    { title: "Does not enter", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 80, internalLevel: 12 }
  ];

  const result = bestCandidates([...currentBest, ...candidates], "new", 10);
  assert.deepEqual(result.map((candidate) => candidate.score.title), ["Near", "High RA", "Low RA"]);
  assert.equal(result[0].nextRank, "SSS");
  assert.ok(Math.abs(result[0].achievementGap - 0.01) < 0.000001);
});
