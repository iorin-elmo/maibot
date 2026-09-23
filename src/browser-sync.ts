import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { validateProfile } from "./analysis.js";
import type { MaimaiCatalog } from "./catalog.js";
import type { BotDatabase, ImportTokenRecipient } from "./database.js";
import type { ChartKind, ComboStatus, ImportedProfile, SyncStatus } from "./types.js";
import { createSyncSummary } from "./sync-summary.js";

interface BrowserScore { title: string; difficulty: string; level?: string; achievements?: number; dxScore?: number; comboStatus?: ComboStatus; syncStatus?: SyncStatus; chartKind: ChartKind; chartType: "dx" | "standard"; officialRank?: number; }
interface BrowserPayload { playerName: string; rating: number; scores: BrowserScore[]; }

const importQueues = new Map<string, Promise<void>>();
export type SyncResultNotifier = (recipient: ImportTokenRecipient, summary: ReturnType<typeof createSyncSummary>) => Promise<void>;

async function deliverPendingSyncNotifications(db: BotDatabase, notify: SyncResultNotifier, discordUserId?: string): Promise<void> {
  for (const pending of db.getPendingSyncNotifications(discordUserId)) {
    await notify(pending.recipient, pending.summary);
    db.deletePendingSyncNotification(pending.id);
  }
}

async function retryPendingSyncNotifications(db: BotDatabase, notify: SyncResultNotifier): Promise<void> {
  const userIds = new Set(db.getPendingSyncNotifications().map((pending) => pending.recipient.discordUserId));
  await Promise.all([...userIds].map((discordUserId) => serializeImport(discordUserId, () => deliverPendingSyncNotifications(db, notify, discordUserId))));
}

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
  return validateProfile({
    playerName: payload.playerName,
    rating: payload.rating,
    updatedAt: new Date().toISOString(),
    scores: payload.scores.map(({ title, difficulty, level, achievements, dxScore, comboStatus, syncStatus, chartKind, chartType, officialRank }) => ({
      title, difficulty, level, achievements, dxScore, comboStatus, syncStatus, chartKind, chartType, officialRank, rating: 0
    }))
  });
}

function scoreKey(score: ImportedProfile["scores"][number]): string {
  return [score.title, score.difficulty, score.level ?? "", score.chartType ?? ""].join("\u0000");
}

function legacyScoreKey(score: ImportedProfile["scores"][number]): string {
  return [score.title, score.difficulty, score.level ?? ""].join("\u0000");
}

function mergeStandardScores(existing: ImportedProfile["scores"], incoming: ImportedProfile["scores"]): ImportedProfile["scores"] {
  // Only the currently received Standard rows have official ranks.  A chart
  // which dropped out of the current 50 must return to normal rating sorting.
  const merged = new Map<string, ImportedProfile["scores"][number]>(
    existing.map((score) => [scoreKey(score), { ...score, officialRank: undefined }] as const)
  );
  for (const score of incoming) {
    // Pre-chart-type database rows were keyed without dx/standard. Remove the
    // legacy entry before overlaying the now-typed Standard score.
    if (score.chartType) {
      const legacyKey = legacyScoreKey(score);
      for (const [key, existingScore] of merged) {
        if (existingScore.chartType === undefined && legacyScoreKey(existingScore) === legacyKey) merged.delete(key);
      }
    }
    const existingScore = merged.get(scoreKey(score));
    // The Rating page does not expose a DX score on every layout. Preserve a
    // previously collected value from a full sync when the incoming row lacks it.
    merged.set(scoreKey(score), {
      ...score,
      dxScore: score.dxScore ?? existingScore?.dxScore,
      dxScoreMax: score.dxScoreMax ?? existingScore?.dxScoreMax,
      comboStatus: score.comboStatus ?? existingScore?.comboStatus,
      syncStatus: score.syncStatus ?? existingScore?.syncStatus
    });
  }
  return [...merged.values()];
}

function validateStandardSnapshot(existing: ImportedProfile["scores"], incoming: ImportedProfile["scores"]): void {
  if (incoming.some((score) => score.chartKind !== "new" && score.chartKind !== "old")) {
    throw new Error("Standard同期の譜面区分を確認できなかったため、既存データは変更しませんでした。");
  }
  for (const kind of ["new", "old"] as const) {
    const frameSize = kind === "new" ? 15 : 35;
    const ranks = incoming.filter((score) => score.chartKind === kind).map((score) => score.officialRank);
    if (ranks.some((rank) => rank === undefined)) {
      throw new Error("Standard同期の順位を確認できなかったため、既存データは変更しませんでした。");
    }
    const sortedRanks = ranks as number[];
    if (sortedRanks.length > frameSize || new Set(sortedRanks).size !== sortedRanks.length
      || sortedRanks.sort((a, b) => a - b).some((rank, index) => rank !== index + 1)) {
      throw new Error("Standard同期の順位に欠落があるため、既存データは変更しませんでした。");
    }
    const existingRankCount = existing.filter((score) => score.chartKind === kind && score.officialRank !== undefined).length;
    const existingChartCount = existing.filter((score) => score.chartKind === kind).length;
    const expectedRankCount = Math.max(existingRankCount, Math.min(frameSize, existingChartCount));
    if (sortedRanks.length < expectedRankCount) {
      throw new Error("Standard同期の譜面数が前回より少ないため、既存データは変更しませんでした。");
    }
  }
}

async function serializeImport<T>(discordUserId: string, task: () => Promise<T>): Promise<T> {
  const previous = importQueues.get(discordUserId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  const tail = result.then(() => undefined, () => undefined);
  importQueues.set(discordUserId, tail);
  try {
    return await result;
  } finally {
    if (importQueues.get(discordUserId) === tail) importQueues.delete(discordUserId);
  }
}

function makeFreeSyncScriptWithHeader(baseUrl: string, token: string): string {
  return makeFreeSyncScript(baseUrl, token)
    .replace(
      'achievements=number(q(".music_score_block.w_120")?.textContent||q(".music_score_block")?.textContent),dxScore=number(q(".music_dx_score_block")?.textContent||q(".dx_score_block")?.textContent)',
      'blocks=Array.from(row.querySelectorAll?.(".music_score_block")||[]),achievements=number(blocks.find(b=>String(b.textContent||"").includes("%"))?.textContent||q(".music_score_block.w_120")?.textContent||q(".music_score_block")?.textContent),dxScore=number(q(".music_dx_score_block")?.textContent||q(".dx_score_block")?.textContent||blocks.find(b=>!String(b.textContent||"").includes("%"))?.textContent)'
    )
    .replace(',status=', ',integer=value=>{const match=String(value??"").match(/\\d[\\d,]*/);if(!match)return undefined;const parsed=Number(match[0].replace(/,/g,""));return Number.isInteger(parsed)?parsed:undefined},status=')
    .replace('dxScore=number(', 'dxScore=integer(')
    .replace('headers:{"Content-Type":"application/json"}', 'headers:{"Content-Type":"application/json","X-Import-Token":token}')
    .replace('JSON.stringify({token,playerName', 'JSON.stringify({playerName')
    .replace('fetch(url)', 'fetch(url,{redirect:"error"})')
    .replace(
      'scores.push(...rows(new DOMParser().parseFromString(await response.text(),"text/html")))',
      'const page=new DOMParser().parseFromString(await response.text(),"text/html");if(!page.querySelector(".main_wrapper"))throw Error("スコアページを確認できませんでした。ログイン状態を確認してください。");scores.push(...rows(page))'
    )
    .replace('fetch(endpoint,{method:"POST"', 'fetch(endpoint,{method:"POST",redirect:"error"');
}

/** The only free-course scraper served to browsers. */
function makeFreeSyncScript(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return String.raw`(()=>{const endpoint=${JSON.stringify(endpoint)},token=${JSON.stringify(token)},origin=location.origin;if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}const number=value=>{const text=String(value??"").replace(/[^0-9.]/g,"");if(!text)return undefined;const parsed=Number(text);return Number.isFinite(parsed)?parsed:undefined},progress=row=>{const icons=[...row.querySelectorAll("img")].map(image=>(image.getAttribute("src")||"").toLowerCase()).join(" "),combo=/allperfect.*plus|ap[_-]?plus/.test(icons)?"AP+":/allperfect|(?:^|[_-])ap(?:[-_.]|$)/.test(icons)?"AP":/fullcombo.*plus|fc[_-]?plus/.test(icons)?"FC+":/fullcombo|(?:^|[_-])fc(?:[-_.]|$)/.test(icons)?"FC":undefined,sync=/fullsync.*dx|fsdx/.test(icons)?"FDX":/fullsync|(?:^|[_-])fs(?:[-_.]|$)/.test(icons)?"FS":undefined;return{comboStatus:combo,syncStatus:sync}},status=(()=>{const e=document.createElement("div");e.style.cssText="position:fixed;z-index:99999;left:8px;right:8px;bottom:8px;padding:12px;background:#2c243b;color:#fff;font-weight:bold;border-radius:6px;text-align:center";document.body.append(e);return e})(),rows=document=>[...document.querySelectorAll(".main_wrapper.t_c .m_15,div.w_450.m_15")].map(row=>{const q=s=>row.querySelector(s),title=q(".music_name_block")?.textContent?.trim(),level=q(".music_lv_block")?.textContent?.trim(),achievements=number(q(".music_score_block.w_120")?.textContent||q(".music_score_block")?.textContent),dxScore=number(q(".music_dx_score_block")?.textContent||q(".dx_score_block")?.textContent),cls=String(row.firstElementChild?.className||""),image=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),raw=cls.match(/music_([a-z]+)_score_back/)?.[1]||["remaster","basic","advanced","expert","master"].find(v=>image.includes(v));if(!title||achievements===undefined||!raw)return null;const difficulty=raw.toLowerCase().startsWith("re")?"REMASTER":raw.toUpperCase(),kindImage=q("img.music_kind_icon")?.getAttribute("src")||"",state=progress(row);return{title,difficulty,level,achievements,dxScore,...state,chartKind:"unknown",chartType:row.id.includes("sta_")||kindImage.includes("standard")?"standard":"dx"}}).filter(Boolean),run=async()=>{const scores=[];for(let difficulty=0;difficulty<5;difficulty++){const url=new URL("/maimai-mobile/record/musicGenre/search/",origin);url.searchParams.set("genre","99");url.searchParams.set("diff",String(difficulty));status.textContent="スコア取得中… "+(difficulty+1)+" / 5";const response=await fetch(url);if(!response.ok)throw Error("スコア取得に失敗しました。");scores.push(...rows(new DOMParser().parseFromString(await response.text(),"text/html")))}const unique=new Map;for(const score of scores){const key=[score.title,score.difficulty,score.level||"",score.chartType].join("\\u0000"),old=unique.get(key);if(!old||score.achievements>old.achievements)unique.set(key,score)}if(!unique.size)throw Error("スコアを読み取れませんでした。ログイン状態を確認してください。");const playerName=document.querySelector(".name_block")?.textContent?.trim()||"maimai player",rating=number(document.querySelector(".rating_block")?.textContent)||0;status.textContent="Botへ送信中…";const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,playerName,rating,scores:[...unique.values()]})}),result=await response.json();status.remove();if(!response.ok)throw Error(result.error||"同期に失敗しました。");alert("Botへ"+result.count+"件を同期しました。")};run().catch(error=>{status.remove();alert("同期できませんでした: "+error.message)})})();`;
}

function validateImportBaseUrl(url: URL): void {
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname))) return;
  throw new Error("IMPORT_BASE_URL はローカルHTTPまたは公開HTTPS URLを指定してください。");
}
export function startBrowserSyncServer(baseUrl: string, listenHost: string, listenPort: number, db: BotDatabase, catalog: MaimaiCatalog, notify?: SyncResultNotifier): () => void {
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
    const recipient = db.consumeImportTokenWithRecipient(token);
    if (!recipient) return respond(response, 401, { error: "token expired" });
    const { discordUserId } = recipient;
    try {
      const result = await serializeImport(discordUserId, async () => {
      const payload = await requestJson(request) as BrowserPayload;
      const parsedProfile = asProfile(payload);
      if (!parsedProfile.scores.length) throw new Error("スコアを読み取れなかったため、既存データは変更しませんでした。");
      const isFreeSync = parsedProfile.scores.every((score) => score.chartKind === "unknown");
      if (isFreeSync && db.getScores(discordUserId).length > parsedProfile.scores.length) {
        throw new Error("前回より少ない譜面数しか取得できなかったため、既存データは変更しませんでした。");
      }
      const account = db.getAccount(discordUserId);
      const profile = account ? {
        ...parsedProfile,
        playerName: payload.playerName === "maimai player" ? (account.playerName ?? parsedProfile.playerName) : parsedProfile.playerName,
        rating: payload.rating === 0 ? (account.rating ?? parsedProfile.rating) : parsedProfile.rating
      } : parsedProfile;
      const enrichedScores = await catalog.enrich(profile.scores);
      const existingScores = db.getScores(discordUserId);
      if (!isFreeSync) {
        if (enrichedScores.some((score) => score.internalLevel === undefined)) {
          throw new Error("譜面定数を照合できなかったため、既存データは変更しませんでした。");
        }
        validateStandardSnapshot(existingScores, enrichedScores);
      }
      const scores = isFreeSync ? enrichedScores : mergeStandardScores(existingScores, enrichedScores);
      const summary = createSyncSummary(account, existingScores, profile.playerName, profile.rating, scores);
      db.importProfile(discordUserId, { ...profile, scores });
      if (recipient.notificationChannelId) {
        db.queueSyncNotification(recipient, summary);
        if (notify) {
          try {
            await deliverPendingSyncNotifications(db, notify, discordUserId);
          } catch (error) {
            // Keep the outbox row so a future sync or bot restart can retry it.
            console.warn(`Sync notification failed for ${discordUserId}`, error);
          }
        }
      }
      return { count: parsedProfile.scores.length, summary };
      });
      return respond(response, 200, { ok: true, count: result.count });
    } catch (error) { return respond(response, 400, { error: error instanceof Error ? error.message : "invalid request" }); }
  });
  server.listen(listenPort, listenHost); server.on("error", (error) => console.error("Browser sync server failed", error));
  if (notify) {
    void retryPendingSyncNotifications(db, notify).catch((error) => console.warn("Pending sync notification delivery failed", error));
  }
  console.log(`Browser sync endpoint: ${url.origin}/v1/browser-sync (listening on ${listenHost}:${listenPort})`); return () => server.close();
}
export function makeFreeBookmarklet(baseUrl: string, token: string): string {
  const source = new URL("/v1/free-bookmarklet", baseUrl).toString();
  return `javascript:(()=>{if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}fetch(${JSON.stringify(source)},{redirect:"error",headers:{"X-Import-Token":${JSON.stringify(token)}}}).then(r=>r.ok?r.text():Promise.reject(Error("script load failed"))).then(s=>Function(s)()).catch(e=>alert("同期スクリプトを開始できませんでした: "+e.message))})()`;
}

export function makePremiumBookmarkletSecure(baseUrl: string, token: string): string {
  return makePremiumBookmarkletInsecure(baseUrl, token)
    .replace('a=n(q("div.music_score_block")?.textContent),src=', 'blocks=Array.from(r.querySelectorAll?.(".music_score_block")||[]),a=n(blocks.find(b=>String(b.textContent||"").includes("%"))?.textContent||q("div.music_score_block")?.textContent),dx=n(q(".music_dx_score_block")?.textContent||q(".dx_score_block")?.textContent||blocks.find(b=>!String(b.textContent||"").includes("%"))?.textContent),src=')
    .replace('level,achievements:a,chartKind:kind', 'level,achievements:a,dxScore:dx,chartKind:kind')
    .replace('return Number.isFinite(x)?x:undefined};if(location.hostname', 'return Number.isFinite(x)?x:undefined},dxNumber=v=>{const m=String(v??"").match(/\\d[\\d,]*/);if(!m)return;const x=Number(m[0].replace(/,/g,""));return Number.isInteger(x)?x:undefined};if(location.hostname')
    .replace(',dx=n(', ',dx=dxNumber(')
    .replace('headers:{"Content-Type":"application/json"}', 'headers:{"Content-Type":"application/json","X-Import-Token":t}')
    .replace('JSON.stringify({token:t,playerName:name', 'JSON.stringify({playerName:name')
    .replace('fetch(e,{method:"POST"', 'fetch(e,{method:"POST",redirect:"error"');
}

export function makePremiumBookmarklet(baseUrl: string, token: string): string {
  return makePremiumBookmarkletSecure(baseUrl, token);
}

// Kept only as a compatibility reference for the token-in-body bookmarklet.
// New callers use the section-aware implementation below.
function makePremiumBookmarkletInsecureLegacy(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  return `javascript:(()=>{const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)},n=v=>{const s=String(v??"").replace(/[^0-9.]/g,"");if(!s)return;const x=Number(s);return Number.isFinite(x)?x:undefined};if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。");return}const rows=[...document.querySelectorAll("div.w_450.m_15")].map((r,i)=>{const q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),a=n(q("div.music_score_block")?.textContent),src=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),d=["remaster","basic","advanced","expert","master"].find(v=>src.includes(v));if(!title||a===undefined||!d)return null;return{title,difficulty:d.toUpperCase(),level,achievements:a,chartKind:i<15?"new":"old",officialRank:i<15?i+1:i-14,chartType:(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard")?"standard":"dx"}}).filter(Boolean);if(!rows.length){alert("でらっくすRatingページを開いてから実行してください。");return}const rating=n(document.querySelector("div.rating_block")?.textContent)||0,name=document.querySelector("div.name_block")?.textContent?.trim()||"maimai player";fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating,scores:rows})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を同期しました")}).catch(x=>alert("同期できませんでした: "+x.message))})()`;
}

function makePremiumBookmarkletInsecure(baseUrl: string, token: string): string {
  const endpoint = new URL("/v1/browser-sync", baseUrl).toString();
  const source = String.raw`(()=>{const e=${JSON.stringify(endpoint)},t=${JSON.stringify(token)},n=v=>{const s=String(v??"").replace(/[^0-9.]/g,"");if(!s)return;const x=Number(s);return Number.isFinite(x)?x:undefined};if(location.hostname!=="maimaidx.jp"){alert("maimai DX NET上で実行してください。\n");return}const grouped={new:[],old:[]},seen=new Set;let kind,invalid=false;for(const node of document.querySelectorAll("div.w_450.m_15,div.screw_block")){if(node.classList.contains("screw_block")){const text=node.textContent||"",next=/新曲|現行|\b(?:new|current)\b/i.test(text)?"new":/旧曲|旧版|\b(?:old|previous)\b/i.test(text)?"old":undefined;kind=next&&!seen.has(next)?next:undefined;if(next)seen.add(next);continue}if(!kind)continue;const r=node,q=s=>r.querySelector(s),title=q("div.music_name_block")?.textContent?.trim(),level=q("div.music_lv_block")?.textContent?.trim(),a=n(q("div.music_score_block")?.textContent),src=(q("img.h_20.f_l")?.getAttribute("src")||"").toLowerCase(),d=["remaster","basic","advanced","expert","master"].find(v=>src.includes(v));if(!title||a===undefined||!d){invalid=true;break}const limit=kind==="new"?15:35;if(grouped[kind].length>=limit){invalid=true;break}grouped[kind].push({title,difficulty:d.toUpperCase(),level,achievements:a,chartKind:kind,officialRank:grouped[kind].length+1,chartType:(q("img.music_kind_icon")?.getAttribute("src")||"").includes("standard")?"standard":"dx"})}const rows=[...grouped.new,...grouped.old];if(invalid||!seen.has("new")||!seen.has("old")||!rows.length){alert("Ratingページの新曲・旧曲セクションを確認できませんでした。ページを開き直してから実行してください。");return}const rating=n(document.querySelector("div.rating_block")?.textContent)||0,name=document.querySelector("div.name_block")?.textContent?.trim()||"maimai player";fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t,playerName:name,rating,scores:rows})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||"sync failed");alert("Botへ"+j.count+"件を保存しました")}).catch(x=>alert("同期できませんでした: "+x.message))})()`;
  return `javascript:${source}`;
}
