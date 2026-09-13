import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} が未設定です。.env.example を参考に .env を作成してください。`);
  return value;
}

function port(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) throw new Error(`${name} は1から65535のポート番号にしてください。`);
  return parsed;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim(),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/maibot.sqlite",
  importBaseUrl: process.env.IMPORT_BASE_URL?.trim() || "http://127.0.0.1:31337",
  syncListenHost: process.env.SYNC_LISTEN_HOST?.trim() || "127.0.0.1",
  syncListenPort: port("SYNC_LISTEN_PORT", 31337),
  dxdataUrl: process.env.DXDATA_URL?.trim() || "https://miruku.dxrating.net/api/v1/dxdata"
};
