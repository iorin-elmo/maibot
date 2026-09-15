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

function versionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export class MaimaiCatalog {
  private loadPromise: Promise<{ index: Map<string, CatalogEntry>; newestVersions: Set<string> }> | undefined;
  private cached: { index: Map<string, CatalogEntry>; newestVersions: Set<string> } | undefined;
  private loadedAt = 0;
  private readonly cacheDurationMs = 6 * 60 * 60 * 1_000;

  constructor(private readonly sourceUrl: string) {}

  private key(title: string, type: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), type, difficulty.toLowerCase(), normalize(level ?? "")].join("\u0000");
  }

  private async load(): Promise<{ index: Map<string, CatalogEntry>; newestVersions: Set<string> }> {
    if (this.cached && Date.now() - this.loadedAt < this.cacheDurationMs) return this.cached;
    if (!this.loadPromise) this.loadPromise = (async () => {
      const response = await fetch(this.sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("譜面定数データを取得できませんでした。");
      const document = await response.json() as CatalogDocument;
      if (!Array.isArray(document.songs)) throw new Error("譜面定数データの形式が不正です。");
      const index = new Map<string, CatalogEntry>();
      for (const song of document.songs) for (const sheet of song.sheets ?? []) {
        if (!Number.isFinite(sheet.internalLevelValue)) throw new Error(`譜面定数が不正です: ${song.title}`);
        const type = sheet.type === "std" ? "standard" : "dx";
        index.set(this.key(song.title, type, sheet.difficulty, sheet.level), {
          internalLevel: sheet.internalLevelValue,
          version: versionId(sheet.version) ?? versionId(song.version)
        });
      }
      const latestVersionIds = Array.isArray(document.versions)
        ? document.versions.slice(-2).map((version) => versionId(version?.version))
        : [];
      const hasTwoDistinctVersions = latestVersionIds.length === 2
        && latestVersionIds.every((version): version is string => version !== undefined)
        && new Set(latestVersionIds).size === 2;
      const newestVersions = hasTwoDistinctVersions ? new Set(latestVersionIds) : new Set<string>();
      const loaded = { index, newestVersions };
      // Standard sync does not need version metadata.  Do not cache malformed
      // metadata, however: free sync should retry the upstream catalogue as
      // soon as it recovers instead of being blocked for the full TTL.
      if (hasTwoDistinctVersions) {
        this.loadedAt = Date.now();
        this.cached = loaded;
      }
      return loaded;
    })().finally(() => { this.loadPromise = undefined; });
    return this.loadPromise;
  }

  async enrich(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { index, newestVersions } = await this.load();
    return scores.map((score) => {
      const entry = score.chartType
        ? index.get(this.key(score.title, score.chartType, score.difficulty, score.level))
        : undefined;
      if (score.chartKind === "unknown" && (newestVersions.size !== 2 || !entry || !entry.version || score.achievements === undefined)) {
        throw new Error(`譜面定数またはバージョンを照合できませんでした: ${score.title}`);
      }
      if (!entry || score.achievements === undefined) return score;
      return {
        ...score,
        // Free-course collection retrieves every score page. The catalogue is
        // the stable source of the "latest two versions" split, so it does not
        // depend on the layout of the version-index page.
        chartKind: score.chartKind === "unknown" && entry.version
          ? (newestVersions.has(entry.version) ? "new" : "old")
          : score.chartKind,
        internalLevel: entry.internalLevel,
        rating: singleChartRating(entry.internalLevel, score.achievements)
      };
    });
  }
}
