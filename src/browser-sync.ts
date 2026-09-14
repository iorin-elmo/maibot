import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { validateProfile } from "./analysis.js";
import type { MaimaiCatalog } from "./catalog.js";
import type { BotDatabase } from "./database.js";
import type { ChartKind, ImportedProfile } from "./types.js";

interface BrowserScore {
  title: string;
  difficulty: string;
  level?: string;
  achievements?: number;
  chartKind: ChartKind;
  chartType: "dx" | "standard";
}

interface BrowserPayload {
  token: string;
  playerName: string;
  rating: number;
  scores: BrowserScore[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maimaidx.jp",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
  "Cache-Control": "no-store"
};

function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function respondScript(response: ServerResponse, script: string): void {
  response.writeHead(200, { ...corsHeaders, "Content-Type": "text/javascript; charset=utf-8" });
  response.end(script);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 3_000_000) throw new Error("データが大きすぎます。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function asProfile(payload: BrowserPayload): ImportedProfile {
  if (typeof payload.token !== "string" || typeof payload.playerName !== "string" || !Number.isFinite(payload.rating) || !Array.isArray(payload.scores)) {
    throw new Error("同期データの形式が正しくありません。");
  }
  return validateProfile({
    playerName: payload.playerName,
    rating: payload.rating,
    updatedAt: new Date().toISOString(),
    scores: payload.scores.map((score) => ({ ...score, rating: 0 }))
  });
}

function makeFreeSyncScript(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return String.raw`(()=>{
const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)},b=location.origin;
if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください");return}
const n=v=>{const x=Number(String(v||"").replace(/[^0-9.]/g,""));return Number.isFinite(x)?x:undefined};
const status=(()=>{const x=document.createElement("div");x.style.cssText="position:fixed;z-index:99999;left:8px;right:8px;bottom:8px;padding:12px;background:#2c243b;color:#fff;font-weight:bold;border-radius:6px;text-align:center";document.body.append(x);return x})();
const scoreRows=(d,k)=>[...d.querySelectorAll("div.w_450.m_15")].map(r=>{const q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),a=n(q(".music_score_block.w_120")?.textContent||q("div.music_score_block")?.textContent),src=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),cls=String(r.firstElementChild?.className||""),raw=cls.match(/music_([a-z]+)_score_back/)?.[1]||["remaster","basic","advanced","expert","master"].find(x=>src.includes(x));if(!title||a===undefined||!raw)return null;const difficulty=raw.toLowerCase().startsWith("re")?"REMASTER":raw.toUpperCase(),type=(r.id.includes("sta_")||(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard"))?"standard":"dx";return{title,difficulty,level,achievements:a,chartKind:k,chartType:type}}).filter(Boolean);
const run=async()=>{status.textContent="バージョン一覧を取得中…";const index=await fetch("/maimai-mobile/record/musicVersion/").then(r=>{if(!r.ok)throw Error("バージョン一覧を取得できませんでした");return r.text()});const doc=new DOMParser().parseFromString(index,"text/html"),seen=new Set,versions=[];for(const a of doc.querySelectorAll('a[href*="record/musicVersion/search"]')){const u=new URL(a.getAttribute("href"),b),v=u.searchParams.get("version");if(v&&!seen.has(v)){seen.add(v);versions.push(v)}}if(versions.length<2)throw Error("バージョン一覧を読み取れませんでした");const jobs=versions.flatMap((v,i)=>[0,1,2,3,4].map(diff=>({v,diff,k:i>=versions.length-2?"new":"old"}))),scores=[];for(let i=0;i<jobs.length;i++){const j=jobs[i],u=new URL("/maimai-mobile/record/musicVersion/search/",b);u.searchParams.set("version",j.v);u.searchParams.set("diff",j.diff);status.textContent="スコア取得中… "+(i+1)+" / "+jobs.length;const html=await fetch(u).then(r=>{if(!r.ok)throw Error("スコア取得に失敗しました");return r.text()});scores.push(...scoreRows(new DOMParser().parseFromString(html,"text/html"),j.k))}const best=new Map;for(const s of scores){const key=[s.title,s.difficulty,s.level||"",s.chartType].join("\u0000"),old=best.get(key);if(!old||s.achievements>old.achievements)best.set(key,s)}const name=document.querySelector("div.name_block")?.textContent?.trim()||"maimai player",rating=n(document.querySelector("div.rating_block")?.textContent)||0;status.textContent="Botへ送信中…";const r=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating,scores:[...best.values()]})}),j=await r.json();status.remove();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を同期しました（新曲: 最新2バージョン）")};run().catch(x=>{status.remove();alert("同期できませんでした: "+x.message)})})();`;
}

/**
 * Free accounts can open the genre score pages even when the version index is
 * unavailable.  Fetch every difficulty from that page and let the catalogue
 * perform the latest-two-version split on the server.
 */
function makeFreeSyncScriptV2(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return String.raw`(()=>{
const endpoint=${JSON.stringify(endpoint)},token=${JSON.stringify(token)},origin=location.origin;
if(location.hostname!=="maimaidx.jp"){alert("Open this from maimai DX NET.");return}
const number=v=>{const n=Number(String(v||"").replace(/[^0-9.]/g,""));return Number.isFinite(n)?n:undefined};
const status=(()=>{const e=document.createElement("div");e.style.cssText="position:fixed;z-index:99999;left:8px;right:8px;bottom:8px;padding:12px;background:#2c243b;color:#fff;font-weight:bold;border-radius:6px;text-align:center";document.body.append(e);return e})();
const scoreRows=document=>[...document.querySelectorAll(".main_wrapper.t_c .m_15,div.w_450.m_15")].map(row=>{const q=selector=>row.querySelector(selector),title=q(".music_name_block")?.textContent?.trim(),level=q(".music_lv_block")?.textContent?.trim(),achievements=number(q(".music_score_block.w_120")?.textContent||q(".music_score_block")?.textContent),className=String(row.firstElementChild?.className||""),image=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),raw=className.match(/music_([a-z]+)_score_back/)?.[1]||["remaster","basic","advanced","expert","master"].find(value=>image.includes(value));if(!title||achievements===undefined||!raw)return null;const difficulty=raw.toLowerCase().startsWith("re")?"REMASTER":raw.toUpperCase(),kindImage=q("img.music_kind_icon")?.getAttribute("src")||"";return{title,difficulty,level,achievements,chartKind:"unknown",chartType:row.id.includes("sta_")||kindImage.includes("standard")?"standard":"dx"}}).filter(Boolean);
const run=async()=>{const scores=[];for(let difficulty=0;difficulty<5;difficulty++){const url=new URL("/maimai-mobile/record/musicGenre/search/",origin);url.searchParams.set("genre","99");url.searchParams.set("diff",String(difficulty));status.textContent="Collecting scores: "+(difficulty+1)+" / 5";const response=await fetch(url);if(!response.ok)throw Error("Could not load score page.");scores.push(...scoreRows(new DOMParser().parseFromString(await response.text(),"text/html")))}const unique=new Map;for(const score of scores){const key=[score.title,score.difficulty,score.level||"",score.chartType].join("\\u0000"),previous=unique.get(key);if(!previous||score.achievements>previous.achievements)unique.set(key,score)}const playerName=document.querySelector(".name_block")?.textContent?.trim()||"maimai player",rating=number(document.querySelector(".rating_block")?.textContent)||0;status.textContent="Sending to bot...";const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,playerName,rating,scores:[...unique.values()]})}),result=await response.json();status.remove();if(!response.ok)throw Error(result.error||"Sync failed.");alert("Saved "+result.count+" scores. The latest two versions are used as new songs.")};run().catch(error=>{status.remove();alert("Sync failed: "+error.message)})})();`;
}

export function startBrowserSyncServer(baseUrl: string, listenHost: string, listenPort: number, db: BotDatabase, catalog: MaimaiCatalog): () => void {
  const url = new URL(baseUrl);
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", url);
    if (request.method === "OPTIONS") return respond(response, 204, {});
    if (request.method === "GET" && requestUrl.pathname === "/v1/free-bookmarklet") {
      const token = requestUrl.searchParams.get("token");
      if (!token) return respond(response, 400, { error: "token required" });
      return respondScript(response, makeFreeSyncScriptV2(url.origin, token));
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/v1/browser-sync") return respond(response, 404, { error: "not found" });
    try {
      const payload = await requestJson(request) as BrowserPayload;
      const parsedProfile = asProfile(payload);
      const enrichedScores = await catalog.enrich(parsedProfile.scores);
      // Keep every collected chart. Besides rendering Best 15 + 35 now, this
      // allows future commands to calculate charts that are close to entering
      // a best frame without requiring the player to sync again.
      const profile = { ...parsedProfile, scores: enrichedScores };
      const discordUserId = db.consumeImportToken(payload.token);
      if (!discordUserId) return respond(response, 401, { error: "token expired" });
      db.importProfile(discordUserId, profile);
      return respond(response, 200, { ok: true, count: profile.scores.length });
    } catch (error) {
      return respond(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
    }
  });
  server.listen(listenPort, listenHost);
  server.on("error", (error) => console.error("Browser sync server failed", error));
  console.log(`Browser sync endpoint: ${url.origin}/v1/browser-sync (listening on ${listenHost}:${listenPort})`);
  return () => server.close();
}

export function makeFreeBookmarklet(baseUrl: string, token: string): string {
  const source = new URL("/v1/free-bookmarklet", baseUrl);
  source.searchParams.set("token", token);
  return `javascript:fetch(${JSON.stringify(source.toString())}).then(r=>r.ok?r.text():Promise.reject(Error("script load failed"))).then(s=>Function(s)()).catch(e=>alert("同期スクリプトを開始できませんでした: "+e.message))`;
}

export function makePremiumBookmarklet(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return `javascript:(()=>{const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)};if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください");return}const n=v=>{const x=Number(String(v||"").replace(/[^0-9.]/g,""));return Number.isFinite(x)?x:undefined},rows=[...document.querySelectorAll("div.w_450.m_15")].map((r,i)=>{const q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),a=n(q("div.music_score_block")?.textContent),src=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),d=["remaster","basic","advanced","expert","master"].find(x=>src.includes(x));if(!title||a===undefined||!d)return null;return{title,difficulty:d.toUpperCase(),level,achievements:a,chartKind:i<15?"new":"old",officialRank:i<15?i+1:i-14,chartType:(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard")?"standard":"dx"}}).filter(Boolean);if(!rows.length){alert("でらっくすRatingページを開いてから実行してください");return}const rating=n(document.querySelector("div.rating_block")?.textContent)||0,name=document.querySelector("div.name_block")?.textContent?.trim()||"maimai player";fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating,scores:rows})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を同期しました")}).catch(x=>alert("同期できませんでした: "+x.message))})()`;
}
