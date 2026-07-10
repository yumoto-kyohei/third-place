import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import DrawingOverlay from './DrawingOverlay';

export default function ScreenShareStage() {
  const tracks = useTracks([Track.Source.ScreenShare]);
  const shareTrack = tracks[0];

  if (!shareTrack) return null;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 960,
        margin: '1rem auto',
        aspectRatio: '16 / 9',
        background: '#000',
      }}
    >
      <VideoTrack trackRef={shareTrack} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      <DrawingOverlay />
    </div>
  );
}
