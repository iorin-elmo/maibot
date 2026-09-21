import { singleChartRating } from "./analysis.js";
import type { ScoreRecord } from "./types.js";

interface CatalogSheet {
  type: "dx" | "std";
  difficulty: string;
  level: string;
  internalLevelValue: number;
  noteCounts?: { total?: number };
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
  dxScoreMax?: number;
  version?: string;
}
interface LoadedCatalog {
  index: Map<string, CatalogEntry>;
  newestVersions: Set<string>;
  knownVersions: Set<string>;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

function versionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function maximumDxScore(noteCounts: CatalogSheet["noteCounts"]): number | undefined {
  const total = noteCounts?.total;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 1) return undefined;
  return total * 3;
}

export class MaimaiCatalog {
  private loadPromise: Promise<LoadedCatalog> | undefined;
  private cachedIndex: Map<string, CatalogEntry> | undefined;
  private cachedNewestVersions: Set<string> | undefined;
  private cachedKnownVersions: Set<string> | undefined;
  private loadedAt = 0;
  private readonly cacheDurationMs = 6 * 60 * 60 * 1_000;

  constructor(private readonly sourceUrl: string) {}

  private key(title: string, type: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), type, difficulty.toLowerCase(), normalize(level ?? "")].join("\u0000");
  }

  private async load(needsVersionMetadata: boolean): Promise<LoadedCatalog> {
    const cachedIndex = this.cachedIndex;
    const cacheIsFresh = cachedIndex && Date.now() - this.loadedAt < this.cacheDurationMs;
    if (cacheIsFresh && (!needsVersionMetadata || this.cachedNewestVersions)) {
      return {
        index: cachedIndex,
        newestVersions: this.cachedNewestVersions ?? new Set<string>(),
        knownVersions: this.cachedKnownVersions ?? new Set<string>()
      };
    }
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
          dxScoreMax: maximumDxScore(sheet.noteCounts),
          version: versionId(sheet.version) ?? versionId(song.version)
        });
      }
      const allVersionIds = Array.isArray(document.versions)
        ? document.versions.map((version) => versionId(version?.version))
        : [];
      const latestVersionIds = allVersionIds.slice(-2);
      const hasTwoDistinctVersions = latestVersionIds.length === 2
        && latestVersionIds.every((version): version is string => version !== undefined)
        && new Set(latestVersionIds).size === 2;
      const newestVersions = hasTwoDistinctVersions ? new Set(latestVersionIds) : new Set<string>();
      const knownVersions = new Set(allVersionIds.filter((version): version is string => version !== undefined));
      const loaded = { index, newestVersions, knownVersions };
      // Standard sync only needs the song index, so cache it independently.
      // Free sync must retry malformed version metadata rather than treating
      // an invalid latest-two split as valid for the full TTL.
      this.loadedAt = Date.now();
      this.cachedIndex = index;
      this.cachedNewestVersions = hasTwoDistinctVersions ? newestVersions : undefined;
      this.cachedKnownVersions = hasTwoDistinctVersions ? knownVersions : undefined;
      return loaded;
    })().finally(() => { this.loadPromise = undefined; });
    return this.loadPromise;
  }

  async enrich(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { index, newestVersions, knownVersions } = await this.load(scores.some((score) => score.chartKind === "unknown"));
    return scores.map((score) => {
      const entry = score.chartType
        ? index.get(this.key(score.title, score.chartType, score.difficulty, score.level))
        : undefined;
      if (score.chartKind === "unknown" && (newestVersions.size !== 2 || !entry || !entry.version || !knownVersions.has(entry.version) || score.achievements === undefined)) {
        throw new Error(`譜面定数またはバージョンを照合できませんでした: ${score.title}`);
      }
      if (!entry) return score;
      const enriched = entry.dxScoreMax === undefined ? score : { ...score, dxScoreMax: entry.dxScoreMax };
      if (score.achievements === undefined) return enriched;
      return {
        ...enriched,
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
