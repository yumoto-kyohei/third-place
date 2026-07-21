// アバターの見た目を1箇所に集約するモジュール（α版は仮デザイン。正式素材はここを差し替える）。
// SPEC F1: 非人間（石・草）=「話しません」、人型=「話す可能性あり」。この区別が一目で伝わることが最重要。

export const AVATAR_TYPES = [
  { key: 'stone', label: '石', emoji: '🪨', human: false },
  { key: 'grass', label: '草', emoji: '🌿', human: false },
  { key: 'human', label: '人', emoji: '🧍', human: true },
];

const BY_KEY = Object.fromEntries(AVATAR_TYPES.map((a) => [a.key, a]));

export const DEFAULT_AVATAR = 'stone';

export function isHumanAvatar(type) {
  return BY_KEY[type]?.human ?? false;
}

export function avatarLabel(type) {
  return BY_KEY[type]?.label ?? '';
}

export default function AvatarSprite({ type, speaking = false, hopping = false }) {
  const info = BY_KEY[type] || BY_KEY[DEFAULT_AVATAR];
  const human = info.human;

  return (
    <div
      // key経由で種別変更時にアニメーションが再生される（石→人などの「変化」演出）
      key={type}
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 28,
        lineHeight: 1,
        background: 'radial-gradient(circle at 35% 30%, var(--panel-bg), var(--bg))',
        // 人型は話す可能性を示すため実線の金枠、非人間は破線の枠で一目で区別
        border: human ? '3px solid var(--accent, #c98a1f)' : '3px dashed #9aa0aa',
        boxShadow: speaking
          ? '0 0 0 4px rgba(127, 176, 105, 0.7), 0 2px 4px rgba(0,0,0,0.3)'
          : '0 2px 4px rgba(0,0,0,0.3)',
        // 石・草・人型が「歩く」のは不自然なので、移動中は歩行の代わりにホップさせる
        animation: hopping ? 'avatar-pop 0.2s ease-out, hop 0.4s ease-in-out infinite' : 'avatar-pop 0.2s ease-out',
      }}
    >
      {info.emoji}
    </div>
  );
}
