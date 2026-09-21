# maimai Discord Bot

maimai DX NETのスコアを同期し、DiscordでBest 50を表示するBotです。Standardコースでは「でらっくすRating」、無料コースでは「レコード ＞ 楽曲スコア」の全難易度ページを使います。SEGA ID・パスワード・CookieはBotへ送信しません。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/maimai sync` | Standardコースの「でらっくすRating」ページから公式Best 50を同期 |
| `/maimai fsync` | 無料コース向け。全難易度の楽曲スコアからBest 50を計算して同期 |
| `/maimai newconstant [count] [image]` | 新曲（最新2バージョン）のDX/STD譜面を譜面定数順に表示。未プレイ・Standardコース同期のBest枠外は `-%`、既定30件・最大50件 |
| `/maimai plate <kind> [count] [image]` | 指定プレートに不足する譜面を定数順に表示。`kind` は熊神・彩将・丸舞舞など、既定30件・最大50件 |
| `/maimai level <level> <kind> [count] [image]` | 指定レベルの未AP+/AP/SSS+/SSS/SS+/SS/S+/S/FC+/FC/FDXを達成率順に表示、既定30件・最大50件 |
| `/maimai help` | 使い方を表示 |
| `/maimai best [kind]` | 定数・単曲レート・達成率を含むベスト枠を表示 |
| `/maimai mbest [kind]` | スマホ向けの短いベスト枠を表示 |
| `/maimai image [kind]` | ベスト枠を画像で表示 |
| `/maimai candidate [kind] [count]` | 次ランク到達でBestレートが伸びる候補。枠外候補は `fsync` 後に利用可能、既定10件・最大50件 |
| `/maimai dxscore <level> [count]` | 指定レベルのDXスコア%順。スコアは譜面ごとの最大DXスコアに対する割合で表示、既定10件・最大50件 |
| `/maimai dxstar <level> <star> [count]` | 指定レベルで、現在の星から次の指定星までに必要なDXスコアが少ない順。`star` は1〜6、既定10件・最大50件 |

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

1. StandardコースならDiscordで `/maimai sync`、無料コースなら `/maimai fsync` を実行する。
2. 返信にあるコード全体をコピーし、ブラウザのブックマークURL欄へ貼り付ける。
3. ブックマークレットを実行するブラウザでmaimai DX NETへログインする。
4. `/maimai fsync` は任意のmaimai DX NETページで、`/maimai sync` は「でらっくすRating」ページで作成したブックマークを実行する。

`/maimai fsync` のブックマークレットは「レコード ＞ 楽曲スコア ＞ version」の全バージョン・全難易度を読み取り、下2バージョンを新曲、それ以前を旧曲としてBest 15・Best 35を計算します。`/maimai sync` はでらっくすRatingページで実行してください。どちらも1回・10分間だけ有効で、同期データは実行したDiscordアカウントに紐付きます。

## 他の人も同期できるように公開する

Botを常時稼働するサーバーへ置き、HTTPSの公開URLをBotへ転送してください。利用者はそのURLへ同期データを送るため、各自でBotを起動する必要はありません。

```dotenv
IMPORT_BASE_URL=https://sync.example.com
SYNC_LISTEN_HOST=0.0.0.0
SYNC_LISTEN_PORT=3000
```

`https://sync.example.com` をサーバーの `3000` 番ポートへ転送するリバースプロキシまたはトンネルを用意してください。公開URLはHTTPSを必須とし、SQLiteデータベースと`.env`はサーバー内だけに保存します。

## テスト

```powershell
npm test
```
