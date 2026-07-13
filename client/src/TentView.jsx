import { useEffect, useRef, useState } from 'react';
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
} from '@livekit/components-react';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';

const SEND_INTERVAL_MS = 100; // 位置更新の送信間隔（約10Hz）
const HEARTBEAT_MS = 2000; // 後から入室した人にも位置・アバターが伝わるよう定期再送する間隔

function encode(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decode(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

// 0〜1の範囲に収める
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export default function TentView({ avatarType }) {
  const floorRef = useRef(null);
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));

  // 自分の初期位置（マウント時に一度だけ、少しばらけさせる）
  const initialPos = useRef({ x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 });
  const [myPos, setMyPos] = useState(initialPos.current);
  const myPosRef = useRef(myPos);
  myPosRef.current = myPos;

  // 自分のアバター種別（親から受け取り、送信時に同梱する）
  const myTypeRef = useRef(avatarType);
  myTypeRef.current = avatarType;

  // 他の参加者の状態 { identity: {x, y, type} }
  const [others, setOthers] = useState({});

  const lastSentRef = useRef(0);
  const draggingRef = useRef(false);

  const { send } = useDataChannel('position', (msg) => {
    const from = msg.from?.identity;
    if (!from || from === localParticipant.identity) return;
    const { x, y, type } = decode(msg.payload);
    setOthers((prev) => ({ ...prev, [from]: { x, y, type } }));
  });

  const sendState = (pos, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentRef.current < SEND_INTERVAL_MS) return;
    lastSentRef.current = now;
    // 強制送信（入室直後・ハートビート・アバター変更）は確実に届くreliable、移動中の連続送信はロスあり
    send(encode({ ...pos, type: myTypeRef.current }), { reliable: force });
  };

  // 定期的に自分の状態を再送（後から入室した人向け）
  useEffect(() => {
    const id = setInterval(() => sendState(myPosRef.current, true), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // 入室直後に一度自分の状態を通知
  useEffect(() => {
    sendState(myPosRef.current, true);
  }, []);

  // アバター種別が変わったら即座に周囲へ通知
  useEffect(() => {
    sendState(myPosRef.current, true);
  }, [avatarType]);

  const posFromEvent = (e) => {
    const rect = floorRef.current.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  };

  const handlePointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    const pos = posFromEvent(e);
    setMyPos(pos);
    sendState(pos, true);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return;
    const pos = posFromEvent(e);
    setMyPos(pos);
    sendState(pos);
  };

  const handlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    sendState(myPosRef.current, true);
  };

  return (
    <div
      ref={floorRef}
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 600,
        margin: '0.5rem auto',
        aspectRatio: '4 / 3',
        background: 'var(--floor, #f0eef5)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      {participants.map((p) => {
        const isMe = p.identity === localParticipant.identity;
        const state = isMe ? myPos : others[p.identity];
        const pos = state || { x: 0.5, y: 0.5 };
        const type = isMe ? avatarType : state?.type || DEFAULT_AVATAR;
        const isSpeaking = speakingIds.has(p.identity);
        return (
          <div
            key={p.identity}
            onPointerDown={isMe ? handlePointerDown : undefined}
            onPointerMove={isMe ? handlePointerMove : undefined}
            onPointerUp={isMe ? handlePointerUp : undefined}
            style={{
              position: 'absolute',
              left: `${pos.x * 100}%`,
              top: `${pos.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              cursor: isMe ? 'grab' : 'default',
              touchAction: 'none',
              userSelect: 'none',
              transition: isMe ? 'none' : 'left 0.1s linear, top 0.1s linear',
            }}
          >
            <AvatarSprite type={type} speaking={isSpeaking} />
            <span style={{ fontSize: 12, color: 'var(--text-h)', whiteSpace: 'nowrap' }}>
              {isSpeaking ? '🔊 ' : ''}
              {p.identity}
              {isMe ? '（あなた）' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}
