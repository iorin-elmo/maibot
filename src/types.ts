export type ChartKind = "new" | "old" | "unknown";
export type ComboStatus = "AP+" | "AP" | "FC+" | "FC";
export type SyncStatus = "FDX" | "FS";

export interface ScoreRecord {
  title: string;
  difficulty: string;
  level?: string;
  achievements?: number;
  dxScore?: number;
  /** The chart's theoretical maximum DX score. */
  dxScoreMax?: number;
  /** Highest recorded clear-combo state from DX NET. */
  comboStatus?: ComboStatus;
  /** Highest recorded sync state from DX NET. */
  syncStatus?: SyncStatus;
  /** Stable jacket identifier supplied by the DX data catalogue. */
  jacketImageName?: string;
  rating: number;
  chartKind?: ChartKind;
  chartType?: "dx" | "standard";
  internalLevel?: number;
  /** 公式のDX Rating画面での枠内順位。Best枠外の候補譜面も含み得ます。 */
  officialRank?: number;
  playedAt?: string;
}

export interface ImportedProfile {
  playerName: string;
  rating: number;
  updatedAt?: string;
  scores: ScoreRecord[];
}

export interface LinkedAccount {
  discordUserId: string;
  segaId: string;
  playerName: string | null;
  rating: number | null;
  updatedAt: string | null;
}
