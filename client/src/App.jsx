import { useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import '@livekit/components-styles';
import CallScreen from './CallScreen';

const TOKEN_SERVER_URL = import.meta.env.PROD
  ? 'https://third-place.onrender.com'
  : 'http://localhost:3001';

function JoinForm({ onJoin, connecting, error }) {
  const [name, setName] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !connecting) onJoin(name.trim());
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: 320,
        margin: '4rem auto',
        padding: '1.5rem',
        background: 'var(--panel-bg)',
        border: '3px solid var(--border)',
        borderRadius: 16,
        boxShadow: '0 4px 0 var(--border), 0 8px 16px rgba(0,0,0,0.15)',
      }}
    >
      <h1 style={{ textAlign: 'center', margin: '0 0 0.5rem' }}>🏕️ third place</h1>
      <input
        type="text"
        placeholder="表示名"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={connecting}
      />
      <button type="submit" disabled={connecting || !name.trim()}>
        {connecting ? '接続中…' : '入室する'}
      </button>
      {connecting && (
        <p style={{ fontSize: 13, color: 'var(--text)' }}>
          サーバーの起動に最大1分ほどかかることがあります。そのままお待ちください。
        </p>
      )}
      {error && (
        <p style={{ fontSize: 13, color: 'var(--danger)' }}>
          接続に失敗しました。もう一度お試しください。
        </p>
      )}
    </form>
  );
}

function App() {
  const [connectionInfo, setConnectionInfo] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(false);

  const handleJoin = async (identity) => {
    setConnecting(true);
    setError(false);
    try {
      const res = await fetch(`${TOKEN_SERVER_URL}/api/token?identity=${encodeURIComponent(identity)}`);
      if (!res.ok) throw new Error(`token request failed: ${res.status}`);
      const data = await res.json();
      setConnectionInfo(data);
    } catch (e) {
      console.error(e);
      setError(true);
    } finally {
      setConnecting(false);
    }
  };

  if (!connectionInfo) {
    return <JoinForm onJoin={handleJoin} connecting={connecting} error={error} />;
  }

  return (
    <LiveKitRoom
      serverUrl={connectionInfo.url}
      token={connectionInfo.token}
      connect
      onDisconnected={() => setConnectionInfo(null)}
      style={{ height: '100vh' }}
    >
      <CallScreen />
    </LiveKitRoom>
  );
}

export default App;
