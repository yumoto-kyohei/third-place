import { useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';

const TOKEN_SERVER_URL = import.meta.env.PROD
  ? 'https://third-place.onrender.com'
  : 'http://localhost:3001';

function ParticipantList() {
  const participants = useParticipants();
  return (
    <ul style={{ padding: '1rem' }}>
      {participants.map((p) => (
        <li key={p.identity}>{p.identity}</li>
      ))}
    </ul>
  );
}

function JoinForm({ onJoin }) {
  const [name, setName] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onJoin(name.trim());
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: 300, margin: '4rem auto' }}
    >
      <h1>third place</h1>
      <input
        type="text"
        placeholder="表示名"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit">入室する</button>
    </form>
  );
}

function App() {
  const [connectionInfo, setConnectionInfo] = useState(null);

  const handleJoin = async (identity) => {
    const res = await fetch(`${TOKEN_SERVER_URL}/api/token?identity=${encodeURIComponent(identity)}`);
    const data = await res.json();
    setConnectionInfo(data);
  };

  if (!connectionInfo) {
    return <JoinForm onJoin={handleJoin} />;
  }

  return (
    <LiveKitRoom
      serverUrl={connectionInfo.url}
      token={connectionInfo.token}
      connect
      audio
      onDisconnected={() => setConnectionInfo(null)}
      style={{ height: '100vh' }}
    >
      <ParticipantList />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

export default App;
