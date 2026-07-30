# third-place

スマートフォンのブラウザで動く、複数人の音声通話＋テキストチャットアプリのプロトタイプ。

## ドキュメントの読み分け

| ファイル | 何が書いてあるか |
|---|---|
| **README.md**（本書） | **今どうなっているか** — 実装の構成、環境変数、ローカル開発、本番運用手順、トラブルシューティング |
| [SPEC.md](SPEC.md) | **何を作るか・なぜ** — 『通りとテント』アプリの全体仕様、設計原則、機能仕様、開発フェーズ計画 |
| `TASK-*.md` | **今着手している作業の実装指示書**。完了したら内容をREADME/SPECへ畳んで削除する（記録はgit履歴に残る）。<br>したがって `TASK-*.md` が存在する＝進行中の作業がある、と読める |

現在の `TASK-*.md`：[TASK-2.5D-boards.md](TASK-2.5D-boards.md) — 2.5D化（Step 0・1）は**完了して本番稼働中**、
空間内に画面共有・掲示板の「ボード」を立てる機能（Step 2以降）が**未着手**

> 事実の重複を避けるため、**現状の一次情報はREADMEに置く**。SPEC・TASKから現状を再掲する場合は、
> 詳細をREADMEへリンクするだけにとどめる（過去に同じ事実が3ファイルに散り、食い違いが発生した）。

## システム構成

```
┌──────────────────────┐        ┌──────────────────────────┐        ┌───────────────────────┐
│  client (React/Vite)  │        │  server (Node/Express)    │        │  LiveKit Cloud (SFU)   │
│  GitHub Pages で配信  │──①──▶│  ai2.haselab.net の Docker │──②──▶│  音声のリレー          │
│                        │        │  （nginx 443 経由で公開） │        │  東京(Japan A)リージョン│
│                        │◀─────③音声/参加者情報──────────────────────┤                        │
└──────────────────────┘        └──────────────────────────┘        └───────────────────────┘
```

- ① クライアントが `GET /api/token?identity=<表示名>` をバックエンド（`https://ai2.haselab.net/third-place/api/token`）に叩き、入室用トークンを取得する
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
- 見た目はRPG風のテーマ（`index.css`のCSS変数）。パーチメント色の背景、木製フレーム風の枠線（ボタン・入力欄・チャットパネル）、テント床は芝生グラデーション＋タイル模様、見出しはセリフ体。ライト/ダーク両方に対応した配色をCSS変数（`--bg`, `--panel-bg`, `--border`, `--accent`, `--floor-a/b`, `--danger`等）で管理しており、色を変えたい場合は`index.css`の`:root`と`@media (prefers-color-scheme: dark)`ブロックだけを触ればよい
- コンポーネント構成:
  - `App.jsx`: 入室フォーム、トークン取得、`LiveKitRoom`への接続
  - `CallScreen.jsx`: アバター切替ボタン（石/草/人）、マイク／画面共有のトグルボタン、チャット表示切り替え、退出ボタン（`useRoomContext().disconnect()`）、テント内2.5Dビュー。非人間アバター選択中は`localParticipant.setMicrophoneEnabled(false)`でマイクを強制ミュートし、マイクボタンを非活性の「🔇 マイク」表示に置き換える
  - `AvatarSprite.jsx`: アバターの見た目を集約したモジュール（SPEC F1。差し替え前提で分離）。石(🪨)・草(🌿)＝非人間（破線枠・話さないシグナル）、人(🧍)＝人型（実線枠・話す可能性あり）。α版の仮素材は絵文字。`AVATAR_TYPES` / `isHumanAvatar` / `DEFAULT_AVATAR`（=石）をエクスポート。種別変更時は`avatar-pop`アニメーションで軽い変化演出
  - `TentState.jsx`: テント内の位置・アバター種別を管理しデータチャネル（`useDataChannel('position', ...)`）で**他参加者への同期**を担う共有ストア（React Context）。SpatialAudioや、他参加者の描画（TentView）が参照する。座標は床サイズ非依存の0〜1正規化、移動中は約10Hzのロスあり配信＋2秒ごとのハートビート再送（後から入室した人にも状態が伝わるように）。種別も同梱するので石↔人の変化が全員に即反映。**接続完了（`useConnectionState` が `Connected`）まで一切publishしない** — 接続前に`publishData`を呼ぶとLiveKit内部の送信路（`publisherConnectionPromise`）が失敗状態でキャッシュされ、以降チャット含む全データ送信が失敗し続けるため
    - **自分の見た目の移動そのものはここでは扱わない**（TentView側のref＋`useFrame`で行う。理由は下記TentViewの注記を参照）。`updateMyPos(pos, force)`はTentViewから間引いて呼ばれる「同期のトリガー」としてのみ機能する
    - **WASDキー移動**: `window`の`keydown`/`keyup`を購読し、`requestAnimationFrame`で連続移動（速度0.5正規化単位/秒）。チャット等の入力欄にフォーカスがある間は無効化（`document.activeElement`がinput/textarea/contentEditableかで判定）。キーを離した瞬間に確定位置をreliableで再送する
    - **ホップ演出**: `hopping: { [identity]: boolean }` を保持し、位置が実際に変化した参加者を350msだけ`true`にする（ハートビートによる同一座標の再送では反応しないよう差分をチェック）。ローカルはWASD/ドラッグどちらでも、リモートは受信した座標が前回と異なる場合に発火する
  - `TentView.jsx`: テント内の**2.5Dビュー**（SPEC §5.3・Phase 1）。`react-three-fiber`（Three.js）で、床だけ3D・アバターはカメラに正対する2Dビルボード（`@react-three/drei`の`Billboard`）という軽量な構成（教授案・Gemini議論で想定されていた「高ポリゴン3Dを避ける」方針を踏襲）。カメラは自分のアバターを斜め上から追従（`CameraRig`）
    - アバター本体（絵文字）は検証用モックアップと同じく**枠や背景を付けない**素の絵文字テクスチャ（Canvas 2D APIで描画）。SPEC F1の「人型=話す可能性あり／非人間=話さない」の区別や発話中グローは、絵文字ではなく**足元の「立ち位置マーカー」**（柔らかい接地影＋金の実線リング(人型)／グレーの破線リング(非人間)＋発話中は緑のグローリング、を焼き込んだ1枚のテクスチャ）で表現する。最初はこの区別を絵文字自体に円形フレームとして焼き込んでいたが、検証用モックアップ（素の絵文字のみ）と見比べて「アイコンに枠がついて異物感がある」ということで、区別のシグナルを足元側に移した
    - ホップは`useFrame`内でY座標をサイン波で動かして表現
    - **自分の移動は React state を経由せず、`useRef`＋`useFrame`だけで完結させている**（`LocalMover`コンポーネント）。位置の実体は`worldRef`（ただのMutableな`THREE.Vector3`）で、`Avatar3D`は毎フレームその値を直接読んで自分の位置に反映する。react-three-fiberの描画ループの外（Reactのstate更新＝再レンダー）で位置を動かすと、Three.jsの描画タイミングとズレてガクガクして見えることが分かったための設計（検証用モックアップの`Player`コンポーネントと同じ方式）
    - **移動方式は「目標地点へ一定ペースで歩く」**（検証用モックアップと同じ）。床をタップ/ドラッグすると`targetRef`にその地点がセットされるだけで、実際の移動は`LocalMover`が毎フレーム`MOVE_SPEED`（ワールド単位/秒）で`targetRef`に向けて`worldRef`を近づけていく。**その場に瞬間移動（テレポート）はさせない** — 最初はタップ/ドラッグした座標へ即座にワープする実装にしていたが、遠くをタップすると一気に画面が動いて酔いやすいという指摘を受けて、モックアップと同じ定速移動に変更した。WASDキー入力があれば`targetRef`はキャンセルされ、キー入力側の移動が優先される
    - **他参加者への同期（ネットワーク送信）は、見た目の滑らかさとは別に間引いて行う**：`LocalMover`が`worldRef`を毎フレーム動かしつつ、約100ms間隔（動き始め・止まった瞬間は確実に届くreliableで、移動中はロスありで）で`TentState.updateMyPos`を呼ぶ。これにより「自分の描画は60fpsで滑らか、ネットワーク送信は10Hzで十分」を両立している
    - 他の参加者（`others`。ネットワーク経由・10Hz程度でしか更新されない）の位置は`THREE.MathUtils.damp`でなめらかに補間（従来のCSS transitionに相当）。ホップの発火条件（実際に位置が変わったときだけ）などは引き続き`TentState.jsx`が管理
    - 検証用の別ページ（`client/src/mockup/`、`mockup.html`）で「2.5D化するとメタバース感が出るか」を先に試作し、良好だったためこの本実装に反映した。開発サーバー(`npm run dev`)でr3f由来の`Invalid hook call`が出ていた問題は、`vite.config.js`の`optimizeDeps.entries`に両エントリを指定することで解消済み
  - `SpatialAudio.jsx`: 空間オーディオ（SPEC F2・本アプリの中核）。`RoomAudioRenderer`の代わりに、各参加者の音声トラックをWeb Audio API（`GainNode`＋`StereoPannerNode`）経由で再生し、`TentState`のアバター間距離で音量、左右位置でステレオパンを制御（近い人ほど明瞭、遠い人はほぼ無音、右にいる人は右から聞こえる）。Chrome向けに無音のaudio要素へも同ストリームを割り当てる定番ワークアラウンドを実施。向きによる強調・遠方トラックの購読停止（帯域節約）は未実装
  - `ChatState.jsx`: チャットのメッセージ配列とデータチャネル購読（`useDataChannel('chat', ...)`、`publishData`方式。LiveKit標準の`useChat`/`sendText`は使わない）を保持する共有ストア（React Context）。`TentStateProvider`と同様、パネルの開閉に関係なく常にマウントされている（`CallScreen`直下）ため、チャットを閉じても履歴が消えず、閉じている間に届いたメッセージも取りこぼさない。`publishData`は自分には配信されないため、自分の送信メッセージは送信時にローカルへ即時追加する
  - `ChatPanel.jsx`: テキストチャットの見た目のみを担当（SPEC F6）。日本語UI（「メッセージを入力…」「送信」等）。`chatOpen`のトグルで表示/非表示にするのはこのコンポーネントの描画だけで、状態は`ChatState`側にあるため開閉しても消えない。石アバターでもチャットは可能（声を出せない段階の参加手段）
  - `ScreenShareStage.jsx`: 画面共有中の映像（`useTracks([Track.Source.ScreenShare])`で検出）と、その上に重ねる描き込みオーバーレイの表示
  - `DrawingOverlay.jsx`: 画面共有映像の上に重ねる`<canvas>`。ペン（フリーハンド）／丸で囲む（楕円）／消しゴムの3ツールを提供し、LiveKitの**データチャネル**（`useDataChannel('draw', ...)`、`localParticipant`経由でP2PではなくSFU経由の低遅延メッセージング）でストローク情報を全参加者にブロードキャストし、誰の画面でも同じ描き込みが同期表示される
    - ツールは明示的に選択するまで無効（初期状態は`tool = null`で`<canvas>`は`pointerEvents: 'none'`）。ツールボタンはトグル式で、選択中のツールボタンをもう一度押すと解除される
    - 座標はキャンバスサイズに依存しないよう0〜1に正規化して送受信
    - 消しゴムは「ストローク単位」で消える方式（線や丸に触れると、その線・丸ごと削除）であり、部分消しではない
    - ペンの描画中の点（`pen-move`）はロスあり配信（`reliable:false`）、開始・終了・丸・消去・全消去はロスなし配信（`reliable:true`）

### バックエンド（`server/`）

- Node.js（ESM） + Express
- `livekit-server-sdk`: `AccessToken` を使ってJWTを発行するだけの薄いAPI（`server/index.js`）
- エンドポイントは2つ。`GET /api/token`（クエリパラメータ `identity`（表示名）を受け取り、`{ url, token }` をJSONで返す）と `GET /api/healthz`（`{ ok: true }` を返すだけの死活監視用）
  - `healthz` を `/api` の外ではなく**内側**に置いているのは、nginxが `/third-place/api/` だけをリバースプロキシしているため（`/healthz` では外部から到達できない）
- 発行するトークンの権限（grant）: `roomJoin: true, canPublish: true, canSubscribe: true`（ルームは `lobby`固定）
- CORSは許可オリジンを限定（GitHub Pages本番 `https://yumoto-kyohei.github.io` とローカル開発 `http://localhost:5173` / `http://127.0.0.1:5173`）。環境変数 `ALLOWED_ORIGINS`（カンマ区切り）で上書き可能
- 待ち受けポートは `process.env.PORT`、なければ `3001`。Docker上ではコンテナ内3001を `127.0.0.1:18080` にバインドしている（`docker-compose.yml`）

### インフラ・ホスティング

| コンポーネント | ホスティング先 | デプロイ方法 |
|---|---|---|
| フロントエンド（静的ビルド成果物） | GitHub Pages（`https://yumoto-kyohei.github.io/third-place/`） | `main`ブランチへのpush時に GitHub Actions（`.github/workflows/deploy-client.yml`）が `client/` をビルドし自動公開 |
| バックエンド（Node.jsプロセス） | **研究室サーバー `ai2.haselab.net` 上の Docker**（公開URL: `https://ai2.haselab.net/third-place/api/`） | サーバー上の `~/third-place` で `git pull && docker compose up -d --build`（**手動**。自動デプロイではない） |
| SFU / 音声リレー | LiveKit Cloud（無料 Build プラン） | 東京(Japan A)リージョンのプロジェクトを使用 |

**バックエンドの公開構成**：Nodeプロセスは外部に直接公開せず `127.0.0.1:18080` だけで待ち受け、
サーバー上で既に稼働している nginx（443/HTTPS、Let's Encrypt証明書）に `location /third-place/api/` を
追加してリバースプロキシしている。`restart: unless-stopped` によりサーバー再起動時も自動復帰する。
運用手順とトラブルシューティングは「本番バックエンドの運用」の節を参照。

> **ホスト名の注意**：`ai2.binaural.me` も同一ホストだが、TLS証明書のSANが `ai2.haselab.net` のみのため
> `ai2.binaural.me` ではHTTPSが通らない。**必ず `ai2.haselab.net` を使うこと。**

**2026-07-28以前は Render 無料プラン（`https://third-place.onrender.com`）で稼働していた。**
無料プランは一定時間アクセスがないとスリープし、次回アクセス時の起動に数十秒かかるため、
初回アクセスが遅いという問題があった。これを解消するために研究室サーバーへ移行した。
Renderのサービスは切り戻し用に当面残してあり（`main`を監視して自動デプロイされ続ける）、
`client/.env.production` の `VITE_TOKEN_SERVER_URL` を Render のURLに戻せば即座にロールバックできる。

## ディレクトリ構成

```
third-place/
├── client/           React(Vite)フロントエンド。GitHub Pagesへデプロイ
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
│       └── mockup/             ★2.5D検証用モックアップ（本番アプリとは完全独立）
│           ├── main.jsx        モックアップのReactエントリ
│           └── Mockup.jsx      Three.js(react-three-fiber)による2.5Dパース＋ビルボード
├── mockup.html       モックアップのHTMLエントリ（本番= index.html とは別）
│   client/.env.production   本番ビルド時のトークンAPIのベースURL（公開URLなのでコミット済み）
├── server/           Express バックエンド。ai2上のDockerで稼働
│   ├── index.js      トークン発行API（/api/token）と死活監視（/api/healthz）
│   └── Dockerfile    バックエンドのコンテナイメージ定義
├── docker-compose.yml  バックエンドの起動設定（127.0.0.1:18080で待ち受け・自動再起動）
├── .github/workflows/deploy-client.yml   client を GitHub Pages に自動デプロイするワークフロー
├── .env              LiveKitの接続情報（Git管理外。ローカル開発時とサーバー稼働時にserverが読む）
└── .env.example      .envに必要な変数のテンプレート
```

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

> **変数名の打ち間違いに注意**：`LIVEKIT_URL` が正しく渡っていないと、`/api/token` のレスポンスから
> `url` が欠落し、**「入室はできるが他の参加者が誰も見えない」**という分かりにくい症状になる
> （ブラウザのコンソールに `no livekit url provided`）。実際にこれで一度ハマっている。
> `docker compose exec third-place-server env | grep LIVEKIT` でコンテナが見ている変数名を確認できる。
> なお `.env` を変更したときは `docker compose restart` では反映されず、
> `docker compose up -d --force-recreate` が必要。

### フロントエンド（`client/`）

| 変数名 | 内容 |
|---|---|
| `VITE_TOKEN_SERVER_URL` | トークンAPIのベースURL（**末尾の `/api` まで含む**）。未設定時は `http://localhost:3001/api` |

本番の値は `client/.env.production` に記述してコミットしている（公開URLであり秘密情報ではない）。
ビルド時に埋め込まれるため、**接続先を変えるにはこのファイルを変更して再デプロイする**必要がある。

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

nginx設定（`location /third-place/api/`）は `/etc/nginx/sites-available/gdrive-oauth-callback` の
443番サーバーブロック内にある（ファイル名に反して、`ai2.haselab.net`宛の443番サーバーブロック全体が
ここに書かれている。gdrive専用ファイルではない）。このファイルはgdrive・aigw・sandboxプロキシも
定義しているため、編集したら**必ず `sudo nginx -t` で構文チェックしてから**
`sudo systemctl reload nginx` すること。

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

## 2.5D 検証モックアップ（採用済み・参考として残置）

「平面の見下ろし」から「斜め見下ろし（2.5Dパース）＋ビルボードアバター」に変えると“場所らしさ／メタバース感”が出るかを、本番に影響を与えずに試すために作った実験ページ。**検証の結果が良好だったため、本番の`TentView.jsx`に同じ方式（react-three-fiber＋ビルボード）を採用した**（上記コンポーネント構成を参照）。ページ自体は今後の見た目実験用に残してある。

- URL: `https://yumoto-kyohei.github.io/third-place/mockup.html`（本番は `/third-place/`。別エントリなので本番のコード・動作には一切影響しない）
- 技術: `three` + `@react-three/fiber` + `@react-three/drei`（教授のGemini議論で想定されていた「床だけ3D・アバターは2Dスプライトのビルボード」構成）。本番`TentView.jsx`も同じ依存を使うため、Three.js関連コードは`main-*.js`と`mockup-*.js`の両方から参照される共有チャンク（`Billboard-*.js`等）としてビルドされ、二重に含まれることはない
- 中身: 芝生の床＋斜めからの追従カメラ、自分＋ダミー3体のビルボードアバター、WASD/タップ・ドラッグ移動＋ホップ。**LiveKit・音声・同期は無し**（見た目と操作感だけを試すもの）
- 以前は`npm run dev`（Vite開発サーバー）でr3f由来の`Invalid hook call`が出ていたが、`vite.config.js`の`optimizeDeps.entries: ['index.html', 'mockup.html']`で解消済み。原因は、Viteの依存事前バンドルが`index.html`からのみクロールされ、`mockup.html`に直接アクセスすると依存関係が段階的にしか見つからず、再最適化→リロードを繰り返す過程でエラーになっていたため。両エントリを明示することで初回起動時に一括でスキャンされるようになった

## 現状の制約・今後の予定

- ルームは `lobby` 1つのみ固定（複数ルーム・部屋作成機能は未実装）
- 音声通話（空間オーディオ付き）＋画面共有＋画面への描き込み＋テキストチャット＋テント内2.5Dビュー（アバター移動・石/草/人の切替）まで実装済み。テーブル分割・複数テント・通り画面は未実装（SPEC Phase 2〜で今後追加）。ボード機能（2.5D空間内に画面共有/掲示板を立てる）は [TASK-2.5D-boards.md](TASK-2.5D-boards.md) のStep 2以降に計画あり・未着手
- 画面共有は同時に1人のみ想定（複数人が同時共有した場合の表示制御は未実装、`ScreenShareStage`は最初の1トラックのみ表示）
- 描き込みの色・太さは固定（ペンは赤、丸は橙、変更UIなし）
- チャットは日本語UI（`ChatPanel.jsx`）。テント（ルーム）単位。テーブル単位チャットは未対応
- チャットのメッセージ履歴は「今そのテントに接続している間」だけ保持される（`ChatState`がその場のReact state。サーバー側には保存しない）。途中入室者やリロード後は、参加より前のメッセージは見えない。サーバー側でのログ保存はSPEC F10（ログ収集基盤）のスコープ
- 認証・ユーザー管理なし（表示名を自己申告するのみ）。CORSはオリジンを限定しているが、
  トークン発行APIそのものは認証なしで公開されている（URLを知っていれば誰でもトークンを取得でき、`lobby`に入室できる）
- バックエンド移行（2026-07-28）の積み残し：
  - Renderのサービス停止（切り戻し用に残置中。数日〜1週間問題なければ停止する）
  - ai2の`/usr/local/share/doc/CHANGELOG.md`へのnginx変更の記録（サーバー運用ルールで求められているもの）
  - スリープ解消の実測比較（原理的には解消済みだが計測していない）
  - 移行後の画面共有・描き込み・2.5D移動の個別動作確認（入室と相互表示は確認済み）
