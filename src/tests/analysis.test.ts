import assert from "node:assert/strict";
import test from "node:test";
import { bestScores, totalBestRating, validateProfile } from "../analysis.js";

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
