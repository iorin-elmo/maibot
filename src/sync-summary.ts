import { EmbedBuilder } from "discord.js";
import { achievementRank, dxStar } from "./analysis.js";
import type { LinkedAccount, ScoreRecord } from "./types.js";

const comboOrder = { undefined: 0, FC: 1, "FC+": 2, AP: 3, "AP+": 4 } as const;
const syncOrder = { undefined: 0, FS: 1, FDX: 2 } as const;

export interface SyncChartUpdate {
  score: ScoreRecord;
  previous?: ScoreRecord;
  achievementGain?: number;
  dxScoreGain?: number;
  rankChanged: boolean;
  starChanged: boolean;
  comboImproved: boolean;
  syncImproved: boolean;
}

export interface SyncSummary {
  initial: boolean;
  playerName: string;
  previousRating?: number;
  rating: number;
  ratingGain?: number;
  scores: ScoreRecord[];
  updates: SyncChartUpdate[];
  scoreRecordCount: number;
  dxScoreRecordCount: number;
  rankUpdateCount: number;
  starUpdateCount: number;
  newApPlusCount: number;
  newApCount: number;
  newFcPlusCount: number;
  newFcCount: number;
  newFdxCount: number;
  rankUpdates: SyncChartUpdate[];
  starUpdates: SyncChartUpdate[];
  lampUpdates: SyncChartUpdate[];
}

function scoreKey(score: ScoreRecord, includeChartType = true): string {
  const difficulty = score.difficulty.normalize("NFKC").replace(/:/g, "").toUpperCase();
  return [score.title.normalize("NFKC"), difficulty, score.level?.normalize("NFKC") ?? "", includeChartType ? score.chartType ?? "" : ""].join("\u0000");
}

function numericGain(current: number | undefined, previous: number | undefined): number | undefined {
  if (typeof current !== "number") return undefined;
  const gain = current - (previous ?? 0);
  return gain > 0 ? gain : undefined;
}

function starOf(score: ScoreRecord | undefined): number | undefined {
  return score ? dxStar(score) : undefined;
}

function formatStar(score: ScoreRecord | undefined): string {
  return String(starOf(score) ?? "-");
}

function statusUpgraded<T extends keyof typeof comboOrder | keyof typeof syncOrder>(
  current: T | undefined, previous: T | undefined, order: Record<T | "undefined", number>
): boolean {
  return order[current ?? "undefined"] > order[previous ?? "undefined"];
}

function compareDifficulty(left: ScoreRecord, right: ScoreRecord): number {
  const level = (score: ScoreRecord) => {
    if (score.internalLevel !== undefined) return score.internalLevel;
    const parsed = Number(score.level?.replace("+", ".6"));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return level(right) - level(left);
}

function limitForDisplay(updates: SyncChartUpdate[]): SyncChartUpdate[] {
  return updates.slice(0, 5);
}

export function createSyncSummary(previousAccount: LinkedAccount | undefined, previousScores: ScoreRecord[], playerName: string, rating: number, scores: ScoreRecord[]): SyncSummary {
  const previousByKey = new Map(previousScores.map((score) => [scoreKey(score), score]));
  const legacyPreviousByKey = new Map(previousScores.filter((score) => score.chartType === undefined).map((score) => [scoreKey(score, false), score]));
  const currentChartCounts = new Map<string, number>();
  for (const score of scores) {
    const key = scoreKey(score, false);
    currentChartCounts.set(key, (currentChartCounts.get(key) ?? 0) + 1);
  }
  const initial = previousScores.length === 0;
  const updates = scores.flatMap((score): SyncChartUpdate[] => {
    const legacyKey = scoreKey(score, false);
    // Before chart type was stored, a DX and Standard chart could not be
    // distinguished. Fall back only when the incoming snapshot has one chart
    // for that title/difficulty/level, so distinct charts are never conflated.
    const previous = previousByKey.get(scoreKey(score))
      ?? (score.chartType !== undefined && currentChartCounts.get(legacyKey) === 1 ? legacyPreviousByKey.get(legacyKey) : undefined);
    const achievementGain = numericGain(score.achievements, previous?.achievements);
    const dxScoreGain = numericGain(score.dxScore, previous?.dxScore);
    const rankChanged = achievementRank(score.achievements) !== achievementRank(previous?.achievements);
    const currentStar = starOf(score);
    const previousStar = starOf(previous);
    const starChanged = currentStar !== undefined && previousStar !== undefined && currentStar > previousStar;
    const comboImproved = statusUpgraded(score.comboStatus, previous?.comboStatus, comboOrder);
    const syncImproved = statusUpgraded(score.syncStatus, previous?.syncStatus, syncOrder);
    if (initial || (!achievementGain && !dxScoreGain && !starChanged && !comboImproved && !syncImproved)) return [];
    return [{ score, previous, achievementGain, dxScoreGain, rankChanged, starChanged, comboImproved, syncImproved }];
  });
  const byRating = (left: SyncChartUpdate, right: SyncChartUpdate) => right.score.rating - left.score.rating
    || (right.score.achievements ?? 0) - (left.score.achievements ?? 0) || left.score.title.localeCompare(right.score.title, "ja");
  const allRankUpdates = updates.filter((update) => update.rankChanged).sort(byRating);
  const allStarUpdates = updates.filter((update) => update.starChanged)
    .sort((left, right) => (starOf(right.score) ?? -1) - (starOf(left.score) ?? -1)
      || compareDifficulty(left.score, right.score) || (right.dxScoreGain ?? 0) - (left.dxScoreGain ?? 0));
  const allLampUpdates = updates.filter((update) => update.comboImproved)
    .sort((left, right) => comboOrder[right.score.comboStatus ?? "undefined"] - comboOrder[left.score.comboStatus ?? "undefined"]
      || compareDifficulty(left.score, right.score) || (right.score.achievements ?? 0) - (left.score.achievements ?? 0));
  const rankUpdates = limitForDisplay(allRankUpdates);
  const starUpdates = limitForDisplay(allStarUpdates);
  const lampUpdates = limitForDisplay(allLampUpdates);
  const newly = (status: ScoreRecord["comboStatus"]) => updates.filter((update) => update.score.comboStatus === status && update.previous?.comboStatus !== status).length;
  const ratingGain = previousAccount?.rating === null || previousAccount?.rating === undefined ? undefined : rating - previousAccount.rating;
  return {
    initial, playerName, previousRating: previousAccount?.rating ?? undefined, rating, ratingGain, scores, updates,
    scoreRecordCount: updates.filter((update) => update.achievementGain !== undefined).length,
    dxScoreRecordCount: updates.filter((update) => update.dxScoreGain !== undefined).length,
    rankUpdateCount: allRankUpdates.length, starUpdateCount: allStarUpdates.length,
    newApPlusCount: newly("AP+"), newApCount: newly("AP"), newFcPlusCount: newly("FC+"), newFcCount: newly("FC"),
    newFdxCount: updates.filter((update) => update.score.syncStatus === "FDX" && update.previous?.syncStatus !== "FDX").length,
    rankUpdates, starUpdates, lampUpdates
  };
}

export function formatAchievement(value: number | undefined): string {
  return typeof value === "number" ? `${value.toFixed(4)}%` : "-%";
}

function shortTitle(title: string): string {
  return title.length > 36 ? `${title.slice(0, 35)}…` : title;
}

function formatRankUpdate(update: SyncChartUpdate): string {
  const { score, previous } = update;
  return `**${shortTitle(score.title)}**\n${achievementRank(previous?.achievements)} → ${achievementRank(score.achievements)} / ${formatAchievement(previous?.achievements)} → ${formatAchievement(score.achievements)} (+${update.achievementGain?.toFixed(4) ?? "0.0000"}%) / ${score.rating}`;
}

function formatStarUpdate(update: SyncChartUpdate): string {
  const { score, previous } = update;
  return `**${shortTitle(score.title)}**\nLv.${score.level ?? "?"} / ${previous?.dxScore ?? 0} → ${score.dxScore ?? 0} (+${update.dxScoreGain ?? 0})/${score.dxScoreMax ?? "?"} ☆${formatStar(previous)}→${formatStar(score)}`;
}

function formatLampUpdate(update: SyncChartUpdate): string {
  const { score, previous } = update;
  return `**${shortTitle(score.title)}**\n${score.comboStatus ?? "-"} / ${formatAchievement(previous?.achievements)} → ${formatAchievement(score.achievements)} (+${update.achievementGain?.toFixed(4) ?? "0.0000"}%) / ${previous?.comboStatus ?? "-"} → ${score.comboStatus ?? "-"}`;
}

function updateField(name: string, updates: SyncChartUpdate[], format: (update: SyncChartUpdate) => string): { name: string; value: string } {
  return { name, value: updates.length ? updates.map(format).join("\n\n") : "更新はありません" };
}

export function syncSummaryEmbed(summary: SyncSummary): EmbedBuilder {
  if (summary.initial) {
    return new EmbedBuilder()
      .setColor(0x53c8f1)
      .setTitle("maimai スコアの同期が完了しました")
      .setDescription(`${summary.playerName} の同期が完了しました。\nこれで \`/maimai best\`、\`/maimai candidate\`、\`/maimai dxscore\` などを利用できます。`)
      .addFields({ name: "Rating", value: String(summary.rating), inline: true });
  }
  const rating = summary.ratingGain === undefined ? String(summary.rating)
    : `${summary.previousRating} → ${summary.rating} (${summary.ratingGain >= 0 ? "+" : ""}${summary.ratingGain})`;
  return new EmbedBuilder()
    .setColor(0x53c8f1)
    .setTitle(`${summary.playerName} の同期結果`)
    .setDescription(`Rating: ${rating}`)
    .addFields(
      { name: "更新サマリー", value: `スコア新記録: ${summary.scoreRecordCount}曲 / ランク更新: ${summary.rankUpdateCount}曲\nDXスコア新記録: ${summary.dxScoreRecordCount}曲 / ☆更新: ${summary.starUpdateCount}曲\nAP+ +${summary.newApPlusCount}曲 / AP +${summary.newApCount}曲 / FC+ +${summary.newFcPlusCount}曲 / FC +${summary.newFcCount}曲 / FDX +${summary.newFdxCount}曲` },
      updateField("ランク更新", summary.rankUpdates, formatRankUpdate),
      updateField("☆更新", summary.starUpdates, formatStarUpdate),
      updateField("ランプ更新", summary.lampUpdates, formatLampUpdate)
    );
}
