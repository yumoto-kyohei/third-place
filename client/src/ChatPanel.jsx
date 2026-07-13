import { useEffect, useRef, useState } from 'react';
import { useChat } from '@livekit/components-react';

// LiveKit標準の <Chat> はラベルが英語固定のため、useChat フックで日本語UIを自作する。

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ChatPanel() {
  const { send, chatMessages, isSending } = useChat();
  const [text, setText] = useState('');
  const listRef = useRef(null);

  // 新着メッセージで最下部へスクロール
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [chatMessages.length]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || isSending) return;
    setText('');
    try {
      await send(value);
    } catch (err) {
      console.error('メッセージの送信に失敗しました', err);
      setText(value); // 失敗したら入力内容を戻す
    }
  };

  return (
    <div
      style={{
        maxWidth: 600,
        margin: '0.5rem auto',
        border: '1px solid var(--border)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        height: 320,
        overflow: 'hidden',
      }}
    >
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0.75rem', textAlign: 'left' }}>
        {chatMessages.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text)' }}>まだメッセージはありません。</p>
        ) : (
          chatMessages.map((m) => (
            <div key={m.id} style={{ marginBottom: 8, fontSize: 14 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>{m.from?.identity || '不明'}</span>
              <span style={{ fontSize: 11, color: 'var(--text)', marginLeft: 6 }}>{formatTime(m.timestamp)}</span>
              <div style={{ color: 'var(--text-h)', wordBreak: 'break-word' }}>{m.message}</div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', borderTop: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder="メッセージを入力…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={isSending || !text.trim()}>
          送信
        </button>
      </form>
    </div>
  );
}
