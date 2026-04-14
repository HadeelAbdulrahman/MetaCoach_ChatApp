import { useState } from 'react';

export default function Logs() {
  const [logs,    setLogs]    = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const res  = await fetch('/api/logs');
    const data = await res.json();
    setLogs(data.logs);
    setLoading(false);
  };

  return (
    <div style={S.wrap}>
      <h2 style={S.heading}>📋 Server Logs</h2>
      <button style={S.btn} onClick={load} disabled={loading}>
        {loading ? '⏳ Loading…' : 'Load last 60 lines'}
      </button>
      <textarea
        style={S.output}
        readOnly
        value={logs}
        placeholder="Click 'Load' to fetch server logs…"
      />
    </div>
  );
}

const S = {
  wrap: {
    maxWidth: 860, margin: '0 auto', padding: '24px 20px',
    display: 'flex', flexDirection: 'column', gap: 14, flex: 1,
  },
  heading: { fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' },
  btn: {
    alignSelf: 'flex-start', padding: '10px 20px', borderRadius: 10,
    border: 'none', background: '#6366f1', color: '#fff',
    cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem',
  },
  output: {
    flex: 1, minHeight: 380, padding: '14px', borderRadius: 10,
    border: '1.5px solid #334155', background: '#0f172a',
    color: '#4ade80', fontSize: '0.78rem', fontFamily: 'monospace',
    resize: 'vertical', lineHeight: 1.7,
  },
};
