import { AttachmentBuilder, Client, Events, GatewayIntentBits, REST, Routes, type ChatInputCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { BotDatabase } from "./database.js";
import { handleMaimai, handleMaimaiAutocomplete, maimaiCommand } from "./commands.js";
import { startBrowserSyncServer } from "./browser-sync.js";
import { MaimaiCatalog } from "./catalog.js";
import { renderSyncSummaryImage } from "./best-image.js";
import { syncSummaryEmbed } from "./sync-summary.js";

const db = new BotDatabase(config.databasePath);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const catalog = new MaimaiCatalog(config.dxdataUrl);
function startSyncServer(): void {
  startBrowserSyncServer(config.importBaseUrl, config.syncListenHost, config.syncListenPort, db, catalog, async (recipient, summary) => {
  if (!recipient.notificationChannelId) return;
  if (!client.isReady()) {
    await new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
  }
  const channel = await client.channels.fetch(recipient.notificationChannelId);
  if (!channel?.isSendable()) throw new Error("Sync notification channel is not sendable");
  const files = recipient.wantsImage
    ? [new AttachmentBuilder(await renderSyncSummaryImage(summary), { name: "maimai-sync-summary.jpg" })]
    : [];
  await channel.send({ embeds: [syncSummaryEmbed(summary)], files });
  });
}

type RegisteredCommand = { id: string; name: string; type: number };

async function removeLegacyGuildCommands(rest: REST, applicationId: string): Promise<void> {
  for (const guildId of client.guilds.cache.keys()) {
    try {
      const commands = await rest.get(Routes.applicationGuildCommands(applicationId, guildId)) as RegisteredCommand[];
      await Promise.all(commands
        .filter((command) => command.name === "maimai" && command.type === 1)
        .map((command) => rest.delete(Routes.applicationGuildCommand(applicationId, guildId, command.id))));
    } catch (error) {
      console.warn(`Legacy command cleanup failed for guild ${guildId}`, error);
    }
  }
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const applicationId = client.user?.id;
  if (!applicationId) throw new Error("Discord application IDを取得できませんでした。");
  const body = [maimaiCommand.toJSON()];
  await rest.put(Routes.applicationCommands(applicationId), { body });
  await removeLegacyGuildCommands(rest, applicationId);
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await registerCommands();
    console.log(`Ready: ${readyClient.user.tag} (global commands registered)`);
  } catch (error) {
    console.error("Command registration failed", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      await handleMaimaiAutocomplete(interaction);
    } catch (error) {
      console.error("Autocomplete failed", error);
    }
    return;
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "maimai") return;
  try {
    await handleMaimai(interaction as ChatInputCommandInteraction, db, config.importBaseUrl, catalog);
  } catch (error) {
    console.error("Interaction failed", error);
    const content = `処理できませんでした: ${error instanceof Error ? error.message : "不明なエラー"}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(content);
    else await interaction.reply({ content, ephemeral: true });
  }
});

startSyncServer();
client.login(config.discordToken);
