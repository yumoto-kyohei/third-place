import { useEffect, useState } from 'react';
import {
  TrackToggle,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import ScreenShareStage from './ScreenShareStage';
import TentView from './TentView';
import SpatialAudio from './SpatialAudio';
import ChatPanel from './ChatPanel';
import { TentStateProvider } from './TentState';
import { AVATAR_TYPES, DEFAULT_AVATAR, isHumanAvatar } from './AvatarSprite';

export default function CallScreen() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [chatOpen, setChatOpen] = useState(false);
  const [avatarType, setAvatarType] = useState(DEFAULT_AVATAR);

  const human = isHumanAvatar(avatarType);

  // 非人間アバター（石・草）のときはマイクを強制ミュート（SPEC F1）
  useEffect(() => {
    if (!human) {
      localParticipant.setMicrophoneEnabled(false);
    }
  }, [human, localParticipant]);

  return (
    <TentStateProvider avatarType={avatarType}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {AVATAR_TYPES.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAvatarType(a.key)}
              style={{ fontWeight: avatarType === a.key ? 'bold' : 'normal' }}
            >
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
        {human ? (
          <TrackToggle source={Track.Source.Microphone} />
        ) : (
          <button type="button" disabled title="「人」になると話せます">
            🔇 マイク
          </button>
        )}
        <TrackToggle source={Track.Source.ScreenShare} />
        <button type="button" onClick={() => setChatOpen((open) => !open)} style={{ fontWeight: chatOpen ? 'bold' : 'normal' }}>
          💬 チャット
        </button>
        <button type="button" onClick={() => room.disconnect()}>
          退出する
        </button>
      </div>
      {!human && (
        <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 1rem' }}>
          いまは「{avatarType === 'grass' ? '草' : '石'}」の姿です。声は出さず、ただそこに居られます。話したくなったら「人」を選んでください。
        </p>
      )}
      <ScreenShareStage />
      <TentView />
      {chatOpen && <ChatPanel />}
      <SpatialAudio />
    </TentStateProvider>
  );
}
