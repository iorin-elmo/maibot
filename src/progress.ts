import type { ScoreRecord } from "./types.js";

export const levelProgressKinds = ["AP+", "AP", "SSS+", "SSS", "SS+", "SS", "S+", "S", "FC+", "FC", "FDX"] as const;
export type LevelProgressKind = typeof levelProgressKinds[number];
export type PlateGoal = "AP" | "FC" | "SSS" | "FDX";
export const plateKinds = ["神", "極", "将", "舞舞"] as const;
export type PlateKind = typeof plateKinds[number];

export interface PlateVersion {
  name: string;
  label: string;
  versions: string[];
  standardOnly?: boolean;
  includeRemaster?: boolean;
  excludedTitles: string[];
}

export interface PlateDefinition {
  name: string;
  label: string;
  versions: string[];
  goal: PlateGoal;
  standardOnly?: boolean;
  includeRemaster?: boolean;
  excludedTitles: string[];
}

const versionGroups = [
  ["真", "maimai PLUSまで", ["maimai", "maimai PLUS"]],
  ["超", "maimai GreeN", ["GreeN"]],
  ["檄", "maimai GreeN PLUS", ["GreeN PLUS"]],
  ["橙", "maimai ORANGE", ["ORANGE"]],
  ["暁", "maimai ORANGE PLUS", ["ORANGE PLUS"]],
  ["桃", "maimai PiNK", ["PiNK"]],
  ["櫻", "maimai PiNK PLUS", ["PiNK PLUS"]],
  ["紫", "maimai MURASAKi", ["MURASAKi"]],
  ["菫", "maimai MURASAKi PLUS", ["MURASAKi PLUS"]],
  ["白", "maimai MiLK", ["MiLK"]],
  ["雪", "maimai MiLK PLUS", ["MiLK PLUS"]],
  ["輝", "maimai FiNALE", ["FiNALE"]],
  ["熊", "maimai でらっくす", ["maimaiでらっくす"]],
  ["華", "maimai でらっくす PLUS", ["maimaiでらっくす PLUS"]],
  ["爽", "maimai でらっくす Splash", ["Splash"]],
  ["煌", "maimai でらっくす Splash PLUS", ["Splash PLUS"]],
  ["宙", "maimai でらっくす UNiVERSE", ["UNiVERSE"]],
  ["星", "maimai でらっくす UNiVERSE PLUS", ["UNiVERSE PLUS"]],
  ["祭", "maimai でらっくす FESTiVAL", ["FESTiVAL"]],
  ["祝", "maimai でらっくす FESTiVAL PLUS", ["FESTiVAL PLUS"]],
  ["双", "maimai でらっくす BUDDiES", ["BUDDiES"]],
  ["宴", "maimai でらっくす BUDDiES PLUS", ["BUDDiES PLUS"]],
  ["鏡", "maimai でらっくす PRiSM", ["PRiSM"]],
  ["彩", "maimai でらっくす PRiSM PLUS", ["PRiSM PLUS"]],
  ["丸", "maimai でらっくす CiRCLE", ["CiRCLE"]],
  ["廻", "maimai でらっくす CiRCLE PLUS", ["CiRCLE PLUS"]]
] as const;

const suffixes: Array<[string, PlateGoal]> = [["極", "FC"], ["将", "SSS"], ["神", "AP"], ["舞舞", "FDX"]];

/** Plate names and requirements from Gamerch's 制覇系 table. */
const excludedFromAllPlates = ["前前前世"];

export const plateVersions: PlateVersion[] = [
  ...versionGroups.map(([name, label, versions]) => ({
    name, label, versions: [...versions],
    excludedTitles: name === "真" ? [...excludedFromAllPlates, "ジングルベル"] : [...excludedFromAllPlates]
  })),
  {
    name: "舞", label: "FiNALEまでのスタンダード譜面", versions: versionGroups.slice(0, 12).flatMap(([, , versions]) => versions as unknown as string[]),
    standardOnly: true, includeRemaster: true, excludedTitles: [...excludedFromAllPlates]
  }
];

export const plates: PlateDefinition[] = plateVersions.flatMap((version) => suffixes
  .filter(([suffix]) => version.name !== "真" || suffix !== "将")
  .map(([suffix, goal]) => ({
  name: `${version.name}${suffix}`, label: version.label, versions: version.versions, goal,
  ...(version.standardOnly ? { standardOnly: true } : {}),
  ...(version.includeRemaster ? { includeRemaster: true } : {}),
  excludedTitles: version.excludedTitles
})));

export function plateByName(name: string): PlateDefinition | undefined {
  return plates.find((plate) => plate.name === name.trim());
}

export function plateByVersionAndKind(version: string, kind: PlateKind): PlateDefinition | undefined {
  return plateByName(`${version.trim()}${kind}`);
}

export function progressKindSatisfied(score: ScoreRecord, kind: LevelProgressKind | PlateGoal): boolean {
  switch (kind) {
    case "AP+": return score.comboStatus === "AP+";
    case "AP": return score.comboStatus === "AP+" || score.comboStatus === "AP";
    case "FC+": return score.comboStatus === "AP+" || score.comboStatus === "AP" || score.comboStatus === "FC+";
    case "FC": return score.comboStatus !== undefined;
    case "FDX": return score.syncStatus === "FDX";
    case "SSS+": return (score.achievements ?? -Infinity) >= 100.5;
    case "SSS": return (score.achievements ?? -Infinity) >= 100;
    case "SS+": return (score.achievements ?? -Infinity) >= 99.5;
    case "SS": return (score.achievements ?? -Infinity) >= 99;
    case "S+": return (score.achievements ?? -Infinity) >= 98;
    case "S": return (score.achievements ?? -Infinity) >= 97;
  }
}

export function isComboOrSyncKind(kind: LevelProgressKind | PlateGoal): boolean {
  return kind === "AP+" || kind === "AP" || kind === "FC+" || kind === "FC" || kind === "FDX";
}

export function plateGoalDescription(goal: PlateGoal): string {
  return { AP: "ALL PERFECT", FC: "FULL COMBO", SSS: "RANK SSS", FDX: "FULL SYNC DX" }[goal];
}
