# maimai Discord Bot

maimai のレートと自己ベスト枠を Discord の `/maimai` コマンドから見られるBotです。TypeScript、discord.js、SQLite（Node.js同梱）だけで動作します。

## 実装済みのコマンド

| コマンド | 内容 |
| --- | --- |
| `/maimai link sega_id` | DiscordアカウントとSEGA IDの表示用紐付けを保存（非公開応答） |
| `/maimai import file` | プロフィールと譜面データをJSONから取り込む（非公開応答） |
| `/maimai sync` | ログイン済みブラウザから、でらっくすRatingの表示内容を同期（非公開応答） |
| `/maimai profile [user]` | レート、登録譜面数、Best 50の合計を表示 |
| `/maimai best kind [limit]` | 新曲・旧曲・全譜面からレート順にベストを表示 |
| `/maimai unlink` | 紐付けと保存済みスコアを完全に削除 |
| `/maimai template` | インポートJSONの雛形をダウンロード |

`/maimai profile` と `/maimai best` は公開メッセージです。`link`、`import`、`unlink` は呼び出した本人だけが見られます。

## 起動

Node.js 24以降を使います。

```powershell
npm install
Copy-Item .env.example .env
# .env に DISCORD_TOKEN と、開発時は DISCORD_GUILD_ID を記入
npm run dev
```

Discord Developer Portal でBotを作成し、`bot` と `applications.commands` スコープでサーバーへ招待してください。起動時にコマンドを登録します。`DISCORD_GUILD_ID` を指定すると、そのサーバーにだけ即時反映します。空欄ならグローバル登録です。

## JSON形式

`/maimai template` で雛形を得られます。各スコアの `rating` は取得元が算出した譜面単位の値です。Botはそれを再計算せず、新曲上位15件 + 旧曲上位35件を合計します。バージョンごとに変動するレート計算式をBot内に固定しないためです。

```json
{
  "playerName": "Player",
  "rating": 15000,
  "updatedAt": "2026-09-13T00:00:00.000Z",
  "scores": [
    {
      "title": "楽曲名",
      "difficulty": "MASTER",
      "level": "14+",
      "achievements": 100.5,
      "dxScore": 3000,
      "rating": 300,
      "chartKind": "new"
    }
  ]
}
```

`chartKind` は `new`、`old`、`unknown` のいずれかです。`unknown` はBest 50集計に含めません。

## ブラウザ同期（JSONを作らない方法）

`/maimai sync` を実行すると、10分間だけ有効なブックマークレットが添付されます。内容をブラウザのブックマークURLとして保存し、**同じPC**でmaimai DX NETへログイン後、`でらっくすRating`ページでブックマークを実行してください。プロフィールの公式Ratingと、新曲15件・旧曲35件の公式表示順をBotに同期します。

この方式では、ログインは公式サイト上で本人が行い、SEGA ID・パスワード・CookieをBotへ送信しません。Botに送るのはプレイヤー名、公式Rating、曲名、難易度、レベル、達成率、公式ベスト枠の順位だけです。`/maimai best` の `#` はその公式枠内順位です。

既定の受信URLは `http://127.0.0.1:31337` のため、Botを起動しているPCのブラウザで使えます。スマホから同期するための外部公開は、この初期実装では扱いません。

## SEGA IDの扱いと次の実装

このBotはSEGA IDの**パスワード、Cookie、セッション情報を一切受け取りません**。現状の `link` はDiscordユーザーとID文字列の対応を保存するだけで、SEGAによる所有確認ではありません。公式に許可されたOAuth/APIが用意された場合は、それを使う同期アダプタを追加できます。

外部サービスの非公開APIをスクレイピングしたり、BotにSEGA IDのパスワードを入力させる実装は、アカウント安全性と利用規約の観点から採用しないでください。

## 確認

```powershell
npm test
```
