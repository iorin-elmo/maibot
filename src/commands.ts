import {
  AttachmentBuilder, EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction
} from "discord.js";
import { achievementRank, bestScores, chartKindOf, totalBestRating, validateProfile } from "./analysis.js";
import type { BotDatabase } from "./database.js";
import type { ScoreRecord } from "./types.js";
import { makeBookmarklet } from "./browser-sync.js";
import { renderBestImage } from "./best-image.js";
import { truncateSongTitle } from "./text.js";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const maimaiCommand = new SlashCommandBuilder()
  .setName("maimai")
  .setDescription("maimaiのプロフィールとベスト枠を表示します")
  .addSubcommand((command) => command.setName("link").setDescription("SEGA IDを紐付けます")
    .addStringOption((option) => option.setName("sega_id").setDescription("SEGA ID（パスワードは入力しないでください）").setRequired(true)))
  .addSubcommand((command) => command.setName("unlink").setDescription("紐付けと保存済みスコアを削除します"))
  .addSubcommand((command) => command.setName("import").setDescription("プロフィールJSONを安全に取り込みます")
    .addAttachmentOption((option) => option.setName("file").setDescription("指定形式のJSONファイル（2MB以下）").setRequired(true)))
  .addSubcommand((command) => command.setName("sync").setDescription("ログイン済みブラウザからベスト枠を同期します"))
  .addSubcommand((command) => command.setName("template").setDescription("インポートJSONの雛形を取得します"))
  .addSubcommand((command) => command.setName("profile").setDescription("プロフィールを表示します")
    .addUserOption((option) => option.setName("user").setDescription("対象ユーザー。省略時は自分")))
  .addSubcommand((command) => command.setName("best").setDescription("自己ベスト枠を表示します")
    .addStringOption((option) => option.setName("kind").setDescription("譜面の区分（省略時は全曲）").addChoices(
      { name: "新曲", value: "new" }, { name: "旧曲", value: "old" }, { name: "全曲", value: "all" })))
  .addSubcommand((command) => command.setName("best-image").setDescription("自己ベスト枠を画像で表示します")
    .addStringOption((option) => option.setName("kind").setDescription("譜面の区分（省略時は全曲）").addChoices(
      { name: "新曲", value: "new" }, { name: "旧曲", value: "old" }, { name: "全曲", value: "all" })));

function accountId(interaction: ChatInputCommandInteraction): string {
  return interaction.options.getUser("user")?.id ?? interaction.user.id;
}

function shortNumber(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function renderMarkdownScore(score: ScoreRecord, index: number, mixed: boolean): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const achievement = (typeof score.achievements === "number" ? `${score.achievements.toFixed(4)}%` : "-").padStart(9);
  const constant = `[${typeof score.internalLevel === "number" ? score.internalLevel.toFixed(1) : "?"}]`.padEnd(6);
  const rating = (typeof score.internalLevel === "number" ? String(score.rating) : "?").padStart(3);
  const title = truncateSongTitle(score.title);
  const prefix = mixed ? `${score.chartKind === "new" ? "新" : "旧"}#${rank}` : `#${rank}`;
  return `${prefix} ${constant} ${rating} / ${achievementRank(score.achievements).padEnd(4)} ${achievement} / ${title}`;
}

function splitLines(lines: string[], maxLength = 3800): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) { chunks.push(current); current = ""; }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function bestEmbeds(playerName: string, label: string, summary: string, scores: ScoreRecord[], mixed: boolean): EmbedBuilder[] {
  return splitLines(scores.map((score, index) => renderMarkdownScore(score, index, mixed)), 4_000).map((description, index) =>
    new EmbedBuilder().setColor(0xff5a9e).setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${summary}**\n\n`}\`\`\`\n${description}\n\`\`\``));
}

function jsonAttachment(profile: unknown): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(JSON.stringify(profile, null, 2), "utf8"), { name: "maimai-profile-template.json" });
}

async function importAttachment(interaction: ChatInputCommandInteraction, db: BotDatabase): Promise<void> {
  const attachment = interaction.options.getAttachment("file", true);
  if (attachment.size > MAX_IMPORT_BYTES) throw new Error("ファイルは2MB以下にしてください。");
  const url = new URL(attachment.url);
  if (url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)) {
    throw new Error("Discordに添付されたファイルだけを受け付けます。");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("添付ファイルを取得できませんでした。");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("ファイルは2MB以下にしてください。");
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("JSONとして読み取れませんでした。"); }
  const profile = validateProfile(raw);
  db.importProfile(interaction.user.id, profile);
  await interaction.editReply(`取り込みました: **${profile.playerName}** / レート **${profile.rating}** / 譜面 **${profile.scores.length}件**`);
}

export async function handleMaimai(interaction: ChatInputCommandInteraction, db: BotDatabase, importBaseUrl: string): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "link") {
    const segaId = interaction.options.getString("sega_id", true).trim();
    if (!/^[A-Za-z0-9._@-]{3,128}$/.test(segaId)) throw new Error("SEGA IDの形式が不正です。");
    db.link(interaction.user.id, segaId);
    await interaction.reply({ content: "紐付けを保存しました。次に `/maimai import` でスコアJSONを取り込んでください。パスワードは保存・要求しません。", ephemeral: true });
    return;
  }
  if (subcommand === "unlink") {
    const removed = db.unlink(interaction.user.id);
    await interaction.reply({ content: removed ? "紐付けと保存済みスコアを削除しました。" : "紐付けはありません。", ephemeral: true });
    return;
  }
  if (subcommand === "import") {
    await interaction.deferReply({ ephemeral: true });
    await importAttachment(interaction, db);
    return;
  }
  if (subcommand === "template") {
    await replyWithTemplate(interaction);
    return;
  }
  if (subcommand === "sync") {
    const token = db.createImportToken(interaction.user.id);
    const bookmarklet = makeBookmarklet(importBaseUrl, token);
    const file = new AttachmentBuilder(Buffer.from(bookmarklet, "utf8"), { name: "maimai-sync-bookmarklet.txt" });
    await interaction.reply({ content: "この添付ファイルの内容を、ブラウザのブックマークURLとして保存してください。PC上のmaimai DX NETでログイン後、**でらっくすRating**ページを開いてそのブックマークを実行すると、10分以内に一度だけ同期できます。SEGA ID・パスワードは送信されません。", files: [file], ephemeral: true });
    return;
  }

  const targetId = accountId(interaction);
  const account = db.getAccount(targetId);
  if (!account || account.rating === null) {
    await interaction.reply({ content: "このユーザーには取り込み済みのプロフィールがありません。", ephemeral: true });
    return;
  }
  const scores = db.getScores(targetId);
  if (subcommand === "profile") {
    const calculated = totalBestRating(scores);
    const ranked = scores.some((score) => score.officialRank !== undefined);
    const unknown = scores.filter((score) => chartKindOf(score) === "unknown").length;
    const embed = new EmbedBuilder().setColor(0x00a7e1).setTitle(`${account.playerName ?? "maimai"} のプロフィール`)
      .addFields(
        { name: "レート", value: shortNumber(account.rating), inline: true },
        { name: "登録譜面", value: `${scores.length}件`, inline: true },
        { name: "Best 50計算", value: ranked ? `${calculated}（新15 + 旧35）` : `${calculated}（新15 + 旧35）`, inline: true }
      )
      .setFooter({ text: unknown ? `区分未設定: ${unknown}件（Best 50集計には含めません）` : "最終更新: インポート時" });
    await interaction.reply({ embeds: [embed] });
    return;
  }
  const kind = interaction.options.getString("kind") ?? "all";
  const newBest = bestScores(scores, "new", 15);
  const oldBest = bestScores(scores, "old", 35);
  const list = kind === "new" ? newBest : kind === "old" ? oldBest : [...newBest, ...oldBest];
  if (!list.length) {
    await interaction.reply({ content: "該当する譜面がありません。インポートJSONの chartKind を確認してください。", ephemeral: true });
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
  if (subcommand === "best-image") {
    const playerName = account.playerName ?? "maimai";
    const image = renderBestImage(playerName, label, summary, list, mixed);
    await interaction.reply({ files: [new AttachmentBuilder(image, { name: "maimai-best.png" })] });
    return;
  }
  await interaction.reply({ embeds: bestEmbeds(account.playerName ?? "maimai", label, summary, list, mixed) });
}

export const profileTemplate = {
  playerName: "Player", rating: 15000, updatedAt: "2026-09-13T00:00:00.000Z",
  scores: [{ title: "楽曲名", difficulty: "MASTER", level: "14+", achievements: 100.5, dxScore: 3000, rating: 300, chartKind: "new" }]
};

export async function replyWithTemplate(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ content: "インポート用JSONの雛形です。`chartKind` は `new` / `old` / `unknown` を指定します。", files: [jsonAttachment(profileTemplate)], ephemeral: true });
}
