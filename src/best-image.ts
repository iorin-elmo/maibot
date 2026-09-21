import { existsSync } from "node:fs";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { achievementRank } from "./analysis.js";
import type { ScoreRecord } from "./types.js";
import { truncateSongTitle } from "./text.js";

const FONT_NAME = "MaiBotMono";
if (process.platform === "win32" && existsSync("C:\\Windows\\Fonts\\msgothic.ttc")) {
  GlobalFonts.registerFromPath("C:\\Windows\\Fonts\\msgothic.ttc", FONT_NAME);
}

function value(score: ScoreRecord): { constant: string; rating: string; achievement: string } {
  return {
    constant: score.internalLevel === undefined ? "?" : score.internalLevel.toFixed(1),
    rating: score.internalLevel === undefined ? "?" : String(score.rating),
    achievement: score.achievements === undefined ? "-" : `${score.achievements.toFixed(4)}%`
  };
}

export function renderBestImage(playerName: string, label: string, summary: string, scores: ScoreRecord[], mixed: boolean): Buffer {
  const width = 1240;
  const rowHeight = 34;
  const headerHeight = 106;
  const canvas = createCanvas(width, headerHeight + scores.length * rowHeight + 36);
  const context = canvas.getContext("2d");
  context.fillStyle = "#211b2e";
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = "#ff5a9e";
  context.fillRect(0, 0, 8, canvas.height);
  context.fillStyle = "#f8f5ff";
  context.font = `bold 28px ${FONT_NAME}, monospace`;
  context.fillText(`${playerName} の${label}`, 32, 48);
  context.fillStyle = "#b9afc9";
  context.font = `18px ${FONT_NAME}, monospace`;
  context.fillText(summary, 32, 78);

  for (const [index, score] of scores.entries()) {
    const y = headerHeight + 8 + index * rowHeight;
    context.fillStyle = index % 2 === 0 ? "#2c243b" : "#261f34";
    context.fillRect(20, y - 24, width - 40, rowHeight);
    const rank = `${mixed ? score.chartKind === "new" ? "新" : "旧" : ""}#${String(score.officialRank ?? index + 1).padStart(2, "0")}`;
    const data = value(score);
    context.fillStyle = "#f8f5ff";
    context.font = `20px ${FONT_NAME}, monospace`;
    context.fillText(rank, 32, y);
    context.fillText(`[${data.constant}]`, 110, y);
    context.fillText(data.rating, 220, y);
    context.fillText("/", 285, y);
    context.fillText(achievementRank(score.achievements), 324, y);
    context.textAlign = "right";
    context.fillText(data.achievement, 590, y);
    context.textAlign = "left";
    context.fillText("/", 610, y);
    context.fillText(truncateSongTitle(score.title), 645, y);
  }
  return canvas.toBuffer("image/png");
}
