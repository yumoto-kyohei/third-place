import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useConnectionState, useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

// テント内の位置・アバター状態を管理し、データチャネルで同期する共有ストア。
// 2D俯瞰ビュー（TentView）と空間オーディオ（SpatialAudio）の両方から参照する。

const SEND_INTERVAL_MS = 100; // 位置更新の送信間隔（約10Hz）
const HEARTBEAT_MS = 2000; // 後から入室した人にも状態が伝わるよう定期再送する間隔
const HOP_LINGER_MS = 350; // 最後に位置が変わってからホップ演出を続ける時間
const MOVE_EPSILON = 0.001; // これ未満の差分は「動いていない」とみなす（ハートビートの誤検知防止）
const WASD_SPEED = 0.5; // 正規化座標/秒

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

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function isTypingTarget() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
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
  const othersLastPosRef = useRef({});

  // 石・草・人型が「歩く」のは不自然なため、移動中は歩行の代わりにぴょんぴょん飛ぶ演出にする。
  // { identity: boolean }。実際に位置が変わったときだけ短時間trueにする。
  const [hopping, setHopping] = useState({});
  const hopTimersRef = useRef({});

  const markHopping = (identity) => {
    setHopping((prev) => (prev[identity] ? prev : { ...prev, [identity]: true }));
    clearTimeout(hopTimersRef.current[identity]);
    hopTimersRef.current[identity] = setTimeout(() => {
      setHopping((prev) => ({ ...prev, [identity]: false }));
    }, HOP_LINGER_MS);
  };

  useEffect(() => {
    const timers = hopTimersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const lastSentRef = useRef(0);

  // 接続完了前に publishData を呼ぶと LiveKit 内部の送信路が壊れ、以降の全送信（チャット含む）が
  // 失敗し続けるため、必ず Connected になってから送信する。
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const { send } = useDataChannel('position', (msg) => {
    const from = msg.from?.identity;
    if (!from || from === localParticipant.identity) return;
    const { x, y, type } = decode(msg.payload);
    const last = othersLastPosRef.current[from];
    if (!last || Math.hypot(x - last.x, y - last.y) > MOVE_EPSILON) {
      markHopping(from);
    }
    othersLastPosRef.current[from] = { x, y };
    setOthers((prev) => ({ ...prev, [from]: { x, y, type } }));
  });

  const publish = (pos, force = false) => {
    if (!connectedRef.current) return; // 接続完了までは送らない
    const now = Date.now();
    if (!force && now - lastSentRef.current < SEND_INTERVAL_MS) return;
    lastSentRef.current = now;
    // 強制送信（入室直後・ハートビート・アバター変更・ドラッグ開始/終了）はreliable、移動中の連続送信はロスあり
    send(encode({ ...pos, type: myTypeRef.current }), { reliable: force });
  };

  const updateMyPos = (pos, force = false) => {
    myPosRef.current = pos;
    setMyPos(pos);
    markHopping(localParticipant.identity);
    publish(pos, force);
  };

  // 定期的に自分の状態を再送
  useEffect(() => {
    const id = setInterval(() => publish(myPosRef.current, true), HEARTBEAT_MS);
    return () => clearInterval(id);
  }, []);

  // 接続完了時に一度通知（後から入室した人にも状態が伝わるように）
  useEffect(() => {
    if (connected) publish(myPosRef.current, true);
  }, [connected]);

  // アバター種別が変わったら即座に通知
  useEffect(() => {
    publish(myPosRef.current, true);
  }, [avatarType]);

  // WASDキーでの移動。チャット等への入力中は無効化する。
  useEffect(() => {
    const keys = new Set();
    let rafId = null;
    let lastTime = null;

    const step = (time) => {
      if (lastTime == null) lastTime = time;
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      let dx = 0;
      let dy = 0;
      if (keys.has('a')) dx -= 1;
      if (keys.has('d')) dx += 1;
      if (keys.has('w')) dy -= 1;
      if (keys.has('s')) dy += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy) || 1;
        const next = {
          x: clamp01(myPosRef.current.x + (dx / len) * WASD_SPEED * dt),
          y: clamp01(myPosRef.current.y + (dy / len) * WASD_SPEED * dt),
        };
        updateMyPos(next);
      }
      rafId = requestAnimationFrame(step);
    };

    const handleKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(k) || isTypingTarget()) return;
      if (!keys.has(k)) {
        keys.add(k);
        if (rafId == null) {
          lastTime = null;
          rafId = requestAnimationFrame(step);
        }
      }
    };

    const handleKeyUp = (e) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (keys.size === 0 && rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        updateMyPos(myPosRef.current, true); // 停止時に確実に同期
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    myPos,
    updateMyPos,
    others,
    avatarType,
    localIdentity: localParticipant.identity,
    hopping,
  };

  return <TentStateContext.Provider value={value}>{children}</TentStateContext.Provider>;
}
