import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
const ROOM_NAME = 'lobby';
const PORT = process.env.PORT || 3001;

// 許可するオリジン（本番のGitHub Pagesとローカル開発）。
// 追加が必要なら環境変数 ALLOWED_ORIGINS（カンマ区切り）で上書きできる。
const DEFAULT_ORIGINS = [
  'https://yumoto-kyohei.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : DEFAULT_ORIGINS;

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // originなし（curl等の同一オリジン外リクエスト）は許可、リストにあれば許可
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin not allowed: ${origin}`));
      }
    },
  }),
);

app.get('/api/token', async (req, res) => {
  const identity = req.query.identity;
  if (!identity) {
    res.status(400).json({ error: 'identity query param is required' });
    return;
  }

  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity });
  token.addGrant({ room: ROOM_NAME, roomJoin: true, canPublish: true, canSubscribe: true });

  res.json({ url: LIVEKIT_URL, token: await token.toJwt() });
});

app.listen(PORT, () => {
  console.log(`token server listening on http://localhost:${PORT}`);
});
