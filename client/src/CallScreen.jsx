import { useState } from 'react';
import {
  Chat,
  RoomAudioRenderer,
  TrackToggle,
  useParticipants,
  useRoomContext,
  useSpeakingParticipants,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import ScreenShareStage from './ScreenShareStage';

function ParticipantList() {
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));

  return (
    <ul style={{ padding: '1rem' }}>
      {participants.map((p) => (
        <li key={p.identity} style={{ fontWeight: speakingIds.has(p.identity) ? 'bold' : 'normal' }}>
          {speakingIds.has(p.identity) ? '🔊 ' : ''}
          {p.identity}
        </li>
      ))}
    </ul>
  );
}

export default function CallScreen() {
  const room = useRoomContext();
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '1rem' }}>
        <TrackToggle source={Track.Source.Microphone} />
        <TrackToggle source={Track.Source.ScreenShare} />
        <button type="button" onClick={() => setChatOpen((open) => !open)} style={{ fontWeight: chatOpen ? 'bold' : 'normal' }}>
          💬 チャット
        </button>
        <button type="button" onClick={() => room.disconnect()}>
          退出する
        </button>
      </div>
      <ScreenShareStage />
      <ParticipantList />
      {chatOpen && <Chat style={{ height: 320 }} />}
      <RoomAudioRenderer />
    </div>
  );
}
