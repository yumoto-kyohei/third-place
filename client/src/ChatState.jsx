import { createContext, useContext, useState } from 'react';
import { ConnectionState } from 'livekit-client';
import { useConnectionState, useDataChannel, useLocalParticipant } from '@livekit/components-react';

// チャットのメッセージ状態とデータチャネル購読を、パネルの開閉に関係なく常に保持するための
// 共有ストア（React Context）。ChatPanel はこれを表示するだけの見た目担当にする。
// こうしないと、パネルを閉じる（＝ChatPanelがアンマウントされる）たびに購読が切れて
// 受信を取りこぼし、開き直すと保持していたメッセージも消えてしまう。

const ChatStateContext = createContext(null);

export function useChatState() {
  return useContext(ChatStateContext);
}

function encode(obj) {
  return new TextEncoder().encode(JSON.stringify(obj));
}

function decode(payload) {
  return JSON.parse(new TextDecoder().decode(payload));
}

export function ChatStateProvider({ children }) {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const connected = connectionState === ConnectionState.Connected;
  const [messages, setMessages] = useState([]);

  const { send } = useDataChannel('chat', (msg) => {
    const from = msg.from?.identity;
    const data = decode(msg.payload);
    setMessages((prev) => [...prev, { id: data.id, from: from || '不明', message: data.message, ts: data.ts }]);
  });

  const sendMessage = async (value) => {
    if (!value || !connected) return;
    const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, message: value, ts: Date.now() };
    await send(encode(entry), { reliable: true });
    // publishData は自分には配信されないので、自分の画面には即時に追加する
    setMessages((prev) => [...prev, { ...entry, from: `${localParticipant.identity}（あなた）` }]);
  };

  const value = { messages, sendMessage, connected };

  return <ChatStateContext.Provider value={value}>{children}</ChatStateContext.Provider>;
}
