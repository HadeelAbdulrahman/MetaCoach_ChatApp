import { useState, useEffect, useRef, useCallback } from 'react';

export default function Chat({ 
  socket, connected, messages, setMessages, sessionId, onMessageSent 
}) {
  const [input,     setInput]     = useState('');
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef(null);
  const bottomRef      = useRef(null);

  // Check voice support
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognition);
  }, []);

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

    const onDone  = () => { setStreaming(false); if (onMessageSent) onMessageSent(); };
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
    return () => { socket.off('token', onToken); socket.off('done', onDone); socket.off('error', onError); };
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

  // ── Voice Input ────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous      = false;
    recognition.interimResults  = true;
    recognition.lang            = 'en-US';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      setInput(transcript);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

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
    <div className="chat-wrap">
      {/* Message list */}
      <div className="chat-box">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty-icon">🧠</div>
            <p className="empty-title">Your Meta-Coach is ready</p>
            <p className="empty-sub">Ask about goals, habits, or decisions. Answers are grounded in your knowledge base.</p>
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
        {voiceSupported && (
          <button
            className={`voice-btn ${listening ? 'voice-active' : ''}`}
            onClick={toggleVoice}
            title={listening ? 'Stop recording' : 'Voice input'}
            disabled={streaming || !connected || !sessionId}
          >
            {listening ? (
              <span className="voice-pulse">🔴</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
          </button>
        )}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={
            listening
              ? '🎙 Listening…'
              : sessionId
                ? 'Ask your Meta-Coach… (Enter to send)'
                : 'Select or create a chat on the left'
          }
          rows={2}
          disabled={!connected || !sessionId || listening}
        />
        <button
          className="send-btn"
          onClick={send}
          disabled={streaming || !connected || !sessionId || listening}
        >
          {streaming ? <span className="sending-dots">⏳</span> : 'Send ↩'}
        </button>
      </div>
    </div>
  );
}

function Message({ msg, isLast, streaming }) {
  const isUser     = msg.role === 'user';
  const showCursor = isLast && !isUser && streaming && msg.content !== undefined;
  const rowClass   = isUser ? 'msg-row user' : 'msg-row bot';

  return (
    <div className={rowClass}>
      <div className="msg-avatar">{isUser ? '🙋' : '🧠'}</div>
      <div className="msg-bubble">
        {msg.content || ''}
        {showCursor && <span className="typing-cursor">▌</span>}
        {!msg.content && !showCursor && <span className="msg-waiting">…</span>}
      </div>
    </div>
  );
}
