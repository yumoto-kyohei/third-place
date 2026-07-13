import { useState } from 'react';
import {
  Chat,
  RoomAudioRenderer,
  TrackToggle,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import ScreenShareStage from './ScreenShareStage';
import TentView from './TentView';

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
      <TentView />
      {chatOpen && <Chat style={{ height: 320 }} />}
      <RoomAudioRenderer />
    </div>
  );
}
