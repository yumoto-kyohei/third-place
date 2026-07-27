# 実装指示書：バックエンドを Render → 研究室サーバー（ai1.haselab.net）へ移行

この文書は実装担当（Sonnet）への指示書です。`README.md` と `SPEC.md`（特に §7.4 インフラ、§7.5 セキュリティ）を先に読んでから着手してください。

**重要**：この作業は**コードを書くだけでは完結しません**。サーバー上での操作（既存nginx設定への追記など）が必要で、
それは湯本さん（人間）、場合によっては管理者（後述）が行います。指示書内では【Sonnetの作業】と【湯本さんの作業】を
明示的に分けています。Sonnetは【湯本さんの作業】を勝手に代行しようとせず、必要な手順・確認コマンドを提示し、
結果を待ってから次に進むこと。

---

## 0. 目的とスコープ

### 目的
バックエンド（トークン発行API）を Render の無料プランから研究室サーバー `ai1.haselab.net`（実体は `ai1.binaural.me`
と同一ホスト）へ移し、将来のログ保存基盤（SPEC F10）を自分たちの管理下に置ける状態にする。
あわせて、Render無料プランのスリープ問題（初回アクセスで数十秒待たされる）を解消する。

### 今回やること
- バックエンド（`server/`）を研究室サーバー上の Docker で常時稼働させる
- **既存のnginx（`ai1.haselab.net`用、443番で稼働中）に相乗りする形でHTTPS公開する**（新規にHTTPS化する作業は不要）
- フロントエンドの接続先を切り替える（ビルド時に差し替えられるよう環境変数化する）

### 今回やらないこと（スコープ外）
- **DB導入・ログ記録・チャットや掲示板の永続化**（ユーザーの明示的な指示により後回し。§7に「後で足すための置き場所」だけ記載）
- **LiveKit のセルフホスト**（引き続き LiveKit Cloud を使う。UDPポート開放やTURNの問題を今回は持ち込まない）
- フロントエンドの配信元の移動（GitHub Pages のまま。SPEC §7.4 も「GitHub Pages併用も可」としている）
- 認証、深夜停止、複数テントなどの機能追加
- **`ai-sandbox-server`リポジトリ（サーバーの全体設定を管理するprivateリポジトリ）自体の変更**。今回はそちらに
  1箇所nginx設定を追記させてもらうだけで、sandbox/aigw等の既存の仕組みには一切触れない

---

## 1. 現状の調査結果（2026-07-27時点、実測・別リポジトリ確認済み）

このサーバーには専用の管理リポジトリ `haselab-net/ai-sandbox-server`（private）があり、構成・権限モデルが
ドキュメント化されている。移行作業の前に必ずこのリポジトリの `README.md` と `doc/CHANGELOG.md` に目を通すこと
（アクセス権限があれば `git clone` できる）。以下はそこから分かった要点。

| 項目 | 内容 |
|---|---|
| ホスト名 | `ai1.binaural.me`。**`ai1.haselab.net` はそのエイリアス（同一ホスト）** |
| OS | Debian GNU/Linux 12 (bookworm) |
| Docker | 29.6.2 / docker compose v5.3.1（利用可能。ただし`docker`グループはroot相当権限とみなされ、意図的に絞られている） |
| **443番ポート** | **既に開いていて動作している。** `ai1.haselab.net` 宛のTLS証明書（Let's Encrypt）が設定済みで、`https://ai1.haselab.net/` は200 OKを返す。**新規のHTTPS化作業（certbot実行など）は不要** |
| ⚠️ 注意 | `ai1.binaural.me` という名前で直接443にアクセスすると接続できない（TLSのserver_nameが`ai1.haselab.net`にしか設定されていないため）。**アプリの公開URLは必ず`ai1.haselab.net`を使うこと** |
| nginx設定ファイル | `/etc/nginx/sites-available/gdrive-oauth-callback`（ファイル名に反して、**ai1.haselab.net宛の443番サーバーブロック全体**がここに書かれている。gdrive専用ファイルではない） |
| 既存のlocation | `/gdrive`、`/agents/`（aigw = スマホからAIエージェント操作するゲートウェイ）、`/sandbox/port<N>`（ユーザー本人のDockerサンドボックスへの認証付きプロキシ） |
| **`/sandbox/port<N>` は使えない** | aigwのセッションCookie認証(`auth_request`)が必須の仕組みで、**ログインしていない一般ユーザー（third-placeを使う学生等）からはアクセスできない**。third-place用には**認証なしの新しいlocationブロックを追加する必要がある** |
| sudo権限モデル | 一般ユーザーに広い`sudo`は渡していない方針。`admin`グループのメンバーでも、ユーザー管理用の5本の専用スクリプト（`adm-adduser`等）しか`sudo`実行できないよう`/etc/sudoers.d/admin`で厳密に制限されている。**nginx設定の編集やDockerコンテナの起動に使える一般sudoがあるかは、この文書だけでは断定できない** |
| Docker利用例 | 各ユーザー用の開発用サンドボックスコンテナ（`devbox-<user>`）が存在し、ポートは`172.17.0.1:<port>`（Dockerブリッジのアドレス）で待ち受けている。これはnginxの`/sandbox/port<N>`から到達するための配置で、**third-placeのような単独のDocker Composeサービスは、必ずしもこの配置に合わせる必要はない**（`127.0.0.1`バインドで問題ない） |
| このリポジトリの更新方針 | サーバー設定を変更したら、ホスト上の`/usr/local/share/doc/CHANGELOG.md`に追記し、変更したファイルを`ai-sandbox-server`リポジトリ側にも反映するのがこのサーバーの運用ルール。**third-placeのnginx location追加も、この慣習に従いCHANGELOGに記録すべき** |

### ここから導かれる結論

- **HTTPS自体は既に使える。新たにポートを開けてもらったり証明書を取ったりする必要はない。**
  やるべきことは「`ai1.haselab.net`の既存443番サーバーブロックに、third-place用の新しいlocationブロックを1つ追加する」だけ
- ただし、**この追加作業（nginx設定ファイルの編集＋`systemctl reload nginx`）に十分な権限（実質的なroot、または少なくともこのファイルへの書き込み＋nginxのreload権限）が湯本さんにあるかは未確認**。Step 0でここを必ず確認すること
- 権限が無い場合は、サーバー管理者（ドキュメント中に登場する「hase」＝おそらく長谷川先生、または他の管理者）に
  1箇所のlocationブロック追加を依頼する形になる。**追加する設定の中身自体はこの指示書で用意するので、
  「このブロックを追加してreloadしてほしい」という依頼を渡せる状態にしておけばよい**

---

## 2. 移行後の構成（目標）

```
[ユーザーのスマホ/PC]
   │
   ├─ フロントエンド … https://yumoto-kyohei.github.io/third-place/   （GitHub Pages のまま。変更なし）
   │        │
   │        └─①トークン要求 https://ai1.haselab.net/third-place/api/token
   │                 │
   │                 ▼
   │        [ai1.haselab.net = ai1.binaural.me]
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

## 3. Step 0：権限確認（**ここが解決しないと Step 2 に進めない**）

### 【湯本さんの作業】サーバーにSSHして以下を確認する

```bash
# (a) 自分に許可されているsudoコマンドを正確に確認する（最重要）
sudo -l

# (b) 一般グループ所属を確認（adminやdockerグループに入っているか）
groups

# (c) dockerコマンドがsudo無しで使えるか
docker ps

# (d) nginx設定ファイルの現在の中身を確認（読むだけなら誰でも可能なはず）
cat /etc/nginx/sites-available/gdrive-oauth-callback

# (e) 18080番が空いているか
ss -tln | grep 18080 || echo "18080は空き"
```

### 確認すべき論点と、結果に応じた分岐

| 確認事項 | 結果 | 対応 |
|---|---|---|
| `sudo -l` に `ALL` や `systemctl`, `nginx`, `vi /etc/nginx/*` 等が含まれる | 十分な権限あり | 湯本さん自身でStep 2のnginx編集・reloadを実施してよい |
| `sudo -l` が `adm-*` の5本だけ（`ai-sandbox-server`のREADMEにある構成そのまま） | nginx編集の権限なし | **サーバー管理者（長谷川先生、または`ai-sandbox-server`のCHANGELOGに登場する管理者）に、5-2で用意するlocationブロックの追加とnginx reloadを依頼する**。Docker起動（Step 1後半）は`docker`グループに入っていれば自分でできる可能性がある（(c)の結果次第） |
| `docker ps` がエラーなく実行できる | dockerグループに所属 | Step 1のDocker起動は自分で可能 |
| `docker ps` が権限エラー | 未所属 | Docker起動も管理者依頼、または`sudo docker ...`が許可されているか要確認 |

### 【Sonnetの作業】
この Step 0 の結果（特に nginx 編集権限の有無）が判明するまで、gitリポジトリ内の作業は進めてよいが
（Step 1・Step 3 はサーバー権限に依存しない）、**サーバー上でのnginx設定変更・reloadを湯本さんに指示するのはStep 0確認後にすること**。

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
- **ヘルスチェック用のエンドポイント `GET /healthz` を追加**（`{ ok: true }` を返すだけ）。
  死活監視や移行後の疎通確認に使う
- `ALLOWED_ORIGINS` は既に環境変数対応済みなのでコード変更不要

### 4-4. ローカルでの動作確認
```bash
docker compose up --build -d
curl -s http://127.0.0.1:18080/healthz
curl -s "http://127.0.0.1:18080/api/token?identity=test" | head -c 200
docker compose down
```
- **完了条件**：ローカルのDockerでトークンが発行できること（`{"url":"wss://...","token":"eyJ..."}` が返る）

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
curl -s http://127.0.0.1:18080/healthz    # {"ok":true} が返ればOK
```

> **秘密情報の扱い**：`.env` は絶対にGitにコミットしない。サーバー上のファイル権限も `chmod 600 .env` にしておく。

### 5-2.【湯本さん、または権限のある管理者の作業】既存nginxにlocationを追加

`/etc/nginx/sites-available/gdrive-oauth-callback` の `server { listen 443 ssl; server_name ai1.haselab.net; ... }`
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

- Step 0で編集権限が無いと分かった場合は、**この`location`ブロックをそのまま管理者に渡して**
  「`/etc/nginx/sites-available/gdrive-oauth-callback`の443番サーバーブロックにこれを追加して`nginx -t && systemctl reload nginx`してほしい」
  と依頼する
- `ai-sandbox-server`リポジトリの運用ルールに従い、変更後は**そのリポジトリ側の`etc/nginx/sites-available/gdrive-oauth-callback`にも今回の追記を反映**し、
  `doc/CHANGELOG.md`に一言（例：「third-placeのAPIプロキシとして`/third-place/api/`locationを追加」）を追記しておくこと（管理者と相談の上）

### 5-3. 疎通確認
```bash
# 外部から（自分のPCで）。ホスト名は必ず ai1.haselab.net を使うこと（ai1.binaural.meではTLSが通らない）
curl -s https://ai1.haselab.net/third-place/api/healthz
curl -s "https://ai1.haselab.net/third-place/api/token?identity=test" | head -c 200
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

### 6-1. 実装方針
- `VITE_TOKEN_SERVER_URL` を参照し、未設定なら従来通りのフォールバック（開発時は `http://localhost:3001`）
- `client/.env.production` に本番の値を書く（**これは公開URLであり秘密情報ではないのでコミットしてよい**）
  ```
  VITE_TOKEN_SERVER_URL=https://ai1.haselab.net/third-place/api
  ```
- **注意**：現在のコードは `${TOKEN_SERVER_URL}/api/token` と組み立てている。上記URLは既に `/api` を含むので、
  **パスの二重付与（`/api/api/token`）にならないよう、組み立て方を整理すること**。
  URLの持ち方を「ベースURL（`/api`まで含む）＋`/token`」に統一するのが分かりやすい
- `.env.example` にも項目を追記して、他の人が分かるようにする

### 6-2. 切り替えの安全な進め方（重要）
**いきなりRenderを止めないこと。** 以下の順で行う：
1. 研究室サーバー側で疎通確認が取れる（Step 2完了）
2. フロントを研究室サーバー向けに切り替えてデプロイ
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
`ai-sandbox-server`リポジトリの確認により、**正しいホスト名（`ai1.haselab.net`）を使えば443は既に利用可能**と判明し、
作業内容を「既存nginxへの1箇所のlocation追加」に縮小できた。
