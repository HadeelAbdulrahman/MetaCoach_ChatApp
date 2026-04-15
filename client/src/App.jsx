import { useState, useEffect } from 'react';
import Chat    from './components/Chat.jsx';
import Memory  from './components/Memory.jsx';
import Logs    from './components/Logs.jsx';
import RagEval from './components/RagEval.jsx';
import { useSocket } from './hooks/useSocket.js';

const TABS = [
  { id: 'chat',    label: '💬 Chat'     },
  { id: 'memory',  label: '🧠 Memory'   },
  { id: 'rageval', label: '🔬 RAG Eval' },
  { id: 'logs',    label: '📋 Logs'     },
];

export default function App() {
  const [tab,              setTab]              = useState('chat');
  const [sessions,         setSessions]         = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages,         setMessages]         = useState([]);
  const [isSidebarOpen,    setIsSidebarOpen]    = useState(true);
  const { socket, connected } = useSocket();

  useEffect(() => { loadSessions(); }, []);

  const loadSessions = async () => {
    try {
      const res  = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
      if (data.length > 0 && !currentSessionId) selectSession(data[0]._id);
    } catch {}
  };

  const selectSession = async (id) => {
    setCurrentSessionId(id);
    setTab('chat');
    try {
      const res  = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {}
  };

  const createNewChat = async () => {
    try {
      const res        = await fetch('/api/sessions', { method: 'POST' });
      const newSession = await res.json();
      setSessions([newSession, ...sessions]);
      setCurrentSessionId(newSession._id);
      setMessages([]);
      setTab('chat');
    } catch {}
  };

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s._id !== id));
      if (currentSessionId === id) { setCurrentSessionId(null); setMessages([]); }
    } catch {}
  };

  return (
    <div className={`app-container ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
      <header className="app-header">
        <button
          className="sidebar-toggle-btn"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          title={isSidebarOpen ? 'Close Menu' : 'Open Menu'}
        >
          {isSidebarOpen ? '✕' : '☰'}
        </button>

        <div className="header-brand">
          <span className="header-logo">🧠</span>
          <span className="header-title brand-font">Coach</span>
        </div>

        <div className="app-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`nav-tab ${tab === t.id ? 'active' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span
          className="header-status-dot"
          title={connected ? 'Connected' : 'Disconnected'}
          style={{ backgroundColor: connected ? '#16a34a' : '#ef4444' }}
        />
      </header>

      <aside className="app-sidebar">
        <button className="new-chat-btn" onClick={createNewChat}>
          <span>+</span> New Chat
        </button>
        <div className="sidebar-label">Recently</div>
        <div className="sessions-list">
          {sessions.map(s => (
            <div
              key={s._id}
              className={`session-item ${currentSessionId === s._id ? 'active' : ''}`}
              onClick={() => selectSession(s._id)}
            >
              <span className="session-icon">💬</span>
              <span className="session-title">{s.title || 'New Chat'}</span>
              <button className="delete-session" onClick={e => deleteSession(e, s._id)}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <main className="app-main">
        <div style={{ display: tab === 'chat' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <Chat
            socket={socket}
            connected={connected}
            messages={messages}
            setMessages={setMessages}
            sessionId={currentSessionId}
            onMessageSent={loadSessions}
          />
        </div>
        {tab === 'memory'  && <Memory />}
        {tab === 'rageval' && <RagEval />}
        {tab === 'logs'    && <Logs />}
      </main>
    </div>
  );
}
