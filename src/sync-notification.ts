import type { SyncSummary } from "./sync-summary.js";

type SyncNotification = (summary: SyncSummary) => Promise<void> | void;

const notifications = new Map<string, { expiresAt: number; notify: SyncNotification }>();

export function registerSyncNotification(token: string, notify: SyncNotification): void {
  const now = Date.now();
  for (const [key, value] of notifications) if (value.expiresAt < now) notifications.delete(key);
  notifications.set(token, { expiresAt: now + 10 * 60_000, notify });
}

export function takeSyncNotification(token: string): SyncNotification | undefined {
  const entry = notifications.get(token);
  notifications.delete(token);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.notify;
}
