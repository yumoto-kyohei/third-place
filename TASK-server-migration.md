# 実装指示書：バックエンドを Render → 研究室サーバー（ai2.haselab.net）へ移行

この文書は実装担当（Sonnet）への指示書です。`README.md` と `SPEC.md`（特に §7.4 インフラ、§7.5 セキュリティ）を先に読んでから着手してください。

> **改訂（2026-07-28）：移行先は `ai1` ではなく `ai2.haselab.net`**
> 当初この文書は移行先を `ai1.haselab.net` として書かれていたが、実際の移行先は
> **third-place開発用に `ai1` の構成をコピーして立てた `ai2.haselab.net`**（131.112.248.55。`ai1`とは別ホスト・別IP）である。
> **`ai2` では湯本さんが管理者権限を持つ**（`docker`グループ所属・root相当の操作が可能）ため、
> 当初想定していた「権限が無いので管理者（hase）に依頼する」という分岐は**不要**になった。
> なお `ai2` にマウントされている `/usr/local/share/doc/` は `ai1` からのコピーであり、
> 記述されたホスト名・権限モデル（`sandboxusers`のみ／`docker`グループは誰にも渡さない等）は
> **`ai1` のポリシーであって `ai2` の現状ではない**。ドキュメントは構成の雛形として読み、
> 実際の値は `ai2` 上で都度確認すること。

**重要**：この作業は**コードを書くだけでは完結しません**。サーバー上での操作（Dockerコンテナ起動、既存nginx設定への追記など）が
必要で、それは湯本さん（人間）が `ai2` のホストシェル上で行います。
Sandboxコンテナ内で動くSonnetからは `docker` コマンドも `/etc/nginx` も見えないため、**代行できません**。
指示書内では【Sonnetの作業】と【湯本さんの作業】を明示的に分けています。Sonnetは【湯本さんの作業】を
勝手に代行しようとせず、必要な手順・確認コマンドを提示し、結果を待ってから次に進むこと。

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

## 3. Step 0：`ai2` 上の nginx 設定の場所を確認する

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

## 4. Step 1：バックエンドをDocker化する【Sonnetの作業】

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
curl -s "http://127.0.0.1:18080/api/token?identity=test" | head -c 200
docker compose down
```
- **完了条件**：ローカルのDockerでトークンが発行できること（`{"url":"wss://...","token":"eyJ..."}` が返る）
- 補足：sandboxコンテナ内には`docker`が無いためSonnetはこの確認を実行できない。
  代わりに **Nodeで直接起動しての疎通確認は実施済み**（`/api/healthz` → `{"ok":true}`、
  `/api/token?identity=test` → JWT、identity未指定 → 400）。Docker経由での確認は湯本さんがホスト側で行う

---

## 5. Step 2：サーバーで公開する

### 5-1.【湯本さんの作業】コードをサーバーに配置して起動

```bash
# サーバー上で
git clone https://github.com/yumoto-kyohei/third-place.git
cd third-place

# .env を作成（LiveKit Cloudの値はRenderのダッシュボードと同じもの）
cp .env.example .env
nano .env   # LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET を記入
            # ALLOWED_ORIGINS=https://yumoto-kyohei.github.io も追記

docker compose up --build -d
curl -s http://127.0.0.1:18080/api/healthz    # {"ok":true} が返ればOK
```

> **秘密情報の扱い**：`.env` は絶対にGitにコミットしない。サーバー上のファイル権限も `chmod 600 .env` にしておく。

### 5-2.【湯本さんの作業】既存nginxにlocationを追加

Step 0(a)(b) で特定したファイル（`ai1`と同じなら `/etc/nginx/sites-available/gdrive-oauth-callback`）の
`server { listen 443 ssl; server_name ai2.haselab.net; ... }`
ブロックの中に、既存の `location /gdrive { ... }` などと並べて以下を追加する。
**認証は付けない**（`/sandbox/port<N>`と違い、third-placeは一般の学生が使うので誰でもアクセスできる必要がある）。

```nginx
# third-place: バックエンド（トークン発行API）へのリバースプロキシ。認証なし（一般公開）。
# third-place/server は 127.0.0.1:18080 で待ち受けている（third-place/docker-compose.yml参照）。
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

- `ai2` では湯本さん自身が編集・reloadできるので、管理者への依頼は不要
- サーバー運用の慣習に従い、変更後は `ai2` 上の `/usr/local/share/doc/CHANGELOG.md` に一言
  （例：「third-placeのAPIプロキシとして`/third-place/api/`locationを追加」）を追記しておくこと。
  `/usr/local/share/doc/` は`ai1`からのコピーなので、**`ai2`固有の変更である旨を明記**し、
  `ai1`の記録と混同されないようにする

### 5-3. 疎通確認
```bash
# 外部から（自分のPCで）。ホスト名は必ず ai2.haselab.net を使うこと（ai2.binaural.meでは証明書のSAN不一致でTLSが通らない）
curl -s https://ai2.haselab.net/third-place/api/healthz
curl -s "https://ai2.haselab.net/third-place/api/token?identity=test" | head -c 200
```
- **完了条件**：外部からHTTPSでトークンが取得できること

---

## 6. Step 3：フロントエンドの接続先を切り替える【Sonnetの作業】

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

**⚠️ `.env.production` は当面 Render のURLのままにしてある**（`https://third-place.onrender.com/api`）。
理由は 6-2 の通りで、**`ai2` の疎通確認（Step 2）が取れる前に `ai2` を指した状態でデプロイすると本番が壊れる**ため。
環境変数化のリファクタ自体は挙動を変えないので、この状態で安全にコミット・デプロイできる。
Step 2 完了後に次の1行へ差し替えるのがカットオーバー作業になる：
```
VITE_TOKEN_SERVER_URL=https://ai2.haselab.net/third-place/api
```

### 6-2. 切り替えの安全な進め方（重要）
**いきなりRenderを止めないこと。** 以下の順で行う：
1. 研究室サーバー（`ai2`）側で疎通確認が取れる（Step 2完了）
2. `client/.env.production` を `ai2` のURLに差し替えてデプロイ
3. 本番URL（`https://yumoto-kyohei.github.io/third-place/`）で実際に入室・会話できることを確認
4. **数日〜1週間ほど問題がないことを確認してから**、Renderのサービスを停止/削除する
   （Render側は残しておいても無料枠なので急いで消す必要はない）

### 6-3. 完了条件
- 本番URLで入室でき、マイク・チャット・画面共有が動作する
- ブラウザのコンソールにMixed ContentやCORSのエラーが出ていない
- 初回アクセスでもRenderのような数十秒の待ちが発生しない（＝スリープ問題の解消を確認）

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
- [ ] 既存機能（入室・音声・空間オーディオ・チャット・画面共有・描き込み・2.5D移動）が壊れていない（2タブで確認）
- [ ] `.env` や APIキーがGitにコミットされていない（`git status` で確認）
- [ ] `npx oxlint src/` に新規エラーなし、`cd client && npm run build` 成功
- [ ] `README.md` の構成図・インフラ表・環境変数の節を更新、`SPEC.md` §7.4 の現状/将来テーブルも更新
- [ ] `git commit -m "…"` → push → GitHub Actions成功 → 本番URLで確認

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
