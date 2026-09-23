import { existsSync } from "node:fs";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { achievementRank, dxScorePercent, dxStar, type BestCandidate, type DxStarCandidate } from "./analysis.js";
import { formatAchievement, type SyncChartUpdate, type SyncSummary } from "./sync-summary.js";
import type { ScoreRecord } from "./types.js";
import { truncateSongTitle } from "./text.js";

const FONT_NAME = "MaiBotMono";
const COVER_BASE_URL = "https://shama.dxrating.net/images/cover/v2";
const coverCache = new Map<string, Promise<Awaited<ReturnType<typeof loadImage>> | undefined>>();

if (process.platform === "win32" && existsSync("C:\\Windows\\Fonts\\msgothic.ttc")) {
  GlobalFonts.registerFromPath("C:\\Windows\\Fonts\\msgothic.ttc", FONT_NAME);
}

interface CardItem {
  score: ScoreRecord;
  topLeft: string;
  topRight: string;
  bottom: string;
  accent?: string;
}

export function difficultyAccent(difficulty: string): string {
  switch (difficulty.trim().toUpperCase()) {
    case "BASIC": return "#48c95a";
    case "ADVANCED": return "#f49a36";
    case "EXPERT": return "#ed4c55";
    case "MASTER": return "#9a62db";
    case "REMASTER":
    case "RE:MASTER": return "#ffffff";
    default: return "#ef8eea";
  }
}

async function jacket(score: ScoreRecord): Promise<Awaited<ReturnType<typeof loadImage>> | undefined> {
  if (!score.jacketImageName) return undefined;
  const url = `${COVER_BASE_URL}/${encodeURIComponent(score.jacketImageName)}.jpg`;
  let pending = coverCache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`Could not fetch jacket: ${response.status}`);
      return loadImage(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      // A temporary HTTP or decoding failure must be retried next time.
      coverCache.delete(url);
      return undefined;
    });
    coverCache.set(url, pending);
  }
  return pending;
}

function drawCover(context: SKRSContext2D, image: Awaited<ReturnType<typeof loadImage>> | undefined, x: number, y: number, width: number, height: number): void {
  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, 12);
  context.clip();
  context.fillStyle = "#403050";
  context.fillRect(x, y, width, height);
  if (image) {
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    context.fillStyle = "#6e4b86";
    context.fillRect(x, y, width, height);
    context.fillStyle = "#cdb7dc";
    context.font = `bold 20px ${FONT_NAME}, monospace`;
    context.textAlign = "center";
    context.fillText("NO JACKET", x + width / 2, y + height / 2);
    context.textAlign = "left";
  }
  const gradient = context.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, "rgba(19, 10, 31, 0.12)");
  gradient.addColorStop(0.48, "rgba(19, 10, 31, 0.02)");
  gradient.addColorStop(1, "rgba(19, 10, 31, 0.9)");
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
  context.restore();
}

function drawCard(context: SKRSContext2D, item: CardItem, image: Awaited<ReturnType<typeof loadImage>> | undefined, x: number, y: number, width: number, height: number): void {
  drawCover(context, image, x, y, width, height);
  context.strokeStyle = item.accent ?? "#ef8eea";
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(x + 1.5, y + 1.5, width - 3, height - 3, 11);
  context.stroke();
  context.font = `bold 20px ${FONT_NAME}, monospace`;
  context.lineWidth = 4;
  context.strokeStyle = "rgba(25, 9, 36, 0.9)";
  context.fillStyle = "#ffffff";
  context.strokeText(item.topLeft, x + 10, y + 26);
  context.fillText(item.topLeft, x + 10, y + 26);
  context.textAlign = "right";
  context.strokeText(item.topRight, x + width - 10, y + 26);
  context.fillText(item.topRight, x + width - 10, y + 26);
  context.textAlign = "left";
  context.font = `bold 17px ${FONT_NAME}, monospace`;
  const title = truncateSongTitle(item.score.title);
  context.strokeText(title, x + 10, y + height - 43);
  context.fillText(title, x + 10, y + height - 43);
  let bottomFontSize = 24;
  do {
    context.font = `bold ${bottomFontSize}px ${FONT_NAME}, monospace`;
    bottomFontSize -= 1;
  } while (context.measureText(item.bottom).width > width - 20 && bottomFontSize >= 14);
  context.fillStyle = "#ffef75";
  context.strokeText(item.bottom, x + 10, y + height - 13);
  context.fillText(item.bottom, x + 10, y + height - 13);
}

export async function renderScoreCardImages(playerName: string, title: string, items: CardItem[]): Promise<Buffer[]> {
  // Best 50 is intentionally a single 5 × 10 sheet, matching the in-game
  // rating-card layout. JPEG keeps the finished sheet below Discord's upload
  // limit even when every jacket is present.
  const perImage = Math.max(1, items.length);
  const images: Buffer[] = [];
  for (let start = 0; start < items.length; start += perImage) {
    const page = items.slice(start, start + perImage);
    const columns = Math.min(5, page.length);
    const cardWidth = 236;
    const cardHeight = 220;
    const gutter = 12;
    const headerHeight = 72;
    const rows = Math.ceil(page.length / columns);
    const width = columns * cardWidth + (columns + 1) * gutter;
    const height = headerHeight + rows * cardHeight + (rows + 1) * gutter;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#211b2e";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#ff5a9e";
    context.fillRect(0, 0, width, 7);
    context.fillStyle = "#f8f5ff";
    context.font = `bold 25px ${FONT_NAME}, monospace`;
    context.fillText(`${playerName} の ${title}${start ? ` (${start + 1}-${start + page.length})` : ""}`, gutter, 45);
    const jackets = await Promise.all(page.map((item) => jacket(item.score)));
    page.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      drawCard(context, item, jackets[index], gutter + column * (cardWidth + gutter), headerHeight + gutter + row * (cardHeight + gutter), cardWidth, cardHeight);
    });
    images.push(canvas.toBuffer("image/jpeg", 92));
  }
  return images;
}

export function bestCards(scores: ScoreRecord[], mixed: boolean): CardItem[] {
  return scores.map((score, index) => ({
    score,
    topLeft: `${mixed ? (score.chartKind === "new" ? "新" : "旧") : ""}Lv${score.internalLevel?.toFixed(1) ?? "?"}`,
    topRight: `#${score.officialRank ?? index + 1} ${score.internalLevel === undefined ? "?" : score.rating}`,
    bottom: score.achievements === undefined ? "-" : `${score.achievements.toFixed(4)}%`,
    accent: difficultyAccent(score.difficulty)
  }));
}

export function candidateCards(candidates: BestCandidate[]): CardItem[] {
  return candidates.map((candidate, index) => ({
    score: candidate.score,
    topLeft: `#${index + 1} Lv${candidate.score.internalLevel?.toFixed(1) ?? "?"}`,
    topRight: `+${candidate.ratingGain}`,
    bottom: `${candidate.score.achievements?.toFixed(4) ?? "-"}% → ${candidate.nextRank}`,
    accent: difficultyAccent(candidate.score.difficulty)
  }));
}

export function dxScoreCards(scores: ScoreRecord[]): CardItem[] {
  return scores.map((score, index) => ({
    score,
    topLeft: `#${index + 1} Lv${score.level ?? "?"}`,
    topRight: `☆${dxStar(score) ?? 0}`,
    bottom: `${score.dxScore ?? 0}/${score.dxScoreMax ?? 0} (${(dxScorePercent(score) ?? 0).toFixed(3)}%)`,
    accent: difficultyAccent(score.difficulty)
  }));
}

export function dxStarCandidateCards(candidates: DxStarCandidate[]): CardItem[] {
  return candidates.map((candidate, index) => ({
    score: candidate.score,
    topLeft: `#${index + 1} Lv${candidate.score.level ?? "?"}`,
    topRight: `☆${candidate.targetStars} -${candidate.missingScore}`,
    bottom: `${candidate.score.dxScore ?? 0}/${candidate.score.dxScoreMax ?? 0} (${(dxScorePercent(candidate.score) ?? 0).toFixed(3)}%)`,
    accent: difficultyAccent(candidate.score.difficulty)
  }));
}

export function newConstantCards(scores: ScoreRecord[]): CardItem[] {
  return scores.map((score, index) => ({
    score,
    topLeft: `#${index + 1} Lv${score.internalLevel?.toFixed(1) ?? "?"}`,
    topRight: `${score.chartType === "standard" ? "STD" : "DX"} ${score.difficulty.toUpperCase()}`,
    bottom: score.achievements === undefined ? "-%" : `${score.achievements.toFixed(4)}%`,
    accent: difficultyAccent(score.difficulty)
  }));
}

export function progressCards(scores: ScoreRecord[], showComboAndSync: boolean): CardItem[] {
  return scores.map((score, index) => ({
    score,
    topLeft: `#${index + 1} Lv${score.internalLevel?.toFixed(1) ?? "?"}`,
    topRight: showComboAndSync
      ? `${score.comboStatus ?? "-"} / ${score.syncStatus ?? "-"}`
      : score.achievements === undefined ? "--" : achievementRank(score.achievements),
    bottom: score.achievements === undefined ? "-%" : `${score.achievements.toFixed(4)}%`,
    accent: difficultyAccent(score.difficulty)
  }));
}

interface SyncImageItem { score: ScoreRecord; topLeft: string; topRight: string; detail: string; }

function starOf(score: ScoreRecord | undefined): number {
  return score ? dxStar(score) ?? 0 : 0;
}

function syncImageItems(kind: "rank" | "star" | "lamp", updates: SyncChartUpdate[]): SyncImageItem[] {
  return updates.map(({ score, previous, achievementGain, dxScoreGain, comboImproved, syncImproved }) => {
    if (kind === "rank") return {
      score, topLeft: achievementRank(previous?.achievements), topRight: `${achievementRank(score.achievements)} ${score.rating}`,
      detail: `${formatAchievement(previous?.achievements)} → ${formatAchievement(score.achievements)} (+${achievementGain?.toFixed(4) ?? "0.0000"}%)`
    };
    if (kind === "star") return {
      score, topLeft: `Lv.${score.level ?? "?"}`, topRight: `☆${starOf(previous)}→${starOf(score)}`,
      detail: `${previous?.dxScore ?? 0} → ${score.dxScore ?? 0} (+${dxScoreGain ?? 0})/${score.dxScoreMax ?? "?"}`
    };
    const previousLamp = comboImproved && syncImproved
      ? `${previous?.comboStatus ?? "-"} / ${previous?.syncStatus ?? "-"}`
      : comboImproved ? previous?.comboStatus ?? "-" : previous?.syncStatus ?? "-";
    const currentLamp = comboImproved && syncImproved
      ? `${score.comboStatus ?? "-"} / ${score.syncStatus ?? "-"}`
      : comboImproved ? score.comboStatus ?? "-" : score.syncStatus ?? "-";
    return {
      score, topLeft: previousLamp, topRight: currentLamp,
      detail: `${formatAchievement(previous?.achievements)} → ${formatAchievement(score.achievements)} (+${achievementGain?.toFixed(4) ?? "0.0000"}%)`
    };
  });
}

function drawSyncCard(context: SKRSContext2D, item: SyncImageItem, image: Awaited<ReturnType<typeof loadImage>> | undefined, x: number, y: number, width: number, height: number): void {
  drawCover(context, image, x, y, width, height);
  context.strokeStyle = difficultyAccent(item.score.difficulty);
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(x + 1.5, y + 1.5, width - 3, height - 3, 11);
  context.stroke();
  context.font = `bold 19px ${FONT_NAME}, monospace`;
  context.lineWidth = 4;
  context.strokeStyle = "rgba(25, 9, 36, 0.9)";
  context.fillStyle = "#ffffff";
  context.strokeText(item.topLeft, x + 10, y + 26);
  context.fillText(item.topLeft, x + 10, y + 26);
  context.textAlign = "right";
  context.strokeText(item.topRight, x + width - 10, y + 26);
  context.fillText(item.topRight, x + width - 10, y + 26);
  context.textAlign = "left";
  context.font = `bold 17px ${FONT_NAME}, monospace`;
  const title = truncateSongTitle(item.score.title);
  context.strokeText(title, x + 10, y + height - 43);
  context.fillText(title, x + 10, y + height - 43);
  let detailFontSize = 14;
  do {
    context.font = `bold ${detailFontSize}px ${FONT_NAME}, monospace`;
    detailFontSize -= 1;
  } while (context.measureText(item.detail).width > width - 20 && detailFontSize >= 10);
  context.fillStyle = "#ffef75";
  context.strokeText(item.detail, x + 10, y + height - 15);
  context.fillText(item.detail, x + 10, y + height - 15);
}

export async function renderSyncSummaryImage(summary: SyncSummary): Promise<Buffer> {
  const groups: Array<{ title: string; items: SyncImageItem[] }> = summary.initial
    ? [{ title: "同期完了", items: summary.scores.slice().sort((left, right) => right.rating - left.rating).slice(0, 5).map((score) => ({
      score, topLeft: `Lv.${score.internalLevel?.toFixed(1) ?? score.level ?? "?"}`, topRight: String(score.rating), detail: formatAchievement(score.achievements)
    })) }]
    : [
      { title: "ランク更新", items: syncImageItems("rank", summary.rankUpdates) },
      { title: "☆更新", items: syncImageItems("star", summary.starUpdates) },
      { title: "ランプ更新", items: syncImageItems("lamp", summary.lampUpdates) }
    ].filter((group) => group.items.length > 0);
  const columns = 5;
  const cardWidth = 236;
  const cardHeight = 220;
  const gutter = 12;
  const headerHeight = 166;
  const groupHeight = 42 + cardHeight + gutter;
  const width = columns * cardWidth + (columns + 1) * gutter;
  const height = headerHeight + Math.max(1, groups.length) * groupHeight + gutter;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#211b2e";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ff5a9e";
  context.fillRect(0, 0, width, 7);
  context.fillStyle = "#f8f5ff";
  context.font = `bold 25px ${FONT_NAME}, monospace`;
  context.fillText(`${summary.playerName} の同期結果`, gutter, 38);
  context.font = `bold 19px ${FONT_NAME}, monospace`;
  const rating = summary.ratingGain === undefined ? String(summary.rating)
    : `${summary.previousRating} → ${summary.rating}`;
  context.fillText(`Rating: ${rating}`, gutter, 68);
  if (summary.initial) {
    context.fillText("初回同期が完了しました。/maimai best などを利用できます。", gutter, 96);
  } else {
    context.fillText(`スコア新記録: ${summary.scoreRecordCount}曲  ランク更新: ${summary.rankUpdateCount}曲`, gutter, 94);
    context.fillText(`DXスコア新記録: ${summary.dxScoreRecordCount}曲  ☆更新: ${summary.starUpdateCount}曲`, gutter, 118);
    context.fillText(`AP+ +${summary.newApPlusCount}曲 / AP +${summary.newApCount}曲 / FC+ +${summary.newFcPlusCount}曲 / FC +${summary.newFcCount}曲 / FDX +${summary.newFdxCount}曲`, gutter, 142);
  }
  let y = headerHeight;
  for (const group of groups) {
    context.fillStyle = "#ffb0d2";
    context.font = `bold 21px ${FONT_NAME}, monospace`;
    context.fillText(group.title, gutter, y + 27);
    const jackets = await Promise.all(group.items.map((item) => jacket(item.score)));
    group.items.forEach((item, index) => drawSyncCard(context, item, jackets[index], gutter + index * (cardWidth + gutter), y + 42, cardWidth, cardHeight));
    y += groupHeight;
  }
  if (!groups.length) {
    context.fillStyle = "#f8f5ff";
    context.font = `bold 22px ${FONT_NAME}, monospace`;
    context.fillText("今回の更新はありません。", gutter, headerHeight + 35);
  }
  return canvas.toBuffer("image/jpeg", 92);
}

// Kept for the existing /maimai image command. Its output now uses jacket cards.
export async function renderBestImage(playerName: string, label: string, _summary: string, scores: ScoreRecord[], mixed: boolean): Promise<Buffer> {
  const images = await renderScoreCardImages(playerName, label, bestCards(scores, mixed));
  return images[0] ?? createCanvas(1, 1).toBuffer("image/jpeg", 92);
}
