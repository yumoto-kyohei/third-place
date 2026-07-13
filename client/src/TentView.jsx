import { useEffect, useRef, useState } from 'react';
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useSpeakingParticipants,
} from '@livekit/components-react';

const SEND_INTERVAL_MS = 100; // 位置更新の送信間隔（約10Hz）
const HEARTBEAT_MS = 2000; // 後から入室した人にも位置が伝わるよう定期再送する間隔

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

export default function TentView() {
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

  // 他の参加者の位置 { identity: {x, y} }
  const [othersPos, setOthersPos] = useState({});

  const lastSentRef = useRef(0);
  const draggingRef = useRef(false);

  const { send } = useDataChannel('position', (msg) => {
    const from = msg.from?.identity;
    if (!from || from === localParticipant.identity) return;
    const { x, y } = decode(msg.payload);
    setOthersPos((prev) => ({ ...prev, [from]: { x, y } }));
  });

  const sendPosition = (pos, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentRef.current < SEND_INTERVAL_MS) return;
    lastSentRef.current = now;
    send(encode(pos), { reliable: false });
  };

  // 定期的に自分の位置を再送（後から入室した人向け）
  useEffect(() => {
    const id = setInterval(() => sendPosition(myPosRef.current, true), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // 入室直後に一度自分の位置を通知
  useEffect(() => {
    sendPosition(myPosRef.current, true);
  }, []);

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
    sendPosition(pos, true);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return;
    const pos = posFromEvent(e);
    setMyPos(pos);
    sendPosition(pos);
  };

  const handlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    sendPosition(myPosRef.current, true);
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
        const pos = isMe ? myPos : othersPos[p.identity] || { x: 0.5, y: 0.5 };
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
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: isMe ? 'var(--accent, #aa3bff)' : '#9aa0aa',
                boxShadow: isSpeaking ? '0 0 0 4px rgba(52, 199, 89, 0.6)' : 'none',
              }}
            />
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
