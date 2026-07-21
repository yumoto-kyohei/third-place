import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { useParticipants, useSpeakingParticipants } from '@livekit/components-react';
import { AVATAR_TYPES, DEFAULT_AVATAR } from './AvatarSprite';
import { useTentState } from './TentState';

// ============================================================================
// テント内2D俯瞰ビュー → 2.5Dパース＋ビルボード表示（SPEC §5.3・Phase 1）。
// 位置・アバター種別・ホップ状態の「正」は引き続き TentState.jsx が持つ（同期・他参加者向け）。
// 自分の見た目上の移動だけは、React state を介さない ref で毎フレーム直接動かす
// （react-three-fiber の描画ループと同期させ、モックアップと同じ滑らかさにするため）。
// 通信への同期（updateMyPos呼び出し）は、この見た目の動きとは別に間引いて行う。
// ============================================================================

const BY_KEY = Object.fromEntries(AVATAR_TYPES.map((a) => [a.key, a]));
const FIELD = 24; // 床の一辺の大きさ（ワールド単位）
const HALF = FIELD / 2;
const WASD_SPEED = 4; // ワールド単位/秒
const SYNC_INTERVAL_MS = 100; // TentStateへの同期間隔（見た目の滑らかさとは独立）

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function toWorldX(nx) {
  return (nx - 0.5) * FIELD;
}
function toWorldZ(ny) {
  return (ny - 0.5) * FIELD;
}
function fromWorld(x, z) {
  return { x: clamp01(x / FIELD + 0.5), y: clamp01(z / FIELD + 0.5) };
}
function clampHalf(v) {
  return THREE.MathUtils.clamp(v, -HALF, HALF);
}
function isTypingTarget() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// アバターの円形フレーム（枠線で石/草=非人間・人=人型を区別）＋発話グロー＋絵文字を1枚のテクスチャに焼く
function makeAvatarTexture(type, speaking) {
  const info = BY_KEY[type] || BY_KEY[DEFAULT_AVATAR];
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;

  if (speaking) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(127, 176, 105, 0.85)';
    ctx.lineWidth = 16;
    ctx.stroke();
  }

  const grad = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, r);
  grad.addColorStop(0, '#faf1da');
  grad.addColorStop(1, '#f3e6c8');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // 人型は話す可能性を示す実線の金枠、非人間は破線の枠で一目で区別（SPEC F1）
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 10;
  if (info.human) {
    ctx.setLineDash([]);
    ctx.strokeStyle = '#c98a1f';
  } else {
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = '#9aa0aa';
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '150px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(info.emoji, cx, cy + 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 表示名を半透明の吹き出し風キャンバスに描いてテクスチャ化
function makeLabelTexture(text) {
  const fontSize = 42;
  const pad = 16;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `bold ${fontSize}px system-ui, sans-serif`;
  const w = Math.ceil(measure.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.aspect = w / h;
  return tex;
}

function Avatar3D({ identity, pos, worldRef, type, speaking, hopping, isMe, cameraTargetRef }) {
  const groupRef = useRef();
  const emojiTex = useMemo(() => makeAvatarTexture(type, speaking), [type, speaking]);
  const label = isMe ? `${identity}（あなた）` : identity;
  const labelTex = useMemo(() => makeLabelTexture(label), [label]);
  const labelW = 0.85 * (labelTex.userData.aspect || 3);

  useFrame((state, dt) => {
    if (!groupRef.current) return;
    const hopY = hopping ? Math.abs(Math.sin(state.clock.elapsedTime * 9)) * 0.4 : 0;

    if (isMe) {
      // 自分は毎フレーム ref から直接反映（React stateを介さないので滑らか）
      groupRef.current.position.set(worldRef.current.x, hopY, worldRef.current.z);
    } else {
      // 他の参加者はネットワーク経由（10Hz程度）なのでなめらかに補間
      const targetX = toWorldX(pos.x);
      const targetZ = toWorldZ(pos.y);
      groupRef.current.position.x = THREE.MathUtils.damp(groupRef.current.position.x, targetX, 8, dt);
      groupRef.current.position.z = THREE.MathUtils.damp(groupRef.current.position.z, targetZ, 8, dt);
      groupRef.current.position.y = hopY;
    }

    if (cameraTargetRef) cameraTargetRef.current.copy(groupRef.current.position);
  });

  return (
    <group ref={groupRef}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.45, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <Billboard>
        <mesh position={[0, 0.9, 0]}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshBasicMaterial map={emojiTex} transparent depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <planeGeometry args={[labelW, 0.5]} />
          <meshBasicMaterial map={labelTex} transparent depthWrite={false} />
        </mesh>
      </Billboard>
    </group>
  );
}

function Tree({ position }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.12, 0.16, 0.8, 8]} />
        <meshStandardMaterial color="#6b4a25" />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <coneGeometry args={[0.65, 1.3, 8]} />
        <meshStandardMaterial color="#3f7a3a" />
      </mesh>
    </group>
  );
}

function CameraRig({ targetRef }) {
  const { camera } = useThree();
  useFrame((_, dt) => {
    const t = targetRef.current;
    const desired = new THREE.Vector3(t.x, t.y + 7, t.z + 7);
    camera.position.lerp(desired, 1 - 0.0015 ** dt);
    camera.lookAt(t.x, t.y + 0.6, t.z);
  });
  return null;
}

// WASDキーでの移動（自分の見た目=worldRefを毎フレーム直接更新）と、
// ドラッグ中も含めた「移動があったときだけ」の間引き同期をまとめて担当する。
function LocalMover({ worldRef, draggingRef, syncToServer }) {
  const keysRef = useRef(new Set());
  const lastSyncRef = useRef(0);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(k) || isTypingTarget()) return;
      keysRef.current.add(k);
    };
    const handleKeyUp = (e) => keysRef.current.delete(e.key.toLowerCase());

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useFrame((state, dt) => {
    const keys = keysRef.current;
    let dx = 0;
    let dz = 0;
    if (keys.has('a')) dx -= 1;
    if (keys.has('d')) dx += 1;
    if (keys.has('w')) dz -= 1;
    if (keys.has('s')) dz += 1;

    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      const p = worldRef.current;
      p.x = clampHalf(p.x + (dx / len) * WASD_SPEED * dt);
      p.z = clampHalf(p.z + (dz / len) * WASD_SPEED * dt);
    }

    const active = keys.size > 0 || draggingRef.current;
    const now = state.clock.elapsedTime * 1000;

    if (active && !wasActiveRef.current) {
      // 動き始めの瞬間は確実に同期
      lastSyncRef.current = now;
      syncToServer(true);
    } else if (active) {
      if (now - lastSyncRef.current > SYNC_INTERVAL_MS) {
        lastSyncRef.current = now;
        syncToServer(false);
      }
    } else if (wasActiveRef.current) {
      // 止まった瞬間も確実に同期
      syncToServer(true);
    }
    wasActiveRef.current = active;
  });

  return null;
}

function Scene() {
  const { myPos, others, avatarType, localIdentity, hopping, updateMyPos } = useTentState();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const speakingIds = new Set(speaking.map((p) => p.identity));

  // 自分の「見た目上の」現在地。React stateではなくrefなので、毎フレーム書き換えても再レンダーを起こさない
  const worldRef = useRef(new THREE.Vector3(toWorldX(myPos.x), 0, toWorldZ(myPos.y)));
  const cameraTargetRef = useRef(worldRef.current.clone());
  const draggingRef = useRef(false);

  const syncToServer = (force) => {
    updateMyPos(fromWorld(worldRef.current.x, worldRef.current.z), force);
  };

  return (
    <>
      <color attach="background" args={['#bfe3f0']} />
      <fog attach="fog" args={['#bfe3f0', 20, 40]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 12, 4]} intensity={1} />

      <mesh
        rotation-x={-Math.PI / 2}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.target.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          worldRef.current.x = clampHalf(e.point.x);
          worldRef.current.z = clampHalf(e.point.z);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          worldRef.current.x = clampHalf(e.point.x);
          worldRef.current.z = clampHalf(e.point.z);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
      >
        <planeGeometry args={[FIELD, FIELD]} />
        <meshStandardMaterial color="#5f9152" />
      </mesh>
      <gridHelper args={[FIELD, FIELD, '#4a7340', '#4a7340']} position={[0, 0.01, 0]} />

      <Tree position={[-6, 0, -7]} />
      <Tree position={[8, 0, -5]} />
      <Tree position={[-9, 0, 6]} />

      <LocalMover worldRef={worldRef} draggingRef={draggingRef} syncToServer={syncToServer} />

      {participants.map((p) => {
        const isMe = p.identity === localIdentity;
        if (isMe) {
          return (
            <Avatar3D
              key={p.identity}
              identity={p.identity}
              worldRef={worldRef}
              type={avatarType}
              speaking={speakingIds.has(p.identity)}
              hopping={!!hopping[p.identity]}
              isMe
              cameraTargetRef={cameraTargetRef}
            />
          );
        }
        const state = others[p.identity];
        const pos = state || { x: 0.5, y: 0.5 };
        return (
          <Avatar3D
            key={p.identity}
            identity={p.identity}
            pos={pos}
            type={state?.type || DEFAULT_AVATAR}
            speaking={speakingIds.has(p.identity)}
            hopping={!!hopping[p.identity]}
            isMe={false}
          />
        );
      })}

      <CameraRig targetRef={cameraTargetRef} />
    </>
  );
}

export default function TentView() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 600,
        margin: '0.5rem auto',
        aspectRatio: '4 / 3',
        border: '4px solid var(--border)',
        borderRadius: 16,
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.25), 0 3px 0 var(--border)',
        touchAction: 'none',
        overflow: 'hidden',
      }}
    >
      <Canvas camera={{ position: [0, 7, 7], fov: 45 }}>
        <Scene />
      </Canvas>
    </div>
  );
}
