import { singleChartRating } from "./analysis.js";
import type { ScoreRecord } from "./types.js";

interface CatalogSheet {
  type: "dx" | "std";
  difficulty: string;
  level: string;
  internalLevelValue: number;
  /** The version in which this particular chart was added. */
  version?: string;
}
interface CatalogSong { title: string; version?: string; sheets: CatalogSheet[]; }
interface CatalogDocument {
  versions?: Array<{ version: string }>;
  songs: CatalogSong[];
}

interface CatalogEntry {
  internalLevel: number;
  version?: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

export class MaimaiCatalog {
  private loadPromise: Promise<{ index: Map<string, CatalogEntry>; newestVersions: Set<string> }> | undefined;
  private loadedAt = 0;
  private readonly cacheDurationMs = 6 * 60 * 60 * 1_000;

  constructor(private readonly sourceUrl: string) {}

  private key(title: string, type: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), type, difficulty.toLowerCase(), normalize(level ?? "")].join("\u0000");
  }

  private async load(): Promise<{ index: Map<string, CatalogEntry>; newestVersions: Set<string> }> {
    if (!this.loadPromise || Date.now() - this.loadedAt >= this.cacheDurationMs) this.loadPromise = (async () => {
      const response = await fetch(this.sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("譜面定数データを取得できませんでした。");
      const document = await response.json() as CatalogDocument;
      if (!Array.isArray(document.songs)) throw new Error("譜面定数データの形式が不正です。");
      if (!Array.isArray(document.versions) || document.versions.length < 2
        || document.versions.some((version) => typeof version?.version !== "string" || !version.version)) {
        throw new Error("譜面定数データに最新バージョン情報がありません。");
      }
      const index = new Map<string, CatalogEntry>();
      for (const song of document.songs) for (const sheet of song.sheets ?? []) {
        const type = sheet.type === "std" ? "standard" : "dx";
        index.set(this.key(song.title, type, sheet.difficulty, sheet.level), {
          internalLevel: sheet.internalLevelValue,
          version: sheet.version ?? song.version
        });
      }
      const newestVersions = new Set(document.versions.slice(-2).map((version) => version.version));
      if (newestVersions.size !== 2) throw new Error("譜面定数データの最新バージョン情報が重複しています。");
      this.loadedAt = Date.now();
      return { index, newestVersions };
    })();
    return this.loadPromise;
  }

  async enrich(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { index, newestVersions } = await this.load();
    return scores.map((score) => {
      const entry = score.chartType
        ? index.get(this.key(score.title, score.chartType, score.difficulty, score.level))
        : undefined;
      if (!entry || score.achievements === undefined) return score;
      return {
        ...score,
        // Free-course collection retrieves every score page. The catalogue is
        // the stable source of the "latest two versions" split, so it does not
        // depend on the layout of the version-index page.
        chartKind: entry.version
          ? (newestVersions.has(entry.version) ? "new" : "old")
          : score.chartKind,
        internalLevel: entry.internalLevel,
        rating: singleChartRating(entry.internalLevel, score.achievements)
      };
    });
  }
}
