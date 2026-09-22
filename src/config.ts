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

function defaultSyncListenPort(importBaseUrl: string): number {
  const url = new URL(importBaseUrl);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol === "http:" && loopbackHosts.has(url.hostname)) {
    const listenPort = url.port ? Number(url.port) : 80;
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65_535) throw new Error("IMPORT_BASE_URL のポート番号が不正です。");
    return listenPort;
  }
  return 31337;
}

const importBaseUrl = process.env.IMPORT_BASE_URL?.trim() || "http://127.0.0.1:31337";
const importUrl = new URL(importBaseUrl);
const defaultSyncListenHost = importUrl.hostname === "::1" || importUrl.hostname === "[::1]" ? "::1" : "127.0.0.1";

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/maibot.sqlite",
  importBaseUrl,
  syncListenHost: process.env.SYNC_LISTEN_HOST?.trim() || defaultSyncListenHost,
  syncListenPort: port("SYNC_LISTEN_PORT", defaultSyncListenPort(importBaseUrl)),
  dxdataUrl: process.env.DXDATA_URL?.trim() || "https://miruku.dxrating.net/api/v1/dxdata"
};
