import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { validateProfile } from "./analysis.js";
import type { MaimaiCatalog } from "./catalog.js";
import type { BotDatabase } from "./database.js";
import type { ChartKind, ImportedProfile } from "./types.js";

interface BrowserScore { title: string; difficulty: string; level?: string; achievements?: number; chartKind: ChartKind; chartType: "dx" | "standard"; }
interface BrowserPayload { playerName: string; rating: number; scores: BrowserScore[]; }

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://maimaidx.jp",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Import-Token",
  "Access-Control-Allow-Private-Network": "true", "Cache-Control": "no-store"
};
function respond(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body));
}
function respondScript(response: ServerResponse, script: string): void {
  response.writeHead(200, { ...corsHeaders, "Content-Type": "text/javascript; charset=utf-8" }); response.end(script);
}
async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 3_000_000) throw new Error("データが大きすぎます。"); chunks.push(buffer); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function asProfile(payload: BrowserPayload): ImportedProfile {
  if (typeof payload.playerName !== "string" || !Number.isFinite(payload.rating) || !Array.isArray(payload.scores)) throw new Error("同期データの形式が正しくありません。");
  return validateProfile({ playerName: payload.playerName, rating: payload.rating, updatedAt: new Date().toISOString(), scores: payload.scores.map((score) => ({ ...score, rating: 0 })) });
}

function makeFreeSyncScriptWithHeader(baseUrl: string, token: string): string {
  return makeFreeSyncScript(baseUrl, token)
    .replace('headers:{"Content-Type":"application/json"}', 'headers:{"Content-Type":"application/json","X-Import-Token":token}')
    .replace('JSON.stringify({token,playerName', 'JSON.stringify({playerName');
}

/** The only free-course scraper served to browsers. */
function makeFreeSyncScript(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return String.raw`(()=>{const endpoint=${JSON.stringify(endpoint)},token=${JSON.stringify(token)},origin=location.origin;if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}const number=value=>{const text=String(value??"").replace(/[^0-9.]/g,"");if(!text)return undefined;const parsed=Number(text);return Number.isFinite(parsed)?parsed:undefined},status=(()=>{const e=document.createElement("div");e.style.cssText="position:fixed;z-index:99999;left:8px;right:8px;bottom:8px;padding:12px;background:#2c243b;color:#fff;font-weight:bold;border-radius:6px;text-align:center";document.body.append(e);return e})(),rows=document=>[...document.querySelectorAll(".main_wrapper.t_c .m_15,div.w_450.m_15")].map(row=>{const q=s=>row.querySelector(s),title=q(".music_name_block")?.textContent?.trim(),level=q(".music_lv_block")?.textContent?.trim(),achievements=number(q(".music_score_block.w_120")?.textContent||q(".music_score_block")?.textContent),cls=String(row.firstElementChild?.className||""),image=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),raw=cls.match(/music_([a-z]+)_score_back/)?.[1]||["remaster","basic","advanced","expert","master"].find(v=>image.includes(v));if(!title||achievements===undefined||!raw)return null;const difficulty=raw.toLowerCase().startsWith("re")?"REMASTER":raw.toUpperCase(),kindImage=q("img.music_kind_icon")?.getAttribute("src")||"";return{title,difficulty,level,achievements,chartKind:"unknown",chartType:row.id.includes("sta_")||kindImage.includes("standard")?"standard":"dx"}}).filter(Boolean),run=async()=>{const scores=[];for(let difficulty=0;difficulty<5;difficulty++){const url=new URL("/maimai-mobile/record/musicGenre/search/",origin);url.searchParams.set("genre","99");url.searchParams.set("diff",String(difficulty));status.textContent="スコア取得中… "+(difficulty+1)+" / 5";const response=await fetch(url);if(!response.ok)throw Error("スコア取得に失敗しました。");scores.push(...rows(new DOMParser().parseFromString(await response.text(),"text/html")))}const unique=new Map;for(const score of scores){const key=[score.title,score.difficulty,score.level||"",score.chartType].join("\\u0000"),old=unique.get(key);if(!old||score.achievements>old.achievements)unique.set(key,score)}if(!unique.size)throw Error("スコアを読み取れませんでした。ログイン状態を確認してください。");const playerName=document.querySelector(".name_block")?.textContent?.trim()||"maimai player",rating=number(document.querySelector(".rating_block")?.textContent)||0;status.textContent="Botへ送信中…";const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,playerName,rating,scores:[...unique.values()]})}),result=await response.json();status.remove();if(!response.ok)throw Error(result.error||"同期に失敗しました。");alert("Botへ"+result.count+"件を同期しました。")};run().catch(error=>{status.remove();alert("同期できませんでした: "+error.message)})})();`;
}

function validateImportBaseUrl(url: URL): void {
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname))) return;
  throw new Error("IMPORT_BASE_URL はローカルHTTPまたは公開HTTPS URLを指定してください。");
}
export function startBrowserSyncServer(baseUrl: string, listenHost: string, listenPort: number, db: BotDatabase, catalog: MaimaiCatalog): () => void {
  const url = new URL(baseUrl); validateImportBaseUrl(url);
  const server = createServer(async (request, response) => {
    let requestUrl: URL;
    try { requestUrl = new URL(request.url ?? "/", url); }
    catch { return respond(response, 400, { error: "invalid request URL" }); }
    if (request.method === "OPTIONS") return respond(response, 204, {});
    if (request.method === "GET" && requestUrl.pathname === "/v1/free-bookmarklet") {
      const token = request.headers["x-import-token"];
      if (typeof token !== "string" || !token) return respond(response, 400, { error: "token required" });
      return respondScript(response, makeFreeSyncScriptWithHeader(url.origin, token));
    }
    if (request.method !== "POST" || requestUrl.pathname !== "/v1/browser-sync") return respond(response, 404, { error: "not found" });
    const token = request.headers["x-import-token"];
    if (typeof token !== "string" || !token) return respond(response, 401, { error: "token required" });
    const discordUserId = db.consumeImportToken(token);
    if (!discordUserId) return respond(response, 401, { error: "token expired" });
    try {
      const payload = await requestJson(request) as BrowserPayload;
      const parsedProfile = asProfile(payload);
      if (!parsedProfile.scores.length) throw new Error("スコアを読み取れなかったため、既存データは変更しませんでした。");
      const account = db.getAccount(discordUserId);
      const profile = payload.playerName === "maimai player" && payload.rating === 0 && account
        ? { ...parsedProfile, playerName: account.playerName ?? parsedProfile.playerName, rating: account.rating ?? parsedProfile.rating }
        : parsedProfile;
      db.importProfile(discordUserId, { ...profile, scores: await catalog.enrich(profile.scores) });
      return respond(response, 200, { ok: true, count: parsedProfile.scores.length });
    } catch (error) { return respond(response, 400, { error: error instanceof Error ? error.message : "invalid request" }); }
  });
  server.listen(listenPort, listenHost); server.on("error", (error) => console.error("Browser sync server failed", error));
  console.log(`Browser sync endpoint: ${url.origin}/v1/browser-sync (listening on ${listenHost}:${listenPort})`); return () => server.close();
}
export function makeFreeBookmarklet(baseUrl: string, token: string): string {
  const source = new URL("/v1/free-bookmarklet", baseUrl).toString();
  return `javascript:(()=>{if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}fetch(${JSON.stringify(source)},{headers:{"X-Import-Token":${JSON.stringify(token)}}}).then(r=>r.ok?r.text():Promise.reject(Error("script load failed"))).then(s=>Function(s)()).catch(e=>alert("同期スクリプトを開始できませんでした: "+e.message))})()`;
}

export function makePremiumBookmarkletSecure(baseUrl: string, token: string): string {
  return makePremiumBookmarklet(baseUrl, token)
    .replace('headers:{"Content-Type":"application/json"}', 'headers:{"Content-Type":"application/json","X-Import-Token":t}')
    .replace('JSON.stringify({token:t,playerName:name', 'JSON.stringify({playerName:name');
}
export function makePremiumBookmarklet(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return `javascript:(()=>{const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)},n=v=>{const s=String(v??"").replace(/[^0-9.]/g,"");if(!s)return;const x=Number(s);return Number.isFinite(x)?x:undefined};if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}const rows=[...document.querySelectorAll("div.w_450.m_15")].map((r,i)=>{const q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),a=n(q("div.music_score_block")?.textContent),src=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),d=["remaster","basic","advanced","expert","master"].find(v=>src.includes(v));if(!title||a===undefined||!d)return null;return{title,difficulty:d.toUpperCase(),level,achievements:a,chartKind:i<15?"new":"old",officialRank:i<15?i+1:i-14,chartType:(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard")?"standard":"dx"}}).filter(Boolean);if(!rows.length){alert("でらっくすRatingページを開いてから実行してください。");return}const rating=n(document.querySelector("div.rating_block")?.textContent)||0,name=document.querySelector("div.name_block")?.textContent?.trim()||"maimai player";fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating,scores:rows})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を同期しました")}).catch(x=>alert("同期できませんでした: "+x.message))})()`;
}
