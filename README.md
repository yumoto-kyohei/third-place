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
- `livekit-client` / `@livekit/components-react`: LiveKitのWeb SDKと、あらかじめ用意されたフック/コンポーネント（`LiveKitRoom`, `TrackToggle`, `useParticipants`, `useSpeakingParticipants`, `useTracks`, `useDataChannel`, `useRoomContext`, `useLocalParticipant`, `useChat` 等）を利用
- ルーム名は現時点で `lobby` に固定（複数ルームには未対応）
- マイクの音声・画面共有（映像トラック）・テキストチャットに対応。カメラ映像は未使用
- マイクは入室時に自動要求せず、「人」アバターを選んで初めて使えるようにしている（SPEC 5.1: 石で居るだけならマイク不要）
- 本番ビルドかどうかで接続先のトークンサーバーURLを切り替えている（`import.meta.env.PROD` で判定、`client/src/App.jsx`）
- レイアウトはスマートフォンでの利用を主眼にモバイルファーストで実装（`index.css`）。ボタン・入力欄は最小44pxの高さでタップしやすいサイズに統一し、入力欄のフォントサイズは16px以上にしてiOS Safariでのフォーカス時自動ズームを防止。ビューポート高さは`100svh`（モバイルブラウザのアドレスバー表示/非表示による揺れに強い単位）を使用
- コンポーネント構成:
  - `App.jsx`: 入室フォーム、トークン取得、`LiveKitRoom`への接続
  - `CallScreen.jsx`: アバター切替ボタン（石/草/人）、マイク／画面共有のトグルボタン、チャット表示切り替え、退出ボタン（`useRoomContext().disconnect()`）、テント内2D俯瞰ビュー。非人間アバター選択中は`localParticipant.setMicrophoneEnabled(false)`でマイクを強制ミュートし、マイクボタンを非活性の「🔇 マイク」表示に置き換える
  - `AvatarSprite.jsx`: アバターの見た目を集約したモジュール（SPEC F1。差し替え前提で分離）。石(🪨)・草(🌿)＝非人間（破線枠・話さないシグナル）、人(🧍)＝人型（実線枠・話す可能性あり）。α版の仮素材は絵文字。`AVATAR_TYPES` / `isHumanAvatar` / `DEFAULT_AVATAR`（=石）をエクスポート。種別変更時は`avatar-pop`アニメーションで軽い変化演出
  - `TentState.jsx`: テント内の位置・アバター種別を管理しデータチャネル（`useDataChannel('position', ...)`）で同期する共有ストア（React Context）。TentView（描画）とSpatialAudio（音声）の両方が参照する。座標は床サイズ非依存の0〜1正規化、移動中は約10Hzのロスあり配信＋2秒ごとのハートビート再送（後から入室した人にも状態が伝わるように）。種別も同梱するので石↔人の変化が全員に即反映。**接続完了（`useConnectionState` が `Connected`）まで一切publishしない** — 接続前に`publishData`を呼ぶとLiveKit内部の送信路（`publisherConnectionPromise`）が失敗状態でキャッシュされ、以降チャット含む全データ送信が失敗し続けるため
  - `TentView.jsx`: テント内の2D俯瞰ビュー（SPEC §5.3・Phase 1）。`TentState`を参照して参加者を`AvatarSprite`として床面に配置し、自分のアバターはドラッグで移動できる。発話中は緑のリングで表示
  - `SpatialAudio.jsx`: 空間オーディオ（SPEC F2・本アプリの中核）。`RoomAudioRenderer`の代わりに、各参加者の音声トラックをWeb Audio API（`GainNode`＋`StereoPannerNode`）経由で再生し、`TentState`のアバター間距離で音量、左右位置でステレオパンを制御（近い人ほど明瞭、遠い人はほぼ無音、右にいる人は右から聞こえる）。Chrome向けに無音のaudio要素へも同ストリームを割り当てる定番ワークアラウンドを実施。向きによる強調・遠方トラックの購読停止（帯域節約）は未実装
  - `ChatState.jsx`: チャットのメッセージ配列とデータチャネル購読（`useDataChannel('chat', ...)`、`publishData`方式。LiveKit標準の`useChat`/`sendText`は使わない）を保持する共有ストア（React Context）。`TentStateProvider`と同様、パネルの開閉に関係なく常にマウントされている（`CallScreen`直下）ため、チャットを閉じても履歴が消えず、閉じている間に届いたメッセージも取りこぼさない。`publishData`は自分には配信されないため、自分の送信メッセージは送信時にローカルへ即時追加する
  - `ChatPanel.jsx`: テキストチャットの見た目のみを担当（SPEC F6）。日本語UI（「メッセージを入力…」「送信」等）。`chatOpen`のトグルで表示/非表示にするのはこのコンポーネントの描画だけで、状態は`ChatState`側にあるため開閉しても消えない。石アバターでもチャットは可能（声を出せない段階の参加手段）
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
- CORSは許可オリジンを限定（GitHub Pages本番 `https://yumoto-kyohei.github.io` とローカル開発 `http://localhost:5173` / `http://127.0.0.1:5173`）。環境変数 `ALLOWED_ORIGINS`（カンマ区切り）で上書き可能
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
│       ├── CallScreen.jsx       アバター切替/マイク/画面共有ボタン・テント内ビュー
│       ├── AvatarSprite.jsx     アバターの見た目（石/草/人）・種別判定ヘルパー
│       ├── TentState.jsx        位置/アバター種別の共有ストア・データチャネル同期
│       ├── TentView.jsx         テント内2D俯瞰ビュー・アバター移動
│       ├── SpatialAudio.jsx     空間オーディオ（距離減衰＋ステレオパン）
│       ├── ChatState.jsx        チャットのメッセージ状態・データチャネル同期（常時マウント）
│       ├── ChatPanel.jsx        日本語テキストチャットの見た目
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
- 音声通話（空間オーディオ付き）＋画面共有＋画面への描き込み＋テキストチャット＋テント内2Dビュー（アバター移動・石/草/人の切替）まで実装済み。テーブル分割・複数テント・通り画面は未実装（SPEC Phase 2〜で今後追加）
- 画面共有は同時に1人のみ想定（複数人が同時共有した場合の表示制御は未実装、`ScreenShareStage`は最初の1トラックのみ表示）
- 描き込みの色・太さは固定（ペンは赤、丸は橙、変更UIなし）
- チャットは日本語UI（`ChatPanel.jsx`）。テント（ルーム）単位。テーブル単位チャットは未対応
- チャットのメッセージ履歴は「今そのテントに接続している間」だけ保持される（`ChatState`がその場のReact state。サーバー側には保存しない）。途中入室者やリロード後は、参加より前のメッセージは見えない。サーバー側でのログ保存はSPEC F10（ログ収集基盤）のスコープ
- CORSはオリジン無制限
- 認証・ユーザー管理なし（表示名を自己申告するのみ）
