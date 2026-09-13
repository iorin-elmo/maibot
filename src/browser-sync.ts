import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BotDatabase } from "./database.js";
import { validateProfile } from "./analysis.js";
import type { ChartKind, ImportedProfile } from "./types.js";
import type { MaimaiCatalog } from "./catalog.js";

interface BrowserScore {
  title: string;
  difficulty: string;
  level?: string;
  achievements?: number;
  chartKind: ChartKind;
  chartType: "dx" | "standard";
  officialRank: number;
}

interface BrowserPayload {
  token: string;
  playerName: string;
  rating: number;
  scores: BrowserScore[];
}

function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "https://maimaidx.jp",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("データが大きすぎます。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function asProfile(payload: BrowserPayload): ImportedProfile {
  if (typeof payload.token !== "string" || typeof payload.playerName !== "string" || !Number.isFinite(payload.rating) || !Array.isArray(payload.scores)) {
    throw new Error("同期データの形式が不正です。");
  }
  return validateProfile({
    playerName: payload.playerName,
    rating: payload.rating,
    updatedAt: new Date().toISOString(),
    scores: payload.scores.map((score) => ({ ...score, rating: 0 }))
  });
}

export function startBrowserSyncServer(baseUrl: string, db: BotDatabase, catalog: MaimaiCatalog): () => void {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("IMPORT_BASE_URL はローカル用の http://127.0.0.1:ポート を指定してください。");
  }
  const port = Number(url.port || "80");
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") return respond(response, 204, {});
    if (request.method !== "POST" || request.url !== "/v1/browser-sync") return respond(response, 404, { error: "not found" });
    try {
      const payload = await requestJson(request) as BrowserPayload;
      const parsedProfile = asProfile(payload);
      const profile = { ...parsedProfile, scores: await catalog.enrich(parsedProfile.scores) };
      const discordUserId = db.consumeImportToken(payload.token);
      if (!discordUserId) return respond(response, 401, { error: "token expired" });
      db.importProfile(discordUserId, profile);
      return respond(response, 200, { ok: true, count: profile.scores.length });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
    }
  });
  server.listen(port, "127.0.0.1");
  server.on("error", (error) => console.error("Browser sync server failed", error));
  console.log(`Browser sync endpoint: ${url.origin}/v1/browser-sync`);
  return () => server.close();
}

export function makeBookmarklet(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  const script = `(()=>{const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)};if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください");return}const x=s=>document.querySelector(s),a=s=>[...document.querySelectorAll(s)],num=s=>{const n=Number(String(s).replace(/[^0-9.]/g,""));return Number.isFinite(n)?n:undefined},rows=a("div.w_450.m_15").map((r,i)=>{const q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),score=num(q("div.music_score_block")?.textContent),img=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),difficulty=["remaster","basic","advanced","expert","master"].find(d=>img.includes(d))||"unknown",chartType=(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard")?"standard":"dx";return title?{title,difficulty:difficulty.toUpperCase(),level,achievements:score,chartKind:i<15?"new":"old",officialRank:i<15?i+1:i-14,chartType}:null}).filter(Boolean);if(!rows.length){alert("でらっくすRatingページを開いてから実行してください");return}const rt=num(x("div.rating_block")?.textContent)||0,name=x("div.name_block")?.textContent?.trim()||"maimai player";fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating:rt,scores:rows})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を同期しました")}).catch(err=>alert("同期できませんでした: "+err.message))})();`;
  return `javascript:${script}`;
}
