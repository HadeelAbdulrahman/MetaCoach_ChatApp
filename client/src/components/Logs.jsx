import { useState, useRef, useEffect } from 'react';

export default function Logs() {
  const [logs,     setLogs]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [filter,   setFilter]   = useState('');
  const [autoLoad, setAutoLoad] = useState(false);
  const intervalRef = useRef(null);
  const bottomRef   = useRef(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res  = await fetch('/api/logs');
      const data = await res.json();
      const lines = (data.logs || '').split('\n').filter(Boolean);
      setLogs(lines);
      if (!silent) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {}
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    if (autoLoad) {
      load();
      intervalRef.current = setInterval(() => load(true), 3000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoLoad]);

  const filtered = filter
    ? logs.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const levelClass = (line) => {
    const l = line.toLowerCase();
    if (l.includes('error') || l.includes('❌')) return 'log-error';
    if (l.includes('warn')  || l.includes('⚠️')) return 'log-warn';
    if (l.includes('✅'))                         return 'log-success';
    if (l.includes('rag:'))                       return 'log-rag';
    return 'log-info';
  };

  return (
    <div className="logs-wrap">
      <h2 className="tab-heading">📋 Server Logs</h2>
      <p className="tab-desc">Live view of server activity, RAG retrieval results, and errors.</p>

      <div className="tab-controls">
        <input
          className="eval-input"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter logs…"
        />
        <button className="eval-btn primary" onClick={() => load()} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
        <label className="auto-toggle">
          <input type="checkbox" checked={autoLoad} onChange={e => setAutoLoad(e.target.checked)} />
          Auto-refresh (3s)
        </label>
      </div>

      <div className="log-box">
        {filtered.length === 0 && (
          <div className="tab-empty">No logs yet — click Refresh or send a chat message.</div>
        )}
        {filtered.map((line, i) => (
          <div key={i} className={`log-line ${levelClass(line)}`}>
            <span className="log-text">{line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
