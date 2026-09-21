import { Client, Events, GatewayIntentBits, REST, Routes, type ChatInputCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { BotDatabase } from "./database.js";
import { handleMaimai, handleMaimaiAutocomplete, maimaiCommand } from "./commands.js";
import { startBrowserSyncServer } from "./browser-sync.js";
import { MaimaiCatalog } from "./catalog.js";

const db = new BotDatabase(config.databasePath);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const catalog = new MaimaiCatalog(config.dxdataUrl);
startBrowserSyncServer(config.importBaseUrl, config.syncListenHost, config.syncListenPort, db, catalog);

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const applicationId = client.user?.id;
  if (!applicationId) throw new Error("Discord application IDを取得できませんでした。");
  const body = [maimaiCommand.toJSON()];
  if (config.guildId) await rest.put(Routes.applicationGuildCommands(applicationId, config.guildId), { body });
  else await rest.put(Routes.applicationCommands(applicationId), { body });
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await registerCommands();
    console.log(`Ready: ${readyClient.user.tag} (${config.guildId ? "guild" : "global"} commands registered)`);
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

client.login(config.discordToken);
