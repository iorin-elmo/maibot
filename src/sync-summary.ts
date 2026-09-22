import { EmbedBuilder } from "discord.js";
import { achievementRank } from "./analysis.js";
import type { LinkedAccount, ScoreRecord } from "./types.js";

const comboOrder = { undefined: 0, FC: 1, "FC+": 2, AP: 3, "AP+": 4 } as const;
const syncOrder = { undefined: 0, FS: 1, FDX: 2 } as const;

export interface SyncChartUpdate {
  score: ScoreRecord;
  previous?: ScoreRecord;
  achievementGain?: number;
  dxScoreGain?: number;
  rankChanged: boolean;
  comboImproved: boolean;
  syncImproved: boolean;
}

export interface SyncSummary {
  initial: boolean;
  playerName: string;
  scoreCount: number;
  previousRating?: number;
  rating: number;
  ratingGain?: number;
  scores: ScoreRecord[];
  updates: SyncChartUpdate[];
  newApCount: number;
  newFcCount: number;
  newFdxCount: number;
}

function scoreKey(score: ScoreRecord): string {
  const difficulty = score.difficulty.normalize("NFKC").replace(/:/g, "").toUpperCase();
  return [score.title.normalize("NFKC"), difficulty, score.level?.normalize("NFKC") ?? "", score.chartType ?? ""].join("\u0000");
}

function numericGain(current: number | undefined, previous: number | undefined): number | undefined {
  if (typeof current !== "number") return undefined;
  return current - (previous ?? 0);
}

function difficultyLabel(difficulty: string): string {
  switch (difficulty.replace(/:/g, "").toUpperCase()) {
    case "BASIC": return "Bas";
    case "ADVANCED": return "Adv";
    case "EXPERT": return "Exp";
    case "MASTER": return "Mas";
    case "REMASTER": return "ReM";
    default: return difficulty;
  }
}

function statusUpgraded<T extends keyof typeof comboOrder | keyof typeof syncOrder>(
  current: T | undefined, previous: T | undefined, order: Record<T | "undefined", number>
): boolean {
  return order[current ?? "undefined"] > order[previous ?? "undefined"];
}

export function createSyncSummary(previousAccount: LinkedAccount | undefined, previousScores: ScoreRecord[], playerName: string, rating: number, scores: ScoreRecord[]): SyncSummary {
  const previousByKey = new Map(previousScores.map((score) => [scoreKey(score), score]));
  const initial = previousScores.length === 0;
  const updates = scores.flatMap((score): SyncChartUpdate[] => {
    const previous = previousByKey.get(scoreKey(score));
    const achievementGain = numericGain(score.achievements, previous?.achievements);
    const dxScoreGain = numericGain(score.dxScore, previous?.dxScore);
    const rankChanged = achievementRank(score.achievements) !== achievementRank(previous?.achievements);
    const comboImproved = statusUpgraded(score.comboStatus, previous?.comboStatus, comboOrder);
    const syncImproved = statusUpgraded(score.syncStatus, previous?.syncStatus, syncOrder);
    if (initial || (!(achievementGain && achievementGain > 0) && !(dxScoreGain && dxScoreGain > 0) && !comboImproved && !syncImproved)) return [];
    return [{ score, previous, achievementGain: achievementGain && achievementGain > 0 ? achievementGain : undefined,
      dxScoreGain: dxScoreGain && dxScoreGain > 0 ? dxScoreGain : undefined, rankChanged, comboImproved, syncImproved }];
  }).sort((left, right) => Number(right.comboImproved || right.syncImproved) - Number(left.comboImproved || left.syncImproved)
    || (right.achievementGain ?? 0) - (left.achievementGain ?? 0)
    || (right.dxScoreGain ?? 0) - (left.dxScoreGain ?? 0)
    || left.score.title.localeCompare(right.score.title, "ja"));
  const newApCount = updates.filter(({ score, previous }) => score.comboStatus?.startsWith("AP") && !previous?.comboStatus?.startsWith("AP")).length;
  const newFcCount = updates.filter(({ score, previous }) => (score.comboStatus === "FC" || score.comboStatus === "FC+") && !previous?.comboStatus).length;
  const newFdxCount = updates.filter(({ score, previous }) => score.syncStatus === "FDX" && previous?.syncStatus !== "FDX").length;
  const ratingGain = previousAccount?.rating === null || previousAccount?.rating === undefined ? undefined : rating - previousAccount.rating;
  return { initial, playerName, scoreCount: scores.length, previousRating: previousAccount?.rating ?? undefined, rating, ratingGain, scores, updates, newApCount, newFcCount, newFdxCount };
}

function formatAchievement(value: number | undefined): string {
  return typeof value === "number" ? `${value.toFixed(4)}%` : "-%";
}

function formatGain(value: number | undefined, digits: number, suffix = ""): string | undefined {
  return value === undefined ? undefined : `+${value.toFixed(digits)}${suffix}`;
}

function formatUpdate(update: SyncChartUpdate): string {
  const { score, previous } = update;
  const title = score.title.length > 42 ? `${score.title.slice(0, 41)}…` : score.title;
  const parts = [`**[${difficultyLabel(score.difficulty)}${score.level ? ` Lv.${score.level}` : ""}] ${title}**`];
  const achievement = `${formatAchievement(previous?.achievements)} → ${formatAchievement(score.achievements)}`;
  const achievementGain = formatGain(update.achievementGain, 4, "%");
  parts.push(achievementGain ? `${achievement} (${achievementGain})` : achievement);
  if (update.dxScoreGain) parts.push(`DX ${previous?.dxScore ?? 0} → ${score.dxScore ?? 0} (+${update.dxScoreGain})`);
  const oldRank = achievementRank(previous?.achievements);
  const newRank = achievementRank(score.achievements);
  if (oldRank !== newRank) parts.push(`${oldRank} → ${newRank}`);
  const badges = [
    update.comboImproved ? `${score.comboStatus} NEW` : undefined,
    update.syncImproved ? `${score.syncStatus} NEW` : undefined
  ].filter(Boolean);
  if (badges.length) parts.push(badges.join(" / "));
  return parts.join("\n");
}

export function syncSummaryEmbed(summary: SyncSummary): EmbedBuilder {
  if (summary.initial) {
    return new EmbedBuilder()
      .setColor(0x53c8f1)
      .setTitle("maimai スコアの同期が完了しました")
      .setDescription(`${summary.playerName} さんの ${summary.scoreCount} 譜面を同期しました。\n` +
        `これで \`/maimai best\`、\`/maimai candidate\`、\`/maimai dxscore\` などを利用できます。`)
      .addFields({ name: "Rating", value: String(summary.rating), inline: true });
  }
  const rating = summary.ratingGain === undefined ? String(summary.rating)
    : `${summary.previousRating} → ${summary.rating} (${summary.ratingGain >= 0 ? "+" : ""}${summary.ratingGain})`;
  const achievementSummary = [
    summary.newApCount ? `AP ${summary.newApCount}` : undefined,
    summary.newFcCount ? `FC ${summary.newFcCount}` : undefined,
    summary.newFdxCount ? `FDX ${summary.newFdxCount}` : undefined
  ].filter(Boolean).join(" / ") || "新規達成はありません";
  const shown: string[] = [];
  for (const update of summary.updates.slice(0, 8)) {
    const formatted = formatUpdate(update);
    if (shown.join("\n\n").length + formatted.length + 2 > 900) break;
    shown.push(formatted);
  }
  const updateText = shown.length ? shown.join("\n\n") : "スコア・称号の更新はありません。";
  const more = summary.updates.length > shown.length ? `\nほか ${summary.updates.length - shown.length} 譜面` : "";
  return new EmbedBuilder()
    .setColor(0x53c8f1)
      .setTitle(`${summary.playerName} の同期結果`)
    .setDescription(`Rating: ${rating}\n同期譜面数: ${summary.scoreCount}`)
    .addFields(
      { name: "新規達成", value: achievementSummary, inline: true },
      { name: `更新された譜面（${summary.updates.length}）`, value: `${updateText}${more}` }
    );
}
