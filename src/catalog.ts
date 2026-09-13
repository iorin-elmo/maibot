import { singleChartRating } from "./analysis.js";
import type { ScoreRecord } from "./types.js";

interface CatalogSheet { type: "dx" | "std"; difficulty: string; level: string; internalLevelValue: number; }
interface CatalogSong { title: string; sheets: CatalogSheet[]; }
interface CatalogDocument { songs: CatalogSong[]; }

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

export class MaimaiCatalog {
  private loadPromise: Promise<Map<string, number>> | undefined;

  constructor(private readonly sourceUrl: string) {}

  private key(title: string, type: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), type, difficulty.toLowerCase(), normalize(level ?? "")].join("\u0000");
  }

  private async load(): Promise<Map<string, number>> {
    if (!this.loadPromise) this.loadPromise = (async () => {
      const response = await fetch(this.sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("譜面定数データを取得できませんでした。");
      const document = await response.json() as CatalogDocument;
      if (!Array.isArray(document.songs)) throw new Error("譜面定数データの形式が不正です。");
      const index = new Map<string, number>();
      for (const song of document.songs) for (const sheet of song.sheets ?? []) {
        const type = sheet.type === "std" ? "standard" : "dx";
        index.set(this.key(song.title, type, sheet.difficulty, sheet.level), sheet.internalLevelValue);
      }
      return index;
    })();
    return this.loadPromise;
  }

  async enrich(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const index = await this.load();
    return scores.map((score) => {
      const internalLevel = score.chartType
        ? index.get(this.key(score.title, score.chartType, score.difficulty, score.level))
        : undefined;
      return internalLevel === undefined || score.achievements === undefined ? score : {
        ...score, internalLevel, rating: singleChartRating(internalLevel, score.achievements)
      };
    });
  }
}
