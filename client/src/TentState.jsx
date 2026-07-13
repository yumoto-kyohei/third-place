import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';

// テント内の位置・アバター状態を管理し、データチャネルで同期する共有ストア。
// 2D俯瞰ビュー（TentView）と空間オーディオ（SpatialAudio）の両方から参照する。

const SEND_INTERVAL_MS = 100; // 位置更新の送信間隔（約10Hz）
const HEARTBEAT_MS = 2000; // 後から入室した人にも状態が伝わるよう定期再送する間隔

const TentStateContext = createContext(null);

export function useTentState() {
  return useContext(TentStateContext);
}

function encode(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decode(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

export function TentStateProvider({ avatarType, children }) {
  const { localParticipant } = useLocalParticipant();

  const initialPos = useRef({ x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 });
  const [myPos, setMyPos] = useState(initialPos.current);
  const myPosRef = useRef(myPos);
  myPosRef.current = myPos;

  const myTypeRef = useRef(avatarType);
  myTypeRef.current = avatarType;

  // 他の参加者の状態 { identity: {x, y, type} }
  const [others, setOthers] = useState({});

  const lastSentRef = useRef(0);

  const { send } = useDataChannel('position', (msg) => {
    const from = msg.from?.identity;
    if (!from || from === localParticipant.identity) return;
    const { x, y, type } = decode(msg.payload);
    setOthers((prev) => ({ ...prev, [from]: { x, y, type } }));
  });

  const publish = (pos, force = false) => {
    const now = Date.now();
    if (!force && now - lastSentRef.current < SEND_INTERVAL_MS) return;
    lastSentRef.current = now;
    // 強制送信（入室直後・ハートビート・アバター変更・ドラッグ開始/終了）はreliable、移動中の連続送信はロスあり
    send(encode({ ...pos, type: myTypeRef.current }), { reliable: force });
  };

  const updateMyPos = (pos, force = false) => {
    myPosRef.current = pos;
    setMyPos(pos);
    publish(pos, force);
  };

  // 定期的に自分の状態を再送
  useEffect(() => {
    const id = setInterval(() => publish(myPosRef.current, true), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // 入室直後に一度通知
  useEffect(() => {
    publish(myPosRef.current, true);
  }, []);

  // アバター種別が変わったら即座に通知
  useEffect(() => {
    publish(myPosRef.current, true);
  }, [avatarType]);

  const value = {
    myPos,
    updateMyPos,
    others,
    avatarType,
    localIdentity: localParticipant.identity,
  };

  return <TentStateContext.Provider value={value}>{children}</TentStateContext.Provider>;
}
