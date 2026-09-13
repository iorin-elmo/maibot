import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} が未設定です。.env.example を参考に .env を作成してください。`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  guildId: process.env.DISCORD_GUILD_ID?.trim(),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/maibot.sqlite",
  importBaseUrl: process.env.IMPORT_BASE_URL?.trim() || "http://127.0.0.1:31337",
  dxdataUrl: process.env.DXDATA_URL?.trim() || "https://miruku.dxrating.net/api/v1/dxdata"
};
