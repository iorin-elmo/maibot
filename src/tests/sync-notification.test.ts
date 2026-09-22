import assert from "node:assert/strict";
import test from "node:test";
import { registerSyncNotification, takeSyncNotification } from "../sync-notification.js";
import type { SyncSummary } from "../sync-summary.js";

const summary: SyncSummary = {
  initial: true, playerName: "Player", rating: 1000, scores: [], updates: [],
  scoreRecordCount: 0, dxScoreRecordCount: 0, rankUpdateCount: 0, starUpdateCount: 0, newApPlusCount: 0, newApCount: 0, newFcPlusCount: 0, newFcCount: 0, newFdxCount: 0,
  rankUpdates: [], starUpdates: [], lampUpdates: []
};

test("a sync notification is consumed once by its import token", async () => {
  let received: SyncSummary | undefined;
  registerSyncNotification("notification-token", (value) => { received = value; });
  await takeSyncNotification("notification-token")?.(summary);
  assert.equal(received, summary);
  assert.equal(takeSyncNotification("notification-token"), undefined);
});
