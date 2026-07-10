# third-place

スマートフォンのブラウザで動く、複数人の音声通話＋（今後追加予定の）チャットアプリのプロトタイプ。

## システム構成

```
┌──────────────────────┐        ┌──────────────────────┐        ┌───────────────────────┐
│  client (React/Vite)  │        │  server (Node/Express)│        │  LiveKit Cloud (SFU)   │
│  GitHub Pages で配信  │──①──▶│  Render で稼働         │──②──▶│  音声のリレー          │
│                        │◀─────③音声/参加者情報──────────────────┤  東京(Japan A)リージョン│
└──────────────────────┘        └──────────────────────┘        └───────────────────────┘
```

- ① クライアントが `GET /api/token?identity=<表示名>` をバックエンドに叩き、入室用トークンを取得する
- ② バックエンドが LiveKit の API Key/Secret でJWTアクセストークンを署名して発行する（Secretはバックエンドだけが保持し、クライアントには渡らない）
- ③ クライアントはそのトークンを使って LiveKit Cloud の WebSocket/WebRTC エンドポイントに直接接続し、音声の送受信はLiveKit Cloud（SFU）経由で行う。バックエンドは音声データ自体には関与しない

### なぜSFU（LiveKit）を使うか

WebRTCは本来1対1通話を前提とした技術で、複数人が同時に通話すると参加者数の2乗で接続数が増えてしまう。LiveKitはSFU（Selective Forwarding Unit）として、各participantがサーバーに1本だけ接続し、サーバー側で他の参加者へ配信し直すことで、これを解消している。今回はLiveKit CloudというLiveKit社のマネージドホスティングを利用しており、自前でメディアサーバーを構築・運用していない。

## 技術スタック

### フロントエンド（`client/`）

- React 19 + Vite（ビルドツール）
- `livekit-client` / `@livekit/components-react`: LiveKitのWeb SDKと、あらかじめ用意されたUIコンポーネント（`LiveKitRoom`, `RoomAudioRenderer`, `useParticipants` 等）を利用
- ルーム名は現時点で `lobby` に固定（複数ルームには未対応）
- 音声のみ（映像トラックは未使用。`video` propは渡していない）
- 本番ビルドかどうかで接続先のトークンサーバーURLを切り替えている（`import.meta.env.PROD` で判定、`client/src/App.jsx`）

### バックエンド（`server/`）

- Node.js（ESM） + Express
- `livekit-server-sdk`: `AccessToken` を使ってJWTを発行するだけの薄いAPI（`server/index.js`）
- エンドポイントは `GET /api/token` の1つのみ。クエリパラメータ `identity`（表示名）を受け取り、`{ url, token }` をJSONで返す
- 発行するトークンの権限（grant）: `roomJoin: true, canPublish: true, canSubscribe: true`（ルームは `lobby`固定）
- CORSは `cors()` をデフォルト設定（オリジン制限なし）で有効化。プロトタイプ段階のため未制限だが、本来は許可オリジンを絞るべき
- ポートはRenderが注入する `process.env.PORT` を優先し、なければ `3001`（ローカル用）

### インフラ・ホスティング

| コンポーネント | ホスティング先 | デプロイ方法 |
|---|---|---|
| フロントエンド（静的ビルド成果物） | GitHub Pages（`https://yumoto-kyohei.github.io/third-place/`） | `main`ブランチへのpush時に GitHub Actions（`.github/workflows/deploy-client.yml`）が `client/` をビルドし自動公開 |
| バックエンド（Node.jsプロセス） | Render 無料プラン（`https://third-place.onrender.com`） | RenderがGitHubリポジトリの`main`ブランチを監視し、push時に自動ビルド・再起動（Root Directory: `server`, Build: `npm install`, Start: `npm start`） |
| SFU / 音声リレー | LiveKit Cloud（無料 Build プラン） | 東京(Japan A)リージョンのプロジェクトを使用 |

Render無料プランは一定時間アクセスがないとスリープし、次回アクセス時に起動し直すため（数十秒かかる）、初回アクセスが遅いことがある。

## ディレクトリ構成

```
third-place/
├── client/           React(Vite)フロントエンド。GitHub Pagesへデプロイ
│   └── src/App.jsx   入室フォーム・LiveKitRoom・参加者一覧
├── server/           Express バックエンド。Renderへデプロイ
│   └── index.js      トークン発行APIのみを提供
├── .github/workflows/deploy-client.yml   client を GitHub Pages に自動デプロイするワークフロー
├── .env              LiveKitの接続情報（Git管理外。ローカル開発時にserverが読む）
└── .env.example      .envに必要な変数のテンプレート
```

## 環境変数

`server/`（および ローカル実行時は プロジェクトルートの `.env`）が読む値。値はLiveKit CloudのプロジェクトSettingsから取得する。

| 変数名 | 内容 |
|---|---|
| `LIVEKIT_URL` | LiveKit CloudプロジェクトのWebSocket URL（`wss://xxxx.livekit.cloud`） |
| `LIVEKIT_API_KEY` | LiveKit CloudのAPI Key |
| `LIVEKIT_API_SECRET` | LiveKit CloudのAPI Secret（非公開情報。Gitにコミットしない・チャット等にも貼らない） |

ローカル開発では `third-place/.env` に、Render本番環境ではRenderダッシュボードの環境変数設定にそれぞれ登録している。

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

## 現状の制約・今後の予定

- ルームは `lobby` 1つのみ固定（複数ルーム・部屋作成機能は未実装）
- 音声のみ。テキストチャット・映像・アバター表示・空間オーディオは未実装（今後追加予定）
- CORSはオリジン無制限
- 認証・ユーザー管理なし（表示名を自己申告するのみ）
