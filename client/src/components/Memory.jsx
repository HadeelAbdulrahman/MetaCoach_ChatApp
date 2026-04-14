import { useState } from 'react';

export default function Memory() {
  const [query,  setQuery]  = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/memory?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResult(data.memory);
    setLoading(false);
  };

  return (
    <div className="memory-wrap">
      <h2 className="memory-heading">🧠 Stored Memory</h2>
      <p className="memory-hint">
        Memory is extracted from your conversations and stored by category:
        goals, preferences, habits, emotions.
      </p>

      <div className="memory-controls">
        <input
          className="memory-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Filter by topic (leave blank for most important)"
        />
        <button className="send-btn" onClick={load} disabled={loading}>
          {loading ? '⏳...' : 'Retrieve'}
        </button>
      </div>

      <textarea
        className="memory-output"
        readOnly
        value={result}
        placeholder="Memory will appear here after you click Retrieve…"
      />
    </div>
  );
}
