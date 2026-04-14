import { useState, useEffect } from 'react';
import Chat   from './components/Chat.jsx';
import Memory from './components/Memory.jsx';
import Logs   from './components/Logs.jsx';
import { useSocket } from './hooks/useSocket.js';

const TABS = [
  { id: 'chat',   label: '💬 Chat'   },
  { id: 'memory', label: '🧠 Memory' },
  { id: 'logs',   label: '📋 Logs'   },
];

export default function App() {
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]); // Lifted Chat state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { socket, connected } = useSocket();

  // Load session list on mount
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(setStatus).catch(() => {});
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
      // Default to first session if none selected
      if (data.length > 0 && !currentSessionId) {
        selectSession(data[0]._id);
      }
    } catch (e) {}
  };

  const selectSession = async (id) => {
    setCurrentSessionId(id);
    setTab('chat');
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (e) {}
  };

  const createNewChat = async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const newSession = await res.json();
      setSessions([newSession, ...sessions]);
      setCurrentSessionId(newSession._id);
      setMessages([]);
      setTab('chat');
    } catch (e) {}
  };

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s._id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (e) {}
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
        <span className="header-logo">🧠</span>
        <div className="header-title">
          <h1 className="brand-font">AI Meta-Coach</h1>
          {status && (
            <p>
              📚 {status.kbChunks} chunks · {status.vectorDB} · {status.memoryBackend}
            </p>
          )}
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
        <span className="header-status-dot"
              style={{ color: connected ? '#22c55e' : '#ef4444', backgroundColor: connected ? '#22c55e' : '#ef4444' }}
              title={connected ? 'Connected' : 'Disconnected'} />
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
              <button className="delete-session" onClick={(e) => deleteSession(e, s._id)}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      <main className="app-main">
        {/* We use hidden instead of conditional rendering for chat to keep it alive or just rely on lifted state */}
        <div style={{ display: tab === 'chat' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <Chat 
            socket={socket} 
            connected={connected} 
            messages={messages} 
            setMessages={setMessages} 
            sessionId={currentSessionId}
            onMessageSent={loadSessions} // Refresh sessions to update titles
          />
        </div>
        {tab === 'memory' && <Memory />}
        {tab === 'logs'   && <Logs   />}
      </main>
    </div>
  );
}

