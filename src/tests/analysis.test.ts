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

test("候補は枠入り時に押し出される最低レートを基準にする", () => {
  const currentBest = Array.from({ length: 15 }, (_, index) => ({
    title: `Best ${index}`, difficulty: "MASTER", rating: 280, chartKind: "new" as const, officialRank: index + 1
  }));
  const candidates = [
    { title: "Near", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.99, internalLevel: 14, officialRank: 16 },
    { title: "High RA", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.4, internalLevel: 14.5, officialRank: 17 },
    { title: "Low RA", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 99.4, internalLevel: 14, officialRank: 18 },
    { title: "Does not enter", difficulty: "MASTER", rating: 270, chartKind: "new" as const, achievements: 80, internalLevel: 12, officialRank: 19 }
  ];

  const result = bestCandidates([...currentBest, ...candidates], "new", 10);
  assert.deepEqual(result.map((candidate) => candidate.score.title), ["Near", "High RA", "Low RA"]);
  assert.equal(result[0].nextRank, "SSS");
  assert.equal(result[0].ratingGain, 22);
  assert.ok(Math.abs(result[0].achievementGap - 0.01) < 0.000001);
});

test("Best枠内の譜面も、次ランクでレートが伸びるなら候補にする", () => {
  const best = Array.from({ length: 15 }, (_, index) => ({
    title: `Best ${index}`, difficulty: "MASTER", rating: index === 0 ? 302 : 280,
    chartKind: "new" as const, achievements: index === 0 ? 100 : 100.5,
    internalLevel: 14, officialRank: index + 1
  }));

  const result = bestCandidates(best, "new", 10);
  assert.deepEqual(result.map((candidate) => candidate.score.title), ["Best 0"]);
  assert.equal(result[0].nextRank, "SSS+");
  assert.equal(result[0].ratingGain, 13);
});

test("次ランクでは枠入りしない譜面も、上位ランクでレートが伸びるなら候補にする", () => {
  const currentBest = Array.from({ length: 15 }, (_, index) => ({
    title: `Best ${index}`, difficulty: "MASTER", rating: 300, chartKind: "new" as const, officialRank: index + 1
  }));
  const laterCandidate = {
    title: "Later", difficulty: "MASTER", rating: 288, chartKind: "new" as const,
    achievements: 99, internalLevel: 14, officialRank: 16
  };

  const result = bestCandidates([...currentBest, laterCandidate], "new", 10);
  assert.deepEqual(result.map((candidate) => candidate.score.title), ["Later"]);
  assert.equal(result[0].nextAchievement, 100);
  assert.equal(result[0].nextRank, "SSS");
  assert.equal(result[0].ratingGain, 2);
});
