import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import type { ImportTokenRecipient } from "./database.js";
import { renderSyncSummaryImage } from "./best-image.js";
import { syncSummaryEmbed, type SyncSummary } from "./sync-summary.js";

/** Builds the Sync result message in the format selected when Sync was started. */
export async function createSyncNotificationMessage(
  recipient: ImportTokenRecipient,
  summary: SyncSummary
): Promise<MessageCreateOptions> {
  if (recipient.wantsImage) {
    return {
      files: [new AttachmentBuilder(await renderSyncSummaryImage(summary), { name: "maimai-sync-summary.jpg" })]
    };
  }
  return { embeds: [syncSummaryEmbed(summary)] };
}
