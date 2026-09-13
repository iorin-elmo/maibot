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

export function validateProfile(value: unknown): ImportedProfile {
  if (!value || typeof value !== "object") throw new Error("JSONのルートがオブジェクトではありません。");
  const profile = value as Partial<ImportedProfile>;
  if (typeof profile.playerName !== "string" || !profile.playerName.trim()) {
    throw new Error("playerName は空でない文字列にしてください。");
  }
  if (!Number.isFinite(profile.rating)) throw new Error("rating は数値にしてください。");
  if (!Array.isArray(profile.scores)) throw new Error("scores は配列にしてください。");
  if (profile.scores.length > 3000) throw new Error("譜面数が多すぎます（上限3000件）。");

  const scores = profile.scores.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`scores[${index}] がオブジェクトではありません。`);
    const score = row as Partial<ScoreRecord>;
    if (typeof score.title !== "string" || !score.title.trim()) throw new Error(`scores[${index}].title が不正です。`);
    if (typeof score.difficulty !== "string" || !score.difficulty.trim()) throw new Error(`scores[${index}].difficulty が不正です。`);
    if (!Number.isFinite(score.rating)) throw new Error(`scores[${index}].rating が不正です。`);
    if (score.achievements !== undefined && !Number.isFinite(score.achievements)) throw new Error(`scores[${index}].achievements が不正です。`);
    if (score.dxScore !== undefined && (!Number.isInteger(score.dxScore) || score.dxScore < 0)) throw new Error(`scores[${index}].dxScore が不正です。`);
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
      achievements: score.achievements, dxScore: score.dxScore, rating: score.rating as number,
      chartKind: score.chartKind ?? "unknown", chartType: score.chartType, internalLevel: score.internalLevel,
      officialRank: score.officialRank, playedAt: score.playedAt
    };
  });
  return { playerName: profile.playerName.trim(), rating: profile.rating as number, updatedAt: profile.updatedAt, scores };
}
