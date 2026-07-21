import { useRef } from 'react';
import { useParticipants, useSpeakingParticipants } from '@livekit/components-react';
import AvatarSprite, { DEFAULT_AVATAR } from './AvatarSprite';
import { useTentState } from './TentState';

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

export default function TentView() {
  const floorRef = useRef(null);
  const draggingRef = useRef(false);
  const { myPos, updateMyPos, others, avatarType, localIdentity, hopping } = useTentState();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));

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
    updateMyPos(posFromEvent(e), true);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return;
    updateMyPos(posFromEvent(e));
  };

  const handlePointerUp = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    updateMyPos(myPos, true);
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
        background: `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 24px),
          linear-gradient(160deg, var(--floor-a), var(--floor-b))
        `,
        border: '4px solid var(--border)',
        borderRadius: 16,
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.25), 0 3px 0 var(--border)',
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      {participants.map((p) => {
        const isMe = p.identity === localIdentity;
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
            <AvatarSprite type={type} speaking={isSpeaking} hopping={!!hopping[p.identity]} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                whiteSpace: 'nowrap',
              }}
            >
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
