import { useEffect, useRef } from 'react';
import { useLocalParticipant, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useTentState } from './TentState';

// 空間オーディオ（SPEC F2）: 各参加者の音声トラックを Web Audio API 経由で再生し、
// アバター間の距離で音量、左右位置でステレオパンを制御する。RoomAudioRenderer の代わり。

const NEAR = 0.12; // これより近ければ最大音量
const FAR = 0.6; // これより遠ければほぼ無音
const PAN_RANGE = 0.4; // 左右にこの正規化距離離れるとフルパン

function computeAudio(me, other) {
  const dx = other.x - me.x;
  const dy = other.y - me.y;
  const dist = Math.hypot(dx, dy);
  let gain;
  if (dist <= NEAR) gain = 1;
  else if (dist >= FAR) gain = 0;
  else gain = 1 - (dist - NEAR) / (FAR - NEAR);
  const pan = Math.max(-1, Math.min(1, dx / PAN_RANGE));
  return { gain, pan };
}

// 単一のリモート音声トラックを Web Audio グラフに接続し、gain/pan を更新する
function SpatialTrack({ mediaStreamTrack, gain, pan, audioCtx }) {
  const gainRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    if (!mediaStreamTrack) return undefined;
    const stream = new MediaStream([mediaStreamTrack]);
    const source = audioCtx.createMediaStreamSource(stream);
    const gainNode = audioCtx.createGain();
    const panNode = audioCtx.createStereoPanner();
    source.connect(gainNode).connect(panNode).connect(audioCtx.destination);
    gainRef.current = gainNode;
    panRef.current = panNode;

    // Chrome対策: WebRTCのリモート音声はaudio要素に紐付けないとWeb Audioに流れないため、
    // 無音のaudio要素にも同じストリームを割り当てて再生しておく
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play().catch(() => {});

    return () => {
      source.disconnect();
      gainNode.disconnect();
      panNode.disconnect();
      el.srcObject = null;
    };
  }, [mediaStreamTrack, audioCtx]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = gain;
    if (panRef.current) panRef.current.pan.value = pan;
  }, [gain, pan]);

  return null;
}

export default function SpatialAudio() {
  const { myPos, others } = useTentState();
  const { localParticipant } = useLocalParticipant();
  const audioCtxRef = useRef(null);
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
  }
  const audioCtx = audioCtxRef.current;

  // AudioContext は suspended で始まることがあるため、操作をきっかけに再開する
  useEffect(() => {
    const resume = () => {
      if (audioCtx.state === 'suspended') audioCtx.resume();
    };
    resume();
    document.addEventListener('pointerdown', resume);
    return () => document.removeEventListener('pointerdown', resume);
  }, [audioCtx]);

  const trackRefs = useTracks([Track.Source.Microphone]);

  return (
    <>
      {trackRefs.map((t) => {
        const identity = t.participant?.identity;
        if (!identity || identity === localParticipant.identity) return null;
        const mediaStreamTrack = t.publication?.track?.mediaStreamTrack;
        if (!mediaStreamTrack) return null;
        const other = others[identity] || { x: 0.5, y: 0.5 };
        const { gain, pan } = computeAudio(myPos, other);
        return (
          <SpatialTrack
            key={identity}
            mediaStreamTrack={mediaStreamTrack}
            gain={gain}
            pan={pan}
            audioCtx={audioCtx}
          />
        );
      })}
    </>
  );
}
