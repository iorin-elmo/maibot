import {
  AttachmentBuilder, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandStringOption
} from "discord.js";
import { achievementRank, bestScores } from "./analysis.js";
import { makeBookmarklet } from "./browser-sync.js";
import { renderBestImage } from "./best-image.js";
import type { BotDatabase } from "./database.js";
import { truncateSongTitle } from "./text.js";
import type { ScoreRecord } from "./types.js";

const kindOption = (option: SlashCommandStringOption) =>
  option.setName("kind").setDescription("表示する譜面区分").addChoices(
    { name: "新曲", value: "new" },
    { name: "旧曲", value: "old" },
    { name: "全曲", value: "all" }
  );

export const maimaiCommand = new SlashCommandBuilder()
  .setName("maimai")
  .setDescription("maimaiのベスト枠を表示します")
  .addSubcommand((command) => command.setName("help").setDescription("使い方を表示します"))
  .addSubcommand((command) => command.setName("sync").setDescription("ブラウザからベスト枠を同期します"))
  .addSubcommand((command) => command.setName("best").setDescription("ベスト枠を表示します")
    .addStringOption(kindOption))
  .addSubcommand((command) => command.setName("mbest").setDescription("スマホ向けの短いベスト枠表示")
    .addStringOption(kindOption))
  .addSubcommand((command) => command.setName("image").setDescription("ベスト枠を画像で表示します")
    .addStringOption(kindOption));

function renderMarkdownScore(score: ScoreRecord, index: number, mixed: boolean): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const achievement = typeof score.achievements === "number" ? `${score.achievements.toFixed(4)}%` : "-";
  const constant = `[${typeof score.internalLevel === "number" ? score.internalLevel.toFixed(1) : "?"}]`;
  const rating = typeof score.internalLevel === "number" ? String(score.rating) : "?";
  const prefix = mixed ? `${score.chartKind === "new" ? "新" : "旧"}#${rank}` : `#${rank}`;
  return `**${prefix}** ${constant} ${rating} / ${achievementRank(score.achievements)} ${achievement} / ${truncateSongTitle(score.title)}`;
}

function renderMobileScore(score: ScoreRecord, index: number): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const category = score.chartKind === "new" ? "新" : "旧";
  const rating = (typeof score.internalLevel === "number" ? String(score.rating) : "?").padStart(3);
  return `${category}#${rank} [${rating}] ${truncateSongTitle(score.title)}`;
}

function splitLines(lines: string[], maxLength = 3_800): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function bestEmbeds(playerName: string, label: string, summary: string, scores: ScoreRecord[], mixed: boolean): EmbedBuilder[] {
  return splitLines(scores.map((score, index) => renderMarkdownScore(score, index, mixed)), 4_000).map((description, index) =>
    new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${summary}**\n\n`}${description}`));
}

export async function handleMaimai(interaction: ChatInputCommandInteraction, db: BotDatabase, importBaseUrl: string): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help") {
    const embed = new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle("maimai Bot の使い方")
      .setDescription("まず `/maimai sync` を実行し、返信のブックマークレットをログイン済みのmaimai DX NET上で実行してください。無料コースでも利用できます。")
      .addFields(
        { name: "/maimai best [kind]", value: "PC向けの詳しいベスト枠表示" },
        { name: "/maimai mbest [kind]", value: "スマホ向けの短いベスト枠表示" },
        { name: "/maimai image [kind]", value: "ベスト枠を画像で表示" },
        { name: "kind", value: "新曲 / 旧曲 / 全曲。省略時は全曲。" }
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  if (subcommand === "sync") {
    const token = db.createImportToken(interaction.user.id);
    const bookmarklet = makeBookmarklet(importBaseUrl, token);
    await interaction.reply({
      content: `下のコード全体をコピーして、ブラウザのブックマークURL欄に貼り付けてください。PC上でmaimai DX NETへログイン後、任意のページで実行すると、レコード＞楽曲スコア＞versionの全スコアを取得してBest 50を計算します。無料コースでも使えます。\n\n\`\`\`\n${bookmarklet}\n\`\`\`\n\nこのリンクは10分間・1回だけ有効です。SEGA ID・パスワードは送信されません。`,
      ephemeral: true
    });
    return;
  }

  const account = db.getAccount(interaction.user.id);
  if (!account || account.rating === null) {
    await interaction.reply({ content: "先に `/maimai sync` でベスト枠を同期してください。", ephemeral: true });
    return;
  }

  const kind = interaction.options.getString("kind") ?? "all";
  const newBest = bestScores(db.getScores(interaction.user.id), "new", 15);
  const oldBest = bestScores(db.getScores(interaction.user.id), "old", 35);
  const scores = kind === "new" ? newBest : kind === "old" ? oldBest : [...newBest, ...oldBest];
  if (!scores.length) {
    await interaction.reply({ content: "表示できるベスト枠がありません。`/maimai sync` をやり直してください。", ephemeral: true });
    return;
  }

  const newTotal = newBest.reduce((total, score) => total + score.rating, 0);
  const oldTotal = oldBest.reduce((total, score) => total + score.rating, 0);
  const mixed = kind === "all";
  const label = kind === "new" ? "新曲 Best 15" : kind === "old" ? "旧曲 Best 35" : "全曲 Best 50";
  const summary = kind === "new"
    ? `新曲合計レート: ${newTotal}`
    : kind === "old"
      ? `旧曲合計レート: ${oldTotal}`
      : `新曲レート: ${newTotal} + 旧曲レート: ${oldTotal} = 全曲レート: ${newTotal + oldTotal}`;
  const playerName = account.playerName ?? "maimai";

  if (subcommand === "mbest") {
    const embeds = splitLines(scores.map(renderMobileScore), 4_000).map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${summary}**\n\n`}\`\`\`\n${description}\n\`\`\``));
    await interaction.reply({ embeds });
    return;
  }

  if (subcommand === "image") {
    const image = renderBestImage(playerName, label, summary, scores, mixed);
    await interaction.reply({ files: [new AttachmentBuilder(image, { name: "maimai-best.png" })] });
    return;
  }

  await interaction.reply({ embeds: bestEmbeds(playerName, label, summary, scores, mixed) });
}
