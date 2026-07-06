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
const PORT = 3001;

const app = express();
app.use(cors());

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
