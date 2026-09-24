import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ImportedProfile, LinkedAccount, ScoreRecord } from "./types.js";
import type { SyncSummary } from "./sync-summary.js";

export interface ImportTokenRecipient {
  discordUserId: string;
  notificationChannelId?: string;
  wantsImage: boolean;
}

export interface PendingSyncNotification {
  id: number;
  recipient: ImportTokenRecipient;
  summary: SyncSummary;
  deliveryAttempts: number;
}

const MAX_SYNC_NOTIFICATION_DELIVERY_ATTEMPTS = 5;
const DEAD_SYNC_NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60_000;

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
        updated_at TEXT,
        default_image INTEGER NOT NULL DEFAULT 0,
        default_count INTEGER CHECK(default_count BETWEEN 1 AND 50)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scores (
        discord_user_id TEXT NOT NULL REFERENCES accounts(discord_user_id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        level TEXT,
        achievements REAL,
        dx_score INTEGER,
        dx_score_max INTEGER,
        combo_status TEXT CHECK(combo_status IN ('AP+', 'AP', 'FC+', 'FC')),
        sync_status TEXT CHECK(sync_status IN ('FDX', 'FS')),
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
        expires_at INTEGER NOT NULL,
        notification_channel_id TEXT,
        notification_image INTEGER NOT NULL DEFAULT 0,
        persistent INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sync_notifications (
        id INTEGER PRIMARY KEY,
        discord_user_id TEXT NOT NULL REFERENCES accounts(discord_user_id) ON DELETE CASCADE,
        channel_id TEXT NOT NULL,
        wants_image INTEGER NOT NULL DEFAULT 0,
        summary_json TEXT NOT NULL,
        delivery_attempts INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dead_sync_notifications (
        id INTEGER PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        wants_image INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        delivery_attempts INTEGER NOT NULL,
        discarded_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS scores_by_rating ON scores(discord_user_id, chart_kind, rating DESC);
    `);
    try { this.db.exec("ALTER TABLE scores ADD COLUMN official_rank INTEGER"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN chart_type TEXT"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN internal_level REAL"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN dx_score_max INTEGER"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN combo_status TEXT CHECK(combo_status IN ('AP+', 'AP', 'FC+', 'FC'))"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE scores ADD COLUMN sync_status TEXT CHECK(sync_status IN ('FDX', 'FS'))"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE import_tokens ADD COLUMN notification_channel_id TEXT"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE import_tokens ADD COLUMN notification_image INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE import_tokens ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE sync_notifications ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE accounts ADD COLUMN default_image INTEGER NOT NULL DEFAULT 0"); } catch { /* existing database */ }
    try { this.db.exec("ALTER TABLE accounts ADD COLUMN default_count INTEGER CHECK(default_count BETWEEN 1 AND 50)"); } catch { /* existing database */ }
    this.db.prepare("DELETE FROM dead_sync_notifications WHERE discarded_at < ?").run(Date.now() - DEAD_SYNC_NOTIFICATION_RETENTION_MS);
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

  private ensureAccount(discordUserId: string): void {
    this.db.prepare(`INSERT INTO accounts (discord_user_id, sega_id) VALUES (?, ?)
      ON CONFLICT(discord_user_id) DO NOTHING`).run(discordUserId, `discord:${discordUserId}`);
  }

  getAccount(discordUserId: string): LinkedAccount | undefined {
    return this.db.prepare("SELECT discord_user_id AS discordUserId, sega_id AS segaId, player_name AS playerName, rating, updated_at AS updatedAt FROM accounts WHERE discord_user_id = ?").get(discordUserId) as LinkedAccount | undefined;
  }

  getDefaultImage(discordUserId: string): boolean {
    const account = this.db.prepare("SELECT default_image AS defaultImage FROM accounts WHERE discord_user_id = ?")
      .get(discordUserId) as { defaultImage: number } | undefined;
    return account?.defaultImage === 1;
  }

  getDefaultCount(discordUserId: string): number | undefined {
    const account = this.db.prepare("SELECT default_count AS defaultCount FROM accounts WHERE discord_user_id = ?")
      .get(discordUserId) as { defaultCount: number | null } | undefined;
    return account?.defaultCount ?? undefined;
  }

  setDefaultImage(discordUserId: string, wantsImage: boolean): void {
    this.ensureAccount(discordUserId);
    this.db.prepare("UPDATE accounts SET default_image = ? WHERE discord_user_id = ?")
      .run(wantsImage ? 1 : 0, discordUserId);
  }

  setDefaultCount(discordUserId: string, count: number): void {
    this.ensureAccount(discordUserId);
    this.db.prepare("UPDATE accounts SET default_count = ? WHERE discord_user_id = ?")
      .run(count, discordUserId);
  }

  createImportToken(discordUserId: string, notification?: { channelId: string; wantsImage: boolean }): string {
    this.ensureAccount(discordUserId);
    if (!this.getAccount(discordUserId)) throw new Error("先に /maimai link を実行してください。");
    const token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    this.db.prepare("DELETE FROM import_tokens WHERE (discord_user_id = ? AND persistent = 0) OR (persistent = 0 AND expires_at < ?)").run(discordUserId, Date.now());
    this.db.prepare(`INSERT INTO import_tokens (token_hash, discord_user_id, expires_at, notification_channel_id, notification_image)
      VALUES (?, ?, ?, ?, ?)`)
      .run(tokenHash, discordUserId, Date.now() + 10 * 60_000, notification?.channelId ?? null, notification?.wantsImage ? 1 : 0);
    return token;
  }

  /** Creates the one-time setup secret used by a user's persistent bookmarklet. */
  createPersistentSyncToken(discordUserId: string, notification: { channelId: string; wantsImage: boolean }, reset = false): { token?: string; created: boolean } {
    this.ensureAccount(discordUserId);
    if (reset) this.db.prepare("DELETE FROM import_tokens WHERE discord_user_id = ? AND persistent = 1").run(discordUserId);
    const existing = this.db.prepare("SELECT token_hash FROM import_tokens WHERE discord_user_id = ? AND persistent = 1")
      .get(discordUserId) as { token_hash: string } | undefined;
    if (existing) {
      this.db.prepare("UPDATE import_tokens SET notification_channel_id = ?, notification_image = ? WHERE token_hash = ?")
        .run(notification.channelId, notification.wantsImage ? 1 : 0, existing.token_hash);
      return { created: false };
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    this.db.prepare(`INSERT INTO import_tokens
      (token_hash, discord_user_id, expires_at, notification_channel_id, notification_image, persistent)
      VALUES (?, ?, ?, ?, ?, 1)`)
      .run(tokenHash, discordUserId, 0, notification.channelId, notification.wantsImage ? 1 : 0);
    return { token, created: true };
  }

  consumeImportTokenWithRecipient(token: string): ImportTokenRecipient | undefined {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const record = this.db.prepare(`SELECT discord_user_id AS discordUserId, expires_at AS expiresAt,
      notification_channel_id AS notificationChannelId, notification_image AS notificationImage, persistent
      FROM import_tokens WHERE token_hash = ?`).get(tokenHash) as {
        discordUserId: string; expiresAt: number; notificationChannelId: string | null; notificationImage: number; persistent: number;
      } | undefined;
    if (!record || (record.persistent !== 1 && record.expiresAt < Date.now())) return undefined;
    if (record.persistent !== 1) this.db.prepare("DELETE FROM import_tokens WHERE token_hash = ?").run(tokenHash);
    return {
      discordUserId: record.discordUserId,
      notificationChannelId: record.notificationChannelId ?? undefined,
      wantsImage: record.notificationImage === 1
    };
  }

  consumeImportToken(token: string): string | undefined {
    return this.consumeImportTokenWithRecipient(token)?.discordUserId;
  }

  queueSyncNotification(recipient: ImportTokenRecipient, summary: SyncSummary): void {
    if (!recipient.notificationChannelId) return;
    this.insertSyncNotification(recipient, summary);
  }

  private insertSyncNotification(recipient: ImportTokenRecipient, summary: SyncSummary): void {
    if (!recipient.notificationChannelId) return;
    this.db.prepare(`INSERT INTO sync_notifications
      (discord_user_id, channel_id, wants_image, summary_json) VALUES (?, ?, ?, ?)`)
      .run(recipient.discordUserId, recipient.notificationChannelId, recipient.wantsImage ? 1 : 0, JSON.stringify(summary));
  }

  getPendingSyncNotifications(discordUserId?: string): PendingSyncNotification[] {
    const statement = discordUserId
      ? this.db.prepare(`SELECT id, discord_user_id AS discordUserId, channel_id AS channelId,
          wants_image AS wantsImage, summary_json AS summaryJson, delivery_attempts AS deliveryAttempts FROM sync_notifications
          WHERE discord_user_id = ? ORDER BY id`)
      : this.db.prepare(`SELECT id, discord_user_id AS discordUserId, channel_id AS channelId,
          wants_image AS wantsImage, summary_json AS summaryJson, delivery_attempts AS deliveryAttempts FROM sync_notifications ORDER BY id`);
    const rows = (discordUserId ? statement.all(discordUserId) : statement.all()) as Array<{
      id: number; discordUserId: string; channelId: string; wantsImage: number; summaryJson: string; deliveryAttempts: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      recipient: { discordUserId: row.discordUserId, notificationChannelId: row.channelId, wantsImage: row.wantsImage === 1 },
      summary: JSON.parse(row.summaryJson) as SyncSummary,
      deliveryAttempts: row.deliveryAttempts
    }));
  }

  deletePendingSyncNotification(id: number): void {
    this.db.prepare("DELETE FROM sync_notifications WHERE id = ?").run(id);
  }

  recordSyncNotificationFailure(id: number): boolean {
    const notification = this.db.prepare(`SELECT discord_user_id AS discordUserId, channel_id AS channelId,
      wants_image AS wantsImage, summary_json AS summaryJson, delivery_attempts AS deliveryAttempts
      FROM sync_notifications WHERE id = ?`).get(id) as {
        discordUserId: string; channelId: string; wantsImage: number; summaryJson: string; deliveryAttempts: number;
      } | undefined;
    if (!notification) return false;
    const deliveryAttempts = notification.deliveryAttempts + 1;
    if (deliveryAttempts < MAX_SYNC_NOTIFICATION_DELIVERY_ATTEMPTS) {
      this.db.prepare("UPDATE sync_notifications SET delivery_attempts = ? WHERE id = ?").run(deliveryAttempts, id);
      return true;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`INSERT INTO dead_sync_notifications
        (discord_user_id, channel_id, wants_image, summary_json, delivery_attempts, discarded_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(notification.discordUserId, notification.channelId, notification.wantsImage, notification.summaryJson, deliveryAttempts, Date.now());
      this.db.prepare("DELETE FROM sync_notifications WHERE id = ?").run(id);
      this.db.exec("COMMIT");
      return false;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  importProfile(discordUserId: string, profile: ImportedProfile): void {
    this.importProfileWithSyncNotification(discordUserId, profile);
  }

  importProfileWithSyncNotification(discordUserId: string, profile: ImportedProfile, notification?: { recipient: ImportTokenRecipient; summary: SyncSummary }): void {
    this.ensureAccount(discordUserId);
    if (!this.getAccount(discordUserId)) throw new Error("先に /maimai link を実行してください。");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE accounts SET player_name = ?, rating = ?, updated_at = ? WHERE discord_user_id = ?")
        .run(profile.playerName, profile.rating, profile.updatedAt ?? new Date().toISOString(), discordUserId);
      this.db.prepare("DELETE FROM scores WHERE discord_user_id = ?").run(discordUserId);
      const insert = this.db.prepare(`INSERT INTO scores
        (discord_user_id, title, difficulty, level, achievements, dx_score, dx_score_max, combo_status, sync_status, rating, chart_kind, chart_type, internal_level, official_rank, played_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const score of profile.scores) insert.run(discordUserId, score.title, score.difficulty, score.level ?? null,
        score.achievements ?? null, score.dxScore ?? null, score.dxScoreMax ?? null, score.comboStatus ?? null, score.syncStatus ?? null, score.rating, score.chartKind ?? "unknown", score.chartType ?? null,
        score.internalLevel ?? null, score.officialRank ?? null, score.playedAt ?? null);
      if (notification) this.insertSyncNotification(notification.recipient, notification.summary);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getScores(discordUserId: string): ScoreRecord[] {
    const rows = this.db.prepare(`SELECT title, difficulty, level, achievements AS achievements, dx_score AS dxScore, dx_score_max AS dxScoreMax, combo_status AS comboStatus, sync_status AS syncStatus,
      rating, chart_kind AS chartKind, chart_type AS chartType, internal_level AS internalLevel,
      official_rank AS officialRank, played_at AS playedAt FROM scores WHERE discord_user_id = ?`).all(discordUserId) as unknown as ScoreRecord[];
    return rows.map((score) => ({
      ...score,
      level: score.level ?? undefined,
      achievements: score.achievements ?? undefined,
      dxScore: score.dxScore ?? undefined,
      dxScoreMax: score.dxScoreMax ?? undefined,
      comboStatus: score.comboStatus ?? undefined,
      syncStatus: score.syncStatus ?? undefined,
      chartType: score.chartType ?? undefined,
      internalLevel: score.internalLevel ?? undefined,
      officialRank: score.officialRank ?? undefined,
      playedAt: score.playedAt ?? undefined
    }));
  }

  close(): void { this.db.close(); }
}
