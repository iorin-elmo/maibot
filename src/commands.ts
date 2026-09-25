import {
  AttachmentBuilder, EmbedBuilder, InteractionContextType, SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandIntegerOption, type SlashCommandStringOption
} from "discord.js";
import { achievementRank, bestCandidates, bestScores, dxScorePercent, dxStar, dxStarCandidates, type BestCandidate, type DxStarCandidate } from "./analysis.js";
import { makeFreeBookmarklet } from "./browser-sync.js";
import { bestCards, candidateCards, dxScoreCards, dxStarCandidateCards, newConstantCards, progressCards, renderScoreCardImages } from "./best-image.js";
import type { MaimaiCatalog } from "./catalog.js";
import type { BotDatabase } from "./database.js";
import { isComboOrSyncKind, levelProgressKinds, plateByVersionAndKind, plateGoalDescription, plateVersions, progressKindSatisfied, type LevelProgressKind, type PlateKind } from "./progress.js";
import { padDisplayEnd, truncateSongTitle } from "./text.js";
import type { ScoreRecord } from "./types.js";

const kindOption = (option: SlashCommandStringOption) =>
  option.setName("kind").setDescription("表示する譜面区分").addChoices(
    { name: "新曲", value: "new" },
    { name: "旧曲", value: "old" },
    { name: "全曲", value: "all" }
  );

const countOption = (option: SlashCommandIntegerOption) =>
  option.setName("count").setDescription("表示件数（既定: 10、最大: 50）").setMinValue(1).setMaxValue(50);

const newConstantCountOption = (option: SlashCommandIntegerOption) =>
  option.setName("count").setDescription("表示件数（既定: 30、最大: 50）").setMinValue(1).setMaxValue(50);

const levelOption = (option: SlashCommandStringOption) =>
  option.setName("level").setDescription("対象レベル（例: 14、14+）").setRequired(true);

const difficultyOption = (option: SlashCommandStringOption, required = false) =>
  option.setName("difficulty").setDescription("対象難易度").setRequired(required).addChoices(
    { name: "BASIC", value: "BASIC" },
    { name: "ADVANCED", value: "ADVANCED" },
    { name: "EXPERT", value: "EXPERT" },
    { name: "MASTER", value: "MASTER" },
    { name: "Re:MASTER", value: "RE:MASTER" }
  );

const levelProgressKindOption = (option: SlashCommandStringOption) =>
  option.setName("kind").setDescription("未達成の目標").setRequired(true).addChoices(
    ...levelProgressKinds.map((kind) => ({ name: kind, value: kind }))
  );

const plateVersionOption = (option: SlashCommandStringOption) =>
  option.setName("version").setDescription("プレートのバージョンを入力して候補を絞り込み（例: 桃、熊、彩）").setRequired(true).setAutocomplete(true);

const plateKindOption = (option: SlashCommandStringOption) =>
  option.setName("kind").setDescription("プレートの目標").setRequired(true).addChoices(
    { name: "神（ALL PERFECT）", value: "神" },
    { name: "極（FULL COMBO）", value: "極" },
    { name: "将（RANK SSS）", value: "将" },
    { name: "舞舞（FULL SYNC DX）", value: "舞舞" }
  );

const starOption = (option: SlashCommandIntegerOption) =>
  option.setName("star").setDescription("目標のDXスコア星").setRequired(true).setMinValue(1).setMaxValue(6);

const imageOption = (option: import("discord.js").SlashCommandBooleanOption) =>
  option.setName("image").setDescription("ジャケット付きの画像で出力します");

function difficultyKey(value: string): string {
  return value.normalize("NFKC").replace(/[\s:]/g, "").toUpperCase();
}

export const maimaiCommand = new SlashCommandBuilder()
  .setName("maimai")
  .setDescription("maimaiのベスト枠を表示します")
  .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
  .addSubcommand((command) => command.setName("help").setDescription("使い方を表示します"))
  .addSubcommand((command) => command.setName("settings").setDescription("画像表示の既定値を設定します")
    .addBooleanOption((option) => option.setName("image").setDescription("画像を既定で表示するか（未指定なら現在値を表示）"))
    .addIntegerOption((option) => option.setName("count").setDescription("一覧の既定表示件数（未指定なら現在値を表示）").setMinValue(1).setMaxValue(50)))
  .addSubcommand((command) => command.setName("sync").setDescription("無料コースのversion別スコアから同期します")
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("sync-reset").setDescription("恒久同期ブックマークを作り直します"))
  .addSubcommand((command) => command.setName("newconstant").setDescription("新曲譜面を定数が高い順に表示します")
    .addIntegerOption(newConstantCountOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("plate").setDescription("プレート取得に足りない譜面を表示")
    .addStringOption(plateVersionOption)
    .addStringOption(plateKindOption)
    .addStringOption(difficultyOption)
    .addIntegerOption(newConstantCountOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("level").setDescription("指定レベルの未達成譜面を表示")
    .addStringOption(levelOption)
    .addStringOption(levelProgressKindOption)
    .addStringOption(difficultyOption)
    .addIntegerOption(newConstantCountOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("difficulty").setDescription("指定難易度の譜面を定数順に表示")
    .addStringOption((option) => difficultyOption(option, true))
    .addIntegerOption(newConstantCountOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("best").setDescription("ベスト枠を表示します")
    .addStringOption(kindOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("mbest").setDescription("スマホ向けの短いベスト枠表示")
    .addStringOption(kindOption))
  .addSubcommand((command) => command.setName("image").setDescription("ベスト枠を画像で表示します")
    .addStringOption(kindOption))
  .addSubcommand((command) => command.setName("candidate").setDescription("次ランク到達でBestレートが伸びる候補譜面を表示")
    .addStringOption(kindOption)
    .addIntegerOption(countOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("dxscore").setDescription("指定レベルのDXスコア%順を表示")
    .addStringOption(levelOption)
    .addIntegerOption(countOption)
    .addBooleanOption(imageOption))
  .addSubcommand((command) => command.setName("dxstar").setDescription("指定したDXスコア星まであと少しの譜面を表示")
    .addStringOption(levelOption)
    .addIntegerOption(starOption)
    .addIntegerOption(countOption)
    .addBooleanOption(imageOption));

export async function handleMaimaiAutocomplete(interaction: import("discord.js").AutocompleteInteraction): Promise<void> {
  if (interaction.commandName !== "maimai" || interaction.options.getSubcommand() !== "plate") return;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "version") return;
  const query = String(focused.value).trim();
  // Discord allows only 25 autocomplete choices.  Keep the special 舞 plate
  // and the newest 24 versions visible before the user starts typing; older
  // plates remain discoverable by their name or label.
  const candidates = query
    ? plateVersions.filter((version) => version.name.startsWith(query) || version.name.includes(query) || version.label.includes(query))
    : [
        ...plateVersions.filter((version) => version.name === "舞"),
        ...plateVersions.filter((version) => version.name !== "舞").slice(-24)
      ];
  const matches = candidates
    .slice(0, 25)
    .map((version) => ({ name: `${version.name} — ${version.label}`, value: version.name }));
  await interaction.respond(matches);
}

function renderMarkdownScore(score: ScoreRecord, index: number, mixed: boolean): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const achievement = typeof score.achievements === "number" ? `${score.achievements.toFixed(4)}%` : "-";
  const constant = `[${typeof score.internalLevel === "number" ? score.internalLevel.toFixed(1) : "?"}]`;
  const rating = typeof score.internalLevel === "number" ? String(score.rating) : "?";
  const prefix = mixed ? `${score.chartKind === "new" ? "新" : "旧"}#${rank}` : `#${rank}`;
  return `**${prefix}** ${constant} ${rating} / ${achievementRank(score.achievements)} ${achievement} / ${truncateSongTitle(score.title)}`;
}

function renderBestScore(score: ScoreRecord, index: number, mixed: boolean): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const achievement = typeof score.achievements === "number" ? `${score.achievements.toFixed(4)}%` : "-";
  const constant = `[${typeof score.internalLevel === "number" ? score.internalLevel.toFixed(1) : "?"}]`;
  const rating = (typeof score.internalLevel === "number" ? String(score.rating) : "?").padStart(3);
  const prefix = mixed ? `${score.chartKind === "new" ? "\u65b0" : "\u65e7"}#${rank}` : `#${rank}`;
  return `${padDisplayEnd(prefix, 5)} ${constant.padEnd(6)} ${rating} / ${achievementRank(score.achievements).padEnd(4)} ${achievement.padStart(9)} / ${truncateSongTitle(score.title)}`;
}

function renderMobileScore(score: ScoreRecord, index: number): string {
  const rank = String(score.officialRank ?? index + 1).padStart(2, "0");
  const category = score.chartKind === "new" ? "新" : "旧";
  const rating = (typeof score.internalLevel === "number" ? String(score.rating) : "?").padStart(3);
  return `${category}#${rank} [${rating}] ${truncateSongTitle(score.title)}`;
}

export function renderNewConstantScore(score: ScoreRecord, index: number): string {
  const constant = `[${score.internalLevel?.toFixed(1) ?? "?"}]`;
  const achievement = score.achievements === undefined ? "-%" : `${score.achievements.toFixed(4)}%`;
  const chart = `${score.chartType === "standard" ? "STD" : "DX"} ${score.difficulty.toUpperCase()}`;
  return `#${String(index + 1).padStart(2)} ${constant} ${achievement.padStart(9)} / ${chart} / ${truncateSongTitle(score.title)}`;
}

export function renderDifficultyScore(score: ScoreRecord, index: number): string {
  const constant = `[${score.internalLevel?.toFixed(1) ?? "?"}]`;
  const achievement = score.achievements === undefined ? "-%" : `${score.achievements.toFixed(4)}%`;
  const chartType = (score.chartType === "standard" ? "STD" : "DX").padEnd(3);
  return `#${String(index + 1).padStart(2)} ${constant} ${achievement.padStart(9)} / ${chartType} / ${truncateSongTitle(score.title)}`;
}

export function renderProgressScore(score: ScoreRecord, index: number, kind: LevelProgressKind | "AP" | "FC" | "SSS" | "FDX"): string {
  const constant = `[${score.internalLevel?.toFixed(1) ?? "?"}]`;
  const achievement = (score.achievements === undefined ? "-%" : `${score.achievements.toFixed(4)}%`).padStart(9);
  const prefix = `#${String(index + 1).padStart(2, "0")} ${constant} ${achievement}`;
  if (isComboOrSyncKind(kind)) {
    const combo = score.comboStatus?.padEnd(3) ?? " - ";
    const sync = score.syncStatus?.padEnd(3) ?? " - ";
    return `${prefix} (${combo}) (${sync}) / ${truncateSongTitle(score.title)}`;
  }
  const rank = score.achievements === undefined ? " -- " : achievementRank(score.achievements).padEnd(4);
  return `${prefix} (${rank}) / ${truncateSongTitle(score.title)}`;
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

function asCodeBlock(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

function bestEmbeds(playerName: string, label: string, summary: string, scores: ScoreRecord[], mixed: boolean): EmbedBuilder[] {
  return splitLines(scores.map((score, index) => renderBestScore(score, index, mixed)), 3_900).map((description, index) =>
    new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${summary}**\n\n`}${asCodeBlock(description)}`));
}

export function renderCandidate(candidate: BestCandidate, index: number): string {
  const score = candidate.score;
  const level = `[${score.internalLevel?.toFixed(1) ?? "?"}]`;
  const currentAchievement = (typeof score.achievements === "number" ? `${score.achievements.toFixed(4)}%` : "-").padStart(9);
  const currentScore = `#${String(index + 1).padStart(2, "0")} ${level} ${currentAchievement}`;
  const nextRank = padDisplayEnd(candidate.nextRank, 4);
  const ratingGain = `(+${String(candidate.ratingGain).padStart(2)})`;
  return `${currentScore} → ${nextRank} ${ratingGain} / ${truncateSongTitle(score.title)}`;
}

export function renderDxScore(score: ScoreRecord, index: number): string {
  const percent = dxScorePercent(score);
  const stars = dxStar(score);
  if (percent === undefined || stars === undefined || score.dxScore === undefined || score.dxScoreMax === undefined) {
    throw new Error("DXスコアの表示に必要なデータがありません。");
  }
  return `#${String(index + 1).padStart(2)} ${String(score.dxScore).padStart(4)}/${score.dxScoreMax} (${percent.toFixed(3)}%) ☆${stars} / ${truncateSongTitle(score.title)}`;
}

export function renderDxStarCandidate(candidate: DxStarCandidate, index: number, missingScoreWidth = 1): string {
  const missingScore = String(candidate.missingScore);
  // Keep the right edge of the deficit aligned, while moving padding before
  // the minus sign so that `- 1` is never emitted.
  const target = `☆${candidate.targetStars} ${" ".repeat(Math.max(0, missingScoreWidth - missingScore.length))}-${missingScore}`;
  return renderDxScore(candidate.score, index).replace(`☆${candidate.currentStars}`, target);
}

function candidateEmbeds(playerName: string, kind: "new" | "old", candidates: BestCandidate[], hasOutsideCharts: boolean): EmbedBuilder[] {
  const label = kind === "new" ? "新曲枠の候補" : "旧曲枠の候補";
  const syncNote = hasOutsideCharts ? "" : "Best枠外の候補を含めるには `/maimai sync` が必要です。\n";
  if (!candidates.length) return [new EmbedBuilder()
    .setColor(0xff5a9e)
    .setTitle(`${playerName} の${label}`)
    .setDescription(`${syncNote}\n上位ランク到達でレートが伸びる候補はありません。`)];
  return splitLines(candidates.map(renderCandidate), 4_000).map((description, index) => new EmbedBuilder()
    .setColor(0xff5a9e)
    .setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
    .setDescription(`${index ? "" : `${syncNote}必要達成率差が小さい順です。「(+値)」は、Bestレートが伸びる最初の上位ランクまで上げた場合の増分です。\n\n`}${asCodeBlock(description)}`));
}

async function replyCardImages(interaction: ChatInputCommandInteraction, playerName: string, title: string, cards: Parameters<typeof renderScoreCardImages>[2], filename: string): Promise<void> {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
  const images = await renderScoreCardImages(playerName, title, cards);
  await interaction.editReply({ files: images.map((image, index) => new AttachmentBuilder(image, { name: `${filename}-${index + 1}.jpg` })) });
}

async function enrichImageScores(catalog: MaimaiCatalog | undefined, scores: ScoreRecord[]): Promise<ScoreRecord[]> {
  if (!catalog) return scores;
  try {
    return await catalog.enrich(scores);
  } catch (error) {
    console.warn("Could not resolve score jackets", error);
    return scores;
  }
}

export async function handleMaimai(interaction: ChatInputCommandInteraction, db: BotDatabase, importBaseUrl: string, catalog?: MaimaiCatalog): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "help") {
    const embed = new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle("maimai Bot の使い方")
      .setDescription("`/maimai sync` を実行し、返信のブックマークレットをログイン済みのmaimai DX NET上で実行してください。")
      .addFields(
        { name: "/maimai sync [image]", value: "無料コース向け。version別スコアからBest 50を計算して同期。image で同期結果をジャケット付き画像でも出力" },
        { name: "/maimai sync-reset", value: "恒久同期ブックマークを無効化して作り直す" },
        { name: "/maimai newconstant [count] [image]", value: "新曲（最新2バージョン）のDX/STD譜面を定数が高い順に表示。image でジャケット画像、既定30件・最大50件" },
        { name: "/maimai plate <version> <kind> [difficulty] [count] [image]", value: "指定プレートに不足している譜面を定数が高い順に表示。difficulty で難易度を絞り込み可能" },
        { name: "/maimai level <level> <kind> [difficulty] [count] [image]", value: "指定レベルの未達成譜面を達成率順に表示。difficulty で難易度を絞り込み可能" },
        { name: "/maimai difficulty <difficulty> [count] [image]", value: "指定難易度の全譜面を譜面定数順、同じ定数では達成率順に表示" },
        { name: "/maimai best [kind] [image]", value: "PC向けの詳しいベスト枠表示。image を有効にするとジャケット付きカード画像" },
        { name: "/maimai mbest [kind]", value: "スマホ向けの短いベスト枠表示" },
        { name: "/maimai image [kind]", value: "ベスト枠を画像で表示" },
        { name: "/maimai candidate [kind] [count] [image]", value: "次ランク到達でBestレートが伸びる候補。枠外候補の算出には /maimai sync が必要（既定10件、最大50件）" },
        { name: "/maimai dxscore <level> [count] [image]", value: "指定レベルのDXスコア%順。現在DXスコア / 譜面ごとの最大DXスコアを表示（既定10件、最大50件）" },
        { name: "/maimai dxstar <level> <star> [count] [image]", value: "指定レベルで、次の指定星まであと何DXスコアかが少ない順。star は1〜6（既定10件、最大50件）" },
        { name: "/maimai settings <image>", value: "画像対応コマンドの画像表示を、ユーザーごとに既定オン／オフへ設定。各コマンドの image 指定はこの値を一度だけ上書き" },
        { name: "kind", value: "新曲 / 旧曲 / 全曲。省略時は全曲。" },
        { name: "詳細", value: "詳細は [https://iorin-elmo.github.io/maibot](https://iorin-elmo.github.io/maibot) をご覧ください。" }
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  if (subcommand === "settings") {
    const requestedImage = interaction.options.getBoolean("image");
    const requestedCount = interaction.options.getInteger("count");
    if (requestedImage === null && requestedCount === null) {
      const wantsImage = db.getDefaultImage(interaction.user.id);
      const count = db.getDefaultCount(interaction.user.id);
      await interaction.reply({ content: `現在の設定:\n- 既定の画像表示: **${wantsImage ? "オン" : "オフ"}**\n- 既定の表示件数: **${count ?? "コマンドごとの既定値"}**\n\n\`/maimai settings image:true/false count:1〜50\` で変更できます。`, ephemeral: true });
      return;
    }
    if (requestedImage !== null) db.setDefaultImage(interaction.user.id, requestedImage);
    if (requestedCount !== null) db.setDefaultCount(interaction.user.id, requestedCount);
    const wantsImage = db.getDefaultImage(interaction.user.id);
    const count = db.getDefaultCount(interaction.user.id);
    await interaction.reply({ content: `設定を更新しました。\n- 既定の画像表示: **${wantsImage ? "オン" : "オフ"}**\n- 既定の表示件数: **${count ?? "コマンドごとの既定値"}**\n\n各コマンドの \`image\` / \`count\` 指定は一度だけ上書きします。`, ephemeral: true });
    return;
  }
  if (subcommand === "sync" || subcommand === "sync-reset") {
    const wantsImage = interaction.options.getBoolean("image") ?? db.getDefaultImage(interaction.user.id);
    const persistent = db.createPersistentSyncToken(interaction.user.id, { channelId: interaction.channelId, wantsImage }, subcommand === "sync-reset");
    if (!persistent.created) {
      await interaction.reply({ content: "恒久ブックマーク `maibot` は作成済みです。maimai DX NET上で実行すると同期できます。このチャンネルを同期結果の通知先に更新しました。ブックマークを作り直す場合は `/maimai sync-reset` を実行してください。", ephemeral: true });
      return;
    }
    const token = persistent.token!;
    const bookmarklet = makeFreeBookmarklet(importBaseUrl, token);
    const instructions = "maimai DX NETへログイン済みのブラウザで、任意のページから実行してください。全難易度の楽曲スコアを取得してBest 50を計算します。";
    await interaction.reply({
      content: `下のコード全体をコピーして名前を \`maibot\` としたブックマークのURL欄に貼り付けてください。以後はmaimai DX NET上でそのブックマークを実行するだけで同期できます。${instructions}\n\n\`\`\`\n${bookmarklet}\n\`\`\`\n\nこのブックマークはあなた専用です。共有しないでください。作り直す場合は \`/maimai sync-reset\` を実行してください。`,
      ephemeral: true
    });
    return;
  }

  const account = db.getAccount(interaction.user.id);
  if (!account || account.rating === null) {
    await interaction.reply({ content: "先に `/maimai sync` でベスト枠を同期してください。", ephemeral: true });
    return;
  }

  const wantsImage = subcommand === "image" || (interaction.options.getBoolean("image") ?? db.getDefaultImage(interaction.user.id));
  const defaultCount = db.getDefaultCount(interaction.user.id);
  const kind = interaction.options.getString("kind") ?? "all";
  const storedScores = db.getScores(interaction.user.id);
  const availableScores = catalog ? await catalog.excludeLocked(storedScores) : storedScores;
  // Older imports can be missing catalogue metadata (for example, if the
  // upstream catalogue temporarily marked a playable song as locked). Refresh
  // it for every command so the score becomes usable without a re-sync.
  const allScores = catalog ? await enrichImageScores(catalog, availableScores) : availableScores;
  const playerName = account.playerName ?? "maimai";
  if (subcommand === "newconstant") {
    if (!catalog) throw new Error("譜面定数データを利用できません。");
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 30;
    await interaction.deferReply();
    const scores = (await catalog.newestChartConstantRanking(allScores)).slice(0, count);
    if (!scores.length) {
      await interaction.editReply("新曲の譜面定数データがありません。");
      return;
    }
    if (wantsImage) {
      const imageScores = await enrichImageScores(catalog, scores);
      await replyCardImages(interaction, playerName, "新曲譜面定数順", newConstantCards(imageScores), "maimai-newconstant");
      return;
    }
    const descriptions = splitLines(scores.map(renderNewConstantScore), 3_900).map(asCodeBlock);
    await interaction.editReply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の新曲譜面定数順${index ? "（続き）" : ""}`)
        .setDescription(`${index ? "" : "**新曲（最新2バージョン）のDX/STD譜面を譜面定数が高い順に表示します。未プレイは -% と表示します。全スコアの反映には `/maimai sync` を利用してください。**\n\n"}${description}`)) });
    return;
  }
  if (subcommand === "plate") {
    if (!catalog) throw new Error("譜面定数データを利用できません。");
    const version = interaction.options.getString("version", true);
    const kind = interaction.options.getString("kind", true) as PlateKind;
    const plate = plateByVersionAndKind(version, kind);
    if (!plate) {
      const message = version === "真" && kind === "将"
        ? "真将は存在しないプレートです。真極・真神・真舞舞を選択してください。"
        : `バージョン「${version}」を確認できません。候補から選択してください。`;
      await interaction.reply({ content: message, ephemeral: true });
      return;
    }
    const requestedDifficulty = interaction.options.getString("difficulty");
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 30;
    await interaction.deferReply();
    const plateScores = await catalog.plateProgressRanking(plate.versions, allScores, plate.standardOnly, plate.excludedTitles, plate.includeRemaster);
    if (!plateScores.length) {
      await interaction.editReply(`${plate.name} の対象譜面データを取得できません。カタログを更新してからお試しください。`);
      return;
    }
    const difficultyScores = plateScores
      .filter((score) => !requestedDifficulty || difficultyKey(score.difficulty) === difficultyKey(requestedDifficulty));
    if (!difficultyScores.length) {
      await interaction.editReply(`${plate.name} に ${requestedDifficulty} の対象譜面はありません。`);
      return;
    }
    const scores = difficultyScores
      .filter((score) => !progressKindSatisfied(score, plate.goal))
      .sort((a, b) => (b.internalLevel ?? 0) - (a.internalLevel ?? 0)
        || (b.achievements ?? -Infinity) - (a.achievements ?? -Infinity)
        || a.title.localeCompare(b.title, "ja"))
      .slice(0, count);
    if (!scores.length) {
      const scope = requestedDifficulty ? `${requestedDifficulty} の対象譜面で` : "";
      await interaction.editReply(`${plate.name} の${scope}条件をすべて満たしています！`);
      return;
    }
    if (wantsImage) {
      const imageScores = await enrichImageScores(catalog, scores);
      await replyCardImages(interaction, playerName, `${plate.name}候補曲`, progressCards(imageScores, isComboOrSyncKind(plate.goal)), "maimai-plate");
      return;
    }
    const descriptions = splitLines(scores.map((score, index) => renderProgressScore(score, index, plate.goal)), 3_900).map(asCodeBlock);
    const difficultyNote = requestedDifficulty ? `（${requestedDifficulty}のみ）` : "";
    const plateSummary = `**${plate.label}の全譜面${difficultyNote} ${plateGoalDescription(plate.goal)} に足りない譜面を、譜面定数が高い順に表示します。状態を反映するには \`/maimai sync\` を再実行してください。**\n\n`;
    await interaction.editReply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の${plate.name}候補曲${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : plateSummary}${description}`)) });
    return;
  }
  if (subcommand === "level") {
    if (!catalog) throw new Error("譜面定数データを利用できません。");
    const level = interaction.options.getString("level", true).trim();
    const kind = interaction.options.getString("kind", true) as LevelProgressKind;
    const requestedDifficulty = interaction.options.getString("difficulty");
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 30;
    await interaction.deferReply();
    const levelScores = await catalog.levelProgressRanking(level, allScores);
    if (!levelScores.length) {
      await interaction.editReply(`Lv.${level} の譜面が見つかりません。レベル表記を確認してください。`);
      return;
    }
    const difficultyScores = levelScores
      .filter((score) => !requestedDifficulty || difficultyKey(score.difficulty) === difficultyKey(requestedDifficulty));
    if (!difficultyScores.length) {
      await interaction.editReply(`Lv.${level} に ${requestedDifficulty} の譜面はありません。`);
      return;
    }
    const scores = difficultyScores
      .filter((score) => !progressKindSatisfied(score, kind))
      .sort((a, b) => (b.achievements ?? -Infinity) - (a.achievements ?? -Infinity)
        || (b.internalLevel ?? 0) - (a.internalLevel ?? 0)
        || a.title.localeCompare(b.title, "ja"))
      .slice(0, count);
    if (!scores.length) {
      const scope = requestedDifficulty ? `${requestedDifficulty} の譜面で` : "全譜面で";
      await interaction.editReply(`Lv.${level} の${scope} ${kind} を達成しています！`);
      return;
    }
    if (wantsImage) {
      const imageScores = await enrichImageScores(catalog, scores);
      await replyCardImages(interaction, playerName, `Lv.${level} 未${kind}一覧`, progressCards(imageScores, isComboOrSyncKind(kind)), "maimai-level");
      return;
    }
    const descriptions = splitLines(scores.map((score, index) => renderProgressScore(score, index, kind)), 3_900).map(asCodeBlock);
    const difficultyNote = requestedDifficulty ? `（${requestedDifficulty}のみ）` : "";
    const levelSummary = `**Lv.${level}${difficultyNote} の未${kind}譜面を達成率が高い順に表示します。未プレイは -% です。AP/FC/FDXの状態を反映するには \`/maimai sync\` を再実行してください。**\n\n`;
    await interaction.editReply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の Lv.${level} 未${kind}一覧${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : levelSummary}${description}`)) });
    return;
  }
  if (subcommand === "difficulty") {
    if (!catalog) throw new Error("譜面定数データを利用できません。");
    const difficulty = interaction.options.getString("difficulty", true);
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 30;
    const scores = (await catalog.difficultyProgressRanking(difficulty, allScores))
      .sort((a, b) => (b.internalLevel ?? 0) - (a.internalLevel ?? 0)
        || (b.achievements ?? -Infinity) - (a.achievements ?? -Infinity)
        || a.title.localeCompare(b.title, "ja"))
      .slice(0, count);
    if (!scores.length) {
      await interaction.reply({ content: `${difficulty} の譜面データを取得できません。カタログを更新してからお試しください。`, ephemeral: true });
      return;
    }
    if (wantsImage) {
      await replyCardImages(interaction, playerName, `${difficulty}譜面定数順`, newConstantCards(scores), "maimai-difficulty");
      return;
    }
    const descriptions = splitLines(scores.map(renderDifficultyScore), 3_900).map(asCodeBlock);
    await interaction.reply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の ${difficulty}譜面定数順${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${difficulty} の全譜面を譜面定数が高い順、同じ定数では達成率が高い順に表示します。未プレイは -% です。**\n\n`}${description}`)) });
    return;
  }
  if (subcommand === "dxscore" || subcommand === "dxstar") {
    const level = interaction.options.getString("level", true).trim();
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 10;
    if (subcommand === "dxscore") {
      const scores = allScores
        .filter((score) => score.level === level && dxScorePercent(score) !== undefined)
        .sort((a, b) => (dxScorePercent(b) ?? 0) - (dxScorePercent(a) ?? 0)
          || (b.dxScore ?? 0) - (a.dxScore ?? 0)
          || a.title.localeCompare(b.title, "ja"))
        .slice(0, count);
      if (!scores.length) {
        await interaction.reply({ content: `Lv.${level} のDXスコアを表示できる譜面がありません。 \`/maimai sync\` を再実行してからお試しください。`, ephemeral: true });
        return;
      }
      if (wantsImage) {
        await interaction.deferReply();
        const imageScores = await enrichImageScores(catalog, scores);
        await replyCardImages(interaction, playerName, `Lv.${level} DXスコア%順`, dxScoreCards(imageScores), "maimai-dxscore");
        return;
      }
      const descriptions = splitLines(scores.map(renderDxScore), 3_900).map(asCodeBlock);
      await interaction.reply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
        .setColor(0xff5a9e)
        .setTitle(`${playerName} の Lv.${level} DXスコア%順${index ? "（続き）" : ""}`)
        .setDescription(`${index ? "" : "**このレベルのDXスコア（現在値 ÷ 譜面ごとの最大値）順**\n\n"}${description}`)) });
      return;
    }

    const targetStars = interaction.options.getInteger("star", true);
    const candidates = dxStarCandidates(allScores, level, targetStars, count);
    if (!candidates.length) {
      await interaction.reply({ content: `Lv.${level} に ☆${targetStars} 未満のDXスコア候補がありません。 \`/maimai sync\` を再実行してからお試しください。`, ephemeral: true });
      return;
    }
    if (wantsImage) {
      await interaction.deferReply();
      const imageScores = await enrichImageScores(catalog, candidates.map((candidate) => candidate.score));
      const imageCandidates = candidates.map((candidate, index) => ({ ...candidate, score: imageScores[index] }));
      await replyCardImages(interaction, playerName, `Lv.${level} ☆${targetStars}候補曲`, dxStarCandidateCards(imageCandidates), "maimai-dxstar");
      return;
    }
    const missingScoreWidth = String(Math.max(...candidates.map((candidate) => candidate.missingScore))).length;
    const descriptions = splitLines(candidates.map((candidate, index) => renderDxStarCandidate(candidate, index, missingScoreWidth)), 3_900).map(asCodeBlock);
    await interaction.reply({ embeds: descriptions.map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の Lv.${level} ☆${targetStars}候補曲${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**☆${targetStars}を目標に、現在の星が高い譜面から次の星までの必要DXスコア順**\n\n`}${description}`)) });
    return;
  }
  const newBest = bestScores(allScores, "new", 15).map((score, index) => ({ ...score, officialRank: score.officialRank ?? index + 1 }));
  const oldBest = bestScores(allScores, "old", 35).map((score, index) => ({ ...score, officialRank: score.officialRank ?? index + 1 }));
  if (subcommand === "candidate") {
    const count = interaction.options.getInteger("count") ?? defaultCount ?? 10;
    const requestedKinds: Array<"new" | "old"> = kind === "new" ? ["new"] : kind === "old" ? ["old"] : ["new", "old"];
    const frameSizes = { new: 15, old: 35 } as const;
    const candidateGroups = requestedKinds.map((candidateKind) => ({
      kind: candidateKind,
      candidates: bestCandidates(allScores, candidateKind, count)
    }));
    if (wantsImage) {
      const candidates = candidateGroups.flatMap((group) => group.candidates);
      if (!candidates.length) {
        await interaction.reply({ content: "上位ランク到達でレートが伸びる候補はありません。", ephemeral: true });
        return;
      }
      await interaction.deferReply();
      const imageScores = await enrichImageScores(catalog, candidates.map((candidate) => candidate.score));
      const imageCandidates = candidates.map((candidate, index) => ({ ...candidate, score: imageScores[index] }));
      await replyCardImages(interaction, playerName, "Best候補曲", candidateCards(imageCandidates), "maimai-candidate");
      return;
    }
    const embeds = candidateGroups.flatMap(({ kind: candidateKind, candidates }) => {
      const hasOutsideCharts = allScores.filter((score) => score.chartKind === candidateKind).length > frameSizes[candidateKind];
      return candidateEmbeds(playerName, candidateKind, candidates, hasOutsideCharts);
    });
    await interaction.reply({ embeds });
    return;
  }

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
  if (subcommand === "mbest") {
    const embeds = splitLines(scores.map(renderMobileScore), 4_000).map((description, index) => new EmbedBuilder()
      .setColor(0xff5a9e)
      .setTitle(`${playerName} の${label}${index ? "（続き）" : ""}`)
      .setDescription(`${index ? "" : `**${summary}**\n\n`}\`\`\`\n${description}\n\`\`\``));
    await interaction.reply({ embeds });
    return;
  }

  if (wantsImage) {
    await interaction.deferReply();
    const imageScores = await enrichImageScores(catalog, scores);
    await replyCardImages(interaction, playerName, label, bestCards(imageScores, mixed), "maimai-best");
    return;
  }

  await interaction.reply({ embeds: bestEmbeds(playerName, label, summary, scores, mixed) });
}
