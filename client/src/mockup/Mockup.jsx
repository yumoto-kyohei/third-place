import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';

// ============================================================================
// 2.5D パース＋ビルボード の「場所らしさ」検証用モックアップ（本番アプリとは独立）。
// LiveKit・音声・同期は一切なし。見た目と移動の体感だけを試すためのもの。
// ============================================================================

const BOUND = 12; // 移動範囲（±）
const SPEED = 4; // 移動速度（ワールド単位/秒）

function clampBound(v) {
  return THREE.MathUtils.clamp(v, -BOUND, BOUND);
}

// 絵文字を透過キャンバスに描いてテクスチャ化（ビルボードのアバター用）
function makeEmojiTexture(emoji) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.font = '190px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 表示名を半透明の吹き出し風キャンバスに描いてテクスチャ化
function makeLabelTexture(text) {
  const fontSize = 44;
  const pad = 18;
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

// アバターの見た目（地面の影＋ビルボードの絵文字＋名前ラベル）
function AvatarVisual({ emoji, name }) {
  const emojiTex = useMemo(() => makeEmojiTexture(emoji), [emoji]);
  const labelTex = useMemo(() => makeLabelTexture(name), [name]);
  const labelW = 0.55 * (labelTex.userData.aspect || 3);
  return (
    <>
      {/* 地面に落ちる影（ビルボードにせず床に寝かせる） */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.25} depthWrite={false} />
      </mesh>
      <Billboard>
        <mesh position={[0, 0.85, 0]}>
          <planeGeometry args={[1.4, 1.4]} />
          <meshBasicMaterial map={emojiTex} transparent depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.85, 0]}>
          <planeGeometry args={[labelW, 0.55]} />
          <meshBasicMaterial map={labelTex} transparent depthWrite={false} />
        </mesh>
      </Billboard>
    </>
  );
}

function Player({ targetRef }) {
  const groupRef = useRef();
  const posRef = useRef(new THREE.Vector3(0, 0, 0));
  const keys = useRef(new Set());
  const { camera } = useThree();

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(k) && !isTyping()) keys.current.add(k);
    };
    const up = (e) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useFrame((state, dt) => {
    const pos = posRef.current;
    let moving = false;

    let dx = 0;
    let dz = 0;
    if (keys.current.has('a')) dx -= 1;
    if (keys.current.has('d')) dx += 1;
    if (keys.current.has('w')) dz -= 1;
    if (keys.current.has('s')) dz += 1;

    if (dx !== 0 || dz !== 0) {
      // WASD 入力があればタップ移動先はキャンセル
      targetRef.current = null;
      const len = Math.hypot(dx, dz);
      pos.x = clampBound(pos.x + (dx / len) * SPEED * dt);
      pos.z = clampBound(pos.z + (dz / len) * SPEED * dt);
      moving = true;
    } else if (targetRef.current) {
      // タップ/ドラッグした地点へ向かって歩く
      const tx = targetRef.current.x - pos.x;
      const tz = targetRef.current.z - pos.z;
      const dist = Math.hypot(tx, tz);
      if (dist > 0.1) {
        const step = Math.min(SPEED * dt, dist);
        pos.x = clampBound(pos.x + (tx / dist) * step);
        pos.z = clampBound(pos.z + (tz / dist) * step);
        moving = true;
      } else {
        targetRef.current = null;
      }
    }

    // 歩行の代わりにホップ（石・草・人型が歩くのは不自然なので）
    const hopY = moving ? Math.abs(Math.sin(state.clock.elapsedTime * 9)) * 0.4 : 0;
    groupRef.current.position.set(pos.x, hopY, pos.z);

    // カメラは斜め上から追従（クォータービュー）
    const desired = new THREE.Vector3(pos.x, 7, pos.z + 7);
    camera.position.lerp(desired, 1 - Math.pow(0.0015, dt));
    camera.lookAt(pos.x, 0.6, pos.z);
  });

  return (
    <group ref={groupRef}>
      <AvatarVisual emoji="🧍" name="あなた" />
    </group>
  );
}

function Dummy({ position, emoji, name, phase }) {
  const ref = useRef();
  useFrame((state) => {
    // その場でゆっくり上下（居る感）
    ref.current.position.y = Math.sin(state.clock.elapsedTime * 1.4 + phase) * 0.05 + 0.05;
  });
  return (
    <group ref={ref} position={position}>
      <AvatarVisual emoji={emoji} name={name} />
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

function Tent({ position, color }) {
  return (
    <mesh position={position} rotation-y={0.4}>
      <coneGeometry args={[1.3, 1.7, 4]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Scene() {
  const targetRef = useRef(null);

  const setTargetFromPoint = (point) => {
    targetRef.current = new THREE.Vector3(clampBound(point.x), 0, clampBound(point.z));
  };

  return (
    <>
      <color attach="background" args={['#bfe3f0']} />
      <fog attach="fog" args={['#bfe3f0', 20, 36]} />
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 12, 4]} intensity={1} />

      {/* 芝生の床（タップ/ドラッグで移動先を指定） */}
      <mesh
        rotation-x={-Math.PI / 2}
        onPointerDown={(e) => {
          e.stopPropagation();
          setTargetFromPoint(e.point);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) setTargetFromPoint(e.point);
        }}
      >
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#5f9152" />
      </mesh>
      <gridHelper args={[80, 80, '#4a7340', '#4a7340']} position={[0, 0.01, 0]} />

      <Tree position={[-6, 0, -5]} />
      <Tree position={[7, 0, -3]} />
      <Tree position={[-8, 0, 3]} />
      <Tent position={[5, 0.85, -7]} color="#c98a1f" />
      <Tent position={[-5, 0.85, -8]} color="#b5643a" />

      <Dummy position={[2, 0, -2]} emoji="🧍" name="はると" phase={0} />
      <Dummy position={[-3, 0, -1]} emoji="🌿" name="ゆい" phase={1.5} />
      <Dummy position={[1, 0, 3]} emoji="🪨" name="そうた" phase={3} />

      <Player targetRef={targetRef} />
    </>
  );
}

function Overlay() {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.45))',
        color: '#fff',
        fontSize: 13,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      🏕️ 2.5D 検証モックアップ（音声・通信なし）／ WASDキー、または画面をタップ・ドラッグで歩けます
    </div>
  );
}

export default function Mockup() {
  return (
    <div style={{ position: 'fixed', inset: 0, touchAction: 'none' }}>
      <Canvas camera={{ position: [0, 7, 7], fov: 45 }}>
        <Scene />
      </Canvas>
      <Overlay />
    </div>
  );
}
