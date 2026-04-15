import { useState } from 'react';

export default function Memory() {
  const [query,   setQuery]   = useState('');
  const [result,  setResult]  = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/memory?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResult(data.memory);
    } catch (e) {
      setResult('Error loading memory.');
    }
    setLoading(false);
  };

  return (
    <div className="memory-wrap">
      <h2 className="tab-heading">🧠 Stored Memory</h2>
      <p className="tab-desc">
        Memory is extracted from your conversations and stored by category:
        goals, preferences, habits, emotions.
      </p>

      <div className="tab-controls">
        <input
          className="eval-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Filter by topic (leave blank for most important)"
        />
        <button className="eval-btn primary" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Retrieve'}
        </button>
      </div>

      {result ? (
        <div className="memory-results">
          {result.split('\n').filter(Boolean).map((line, i) => (
            <div key={i} className="memory-card">{line}</div>
          ))}
        </div>
      ) : (
        <div className="tab-empty">
          <span>Memory will appear here after you click Retrieve.</span>
        </div>
      )}
    </div>
  );
}
