import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ImportedProfile, LinkedAccount, ScoreRecord } from "./types.js";

export class BotDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        discord_user_id TEXT PRIMARY KEY,
        sega_id TEXT NOT NULL UNIQUE,
        player_name TEXT,
        rating REAL,
        updated_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scores (
        discord_user_id TEXT NOT NULL REFERENCES accounts(discord_user_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        level TEXT,
        achievements REAL,
        dx_score INTEGER,
        rating REAL NOT NULL,
        chart_kind TEXT NOT NULL CHECK(chart_kind IN ('new', 'old', 'unknown')),
        chart_type TEXT CHECK(chart_type IN ('dx', 'standard')),
        internal_level REAL,
        official_rank INTEGER,
        played_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS import_tokens (
        token_hash TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL REFERENCES accounts(discord_user_id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS scores_by_rating ON scores(discord_user_id, chart_kind, rating DESC);
    `);
    try { this.db.exec("ALTER TABLE scores ADD COLUMN official_rank INTEGER"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN chart_type TEXT"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN internal_level REAL"); } catch { /* existing database */ }
  }

  link(discordUserId: string, segaId: string): void {
    const owner = this.db.prepare("SELECT discord_user_id FROM accounts WHERE sega_id = ?").get(segaId) as { discord_user_id: string } | undefined;
    if (owner && owner.discord_user_id !== discordUserId) throw new Error("このSEGA IDはすでに別のDiscordアカウントへ紐付けられています。");
    this.db.prepare(`INSERT INTO accounts (discord_user_id, sega_id) VALUES (?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET sega_id = excluded.sega_id`).run(discordUserId, segaId);
  }

  unlink(discordUserId: string): boolean {
    return this.db.prepare("DELETE FROM accounts WHERE discord_user_id = ?").run(discordUserId).changes > 0;
  }

  getAccount(discordUserId: string): LinkedAccount | undefined {
    return this.db.prepare("SELECT discord_user_id AS discordUserId, sega_id AS segaId, player_name AS playerName, rating, updated_at AS updatedAt FROM accounts WHERE discord_user_id = ?").get(discordUserId) as LinkedAccount | undefined;
  }

  createImportToken(discordUserId: string): string {
    if (!this.getAccount(discordUserId)) throw new Error("先に /maimai link を実行してください。");
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    this.db.prepare("DELETE FROM import_tokens WHERE discord_user_id = ? OR expires_at < ?").run(discordUserId, Date.now());
    this.db.prepare("INSERT INTO import_tokens (token_hash, discord_user_id, expires_at) VALUES (?, ?, ?)")
      .run(tokenHash, discordUserId, Date.now() + 10 * 60_000);
    return token;
  }

  consumeImportToken(token: string): string | undefined {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = this.db.prepare("SELECT discord_user_id AS discordUserId, expires_at AS expiresAt FROM import_tokens WHERE token_hash = ?")
      .get(tokenHash) as { discordUserId: string; expiresAt: number } | undefined;
    if (!record || record.expiresAt < Date.now()) return undefined;
    this.db.prepare("DELETE FROM import_tokens WHERE token_hash = ?").run(tokenHash);
    return record.discordUserId;
  }

  importProfile(discordUserId: string, profile: ImportedProfile): void {
    if (!this.getAccount(discordUserId)) throw new Error("先に /maimai link を実行してください。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE accounts SET player_name = ?, rating = ?, updated_at = ? WHERE discord_user_id = ?")
        .run(profile.playerName, profile.rating, profile.updatedAt ?? new Date().toISOString(), discordUserId);
      this.db.prepare("DELETE FROM scores WHERE discord_user_id = ?").run(discordUserId);
      const insert = this.db.prepare(`INSERT INTO scores
        (discord_user_id, title, difficulty, level, achievements, dx_score, rating, chart_kind, chart_type, internal_level, official_rank, played_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const score of profile.scores) insert.run(discordUserId, score.title, score.difficulty, score.level ?? null,
        score.achievements ?? null, score.dxScore ?? null, score.rating, score.chartKind ?? "unknown", score.chartType ?? null,
        score.internalLevel ?? null, score.officialRank ?? null, score.playedAt ?? null);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getScores(discordUserId: string): ScoreRecord[] {
    const rows = this.db.prepare(`SELECT title, difficulty, level, achievements AS achievements, dx_score AS dxScore,
      rating, chart_kind AS chartKind, chart_type AS chartType, internal_level AS internalLevel,
      official_rank AS officialRank, played_at AS playedAt FROM scores WHERE discord_user_id = ?`).all(discordUserId) as unknown as ScoreRecord[];
    return rows.map((score) => ({
      ...score,
      level: score.level ?? undefined,
      achievements: score.achievements ?? undefined,
      dxScore: score.dxScore ?? undefined,
      chartType: score.chartType ?? undefined,
      internalLevel: score.internalLevel ?? undefined,
      officialRank: score.officialRank ?? undefined,
      playedAt: score.playedAt ?? undefined
    }));
  }

  close(): void { this.db.close(); }
}
