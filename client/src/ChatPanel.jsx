import { useEffect, useRef, useState } from 'react';
import { useConnectionState, useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

// チャットは描き込み・位置同期と同じ useDataChannel（publishData）方式で実装する。
// LiveKit標準の useChat（sendText/DataStreams）とは別経路で、既に動作実績のある仕組みに揃える。

function encode(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decode(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function ChatPanel() {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState(false);
  const listRef = useRef(null);

  const { send } = useDataChannel('chat', (msg) => {
    const from = msg.from?.identity;
    const data = decode(msg.payload);
    setMessages((prev) => [...prev, { id: data.id, from: from || '不明', message: data.message, ts: data.ts }]);
  });

  // 新着メッセージで最下部へスクロール
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || !connected) return;
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, message: value, ts: Date.now() };
    setText('');
    setSendError(false);
    try {
      await send(encode(entry), { reliable: true });
      // publishData は自分には配信されないので、自分の画面には即時に追加する
      setMessages((prev) => [...prev, { ...entry, from: `${localParticipant.identity}（あなた）` }]);
    } catch (err) {
      console.error('メッセージの送信に失敗しました', err);
      setSendError(true);
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
        {messages.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text)' }}>まだメッセージはありません。</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 8, fontSize: 14 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-h)' }}>{m.from}</span>
              <span style={{ fontSize: 11, color: 'var(--text)', marginLeft: 6 }}>{formatTime(m.ts)}</span>
              <div style={{ color: 'var(--text-h)', wordBreak: 'break-word' }}>{m.message}</div>
            </div>
          ))
        )}
      </div>
      {sendError && (
        <p style={{ fontSize: 12, color: '#d33', margin: '0 0.75rem' }}>
          送信に失敗しました。接続を確認してもう一度お試しください。
        </p>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', borderTop: '1px solid var(--border)' }}>
        <input
          type="text"
          placeholder={connected ? 'メッセージを入力…' : '接続中…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!connected}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!text.trim() || !connected}>
          送信
        </button>
      </form>
    </div>
  );
}
