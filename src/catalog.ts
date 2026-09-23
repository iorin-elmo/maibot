import { singleChartRating } from "./analysis.js";
import type { ScoreRecord } from "./types.js";

interface CatalogSheet {
  type: string;
  difficulty: string;
  level: string;
  internalLevelValue: number;
  noteCounts?: { total?: number };
  /** The version in which this particular chart was added. */
  version?: string;
}
interface CatalogSong { title: string; imageName?: string; version?: string; isLocked?: boolean; sheets: CatalogSheet[]; }
interface CatalogDocument {
  versions?: Array<{ version: string }>;
  songs: CatalogSong[];
}

interface CatalogEntry {
  internalLevel: number;
  dxScoreMax?: number;
  jacketImageName?: string;
  version?: string;
}
interface CatalogChart {
  key: string;
  title: string;
  difficulty: string;
  level: string;
  chartType: "dx" | "standard";
  internalLevel: number;
  dxScoreMax?: number;
  jacketImageName?: string;
  version?: string;
}
interface LoadedCatalog {
  index: Map<string, CatalogEntry>;
  charts: CatalogChart[];
  newestVersions: Set<string>;
  knownVersions: Set<string>;
  lockedTitles: Set<string>;
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

function normalizeDifficulty(value: string): string {
  return normalize(value).replace(/:/g, "");
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
  private cachedCharts: CatalogChart[] | undefined;
  private cachedNewestVersions: Set<string> | undefined;
  private cachedKnownVersions: Set<string> | undefined;
  private cachedLockedTitles: Set<string> | undefined;
  private loadedAt = 0;
  private readonly cacheDurationMs = 6 * 60 * 60 * 1_000;

  constructor(private readonly sourceUrl: string) {}

  private key(title: string, type: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), type, normalizeDifficulty(difficulty), normalize(level ?? "")].join("\u0000");
  }

  private legacyKey(title: string, difficulty: string, level: string | undefined): string {
    return [normalize(title), normalizeDifficulty(difficulty), normalize(level ?? "")].join("\u0000");
  }

  private legacyTitleDifficultyKey(title: string, difficulty: string): string {
    return [normalize(title), normalizeDifficulty(difficulty)].join("\u0000");
  }

  private async load(needsVersionMetadata: boolean): Promise<LoadedCatalog> {
    const cachedIndex = this.cachedIndex;
    const cachedCharts = this.cachedCharts;
    const cacheIsFresh = cachedIndex && cachedCharts && Date.now() - this.loadedAt < this.cacheDurationMs;
    if (cacheIsFresh && (!needsVersionMetadata || this.cachedNewestVersions)) {
      return {
        index: cachedIndex,
        charts: cachedCharts,
        newestVersions: this.cachedNewestVersions ?? new Set<string>(),
        knownVersions: this.cachedKnownVersions ?? new Set<string>()
        , lockedTitles: this.cachedLockedTitles ?? new Set<string>()
      };
    }
    if (!this.loadPromise) this.loadPromise = (async () => {
      const response = await fetch(this.sourceUrl, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("譜面定数データを取得できませんでした。");
      const document = await response.json() as CatalogDocument;
      if (!Array.isArray(document.songs)) throw new Error("譜面定数データの形式が不正です。");
      const index = new Map<string, CatalogEntry>();
      const charts: CatalogChart[] = [];
      const lockedTitles = new Set<string>();
      for (const song of document.songs) {
        if (song.isLocked) { lockedTitles.add(normalize(song.title)); continue; }
        for (const sheet of song.sheets ?? []) {
        // UTAGE charts (including two-player variants) are not part of the
        // new-song rating frame and must not appear in its constant ranking.
        if (sheet.type !== "dx" && sheet.type !== "std") continue;
        if (!Number.isFinite(sheet.internalLevelValue)) throw new Error(`譜面定数が不正です: ${song.title}`);
        const type = sheet.type === "std" ? "standard" : "dx";
        const key = this.key(song.title, type, sheet.difficulty, sheet.level);
        const version = versionId(sheet.version) ?? versionId(song.version);
        const jacketImageName = typeof song.imageName === "string" && song.imageName ? song.imageName : undefined;
        const dxScoreMax = maximumDxScore(sheet.noteCounts);
        index.set(key, {
          internalLevel: sheet.internalLevelValue,
          dxScoreMax,
          jacketImageName,
          version
        });
        charts.push({ key, title: song.title, difficulty: sheet.difficulty, level: sheet.level, chartType: type,
          internalLevel: sheet.internalLevelValue, dxScoreMax, jacketImageName, version });
        }
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
      const loaded = { index, charts, newestVersions, knownVersions, lockedTitles };
      // Standard sync only needs the song index, so cache it independently.
      // Free sync must retry malformed version metadata rather than treating
      // an invalid latest-two split as valid for the full TTL.
      this.loadedAt = Date.now();
      this.cachedIndex = index;
      this.cachedCharts = charts;
      this.cachedNewestVersions = hasTwoDistinctVersions ? newestVersions : undefined;
      this.cachedKnownVersions = hasTwoDistinctVersions ? knownVersions : undefined;
      this.cachedLockedTitles = lockedTitles;
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
      const enriched = {
        ...score,
        ...(entry.dxScoreMax === undefined ? {} : { dxScoreMax: entry.dxScoreMax }),
        ...(entry.jacketImageName === undefined ? {} : { jacketImageName: entry.jacketImageName })
      };
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

  async excludeLocked(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { lockedTitles } = await this.load(false);
    return scores.filter((score) => !lockedTitles.has(normalize(score.title)));
  }

  private scoreCharts(charts: CatalogChart[], scores: ScoreRecord[]): ScoreRecord[] {
    const scoresByChart = new Map(scores.flatMap((score) => score.chartType && normalize(score.level ?? "")
      ? [[this.key(score.title, score.chartType, score.difficulty, score.level), score] as const]
      : []));
    const levelLessTypedScores = new Map<string, ScoreRecord | null>();
    const legacyScores = new Map<string, ScoreRecord | null>();
    const levelLessLegacyScores = new Map<string, ScoreRecord | null>();
    for (const score of scores) {
      if (score.chartType && !normalize(score.level ?? "")) {
        const key = this.key(score.title, score.chartType, score.difficulty, undefined);
        levelLessTypedScores.set(key, levelLessTypedScores.has(key) ? null : score);
        continue;
      }
      if (score.chartType) continue;
      if (normalize(score.level ?? "")) {
        const key = this.legacyKey(score.title, score.difficulty, score.level);
        legacyScores.set(key, legacyScores.has(key) ? null : score);
      } else {
        const key = this.legacyTitleDifficultyKey(score.title, score.difficulty);
        levelLessLegacyScores.set(key, levelLessLegacyScores.has(key) ? null : score);
      }
    }
    const chartCountByLevelLessTypedKey = new Map<string, number>();
    const chartCountByLegacyKey = new Map<string, number>();
    const chartCountByLegacyTitleDifficultyKey = new Map<string, number>();
    for (const chart of charts) {
      const levelLessTypedKey = this.key(chart.title, chart.chartType, chart.difficulty, undefined);
      chartCountByLevelLessTypedKey.set(levelLessTypedKey, (chartCountByLevelLessTypedKey.get(levelLessTypedKey) ?? 0) + 1);
      const key = this.legacyKey(chart.title, chart.difficulty, chart.level);
      chartCountByLegacyKey.set(key, (chartCountByLegacyKey.get(key) ?? 0) + 1);
      const titleDifficultyKey = this.legacyTitleDifficultyKey(chart.title, chart.difficulty);
      chartCountByLegacyTitleDifficultyKey.set(titleDifficultyKey, (chartCountByLegacyTitleDifficultyKey.get(titleDifficultyKey) ?? 0) + 1);
    }
    return charts
      .map((chart) => {
        const levelLessTypedKey = this.key(chart.title, chart.chartType, chart.difficulty, undefined);
        const legacyKey = this.legacyKey(chart.title, chart.difficulty, chart.level);
        const titleDifficultyKey = this.legacyTitleDifficultyKey(chart.title, chart.difficulty);
        const score = scoresByChart.get(chart.key)
          ?? (chartCountByLevelLessTypedKey.get(levelLessTypedKey) === 1 ? levelLessTypedScores.get(levelLessTypedKey) ?? undefined : undefined)
          ?? (chartCountByLegacyKey.get(legacyKey) === 1 ? legacyScores.get(legacyKey) ?? undefined : undefined)
          ?? (chartCountByLegacyTitleDifficultyKey.get(titleDifficultyKey) === 1 ? levelLessLegacyScores.get(titleDifficultyKey) ?? undefined : undefined);
        return {
          title: chart.title,
          difficulty: chart.difficulty,
          level: chart.level,
          achievements: score?.achievements,
          dxScore: score?.dxScore,
          dxScoreMax: chart.dxScoreMax ?? score?.dxScoreMax,
          comboStatus: score?.comboStatus,
          syncStatus: score?.syncStatus,
          rating: score?.rating ?? 0,
          chartKind: "new" as const,
          chartType: chart.chartType,
          internalLevel: chart.internalLevel,
          jacketImageName: chart.jacketImageName
        };
      });
  }

  /** Lists every chart in the latest two versions by chart constant. */
  async newestChartConstantRanking(scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { charts, newestVersions } = await this.load(true);
    if (newestVersions.size !== 2) throw new Error("新曲のバージョン情報を照合できませんでした。");
    return this.scoreCharts(charts.filter((chart) => chart.version !== undefined && newestVersions.has(chart.version)), scores)
      .sort((a, b) => (b.internalLevel ?? 0) - (a.internalLevel ?? 0)
        || a.title.localeCompare(b.title, "ja")
        || a.difficulty.localeCompare(b.difficulty));
  }

  /** Lists every DX/STD chart at a displayed level, including unplayed charts. */
  async levelProgressRanking(level: string, scores: ScoreRecord[]): Promise<ScoreRecord[]> {
    const { charts } = await this.load(false);
    return this.scoreCharts(charts.filter((chart) => chart.level === level), scores);
  }

  /** Lists the BASIC through MASTER charts that count toward a plate. */
  async plateProgressRanking(versions: readonly string[], scores: ScoreRecord[], standardOnly = false, excludedTitles: readonly string[] = []): Promise<ScoreRecord[]> {
    const { charts, knownVersions } = await this.load(true);
    if (versions.some((version) => !knownVersions.has(version))) throw new Error("プレートのバージョン情報を照合できませんでした。");
    const targetVersions = new Set(versions);
    const excluded = new Set(excludedTitles);
    return this.scoreCharts(charts.filter((chart) => chart.version !== undefined
      && targetVersions.has(chart.version)
      && !excluded.has(chart.title)
      && normalizeDifficulty(chart.difficulty) !== "remaster"
      && (!standardOnly || chart.chartType === "standard")), scores);
  }
}
