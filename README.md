# maimai Discord Bot

maimai DX NETの無料コースのスコアを同期し、DiscordでBest 50を表示するBotです。「レコード ＞ 楽曲スコア」の全難易度ページを使います。SEGA ID・パスワード・CookieはBotへ送信しません。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `/maimai sync [image]` | 無料コース向け。全難易度の楽曲スコアからBest 50を計算して同期し、実行したチャンネルに差分を通知。`image` でジャケット付き画像も出力 |
| `/maimai sync-reset` | 恒久同期ブックマークを無効化して、新しいブックマークを発行 |
| `/maimai newconstant [count] [image]` | 新曲（最新2バージョン）のDX/STD譜面を譜面定数順に表示。未プレイは `-%`、既定30件・最大50件 |
| `/maimai plate <version> <kind> [count] [image]` | 指定プレートに不足する譜面を定数順に表示。`version` は熊・彩など、`kind` は神・極・将・舞舞、既定30件・最大50件 |
| `/maimai level <level> <kind> [count] [image]` | 指定レベルの未AP+/AP/SSS+/SSS/SS+/SS/S+/S/FC+/FC/FDXを達成率順に表示、既定30件・最大50件 |
| `/maimai difficulty <difficulty> [count] [image]` | 指定難易度（BASIC/ADVANCED/EXPERT/MASTER/Re:MASTER）の全譜面を、譜面定数順・同じ定数では達成率順に表示、既定30件・最大50件 |
| `/maimai help` | 使い方を表示 |
| `/maimai best [kind]` | 定数・単曲レート・達成率を含むベスト枠を表示 |
| `/maimai mbest [kind]` | スマホ向けの短いベスト枠を表示 |
| `/maimai image [kind]` | ベスト枠を画像で表示 |
| `/maimai candidate [kind] [count]` | 次ランク到達でBestレートが伸びる候補。枠外候補は `sync` 後に利用可能、既定10件・最大50件 |
| `/maimai dxscore <level> [count]` | 指定レベルのDXスコア%順。スコアは譜面ごとの最大DXスコアに対する割合で表示、既定10件・最大50件 |
| `/maimai dxstar <level> <star> [count]` | 指定レベルで、現在の星から次の指定星までに必要なDXスコアが少ない順。`star` は1〜6、既定10件・最大50件 |

`kind` は `新曲` / `旧曲` / `全曲` から選べます。省略時は全曲です。

`plate` と `level` は任意の `difficulty` 指定で、BASIC/ADVANCED/EXPERT/MASTER/Re:MASTERに絞り込めます。

## セットアップ

```powershell
npm install
Copy-Item .env.example .env
# .env に DISCORD_TOKEN を設定
npm run dev
```

## 同期方法

1. Discordで `/maimai sync` を実行する。
2. 返信にあるコード全体をコピーし、ブラウザのブックマークURL欄へ貼り付ける。
3. ブックマークレットを実行するブラウザでmaimai DX NETへログインする。
4. 任意のmaimai DX NETページで、作成したブックマークを実行する。

`/maimai sync` のブックマークレットは「レコード ＞ 楽曲スコア ＞ version」の全バージョン・全難易度を読み取り、下2バージョンを新曲、それ以前を旧曲としてBest 15・Best 35を計算します。ブックマークレットは繰り返し利用でき、同期データは実行したDiscordアカウントに紐付きます。ブックマークにはアカウント固有の長期トークンが含まれるため、他人に共有しないでください。紛失・共有してしまった場合は `/maimai sync-reset` を実行して無効化・再発行してください。同期後は、コマンドを実行したチャンネルに初回案内または前回からの差分を通知します。

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
