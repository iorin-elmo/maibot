# maimai Discord Bot

maimai DX NETの「でらっくすRating」ページからベスト枠を同期し、Discordで表示するBotです。SEGA ID・パスワード・CookieはBotへ送信しません。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/maimai sync` | ブラウザ用ブックマークレットを発行して、ベスト枠を同期 |
| `/maimai best [kind]` | 定数・単曲レート・達成率を含むベスト枠を表示 |
| `/maimai best-mobile [kind]` | スマホ向けの短いベスト枠を表示 |
| `/maimai best-image [kind]` | ベスト枠を画像で表示 |

`kind` は `新曲` / `旧曲` / `全曲` から選べます。省略時は全曲です。

## セットアップ

```powershell
npm install
Copy-Item .env.example .env
# .env に DISCORD_TOKEN を設定
npm run dev
```

開発サーバーへ即時にコマンドを反映する場合は、`.env` に `DISCORD_GUILD_ID` を設定します。

## 同期方法

1. Discordで `/maimai sync` を実行する。
2. 返信にあるコード全体をコピーし、ブラウザのブックマークURL欄へ貼り付ける。
3. 同じPCでmaimai DX NETへログインし、「でらっくすRating」ページを開く。
4. 作成したブックマークを実行する。

ブックマークレットは1回・10分間だけ有効です。同期データは実行したDiscordアカウントに紐付きます。

## テスト

```powershell
npm test
```
