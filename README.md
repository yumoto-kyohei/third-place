# third-place

スマートフォンのブラウザで動く、複数人の音声通話＋テキストチャットアプリのプロトタイプ。

今後の開発目標である『通りとテント』アプリの全体仕様は [SPEC.md](SPEC.md) を参照。

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
- `livekit-client` / `@livekit/components-react`: LiveKitのWeb SDKと、あらかじめ用意されたUIコンポーネント（`LiveKitRoom`, `RoomAudioRenderer`, `TrackToggle`, `Chat`, `useParticipants`, `useSpeakingParticipants`, `useTracks`, `VideoTrack`, `useDataChannel`, `useRoomContext` 等）を利用
- ルーム名は現時点で `lobby` に固定（複数ルームには未対応）
- マイクの音声・画面共有（映像トラック）・テキストチャットに対応。カメラ映像は未使用
- 本番ビルドかどうかで接続先のトークンサーバーURLを切り替えている（`import.meta.env.PROD` で判定、`client/src/App.jsx`）
- レイアウトはスマートフォンでの利用を主眼にモバイルファーストで実装（`index.css`）。ボタン・入力欄は最小44pxの高さでタップしやすいサイズに統一し、入力欄のフォントサイズは16px以上にしてiOS Safariでのフォーカス時自動ズームを防止。ビューポート高さは`100svh`（モバイルブラウザのアドレスバー表示/非表示による揺れに強い単位）を使用
- コンポーネント構成:
  - `App.jsx`: 入室フォーム、トークン取得、`LiveKitRoom`への接続
  - `CallScreen.jsx`: マイク／画面共有のトグルボタン、チャット表示切り替え、退出ボタン（`useRoomContext().disconnect()`）、テント内2D俯瞰ビュー
  - `TentView.jsx`: テント内の2D俯瞰ビュー（SPEC §5.3・Phase 1）。参加者をアバター（現状は仮の丸＋表示名）として床面に配置し、自分のアバターはドラッグで移動できる。位置はLiveKitのデータチャネル（`useDataChannel('position', ...)`）で全参加者に同期。座標は床サイズ非依存の0〜1正規化、移動中は約10Hzのロスあり配信＋2秒ごとのハートビート再送（後から入室した人にも位置が伝わるように）。発話中は緑のリングで表示
  - `ScreenShareStage.jsx`: 画面共有中の映像（`useTracks([Track.Source.ScreenShare])`で検出）と、その上に重ねる描き込みオーバーレイの表示
  - `DrawingOverlay.jsx`: 画面共有映像の上に重ねる`<canvas>`。ペン（フリーハンド）／丸で囲む（楕円）／消しゴムの3ツールを提供し、LiveKitの**データチャネル**（`useDataChannel('draw', ...)`、`localParticipant`経由でP2PではなくSFU経由の低遅延メッセージング）でストローク情報を全参加者にブロードキャストし、誰の画面でも同じ描き込みが同期表示される
    - ツールは明示的に選択するまで無効（初期状態は`tool = null`で`<canvas>`は`pointerEvents: 'none'`）。ツールボタンはトグル式で、選択中のツールボタンをもう一度押すと解除される
    - 座標はキャンバスサイズに依存しないよう0〜1に正規化して送受信
    - 消しゴムは「ストローク単位」で消える方式（線や丸に触れると、その線・丸ごと削除）であり、部分消しではない
    - ペンの描画中の点（`pen-move`）はロスあり配信（`reliable:false`）、開始・終了・丸・消去・全消去はロスなし配信（`reliable:true`）
- テキストチャットはLiveKit標準のチャット機能（`<Chat />`コンポーネント）をそのまま使用。独自のデータチャネル実装ではなく、LiveKit組み込みのメッセージング機構に乗っている。UIラベルは英語のまま（"Enter a message...", "Send"等）で日本語化はされていない

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
│   └── src/
│       ├── App.jsx              入室フォーム・LiveKitRoomへの接続
│       ├── CallScreen.jsx       マイク/画面共有ボタン・テント内ビュー
│       ├── TentView.jsx         テント内2D俯瞰ビュー・アバター移動・位置同期
│       ├── ScreenShareStage.jsx 画面共有映像の表示
│       └── DrawingOverlay.jsx   画面共有上の描き込み（ペン/丸/消しゴム）とデータチャネル同期
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
- 音声通話＋画面共有＋画面への描き込み＋テキストチャットまで実装済み。カメラ映像・アバター表示・空間オーディオは未実装（今後追加予定）
- 画面共有は同時に1人のみ想定（複数人が同時共有した場合の表示制御は未実装、`ScreenShareStage`は最初の1トラックのみ表示）
- 描き込みの色・太さは固定（ペンは赤、丸は橙、変更UIなし）
- チャットのUIラベルは英語のまま（日本語化未対応）
- CORSはオリジン無制限
- 認証・ユーザー管理なし（表示名を自己申告するのみ）
