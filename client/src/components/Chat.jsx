import { useState, useEffect, useRef, useCallback } from 'react';

export default function Chat({ 
  socket, 
  connected, 
  messages, 
  setMessages, 
  sessionId, 
  onMessageSent 
}) {
  const [input,      setInput]      = useState('');
  const [streaming,  setStreaming]   = useState(false);
  const bottomRef = useRef(null);

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const onToken = (token) => {
      setMessages(prev => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: last.content + token };
        }
        return updated;
      });
    };

    const onDone  = () => {
      setStreaming(false);
      if (onMessageSent) onMessageSent(); // Trigger session list refresh for titles
    };

    const onError = (msg) => {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: msg };
        return updated;
      });
      setStreaming(false);
    };

    socket.on('token', onToken);
    socket.on('done',  onDone);
    socket.on('error', onError);
    return () => {
      socket.off('token', onToken);
      socket.off('done',  onDone);
      socket.off('error', onError);
    };
  }, [socket, setMessages, onMessageSent]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || !socket || !sessionId) return;
    setInput('');
    setMessages(prev => [
      ...prev,
      { role: 'user',      content: text },
      { role: 'assistant', content: ''   },
    ]);
    setStreaming(true);
    socket.emit('chat', { sessionId, message: text });
  }, [input, streaming, socket, sessionId, setMessages]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const feedback = async (type) => {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
  };

  const clearChat = async () => {
    setMessages([]);
    await fetch('/api/clear', { method: 'POST' });
  };

  return (
    <div className="chat-wrap" style={{ flex: 1, minHeight: 0 }}>
      {/* Message list */}
      <div className="chat-box">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="icon">🧠</div>
            <p>Ask your Meta-Coach anything about goals, habits, or decisions.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} isLast={i === messages.length - 1} streaming={streaming} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Action buttons */}
      <div className="chat-actions">
        <button className="action-btn positive" onClick={() => feedback('positive')}>👍 Helpful</button>
        <button className="action-btn negative" onClick={() => feedback('negative')}>👎 Not helpful</button>
        <button className="action-btn clear"    onClick={clearChat}>🗑 Clear History</button>
      </div>

      {/* Input row */}
      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={sessionId ? "Ask your Meta-Coach…" : "Please select or create a chat on the left"}
          rows={2}
          disabled={!connected || !sessionId}
        />
        <button
          className="send-btn"
          onClick={send}
          disabled={streaming || !connected || !sessionId}
        >
          {streaming ? '⏳...' : 'Send ↩'}
        </button>
      </div>
    </div>
  );
}

function Message({ msg, isLast, streaming }) {
  const isUser   = msg.role === 'user';
  const showCursor = isLast && !isUser && streaming && msg.content !== undefined;
  
  const rowClass = isUser ? 'msg-row user' : 'msg-row bot';

  return (
    <div className={rowClass}>
      <div className="msg-avatar">
        {isUser ? '🙋' : '🧠'}
      </div>
      <div className="msg-bubble">
        {msg.content || (showCursor ? '' : '')}
        {showCursor && <span className="typing-cursor">▌</span>}
        {!msg.content && !showCursor && <span style={{ opacity: 0.4 }}>…</span>}
      </div>
    </div>
  );
}

