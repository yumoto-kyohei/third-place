# third-place

スマートフォンのブラウザで動く、空間オーディオ付きの音声通話＋テキストチャットアプリ。
研究プロジェクト『通りとテント』（デジタル・サードプレイスによるピア・ケア実証）のプロトタイプ。

テント（＝仮想的な場）の中を歩き回り、**近づいた人の声がはっきり聞こえ、離れると聞こえなくなる**。
石や草のアバターを選べば、声を出さずにただその場に居ることもできる。

| | |
|---|---|
| 本番URL | https://yumoto-kyohei.github.io/third-place/ |
| バックエンド | `https://ai2.haselab.net/third-place/api/`（研究室サーバー ai2 上のDocker） |

---

## ドキュメントの読み分け

| ファイル | 何が書いてあるか |
|---|---|
| **README.md**（本書） | **動かし方** — ローカル開発、本番運用手順、環境変数、トラブルシューティング |
| [SPEC.md](SPEC.md) | **何を作るか・なぜ**（全体仕様書） — 目指す体験、設計原則、機能仕様、開発フェーズ |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **どう作られているか**（技術仕様書） — 構成、データチャネル、空間オーディオ、実装上の注意 |
| `TASK-*.md` | **今着手している作業の実装指示書**。完了したら内容を各文書へ畳んで削除する（記録はgit履歴に残る）。<br>したがって `TASK-*.md` が存在する＝進行中の作業がある、と読める |

現在の `TASK-*.md`：[TASK-2.5D-boards.md](TASK-2.5D-boards.md) — 2.5D化（Step 0・1）は**完了して本番稼働中**、
空間内に画面共有・掲示板の「ボード」を立てる機能（Step 2以降）が**未着手**

> 事実の重複を避けるため、**それぞれの話題の一次情報は1つの文書だけに置く**。
> 他の文書からはリンクするにとどめる（過去に同じ事実が3ファイルに散り、食い違いが発生した）。

**はじめて触る人へ**：まず [SPEC.md](SPEC.md) の §0（現在の実装状況）と §1（プロジェクト概要）を読み、
コードに手を入れる前に [ARCHITECTURE.md](ARCHITECTURE.md) の §9（実装時に守ること）に目を通してください。

---

## ディレクトリ構成

```
third-place/
├── client/           React(Vite)フロントエンド。GitHub Pagesへデプロイ
│   ├── .env.production      本番ビルド時のトークンAPIのURL（公開URLなのでコミット済み）
│   └── src/
│       ├── App.jsx              入室フォーム・LiveKitRoomへの接続
│       ├── CallScreen.jsx       アバター切替/マイク/画面共有ボタン・テント内ビュー
│       ├── AvatarSprite.jsx     アバターの見た目（石/草/人）・種別判定ヘルパー
│       ├── TentState.jsx        位置/アバター種別の共有ストア・データチャネル同期
│       ├── TentView.jsx         テント内2.5Dビュー（r3f・ビルボード）・アバター移動
│       ├── SpatialAudio.jsx     空間オーディオ（距離減衰＋ステレオパン）
│       ├── ChatState.jsx        チャットのメッセージ状態・データチャネル同期（常時マウント）
│       ├── ChatPanel.jsx        日本語テキストチャットの見た目
│       ├── ScreenShareStage.jsx 画面共有映像の表示
│       ├── DrawingOverlay.jsx   画面共有上の描き込み（ペン/丸/消しゴム）とデータチャネル同期
│       └── mockup/             2.5D検証用モックアップ（本番アプリとは完全独立）
├── mockup.html       モックアップのHTMLエントリ（本番= index.html とは別）
├── server/           Express バックエンド。ai2上のDockerで稼働
│   ├── index.js      トークン発行API（/api/token）と死活監視（/api/healthz）
│   └── Dockerfile    バックエンドのコンテナイメージ定義
├── docker-compose.yml  バックエンドの起動設定（127.0.0.1:18080で待ち受け・自動再起動）
├── docs/images/      仕様書に埋め込む図（SVG）
├── .github/workflows/deploy-client.yml   client を GitHub Pages に自動デプロイするワークフロー
├── .env              LiveKitの接続情報（Git管理外。ローカル開発時とサーバー稼働時にserverが読む）
└── .env.example      .envに必要な変数のテンプレート
```

各モジュールが何を担当し、なぜそう分けているかは [ARCHITECTURE.md](ARCHITECTURE.md) §3 を参照。

---

## 環境変数

### バックエンド（`server/`）

プロジェクト直下の `.env` から読む（Docker稼働時は `docker-compose.yml` の `env_file` 経由）。
値はLiveKit CloudのプロジェクトSettingsから取得する。

| 変数名 | 内容 |
|---|---|
| `LIVEKIT_URL` | LiveKit CloudプロジェクトのWebSocket URL（`wss://xxxx.livekit.cloud`） |
| `LIVEKIT_API_KEY` | LiveKit CloudのAPI Key |
| `LIVEKIT_API_SECRET` | LiveKit CloudのAPI Secret（非公開情報。Gitにコミットしない・チャット等にも貼らない） |
| `ALLOWED_ORIGINS` | （任意）CORSで許可するオリジンをカンマ区切りで上書き |

本番（ai2）では `~/third-place/.env`（`chmod 600`）に置いている。
**このファイルを `~/sandhome/` 配下に置かないこと** — そこはsandboxコンテナにマウントされており、
コンテナ内で動くAIエージェントが同じuidで動くため、`chmod 600` でもSecretが読まれてしまう。

### フロントエンド（`client/`）

| 変数名 | 内容 |
|---|---|
| `VITE_TOKEN_SERVER_URL` | トークンAPIのベースURL（**末尾の `/api` まで含む**）。未設定時は `http://localhost:3001/api` |

本番の値は `client/.env.production` に記述してコミットしている（公開URLであり秘密情報ではない）。
ビルド時に埋め込まれるため、**接続先を変えるにはこのファイルを変更して再デプロイする**必要がある。

---

## ローカルでの動かし方

```bash
# バックエンド
cd server
npm install
npm run dev      # http://localhost:3001

# フロントエンド（別ターミナル）
cd client
npm install
npm run dev      # http://localhost:5173
```

開発時は `VITE_TOKEN_SERVER_URL` が未設定なので、フロントは自動的に `http://localhost:3001/api` を見る。

> **動作確認は実ブラウザ2つで行うこと。** ヘッドレスでは実WebRTCが張れないため、他の参加者が
> 見える／聞こえるかは確認できない。別ブラウザかシークレットウィンドウで、**違う表示名**で
> 2つ入室する（同じ表示名だとLiveKit側で同一参加者として扱われる）。

ビルドとlint：

```bash
cd client
npm run build          # dist/ に本番ビルド
npx oxlint src/        # 既存のwarningのみ。新規エラーを出さないこと
```

---

## 本番バックエンドの運用（ai2.haselab.net）

サーバーにSSHし、`~/third-place` で操作する（sandboxコンテナの中ではなくホストのシェル）。

```bash
# 状態確認
docker compose ps
docker compose logs --tail=50 third-place-server

# コード更新を反映
git pull && docker compose up -d --build

# .env を変更したとき（restartでは反映されない）
docker compose up -d --force-recreate

# 生存確認
curl -s https://ai2.haselab.net/third-place/api/healthz             # {"ok":true}
curl -s "https://ai2.haselab.net/third-place/api/token?identity=t"  # url と token の両方が返ること
```

フロントエンドは `main` への push で GitHub Actions が自動デプロイする（`client/**` の変更時のみ発火）。
バックエンドは**自動デプロイされない**ので、上記を手動で実行する。

### nginx

`location /third-place/api/` は `/etc/nginx/sites-available/gdrive-oauth-callback` の
443番サーバーブロック内にある（ファイル名に反して、`ai2.haselab.net`宛の443番サーバーブロック全体が
ここに書かれている。gdrive専用ファイルではない）。

このファイルはgdrive・aigw・sandboxプロキシも定義しているため、編集したら
**必ず `sudo nginx -t` で構文チェックしてから** `sudo systemctl reload nginx` すること。

### トラブルシューティング

**入室はできるが他の参加者が誰も見えない**

ブラウザのコンソールに `no livekit url provided` が出ていたら、`LIVEKIT_URL` がバックエンドの
プロセスに渡っていない。`/api/token` のレスポンスから `url` が欠落し、フロントが接続先を
知れないため「自分しかいない部屋」に見える。

```bash
docker compose exec third-place-server env | grep LIVEKIT   # 変数名を確認
```

実際に一度、`.env` の1行目が `LIVEKIT_URL=` ではなく **`QLIVEKIT_URL=`**（先頭に`Q`が混入）に
なっていてこの症状が出た。**変数名の打ち間違い**を最初に疑うこと。
`.env`を読むだけでは気付きにくいので、上記のようにコンテナのプロセスが見ている変数名を確認する。

なおこのとき、疎通確認を `curl ... | head -c 200` と切り詰めていたために欠落を見落としていた。
**トークンAPIの確認では出力を切り詰めず、`url`と`token`の両方があることを目視すること。**

**`.env` を直したのに反映されない**

`docker compose restart` では環境変数は再読み込みされない（コンテナ作成時に注入されるため）。
`docker compose up -d --force-recreate` を使う。

**502 が返る**

バックエンドのコンテナが落ちている。`docker compose ps` と `docker compose logs` を確認。

**`.env` の中身を確認したい（値は見せずに）**

```bash
grep -c "your_api\|your-project" .env                     # 0 ならプレースホルダーは残っていない
awk -F= '/LIVEKIT_API_SECRET/ {print length($2)}' .env     # 0 より大きければ値が入っている
```

`LIVEKIT_API_SECRET` の値そのものをチャットやissueに貼らないこと。

### 切り戻し（ai2 → Render）

2026-07-28以前は Render 無料プラン（`https://third-place.onrender.com`）で稼働していた。
無料プランは一定時間アクセスがないとスリープし、次回アクセス時の起動に数十秒かかるため、
研究室サーバーへ移行した。

Renderのサービスは切り戻し用に当面残してある（`main`を監視して自動デプロイされ続ける）。
`client/.env.production` の `VITE_TOKEN_SERVER_URL` を
`https://third-place.onrender.com/api` に戻して push すればロールバックできる。

---

## 現状わかっている制約

実装済みの範囲と未実装の機能は [SPEC.md](SPEC.md) §0、
技術的な既知の制約は [ARCHITECTURE.md](ARCHITECTURE.md) §10 にまとめてある。

移行（2026-07-28）の積み残し：

- Renderのサービス停止（切り戻し用に残置中。数日〜1週間問題なければ停止する）
- ai2の`/usr/local/share/doc/CHANGELOG.md`へのnginx変更の記録（サーバー運用ルールで求められているもの）
- スリープ解消の実測比較（原理的には解消済みだが計測していない）
- 移行後の画面共有・描き込み・2.5D移動の個別動作確認（入室と相互表示は確認済み）
