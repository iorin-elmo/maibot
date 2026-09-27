import assert from "node:assert/strict";
import test from "node:test";
import { createSyncSummary } from "../sync-summary.js";
import { createSyncNotificationMessage } from "../sync-notification.js";

const summary = createSyncSummary(
  undefined,
  [],
  "Player",
  1234,
  [{ title: "First", difficulty: "MASTER", level: "14", achievements: 99, rating: 300, chartKind: "new", chartType: "dx" }]
);

test("Sync with image enabled sends only an image", async () => {
  const message = await createSyncNotificationMessage(
    { discordUserId: "user", notificationChannelId: "channel", wantsImage: true },
    summary
  );

  assert.equal(message.embeds?.length ?? 0, 0);
  assert.equal(message.files?.length, 1);
});

test("Sync with image disabled sends only text", async () => {
  const message = await createSyncNotificationMessage(
    { discordUserId: "user", notificationChannelId: "channel", wantsImage: false },
    summary
  );

  assert.equal(message.embeds?.length, 1);
  assert.equal(message.files?.length ?? 0, 0);
});
