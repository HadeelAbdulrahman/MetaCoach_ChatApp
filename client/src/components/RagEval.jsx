import { useState } from 'react';

const DEFAULT_QUERIES = [{ query: '', expectedKeywords: '', expectedSource: '' }];

// Safe fetch wrapper that always returns JSON or throws a readable error
async function safeFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned non-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export default function RagEval() {
  const [queries,     setQueries]     = useState(DEFAULT_QUERIES);
  const [running,     setRunning]     = useState(false);
  const [results,     setResults]     = useState(null);
  const [probeQuery,  setProbeQuery]  = useState('');
  const [probeResult, setProbeResult] = useState(null);
  const [probing,     setProbing]     = useState(false);
  const [debugData,   setDebugData]   = useState(null);
  const [debugError,  setDebugError]  = useState(null);

  const addQuery    = () => setQueries(p => [...p, { query: '', expectedKeywords: '', expectedSource: '' }]);
  const removeQuery = (i) => setQueries(p => p.filter((_, idx) => idx !== i));
  const updateQuery = (i, f, v) => setQueries(p => p.map((q, idx) => idx === i ? { ...q, [f]: v } : q));

  const runProbe = async () => {
    if (!probeQuery.trim()) return;
    setProbing(true); setProbeResult(null);
    try {
      const data = await safeFetch(`/api/rag-probe?q=${encodeURIComponent(probeQuery)}`);
      setProbeResult(data);
    } catch (e) {
      setProbeResult({ error: e.message });
    }
    setProbing(false);
  };

  const loadDebug = async () => {
    setDebugData(null); setDebugError(null);
    try {
      const data = await safeFetch('/api/rag-debug');
      setDebugData(data);
    } catch (e) {
      setDebugError(e.message);
    }
  };

  const runEval = async () => {
    setRunning(true); setResults(null);
    try {
      const payload = {
        queries: queries
          .filter(q => q.query.trim())
          .map(q => ({
            query: q.query.trim(),
            expectedKeywords: q.expectedKeywords ? q.expectedKeywords.split(',').map(k => k.trim()).filter(Boolean) : [],
            expectedSource: q.expectedSource.trim() || null
          }))
      };
      const data = await safeFetch('/api/rag-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      setResults(data);
    } catch (e) {
      setResults({ error: e.message });
    }
    setRunning(false);
  };

  return (
    <div className="rag-eval-wrap">
      <div className="rag-eval-header">
        <h2>🔬 RAG Retrieval Evaluation</h2>
        <p>Test whether your PDFs are being retrieved and used correctly.</p>
      </div>

      {/* ── Quick Probe ─────────────────────────────────────── */}
      <section className="eval-section">
        <h3>Quick Probe <span className="eval-badge">instant</span></h3>
        <p className="eval-desc">Test exactly which chunks are retrieved for a query — no model involved.</p>
        <div className="probe-row">
          <input className="eval-input" value={probeQuery}
            onChange={e => setProbeQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runProbe()}
            placeholder="e.g. metacognition and learning frameworks" />
          <button className="eval-btn primary" onClick={runProbe} disabled={probing || !probeQuery.trim()}>
            {probing ? 'Probing…' : 'Probe →'}
          </button>
        </div>
        {probeResult && (
          <div className="probe-results">
            {probeResult.error ? (
              <div className="eval-error">
                <strong>Error:</strong> {probeResult.error}
                <div className="error-hint">💡 Make sure your server is running with the latest code and restart it.</div>
              </div>
            ) : (
              <>
                <div className={`probe-summary ${probeResult.chunksFound > 0 ? 'pass' : 'fail'}`}>
                  {probeResult.chunksFound > 0
                    ? `✅ ${probeResult.chunksFound} chunk(s) retrieved`
                    : '❌ 0 chunks — query may not match KB vocabulary or PDFs not ingested'}
                </div>
                {probeResult.chunks?.map((c, i) => (
                  <div key={i} className="chunk-card">
                    <div className="chunk-meta">
                      <span className="chunk-source">📄 {c.source}</span>
                      <span className={`chunk-score ${parseFloat(c.score) > 0.5 ? 'score-high' : parseFloat(c.score) > 0.3 ? 'score-mid' : 'score-low'}`}>
                        cosine: {c.score}
                      </span>
                    </div>
                    <p className="chunk-preview">{c.preview}</p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Last Debug Snapshot ──────────────────────────── */}
      <section className="eval-section">
        <div className="section-header-row">
          <h3>Last Chat Retrieval Snapshot</h3>
          <button className="eval-btn secondary" onClick={loadDebug}>Load Debug →</button>
        </div>
        <p className="eval-desc">Shows what was retrieved during the most recent chat message.</p>
        {debugError && (
          <div className="eval-error">
            <strong>Error:</strong> {debugError}
            <div className="error-hint">💡 Restart your server to pick up the latest code changes.</div>
          </div>
        )}
        {debugData && (
          <div className="debug-data">
            {debugData.message ? (
              <p className="eval-muted">{debugData.message}</p>
            ) : (
              <>
                <div className="debug-meta">
                  <span>Query: <strong>"{debugData.query}"</strong></span>
                  <span className={`eval-pill ${debugData.retrieved > 0 ? 'pill-green' : 'pill-red'}`}>
                    {debugData.retrieved} retrieved
                  </span>
                  {debugData.usedFallback && <span className="eval-pill pill-yellow">⚠ used fallback</span>}
                  <span className="eval-muted">threshold: {debugData.threshold}</span>
                  <span className="eval-muted">{debugData.timestamp}</span>
                </div>
                {debugData.topResults?.map((r, i) => (
                  <div key={i} className="chunk-card">
                    <div className="chunk-meta">
                      <span className="chunk-source">📄 {r.source}</span>
                      <span className={`chunk-score ${parseFloat(r.score) > 0.5 ? 'score-high' : 'score-mid'}`}>cosine: {r.score}</span>
                    </div>
                    <p className="chunk-preview">{r.preview}</p>
                  </div>
                ))}
                <details className="eval-details">
                  <summary>All candidates (before threshold)</summary>
                  <table className="eval-table">
                    <thead><tr><th>Cosine</th><th>L2</th><th>Source</th><th>Preview</th></tr></thead>
                    <tbody>
                      {debugData.allCandidates?.map((c, i) => (
                        <tr key={i} className={parseFloat(c.cosine) >= debugData.threshold ? 'row-pass' : 'row-fail'}>
                          <td>{c.cosine}</td><td>{c.l2}</td><td>{c.source}</td>
                          <td className="td-preview">{c.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Eval Suite ──────────────────────────────────────── */}
      <section className="eval-section">
        <h3>Eval Suite <span className="eval-badge">batch</span></h3>
        <p className="eval-desc">Run multiple test queries and score keyword recall across your knowledge base.</p>
        <div className="eval-queries">
          {queries.map((q, i) => (
            <div key={i} className="eval-query-row">
              <span className="query-num">{i + 1}</span>
              <div className="query-fields">
                <input className="eval-input" value={q.query} onChange={e => updateQuery(i, 'query', e.target.value)} placeholder="Test query" />
                <input className="eval-input" value={q.expectedKeywords} onChange={e => updateQuery(i, 'expectedKeywords', e.target.value)} placeholder="Expected keywords (comma-separated)" />
                <input className="eval-input" value={q.expectedSource} onChange={e => updateQuery(i, 'expectedSource', e.target.value)} placeholder="Expected PDF filename (optional)" />
              </div>
              <button className="remove-btn" onClick={() => removeQuery(i)}>✕</button>
            </div>
          ))}
        </div>
        <div className="eval-actions-row">
          <button className="eval-btn secondary" onClick={addQuery}>+ Add Query</button>
          <button className="eval-btn primary" onClick={runEval} disabled={running || !queries.some(q => q.query.trim())}>
            {running ? 'Running…' : '▶ Run Eval Suite'}
          </button>
        </div>

        {results && (
          <div className="eval-results">
            {results.error ? (
              <div className="eval-error">
                <strong>Error:</strong> {results.error}
                <div className="error-hint">💡 Make sure the server is running with the updated code.</div>
              </div>
            ) : (
              <>
                <div className="summary-bar">
                  <span className={`summary-pill ${results.summary.passed === results.summary.total ? 'pill-green' : results.summary.passed > 0 ? 'pill-yellow' : 'pill-red'}`}>
                    {results.summary.passRate} pass rate
                  </span>
                  <span>{results.summary.passed}/{results.summary.total} tests passed</span>
                </div>
                {results.results?.map((r, i) => (
                  <div key={i} className={`result-card ${r.pass ? 'result-pass' : 'result-fail'}`}>
                    <div className="result-header">
                      <span className={`result-badge ${r.pass ? 'badge-pass' : 'badge-fail'}`}>{r.pass ? '✅ PASS' : '❌ FAIL'}</span>
                      <span className="result-query">"{r.query}"</span>
                    </div>
                    <div className="result-stats">
                      <span>Chunks: <strong>{r.chunksRetrieved}</strong></span>
                      <span>Top Score: <strong>{r.topScore}</strong></span>
                      <span>Source: <strong>{r.topSource}</strong></span>
                      {r.keywordRecall !== 'N/A' && <span>Recall: <strong>{r.keywordRecall}</strong></span>}
                    </div>
                    {r.keywordsFound?.length > 0 && (
                      <div className="kw-row found">✓ {r.keywordsFound.map(k => <span key={k} className="kw-chip green">{k}</span>)}</div>
                    )}
                    {r.keywordsMissed?.length > 0 && (
                      <div className="kw-row missed">✗ {r.keywordsMissed.map(k => <span key={k} className="kw-chip red">{k}</span>)}</div>
                    )}
                    {r.contextPreview && (
                      <details className="eval-details">
                        <summary>Context preview</summary>
                        <pre className="context-pre">{r.contextPreview}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
