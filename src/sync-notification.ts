import type { SyncSummary } from "./sync-summary.js";

type SyncNotification = (summary: SyncSummary) => Promise<void> | void;

const notificationLifetimeMs = 10 * 60_000;
interface PendingNotification { expiresAt: number; notify: SyncNotification; timeout: ReturnType<typeof setTimeout>; }
const notifications = new Map<string, PendingNotification>();

export function registerSyncNotification(token: string, notify: SyncNotification): void {
  const now = Date.now();
  for (const [key, value] of notifications) {
    if (value.expiresAt < now) {
      clearTimeout(value.timeout);
      notifications.delete(key);
    }
  }
  const existing = notifications.get(token);
  if (existing) clearTimeout(existing.timeout);
  const timeout = setTimeout(() => notifications.delete(token), notificationLifetimeMs);
  timeout.unref();
  notifications.set(token, { expiresAt: now + notificationLifetimeMs, notify, timeout });
}

export function takeSyncNotification(token: string): SyncNotification | undefined {
  const entry = notifications.get(token);
  notifications.delete(token);
  if (entry) clearTimeout(entry.timeout);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.notify;
}
