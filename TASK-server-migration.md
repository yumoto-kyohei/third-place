# 実装指示書：バックエンドを Render → 研究室サーバー（ai1.binaural.me）へ移行

この文書は実装担当（Sonnet）への指示書です。`README.md` と `SPEC.md`（特に §7.4 インフラ、§7.5 セキュリティ）を先に読んでから着手してください。

**重要**：この作業は**コードを書くだけでは完結しません**。サーバー上での操作・ネットワーク管理者への依頼が必要で、それは湯本さん（人間）が行います。
指示書内では【Sonnetの作業】と【湯本さんの作業】を明示的に分けています。Sonnetは【湯本さんの作業】を勝手に代行しようとせず、
必要な手順・確認コマンドを提示し、結果を待ってから次に進むこと。

---

## 0. 目的とスコープ

### 目的
バックエンド（トークン発行API）を Render の無料プランから研究室サーバー `ai1.binaural.me` へ移し、
将来のログ保存基盤（SPEC F10）を自分たちの管理下に置ける状態にする。
あわせて、Render無料プランのスリープ問題（初回アクセスで数十秒待たされる）を解消する。

### 今回やること
- バックエンド（`server/`）を研究室サーバー上の Docker で常時稼働させる
- HTTPS で公開し、GitHub Pages のフロントエンドから呼べるようにする
- フロントエンドの接続先を切り替える（ビルド時に差し替えられるよう環境変数化する）

### 今回やらないこと（スコープ外）
- **DB導入・ログ記録・チャットや掲示板の永続化**（ユーザーの明示的な指示により後回し。§7に「後で足すための置き場所」だけ記載）
- **LiveKit のセルフホスト**（引き続き LiveKit Cloud を使う。UDPポート開放やTURNの問題を今回は持ち込まない）
- フロントエンドの配信元の移動（GitHub Pages のまま。SPEC §7.4 も「GitHub Pages併用も可」としている）
- 認証、深夜停止、複数テントなどの機能追加

---

## 1. 現状の調査結果（2026-07-27時点、実測済み）

| 項目 | 実測値 |
|---|---|
| ホスト名 | `ai1.binaural.me` |
| グローバルIP | `131.112.248.54`（外部から名前解決・到達可能） |
| OS | Debian GNU/Linux 12 (bookworm) |
| Docker | 29.6.2 / docker compose v5.3.1（利用可能） |
| Node（ホスト上） | v18.20.4（Dockerを使うので直接は使わない想定） |
| **80番ポート** | **外部から到達可能。`nginx/1.22.1` が 200 を返す** |
| **443番ポート** | **外部から接続不可（閉じている）** |
| sudo | パスワード必要（`sudo -n` は失敗） |
| その他 | `172.17.0.1`（Dockerブリッジ）の 20073〜20095 番台を多数の何かがLISTEN中＝**他プロジェクトが同居している可能性が高い** |

### ここから導かれる最重要事項

- **HTTPS（443）が使えないと、この移行は成立しない。** 理由：
  1. ブラウザは `localhost` 以外では **HTTPS でないとマイク・画面共有・WebRTC を許可しない**（Secure Context 要件）
  2. フロントエンドは GitHub Pages（`https://`）で動作しており、**HTTPSページから `http://` のAPIを呼ぶとブラウザがブロックする**（Mixed Content）
- 80番でnginxが動いているのは好都合（Let's Encrypt の HTTP-01 チャレンジに使える／リバースプロキシとして相乗りできる）。
  **ただしホスト上に `nginx` コマンドが見つからなかった＝このnginxは別のユーザーがDockerで動かしている可能性が高い。**
  勝手に設定を書き換えると他プロジェクトを壊すおそれがあるため、**必ず所有者を確認してから触ること**。
- 20073〜20095番台が使用中なので、**このアプリのポートはそれらと衝突しないもの**を選ぶ（本書では暫定で `18080` を使う。衝突していたら変更してよい）。

---

## 2. 移行後の構成（目標）

```
[ユーザーのスマホ/PC]
   │
   ├─ フロントエンド … https://yumoto-kyohei.github.io/third-place/   （GitHub Pages のまま。変更なし）
   │        │
   │        └─①トークン要求 https://ai1.binaural.me/third-place/api/token
   │                 │
   │                 ▼
   │        [ai1.binaural.me]
   │           nginx（443/HTTPS, Let's Encrypt）
   │             └─ /third-place/api/ を localhost:18080 にリバースプロキシ
   │                   └─ Docker: third-place-server（Node/Express。トークン発行のみ）
   │                        └─（将来）ここに PostgreSQL を足してログ保存 …§7
   │
   └─②音声/データ … wss://haselab-third-place-....livekit.cloud （LiveKit Cloud のまま。変更なし）
```

**ポイント**
- LiveKit Cloud は変更しないので、`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` の値はそのまま流用できる
- サブドメインを新設せず、**既存ドメインのパス `/third-place/api/` に相乗り**する（DNS変更が不要で、他プロジェクトとも共存しやすい）
- 公開するのは HTTPS だけ。Nodeアプリは外部に直接公開せず、`127.0.0.1:18080` だけで待ち受けてnginx経由にする（SPEC §7.5）

---

## 3. Step 0：前提確認（**ブロッカー。ここが解決しないと先に進めない**）

### 【湯本さんの作業】サーバーにSSHして以下を確認する

```bash
# (a) 80/443を誰がリッスンしているか（nginxの正体を突き止める）
sudo ss -tlnp | grep -E ':80 |:443 '

# (b) 動いているコンテナ一覧（nginxがDockerかどうか、ポートの空き状況）
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Image}}'

# (c) ホストにnginxが入っているか（入っていればDockerではなくホスト側の設定を触る）
ls /etc/nginx/ 2>&1; systemctl status nginx 2>&1 | head -5

# (d) sudoが実際に使えるか（パスワードを入力して確認）
sudo true && echo "sudo 使える"

# (e) 18080番が空いているか
ss -tln | grep 18080 || echo "18080は空き"

# (f) ファイアウォール設定（見られれば）
sudo iptables -L -n 2>&1 | head -20; sudo ufw status 2>&1 | head -5
```

### 確認すべき論点と、結果に応じた分岐

| 確認事項 | 結果 | 対応 |
|---|---|---|
| **443を開けられるか** | 自分/研究室で開けられる | Step 2へ進む |
| | 大学のFWで塞がれている | **ネットワーク管理者／長谷川先生に443開放を依頼する。これが通らないと移行不可**（→§8の代替案を検討） |
| **80のnginxの所有者** | 自分（または研究室共用で触ってよい） | そのnginxに設定を追加して相乗りする |
| | 他人のDockerコンテナ | **勝手に触らない。** 所有者に「`/third-place/api/` を18080へプロキシする設定を足してよいか」を相談する。断られた場合は自分専用のnginxコンテナを別ポートで立て、443を別途割り当ててもらう |
| **sudoが使えるか** | 使える | Let's Encrypt・nginx設定・FW設定を自分で行える |
| | 使えない | 証明書取得やnginx設定は管理者依頼が必要。Dockerだけで完結する構成（後述）を検討 |

### 【Sonnetの作業】
このStep 0の結果が判明するまで、**サーバー側の設定ファイルを書き進めない**こと。
ただし、結果に依存しない §4（アプリのDocker化）と §6（フロントエンドの環境変数化）は先行して進めてよい。

---

## 4. Step 1：バックエンドをDocker化する【Sonnetの作業】

サーバー上で常時稼働させるため、`server/` をDockerで動かせるようにする。

### 4-1. `server/Dockerfile` を新規作成
- ベースイメージは `node:20-alpine` 程度（ホストのNodeは18だがDocker内なので無関係）
- `server/package.json` / `package-lock.json` をコピーして `npm ci --omit=dev`
- ソースをコピーして `CMD ["node", "index.js"]`
- 本番環境なので `NODE_ENV=production`

### 4-2. リポジトリ直下に `docker-compose.yml` を新規作成
- サービス名 `third-place-server`
- `build: ./server`
- **ポートは `127.0.0.1:18080:3001` とし、外部に直接公開しない**（nginx経由のみ。SPEC §7.5）
- `restart: unless-stopped`（サーバー再起動時も自動復帰）
- 環境変数はサーバー上に置く `.env` から読む（`env_file`）。**`.env`はGitにコミットしない**（既存の`.gitignore`のまま）
- 将来DBを足す場所をコメントで明示しておく（§7）

### 4-3. `server/index.js` の調整
- **`dotenv` の読み込みパスに注意**：現在 `../.env`（リポジトリ直下）を見ているが、Dockerでは `server/` だけをコピーする想定なので壊れる。
  `docker compose` の `env_file` で環境変数を渡すなら `dotenv` は無くても動く。
  **ローカル開発（`npm run dev`）でも壊れないよう、`.env`が無ければ黙って無視する形にする**（`dotenv.config()`は失敗しても例外を投げないが、パス指定は要見直し）
- **ヘルスチェック用のエンドポイント `GET /healthz` を追加**（`{ ok: true }` を返すだけ）。
  nginx設定やDockerの死活監視、移行後の疎通確認に使う
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

## 5. Step 2：サーバーで公開する（HTTPS化）

**Step 0 で 443 が開けられることを確認してから着手すること。**

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

### 5-2.【湯本さんの作業】nginx にリバースプロキシ設定を追加

Step 0 で判明したnginxの所有者・形態に応じて、以下の設定を追加する（所有者が他人なら**必ず相談してから**）。

```nginx
# https のサーバーブロック内に追加
location /third-place/api/ {
    proxy_pass http://127.0.0.1:18080/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

> nginxがDockerコンテナの場合、`127.0.0.1` はコンテナ内を指してしまい繋がらない。
> その場合は `host.docker.internal` か Dockerブリッジのアドレス（`172.17.0.1:18080`）を使うか、
> 同じDockerネットワークに参加させる必要がある。**ここは実際の構成を見てから判断すること。**

### 5-3.【湯本さんの作業】Let's Encrypt でHTTPS証明書を取得

80番が外部から到達できるので、HTTP-01チャレンジが使える。

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ai1.binaural.me
```
- certbot が自動でnginxに443の設定を追加し、証明書の自動更新も設定してくれる
- **他プロジェクトのnginx設定を書き換える可能性があるため、所有者に確認してから実行すること**
- nginxがDockerの場合は certbot の使い方が変わる（`--webroot` を使う等）。構成に合わせて調整

### 5-4. 疎通確認
```bash
# 外部から（自分のPCで）
curl -s https://ai1.binaural.me/third-place/api/healthz
curl -s "https://ai1.binaural.me/third-place/api/token?identity=test" | head -c 200
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
  VITE_TOKEN_SERVER_URL=https://ai1.binaural.me/third-place/api
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

## 8. もし443が開けられなかった場合の代替案（Step 0の結果次第）

443が大学のファイアウォールで開放できない場合、この移行はそのままでは実現できない。以下を検討する（いずれも要相談）：

1. **別のポートでHTTPSを公開**（例：8443）。ブラウザはポート番号が違ってもHTTPSなら Secure Context を満たすので機能的には動く。
   URLが `https://ai1.binaural.me:8443/...` と不格好になるが実用上は問題ない。**そのポートの開放は必要**
2. **既に443が開いている別の研究室サーバー**があれば、そちらに相乗りする
3. **当面Renderを継続**し、サーバー移行はネットワーク要件が整うまで保留する
   （ログ保存が必要になった時点で改めて交渉する）

**Sonnetへ**：この判断は技術だけで決められない（大学のポリシー・他プロジェクトへの影響が絡む）ため、
勝手に代替案を実装せず、状況を整理してユーザーに提示し、判断を仰ぐこと。

---

## 9. 各ステップ完了時のチェックリスト
- [ ] 既存機能（入室・音声・空間オーディオ・チャット・画面共有・描き込み・2.5D移動）が壊れていない（2タブで確認）
- [ ] `.env` や APIキーがGitにコミットされていない（`git status` で確認）
- [ ] `npx oxlint src/` に新規エラーなし、`cd client && npm run build` 成功
- [ ] `README.md` の構成図・インフラ表・環境変数の節を更新、`SPEC.md` §7.4 の現状/将来テーブルも更新
- [ ] `git commit -m "…"` → push → GitHub Actions成功 → 本番URLで確認

---

## 10. 参考：この移行の位置づけ
SPEC §7.4 で「将来（研究室サーバー移行後）」として計画されていたもののうち、**バックエンドの移行のみ**を先行実施する。
SFU（LiveKit）のセルフホストとDB導入は据え置き、段階的にリスクを分けて進める。
目的は「Renderのスリープ解消」と「将来のログ基盤（F10）を自分たちの管理下に置く準備」。
