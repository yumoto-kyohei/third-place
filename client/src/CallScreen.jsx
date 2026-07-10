import { RoomAudioRenderer, TrackToggle, useParticipants, useSpeakingParticipants } from '@livekit/components-react';
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
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem' }}>
        <TrackToggle source={Track.Source.Microphone} />
        <TrackToggle source={Track.Source.ScreenShare} />
      </div>
      <ScreenShareStage />
      <ParticipantList />
      <RoomAudioRenderer />
    </div>
  );
}
