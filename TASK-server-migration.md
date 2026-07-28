# 実施記録：バックエンドを Render → 研究室サーバー（ai2.haselab.net）へ移行

> ## ✅ 移行完了（2026-07-28）
>
> 本番は既に `ai2.haselab.net` のバックエンドで稼働している。以下は**実施済みの記録**であり、
> これから作業する指示書ではない。**再構築・トラブル対応・切り戻しの手順書**として読むこと。
>
> | 項目 | 結果 |
> |---|---|
> | バックエンド | `ai2` 上の Docker（`~/third-place`、`127.0.0.1:18080`）で常時稼働 |
> | 公開URL | `https://ai2.haselab.net/third-place/api/`（nginx 443に location 追加） |
> | フロントエンド | GitHub Pages のまま。接続先は `client/.env.production` で ai2 を指す |
> | 動作確認 | PC・スマホの2端末で入室し、相互に表示・通話できることを確認済み |
> | Render | **まだ停止していない**（切り戻し用に残置。§6-2 の4を参照） |
>
> **積み残し**：Renderの停止（数日〜1週間の様子見後）、および `README.md` / `SPEC.md` §7.4 の
> インフラ記述の更新（まだ「Renderで稼働」と書かれたままなら要修正）。
>
> **実作業で踏んだ落とし穴は §10 にまとめてある。再構築時は必ず目を通すこと。**

この文書はもともと実装担当（Sonnet）への指示書として書かれた。背景は `README.md` と
`SPEC.md`（特に §7.4 インフラ、§7.5 セキュリティ）を参照。

> **改訂（2026-07-28）：移行先は `ai1` ではなく `ai2.haselab.net`**
> 当初この文書は移行先を `ai1.haselab.net` として書かれていたが、実際の移行先は
> **third-place開発用に `ai1` の構成をコピーして立てた `ai2.haselab.net`**（131.112.248.55。`ai1`とは別ホスト・別IP）である。
> **`ai2` では湯本さんが管理者権限を持つ**（`docker`グループ所属・root相当の操作が可能）ため、
> 当初想定していた「権限が無いので管理者（hase）に依頼する」という分岐は**不要**だった。
> なお `ai2` にマウントされている `/usr/local/share/doc/` は `ai1` からのコピーであり、
> 記述されたホスト名・権限モデル（`sandboxusers`のみ／`docker`グループは誰にも渡さない等）は
> **`ai1` のポリシーであって `ai2` の現状ではない**。ドキュメントは構成の雛形として読み、
> 実際の値は `ai2` 上で都度確認すること。

**作業分担**：この作業は**コードを書くだけでは完結しない**。サーバー上での操作（Dockerコンテナ起動、既存nginx設定への追記など）は
湯本さん（人間）が `ai2` のホストシェル上で行った。
Sandboxコンテナ内で動くSonnetからは `docker` コマンドも `/etc/nginx` も見えないため、**代行できない**。
文書内では【Sonnetの作業】と【湯本さんの作業】を明示的に分けている。

---

## 0. 目的とスコープ

### 目的
バックエンド（トークン発行API）を Render の無料プランから研究室サーバー `ai2.haselab.net`（実体は `ai2.binaural.me`
と同一ホスト）へ移し、将来のログ保存基盤（SPEC F10）を自分たちの管理下に置ける状態にする。
あわせて、Render無料プランのスリープ問題（初回アクセスで数十秒待たされる）を解消する。

### 今回やること
- バックエンド（`server/`）を研究室サーバー上の Docker で常時稼働させる
- **既存のnginx（`ai2.haselab.net`用、443番で稼働中）に相乗りする形でHTTPS公開する**（新規にHTTPS化する作業は不要）
- フロントエンドの接続先を切り替える（ビルド時に差し替えられるよう環境変数化する）

### 今回やらないこと（スコープ外）
- **DB導入・ログ記録・チャットや掲示板の永続化**（ユーザーの明示的な指示により後回し。§7に「後で足すための置き場所」だけ記載）
- **LiveKit のセルフホスト**（引き続き LiveKit Cloud を使う。UDPポート開放やTURNの問題を今回は持ち込まない）
- フロントエンドの配信元の移動（GitHub Pages のまま。SPEC §7.4 も「GitHub Pages併用も可」としている）
- 認証、深夜停止、複数テントなどの機能追加
- **`ai-sandbox-server`リポジトリ（サーバーの全体設定を管理するprivateリポジトリ）自体の変更**。今回はそちらに
  1箇所nginx設定を追記させてもらうだけで、sandbox/aigw等の既存の仕組みには一切触れない

---

## 1. 現状の調査結果（`ai2` について 2026-07-28 に実測）

`ai1` には専用の管理リポジトリ `haselab-net/ai-sandbox-server`（private）があり、構成・権限モデルが
ドキュメント化されている。`ai2` はその構成のコピーなので、**構成の雛形を理解する目的で**このリポジトリの
`README.md` と `doc/CHANGELOG.md`（およびホスト上の `/usr/local/share/doc/`）に目を通すのは有用。
ただし**そこに書かれた値をそのまま `ai2` の現状と信じないこと**（下表の「実測」列が優先）。

| 項目 | `ai2` での実測値（2026-07-28） |
|---|---|
| ホスト名 | `ai2.binaural.me` / `ai2.haselab.net` はエイリアス（同一ホスト、131.112.248.55）。`ai1`（131.112.248.54）とは**別マシン** |
| OS | Debian GNU/Linux 12 (bookworm)（`ai1`からのコピー） |
| Docker | 利用可能。**`kyumoto` は `docker` グループに所属**（`/etc/group`: `docker:x:996:hase,kyumoto`）。`ai1`の「dockerグループは誰にも渡さない」方針は`ai2`には適用されていない |
| **443番ポート** | **既に開いていて動作している。** `https://ai2.haselab.net/` は 200 OK。Let's Encrypt証明書（`CN=ai2.haselab.net`、2026-07-27発行・2026-10-25まで有効）が設定済み。**新規のHTTPS化作業（certbot実行など）は不要** |
| ⚠️ 注意 | `ai2.binaural.me` という名前で443にアクセスするとTLS検証に失敗する（証明書のSANが `ai2.haselab.net` のみ）。**アプリの公開URLは必ず`ai2.haselab.net`を使うこと** |
| `/third-place/api/` パス | **未使用（現在404）**。競合なし |
| 18080番ポート | **空き**（Dockerブリッジ`172.17.0.1:18080`は接続不可＝未使用） |
| nginx設定ファイル | **要確認**。`ai1`では`/etc/nginx/sites-available/gdrive-oauth-callback`にファイル名に反して443サーバーブロック全体が書かれている。`ai2`もコピーなら同じはずだが、**Step 0でホスト上から実際に確認すること**（sandboxコンテナ内からは`/etc/nginx`が見えない） |
| **`/sandbox/port<N>` は使えない** | aigwのセッションCookie認証(`auth_request`)が必須の仕組みで、**ログインしていない一般ユーザー（third-placeを使う学生等）からはアクセスできない**。third-place用には**認証なしの新しいlocationブロックを追加する必要がある** |
| Docker利用例 | 各ユーザー用の開発用サンドボックスコンテナ（`devbox-<user>`）が`172.17.0.1:<port>`で待ち受けている。これはnginxの`/sandbox/port<N>`から到達するための配置で、**third-placeのような単独のDocker Composeサービスは、必ずしもこの配置に合わせる必要はない**（`127.0.0.1`バインドで問題ない） |
| ドキュメントの更新方針 | サーバー設定を変更したら、ホスト上の`/usr/local/share/doc/CHANGELOG.md`に追記するのが`ai1`由来の運用ルール。**`ai2`でも同じ慣習に従い、third-placeのnginx location追加をCHANGELOGに記録しておくこと**（`ai2`の記録が`ai1`のドキュメントと混ざらないよう、`ai2`固有の変更である旨を明記する） |

### ここから導かれる結論

- **HTTPS自体は既に使える。新たにポートを開けたり証明書を取ったりする必要はない。**
  やるべきことは「`ai2.haselab.net`の既存443番サーバーブロックに、third-place用の新しいlocationブロックを1つ追加する」だけ
- **`ai2` では湯本さんが管理者権限を持つため、nginx編集・reload・Docker起動はすべて自分で実施できる。**
  当初あった「権限が無ければ管理者（hase）に依頼する」という分岐は不要
- 残る唯一の未確認事項は**`ai2`上のnginx設定ファイルの正確なパスと既存locationの内容**（Step 0で確認）

---

## 2. 移行後の構成（目標）

```
[ユーザーのスマホ/PC]
   │
   ├─ フロントエンド … https://yumoto-kyohei.github.io/third-place/   （GitHub Pages のまま。変更なし）
   │        │
   │        └─①トークン要求 https://ai2.haselab.net/third-place/api/token
   │                 │
   │                 ▼
   │        [ai2.haselab.net = ai2.binaural.me]
   │           nginx（443/HTTPS。Let's Encrypt証明書は設定済み・変更不要）
   │             └─ location /third-place/api/ → 127.0.0.1:18080 へリバースプロキシ（★今回追加する設定）
   │                   └─ Docker: third-place-server（Node/Express。トークン発行のみ）
   │                        └─（将来）ここに PostgreSQL を足してログ保存 …§7
   │
   └─②音声/データ … wss://haselab-third-place-....livekit.cloud （LiveKit Cloud のまま。変更なし）
```

**ポイント**
- LiveKit Cloud は変更しないので、`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` の値はそのまま流用できる
- **既存の443番サーバーブロックに、他の`location`（`/gdrive`、`/agents/`）と並ぶ形で`/third-place/api/`を追加するだけ**。
  DNS変更・証明書取得・新しいサーバーブロックの作成は不要
- `/sandbox/port<N>`は使わない（認証必須のため）。third-place用のlocationは**認証なしの素のリバースプロキシ**にする
- 公開するのは既存の443だけ。Nodeアプリは外部に直接公開せず、`127.0.0.1:18080`だけで待ち受けてnginx経由にする（SPEC §7.5）

---

## 3. Step 0：`ai2` 上の nginx 設定の場所を確認する ✅完了

> **実測結果（2026-07-28）**：443のサーバーブロックは `ai1` と同名の
> `/etc/nginx/sites-available/gdrive-oauth-callback` にあった（`server_name ai2.haselab.net`、
> 証明書も `/etc/letsencrypt/live/ai2.haselab.net/`）。既存locationは `/gdrive`（完全一致）、
> `/agents/`、`/sandbox/port<N>`（正規表現・aigw認証付き）と内部用の3つ。
> `/third-place/api/` はどれとも衝突しない。`docker ps` は **sudoなしで通った**（dockerグループ所属を実機確認）。
> なお `/etc/nginx/sites-available/default` にも `listen 443` があるが、`server_name` が
> `ai2.haselab.net` の上記ブロックが優先されるため影響なし。

権限の有無はもう論点ではない（`ai2` では湯本さんが管理者）。残っているのは
**「443のサーバーブロックがどのファイルに書かれているか」を実機で確認する**ことだけ。

### 【湯本さんの作業】`ai2` のホストシェル（sandboxコンテナの外）で確認する

```bash
# (a) 443のサーバーブロックがどのファイルにあるかを探す
grep -rl "listen 443" /etc/nginx/sites-enabled/ /etc/nginx/sites-available/

# (b) その中身と既存のlocationを確認（ai1では gdrive-oauth-callback というファイル名）
sudo cat /etc/nginx/sites-available/gdrive-oauth-callback

# (c) 18080番が空いているか（コンテナ内からの確認では空きだったが、ホスト側でも念のため）
ss -tln | grep 18080 || echo "18080は空き"

# (d) docker が使えるか
docker ps
```

### 【Sonnetの作業】
Step 1（Docker化）と Step 3（フロント側のURL環境変数化）は**サーバー権限に依存しないので先に進めてよい**。
ただし **Step 2（サーバー上での起動・nginx追記）は、(a)(b) の結果を湯本さんから受け取ってから**、
実際のファイル名・既存locationに合わせた具体的な手順として提示すること。

---

## 4. Step 1：バックエンドをDocker化する【Sonnetの作業】 ✅完了

> コミット `9668108`「Dockerize the token server and add /api/healthz」で実施。

サーバー上で常時稼働させるため、`server/` をDockerで動かせるようにする。

### 4-1. `server/Dockerfile` を新規作成
- ベースイメージは `node:20-alpine` 程度
- `server/package.json` / `package-lock.json` をコピーして `npm ci --omit=dev`
- ソースをコピーして `CMD ["node", "index.js"]`
- 本番環境なので `NODE_ENV=production`

### 4-2. リポジトリ直下に `docker-compose.yml` を新規作成
- サービス名 `third-place-server`
- `build: ./server`
- **ポートは `127.0.0.1:18080:3001` とし、外部に直接公開しない**（nginx経由のみ。SPEC §7.5）。
  このサーバーの他プロジェクト（`devbox-*`）は`172.17.0.1`にバインドしているが、それは
  nginxの`/sandbox/port<N>`という別の仕組み向けの配置なので、third-placeは素直に`127.0.0.1`でよい
- `restart: unless-stopped`（サーバー再起動時も自動復帰）
- 環境変数はサーバー上に置く `.env` から読む（`env_file`）。**`.env`はGitにコミットしない**（既存の`.gitignore`のまま）
- 将来DBを足す場所をコメントで明示しておく（§7）

### 4-3. `server/index.js` の調整
- **`dotenv` の読み込みパスに注意**：現在 `../.env`（リポジトリ直下）を見ているが、Dockerでは `server/` だけをコピーする想定なので壊れる。
  `docker compose` の `env_file` で環境変数を渡すなら `dotenv` は無くても動く。
  **ローカル開発（`npm run dev`）でも壊れないよう、`.env`が無ければ黙って無視する形にする**
- **ヘルスチェック用のエンドポイント `GET /api/healthz` を追加**（`{ ok: true }` を返すだけ）。
  死活監視や移行後の疎通確認に使う。
  **`/healthz` ではなく `/api/healthz` に置くこと**：nginxは `/third-place/api/` → `127.0.0.1:18080/api/` しか
  プロキシしないので、`/api` の外に置くと外部から疎通確認できない（当初の指示は`/healthz`だったが、
  §5-3の確認コマンド `.../third-place/api/healthz` と矛盾していたため`/api`配下に統一した）
- `ALLOWED_ORIGINS` は既に環境変数対応済みなのでコード変更不要

### 4-4. ローカルでの動作確認
```bash
docker compose up --build -d
curl -s http://127.0.0.1:18080/api/healthz
curl -s "http://127.0.0.1:18080/api/token?identity=test"   # 切り詰めない（§10-1）
docker compose down
```
- **完了条件**：ローカルのDockerでトークンが発行できること
  （**`url` と `token` の両方**が入った `{"url":"wss://...","token":"eyJ..."}` が返る）
- 補足：sandboxコンテナ内には`docker`が無いためSonnetはこの確認を実行できない。
  代わりに **Nodeで直接起動しての疎通確認は実施済み**（`/api/healthz` → `{"ok":true}`、
  `/api/token?identity=test` → JWT、identity未指定 → 400）。Docker経由での確認は湯本さんがホスト側で行う

---

## 5. Step 2：サーバーで公開する ✅完了

### 5-1.【湯本さんの作業】コードをサーバーに配置して起動

> **配置先は `~/third-place`（＝`/home/kyumoto/third-place`）にした。**
> **`~/sandhome/` 配下に置いてはいけない**：そこは sandbox コンテナにマウントされており、
> コンテナ内のAIエージェントが**同じuidで**動くため、`chmod 600` にしても `.env` の
> `LIVEKIT_API_SECRET` が読めてしまう。`~/third-place` はコンテナからは見えない
> （コンテナ内の `/home/kyumoto/` には `sandhome` しか存在しないことを実機確認済み）。

```bash
# サーバー上で（ホストのシェル。sandboxコンテナの中ではない）
cd ~
git clone https://github.com/yumoto-kyohei/third-place.git
cd third-place

# .env を作成（LiveKit Cloudの値はRenderのダッシュボードと同じもの）
cp .env.example .env
nano .env   # LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET を記入
            # ALLOWED_ORIGINS=https://yumoto-kyohei.github.io も追記

chmod 600 .env
docker compose up --build -d
curl -s http://127.0.0.1:18080/api/healthz    # {"ok":true} が返ればOK

# ★ healthz だけでなく token も必ず確認すること（理由は §10-1）
curl -s "http://127.0.0.1:18080/api/token?identity=test"
#   期待する形: {"url":"wss://...","token":"eyJ..."}
#   "url" が無く {"token":"..."} だけなら LIVEKIT_URL が渡っていない
```

> **秘密情報の扱い**：`.env` は絶対にGitにコミットしない。サーバー上のファイル権限も `chmod 600 .env` にしておく。
>
> **`.env` の中身を確認するときは、値をチャットやissueに貼らないこと。**
> プレースホルダーが残っていないかは、値を出さずに次で確認できる：
> ```bash
> grep -c "your_api\|your-project" .env        # 0 なら置換済み
> awk -F= '/LIVEKIT_API_SECRET/ {print length($2)}' .env   # 0 より大きければ値が入っている
> ```

### 5-2.【湯本さんの作業】既存nginxにlocationを追加

`/etc/nginx/sites-available/gdrive-oauth-callback` の
`server { listen 443 ssl; server_name ai2.haselab.net; ... }`
ブロックの中、`location = /gdrive { ... }` の直後に以下を追加した（実際に追加したのは英語コメント版。
このファイルの既存コメントが英語で統一されているため、そのスタイルに合わせた）。
**認証は付けない**（`/sandbox/port<N>`と違い、third-placeは一般の学生が使うので誰でもアクセスできる必要がある）。

編集前に必ずバックアップを取ること：
```bash
sudo cp /etc/nginx/sites-available/gdrive-oauth-callback \
        /etc/nginx/sites-available/gdrive-oauth-callback.bak-$(date +%Y%m%d)
```

```nginx
# third-place: token-issuing backend for the spatial-audio web app
# (https://github.com/yumoto-kyohei/third-place). Unlike /sandbox/port<N>
# above this is deliberately UNAUTHENTICATED -- it is used by ordinary
# students loading the GitHub Pages frontend, who have no aigw session.
# It only mints short-lived LiveKit join tokens; the LiveKit API secret
# stays server-side and never reaches the browser.
# Backend runs as a docker compose service on 127.0.0.1:18080
# (see third-place/docker-compose.yml).
location /third-place/api/ {
    proxy_pass http://127.0.0.1:18080/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

追加後：
```bash
sudo nginx -t              # 構文チェック
sudo systemctl reload nginx
```

**`nginx -t` が `successful` を返すまで `reload` しないこと。** このファイルは gdrive・aigw・
sandboxプロキシも定義しており、壊すと他の人の作業も止まる。

- `ai2` では湯本さん自身が編集・reloadできるので、管理者への依頼は不要
- サーバー運用の慣習に従い、変更後は `ai2` 上の `/usr/local/share/doc/CHANGELOG.md` に一言
  （例：「third-placeのAPIプロキシとして`/third-place/api/`locationを追加」）を追記しておくこと。
  `/usr/local/share/doc/` は`ai1`からのコピーなので、**`ai2`固有の変更である旨を明記**し、
  `ai1`の記録と混同されないようにする
  → **⚠️ 今回この追記はまだ行っていない。積み残し。**

### 5-3. 疎通確認
```bash
# 外部から（自分のPCで）。ホスト名は必ず ai2.haselab.net を使うこと（ai2.binaural.meでは証明書のSAN不一致でTLSが通らない）
curl -s https://ai2.haselab.net/third-place/api/healthz
curl -s "https://ai2.haselab.net/third-place/api/token?identity=test"
```
- **完了条件**：外部からHTTPSでトークンが取得できること
- **`token` の確認では出力を `head -c 200` などで切り詰めないこと。**
  `url` フィールドはJSONの先頭にあるとは限らず、切り詰めると欠落に気付けない（§10-1 で実際に見落とした）

---

## 6. Step 3：フロントエンドの接続先を切り替える【Sonnetの作業】 ✅完了

> 環境変数化がコミット `4a4d987`、ai2へのカットオーバーがコミット `ea0b441`。

現在 `client/src/App.jsx` にトークンサーバーのURLがハードコードされている：
```js
const TOKEN_SERVER_URL = import.meta.env.PROD
  ? 'https://third-place.onrender.com'
  : 'http://localhost:3001';
```

これを**環境変数（Viteの `import.meta.env.VITE_*`）で差し替えられるようにする**（SPEC §7.4「接続先URL・鍵はすべて環境変数化」）。

### 6-1. 実装方針（実装済み）
- `VITE_TOKEN_SERVER_URL` を参照し、未設定なら開発時のフォールバック `http://localhost:3001/api`
- URLの持ち方は「ベースURL（`/api`まで含む）＋`/token`」に統一し、パスの二重付与（`/api/api/token`）を回避
- `client/.env.production` に本番の値を書く（**これは公開URLであり秘密情報ではないのでコミットしてよい**）
- `.env.example` にも、フロント側の設定は `client/.env.production` にある旨を追記済み

**段階的に切り替えた**：環境変数化のコミット時点では `.env.production` を Render のURLのままにし
（挙動を変えないリファクタとして安全にデプロイできる状態を作り）、Step 2 の疎通確認が取れてから
次の1行だけを変更してカットオーバーした。
```
VITE_TOKEN_SERVER_URL=https://ai2.haselab.net/third-place/api
```
**切り戻すときはこの1行を `https://third-place.onrender.com/api` に戻して push するだけ**
（Renderを停止するまでの間は、これが最速のロールバック手段）。

### 6-2. 切り替えの安全な進め方（重要）
**いきなりRenderを止めないこと。** 以下の順で行う：
1. ✅ 研究室サーバー（`ai2`）側で疎通確認が取れる（Step 2完了）
2. ✅ `client/.env.production` を `ai2` のURLに差し替えてデプロイ
3. ✅ 本番URL（`https://yumoto-kyohei.github.io/third-place/`）で実際に入室・会話できることを確認
4. ⬜ **数日〜1週間ほど問題がないことを確認してから**、Renderのサービスを停止/削除する
   （Render側は残しておいても無料枠なので急いで消す必要はない）
   → **2026-07-28時点で未実施。Renderは稼働したまま残っている。**

> Renderも`main`ブランチを監視して自動デプロイするため、**停止するまでは Render 側にも同じコードが
> デプロイされ続ける**（今回 `/api/healthz` を追加した際、Render側にも反映されたことを確認している）。
> これは切り戻し手段が常に最新コードで動くということなので、当面は都合がよい。

### 6-3. 完了条件
- ✅ 本番URLで入室でき、PC・スマホの2端末で相互に表示・通話できる
- ✅ ブラウザのコンソールにMixed ContentやCORSのエラーが出ていない
- ⬜ 初回アクセスでもRenderのような数十秒の待ちが発生しない
  → 移行後の常時稼働により原理的には解消しているが、**「スリープ明けの待ちが無い」ことを
  意識的に計測はしていない**（確認時、Renderも自動デプロイ直後で起きており0.2秒応答だったため比較できず）

---

## 7. 将来：ログ保存のための土台（今回は実装しない）

ユーザーの指示により**今回はDBもログ記録も作らない**。ただし、後で足すときに構成を作り直さずに済むよう、以下だけ意識しておく。

- `docker-compose.yml` に PostgreSQL サービスを後から追加できるよう、コメントで場所を示しておく
- ログを記録するようになったら SPEC F10 に従うこと。特に：
  - **音声の生データは保存しない**
  - ユーザーIDは**仮名化ID**で記録し、実名との対応表は分離管理
  - **取得は本人同意（オンボーディング時）が前提** → 同意フローの実装が先に必要
  - 何をどこまで残すかは**研究倫理審査と連動**するため、実装前に長谷川先生と要相談
- 現状のチャット・位置・描き込みは全てその場限り（LiveKitデータチャネル）で、サーバーを経由していない。
  ログを取るには「クライアント → バックエンドへイベント送信」の経路を新設する必要がある（今回は作らない）

---

## 8. 各ステップ完了時のチェックリスト
- [x] 既存機能（入室・音声・空間オーディオ・チャット・画面共有・描き込み・2.5D移動）が壊れていない
      → PC・スマホの2端末で入室し相互表示・通話を確認。**画面共有・描き込み・2.5D移動の個別確認までは未実施**
- [x] `.env` や APIキーがGitにコミットされていない（`git status` で確認）
- [x] `npx oxlint src/` に新規エラーなし（既存warningのみ）、`cd client && npm run build` 成功
- [ ] **`README.md` の構成図・インフラ表・環境変数の節を更新、`SPEC.md` §7.4 の現状/将来テーブルも更新
      → 未実施の積み残し。**READMEは今も「バックエンドはRenderで稼働」と書かれているため実態と食い違う
- [x] `git commit` → push → GitHub Actions成功 → 本番URLで確認
      （`9668108` / `4a4d987` / `ae90476` / `ea0b441`）

---

## 9. 参考：この移行の位置づけ
SPEC §7.4 で「将来（研究室サーバー移行後）」として計画されていたもののうち、**バックエンドの移行のみ**を先行実施する。
SFU（LiveKit）のセルフホストとDB導入は据え置き、段階的にリスクを分けて進める。
目的は「Renderのスリープ解消」と「将来のログ基盤（F10）を自分たちの管理下に置く準備」。
当初は「443番ポートが閉じている」という調査結果に基づき証明書取得やFW開放が必要と考えていたが、
**正しいホスト名（`ai2.haselab.net`）を使えば443は既に利用可能**（証明書も設定済み）と判明し、
作業内容を「既存nginxへの1箇所のlocation追加」に縮小できた。
さらに移行先が `ai2`（third-place開発用にコピーした、湯本さんが管理者権限を持つサーバー）と確定したことで、
当初懸念していた「管理者への作業依頼」も不要になっている。

---

## 10. 実作業で踏んだ落とし穴（再構築・トラブル対応時に必読）

### 10-1. `.env` の変数名の打ち間違いで「他の参加者が見えない」

**症状**：入室自体はできるが、他の参加者が誰も見えない。ブラウザのコンソールに
`no livekit url provided` という警告が出る。

**原因**：`.env` の1行目が `LIVEKIT_URL=...` ではなく **`QLIVEKIT_URL=...`** になっていた
（nano編集時に先頭へ `Q` が1文字混入）。`LIVEKIT_URL` という名前の変数は存在しないので
`process.env.LIVEKIT_URL` が `undefined` になり、`/api/token` のレスポンスが
`{"token":"..."}` だけになって `url` が欠落していた。フロントは接続先URLを受け取れず、
LiveKitに繋がらないので「自分しかいない部屋」に見える。

**なぜすぐ気付けなかったか**：確認コマンドが `curl ... | head -c 200` と出力を切り詰めており、
しかも `url` が JSON の先頭に来ていなかったため、欠落が見えていなかった。
実際には Step 2 の疎通確認の時点で既に壊れていた。

**対策**：
- トークンAPIの確認では**出力を切り詰めない**。`url` と `token` の両方があることを目視する
- `docker compose exec third-place-server env | grep LIVEKIT` で、
  **コンテナのプロセスが実際に見ている変数名**を確認する（`.env` を読むだけでは打ち間違いに気付きにくい）
- 症状が「入室はできるが他の人が見えない」なら、まずここを疑う

### 10-2. `.env` を直しても反映されない

`docker compose restart` では**環境変数は再読み込みされない**（コンテナ作成時に注入されるため）。
`.env` を編集したら必ず：

```bash
docker compose up -d --force-recreate
docker compose exec third-place-server env | grep LIVEKIT_URL   # 反映確認
```

### 10-3. ヘルスチェックのパスは `/api` の内側に置く

nginx は `/third-place/api/` → `127.0.0.1:18080/api/` しかプロキシしない。
当初の指示書は `GET /healthz` を追加するよう書いていたが、それでは外部から到達できず、
指示書自身の確認コマンド（`.../third-place/api/healthz`）とも矛盾していた。
実装では **`/api/healthz`** に統一している。

### 10-4. 秘密情報を置く場所

`~/sandhome/` 配下は sandbox コンテナにマウントされ、コンテナ内のAIエージェントが
**同じuidで**動く。`chmod 600` はこの相手には効かない。
`.env` を含むデプロイ一式は `~/third-place`（sandhome の外）に置くこと。

### 10-5. 作業ログに秘密情報を残さない

`.env` の中身を確認・共有する場面では、`LIVEKIT_API_SECRET` の値そのものを
チャットやissueに貼らないこと。存在確認だけなら §5-1 の `grep -c` / `awk` で足りる。

---

## 11. 運用メモ（移行後の日常操作）

すべて `ai2` のホストシェル、`~/third-place` で実行する。

```bash
# 状態確認
docker compose ps
docker compose logs --tail=50 third-place-server

# コードを更新して再起動（GitHubのmainを取り込む）
git pull
docker compose up -d --build

# .env を変更したとき（restartではダメ。§10-2）
docker compose up -d --force-recreate

# 停止 / 再開
docker compose down
docker compose up -d
```

サーバー再起動後は `restart: unless-stopped` により自動で復帰する。

### 生存確認

```bash
curl -s https://ai2.haselab.net/third-place/api/healthz            # {"ok":true}
curl -s "https://ai2.haselab.net/third-place/api/token?identity=t" # url と token の両方があること
```

### 切り戻し（ai2 → Render）

`client/.env.production` の1行を `https://third-place.onrender.com/api` に戻して push するだけ
（Renderを停止するまで有効。§6-2）。
