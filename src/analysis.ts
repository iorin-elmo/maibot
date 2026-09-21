import type { ChartKind, ImportedProfile, ScoreRecord } from "./types.js";

export function chartKindOf(score: ScoreRecord): ChartKind {
  return score.chartKind === "new" || score.chartKind === "old" ? score.chartKind : "unknown";
}

export function bestScores(scores: ScoreRecord[], kind?: ChartKind, limit = 50): ScoreRecord[] {
  return scores
    .filter((score) => kind === undefined || chartKindOf(score) === kind)
    .sort((a, b) => (a.officialRank ?? Number.MAX_SAFE_INTEGER) - (b.officialRank ?? Number.MAX_SAFE_INTEGER)
      || b.rating - a.rating || (b.achievements ?? 0) - (a.achievements ?? 0))
    .slice(0, limit);
}

export function totalBestRating(scores: ScoreRecord[], newCount = 15, oldCount = 35): number {
  return bestScores(scores, "new", newCount).reduce((sum, score) => sum + score.rating, 0)
    + bestScores(scores, "old", oldCount).reduce((sum, score) => sum + score.rating, 0);
}

export function achievementRank(achievement: number | undefined): string {
  if (typeof achievement !== "number") return "-";
  if (achievement >= 100.5) return "SSS+";
  if (achievement >= 100) return "SSS";
  if (achievement >= 99.5) return "SS+";
  if (achievement >= 99) return "SS";
  if (achievement >= 98) return "S+";
  if (achievement >= 97) return "S";
  if (achievement >= 94) return "AAA";
  if (achievement >= 90) return "AA";
  if (achievement >= 80) return "A";
  if (achievement >= 75) return "BBB";
  if (achievement >= 70) return "BB";
  if (achievement >= 60) return "B";
  if (achievement >= 50) return "C";
  return "D";
}

export function singleChartRating(internalLevel: number, achievement: number): number {
  const coefficient = achievement >= 100.5 ? 22.4 : achievement >= 100 ? 21.6 : achievement >= 99.5 ? 21.1
    : achievement >= 99 ? 20.8 : achievement >= 98 ? 20.3 : achievement >= 97 ? 20 : achievement >= 94 ? 16.8
      : achievement >= 90 ? 15.2 : achievement >= 80 ? 13.6 : achievement >= 75 ? 12 : achievement >= 70 ? 11.2
        : achievement >= 60 ? 9.6 : achievement >= 50 ? 8 : achievement >= 40 ? 7 : achievement >= 30 ? 6
          : achievement >= 20 ? 5 : achievement >= 10 ? 4 : 0;
  return Math.floor(internalLevel * Math.min(achievement, 100.5) * coefficient / 100);
}

const nextRankThresholds = [50, 60, 70, 75, 80, 90, 94, 97, 98, 99, 99.5, 100, 100.5];

export interface BestCandidate {
  score: ScoreRecord;
  nextAchievement: number;
  nextRank: string;
  ratingAtNextRank: number;
  ratingGain: number;
  achievementGap: number;
}

/** DX score star thresholds, indexed by the number of stars earned. */
// ☆6 is the non-official 99% milestone; the in-game DX stars end at ☆5.
export const dxStarThresholds = [0, 85, 90, 93, 95, 97, 99] as const;

export function dxScorePercent(score: ScoreRecord): number | undefined {
  if (typeof score.dxScore !== "number" || typeof score.dxScoreMax !== "number" || score.dxScoreMax <= 0) return undefined;
  return score.dxScore / score.dxScoreMax * 100;
}

export function dxStar(score: ScoreRecord): number | undefined {
  const percent = dxScorePercent(score);
  if (percent === undefined) return undefined;
  for (let stars = 6; stars >= 0; stars -= 1) {
    if (percent >= dxStarThresholds[stars]) return stars;
  }
  return 0;
}

export interface DxStarCandidate {
  score: ScoreRecord;
  currentStars: number;
  targetStars: number;
  missingScore: number;
}

/**
 * Returns charts below the requested target. Charts one star below it are
 * listed first; lower-star charts fill the requested count when necessary.
 * Each row always shows the exact DX points required for that chart's next
 * star, rather than a multi-star jump.
 */
export function dxStarCandidates(scores: ScoreRecord[], level: string, requestedStars: number, limit = 10): DxStarCandidate[] {
  if (dxStarThresholds[requestedStars] === undefined || requestedStars < 1) return [];
  return scores.flatMap((score): DxStarCandidate[] => {
    const currentStars = dxStar(score);
    if (score.level !== level || currentStars === undefined || currentStars >= requestedStars || score.dxScore === undefined || score.dxScoreMax === undefined) return [];
    const targetStars = currentStars + 1;
    const threshold = dxStarThresholds[targetStars];
    return [{
      score,
      currentStars,
      targetStars,
      // Scores are integral. Reaching a fractional percentage threshold must
      // round up to the next attainable DX point.
      missingScore: Math.max(0, Math.ceil(score.dxScoreMax * threshold / 100) - score.dxScore)
    }];
  }).sort((a, b) => b.currentStars - a.currentStars
    || a.missingScore - b.missingScore
    || (dxScorePercent(b.score) ?? 0) - (dxScorePercent(a.score) ?? 0)
    || a.score.title.localeCompare(b.score.title, "ja"))
    .slice(0, limit);
}

/**
 * Finds charts which would improve the Best total at a higher achievement
 * rank. Charts outside the frame are compared with the lowest-rated chart in
 * the current frame, because that is the chart they would displace. Each
 * chart uses its nearest higher rank that improves the total, so charts which
 * need more than one rank increase can also be returned.
 */
export function bestCandidates(scores: ScoreRecord[], kind: "new" | "old", limit = 10): BestCandidate[] {
  const frameSize = kind === "new" ? 15 : 35;
  const currentBest = bestScores(scores, kind, frameSize);
  const bestSet = new Set(currentBest);
  const lowestBestRating = currentBest.length === frameSize
    ? Math.min(...currentBest.map((score) => score.rating))
    : undefined;

  return scores.flatMap((score): BestCandidate[] => {
    if (chartKindOf(score) !== kind
      || typeof score.achievements !== "number" || typeof score.internalLevel !== "number") return [];
    const alreadyInBest = bestSet.has(score);
    const upgrade = nextRankThresholds
      .filter((threshold) => threshold > score.achievements!)
      .map((achievement) => ({ achievement, rating: singleChartRating(score.internalLevel!, achievement) }))
      .find(({ rating }) => alreadyInBest
        ? rating > score.rating
        : lowestBestRating === undefined || rating > lowestBestRating);
    if (!upgrade) return [];
    const ratingGain = alreadyInBest
      ? upgrade.rating - score.rating
      : lowestBestRating === undefined ? upgrade.rating : upgrade.rating - lowestBestRating;
    return [{
      score,
      nextAchievement: upgrade.achievement,
      nextRank: achievementRank(upgrade.achievement),
      ratingAtNextRank: upgrade.rating,
      ratingGain,
      achievementGap: upgrade.achievement - score.achievements
    }];
  }).sort((a, b) => a.achievementGap - b.achievementGap
    || b.ratingAtNextRank - a.ratingAtNextRank
    || b.score.rating - a.score.rating)
    .slice(0, limit);
}

export function validateProfile(value: unknown): ImportedProfile {
  if (!value || typeof value !== "object") throw new Error("JSONのルートがオブジェクトではありません。");
  const profile = value as Partial<ImportedProfile>;
  if (typeof profile.playerName !== "string" || !profile.playerName.trim()) {
    throw new Error("playerName は空でない文字列にしてください。");
  }
  if (!Number.isFinite(profile.rating)) throw new Error("rating は数値にしてください。");
  if (!Array.isArray(profile.scores)) throw new Error("scores は配列にしてください。");
  // Free-course sync collects all played charts before the server selects Best
  // 15 + 35. A long-time player can legitimately exceed the old 3,000 limit.
  if (profile.scores.length > 10_000) throw new Error("譜面数が多すぎます（上限10000件）。");

  const scores = profile.scores.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`scores[${index}] がオブジェクトではありません。`);
    const score = row as Partial<ScoreRecord>;
    if (typeof score.title !== "string" || !score.title.trim()) throw new Error(`scores[${index}].title が不正です。`);
    if (typeof score.difficulty !== "string" || !score.difficulty.trim()) throw new Error(`scores[${index}].difficulty が不正です。`);
    if (!Number.isFinite(score.rating)) throw new Error(`scores[${index}].rating が不正です。`);
    if (score.achievements !== undefined && !Number.isFinite(score.achievements)) throw new Error(`scores[${index}].achievements が不正です。`);
    if (score.dxScore !== undefined && (!Number.isInteger(score.dxScore) || score.dxScore < 0)) throw new Error(`scores[${index}].dxScore が不正です。`);
    if (score.dxScoreMax !== undefined && (!Number.isInteger(score.dxScoreMax) || score.dxScoreMax < 1)) throw new Error(`scores[${index}].dxScoreMax が不正です。`);
    if (score.comboStatus !== undefined && !["AP+", "AP", "FC+", "FC"].includes(score.comboStatus)) throw new Error(`scores[${index}].comboStatus が不正です。`);
    if (score.syncStatus !== undefined && !["FDX", "FS"].includes(score.syncStatus)) throw new Error(`scores[${index}].syncStatus が不正です。`);
    if (score.chartType !== undefined && score.chartType !== "dx" && score.chartType !== "standard") throw new Error(`scores[${index}].chartType が不正です。`);
    if (score.internalLevel !== undefined && !Number.isFinite(score.internalLevel)) throw new Error(`scores[${index}].internalLevel が不正です。`);
    if (score.chartKind && !["new", "old", "unknown"].includes(score.chartKind)) {
      throw new Error(`scores[${index}].chartKind は new / old / unknown です。`);
    }
    if (score.officialRank !== undefined && (!Number.isInteger(score.officialRank) || score.officialRank < 1 || score.officialRank > 3000)) {
      throw new Error(`scores[${index}].officialRank が不正です。`);
    }
    return {
      title: score.title.trim(), difficulty: score.difficulty.trim(), level: score.level,
      achievements: score.achievements, dxScore: score.dxScore, dxScoreMax: score.dxScoreMax, comboStatus: score.comboStatus, syncStatus: score.syncStatus, rating: score.rating as number,
      chartKind: score.chartKind ?? "unknown", chartType: score.chartType, internalLevel: score.internalLevel,
      officialRank: score.officialRank, playedAt: score.playedAt
    };
  });
  return { playerName: profile.playerName.trim(), rating: profile.rating as number, updatedAt: profile.updatedAt, scores };
}
