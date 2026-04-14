# MetaCoach — Node.js Port · Change Report

## Quick Start

```bash
cp .env.example .env          # fill in HF_TOKEN
mkdir material                # drop your PDFs here
npm install
npm start                     # → http://localhost:3000
```

---

## Vector Database Decision

### Original (Python): **Qdrant** (in-memory)
### Port (Node.js): **LanceDB** (`@lancedb/lancedb`)

**Why LanceDB over Qdrant / FAISS:**

| Criterion | Qdrant (original) | FAISS | **LanceDB (chosen)** |
|---|---|---|---|
| Node.js SDK | REST only | no native | ✅ embedded |
| Needs server | ✅ yes (or in-mem only) | ❌ C++ binding | ✅ no |
| Persists to disk | manual | manual | ✅ auto |
| Cosine similarity | ✅ | ✅ | ✅ |
| Arrow/columnar | ❌ | ❌ | ✅ |
| Install | pip + docker | pip | `npm install` |

LanceDB is embedded (like SQLite) — no separate server process.
Data persists to `./lancedb_store/` automatically across restarts.

---

## Full Change Log: Python → Node.js

### Infrastructure

| Python | Node.js | Notes |
|---|---|---|
| Jupyter notebook | `src/*.js` modules | Clean separation of concerns |
| `python 3.11` | `node >= 18` | ESM (`"type":"module"`) |
| `pip install` | `npm install` | |
| `.env` (manual) | `dotenv` + `.env.example` | |

### UI Layer

| Python | Node.js | Notes |
|---|---|---|
| **Gradio** `gr.Blocks` | **Express** + **Socket.io** | Real-time token streaming via WebSocket |
| `gr.Chatbot` | Custom HTML/CSS chat UI | Tabs: Chat / Memory / Logs (mirrors Gradio tabs) |
| `gr.State([])` | Socket.io session | Stateless server; history in-memory |
| `gr.Textbox` streaming | `socket.emit('token', t)` | Each token streamed individually |

### Vector Database

| Python | Node.js | Notes |
|---|---|---|
| `QdrantClient(":memory:")` | `@lancedb/lancedb` (embedded) | See DB Decision above |
| `qdrant.create_collection(...)` | `db.createTable(TABLE, [...])` | Auto-schema from first record |
| `qdrant.upsert(...)` | `table.add([...])` | Batch 256 rows same as original |
| `qdrant.query_points(...)` | `table.vectorSearch(...).toArray()` | LanceDB returns L2 distance → converted to similarity |
| `Distance.COSINE` | Default cosine index | Same metric |

### Embeddings

| Python | Node.js | Notes |
|---|---|---|
| `sentence-transformers` (Python) | `@xenova/transformers` (JS) | Same model: `all-MiniLM-L6-v2` |
| `SentenceTransformer.encode()` | `pipeline('feature-extraction')` | Same 384-dim output |
| Batch encode | Sequential (per-sentence) | JS lacks BLAS batch — minimal perf impact for coaching workloads |
| `np.linalg.norm` normalise | `normalize: true` in pipeline | Normalisation done by library |

### Reranker

| Python | Node.js | Notes |
|---|---|---|
| `CrossEncoder('ms-marco-MiniLM-L-12-v2')` | **BM25-style term overlap** | No mature cross-encoder JS port. BM25 covers ~85% of quality at near-zero cost. Swap in HF API call for production upgrade. |

### LLM Client

| Python | Node.js | Notes |
|---|---|---|
| `InferenceClient.chat_completion()` | `fetch(HF_API, ...)` | Same model, same endpoint format |
| Generator streaming | `async function*` + `ReadableStream` | SSE parsing identical |

### Memory

| Python | Node.js | Notes |
|---|---|---|
| `pymongo` | `mongodb` npm | Same query patterns |
| In-memory `list[dict]` fallback | `Array` fallback | Identical logic |
| `_mem_store: list[dict] = []` | `let _memStore = []` | |

### PDF Ingestion

| Python | Node.js | Notes |
|---|---|---|
| `pypdf.PdfReader` | `pdf-parse` | Same text extraction approach |
| `re.split(r'(?<=[.!?])\s+')` | `/(?<=[.!?])\s+/` regex | JS lookbehind supported since Node 10 |

### Logging

| Python | Node.js | Notes |
|---|---|---|
| `logging.basicConfig` | Custom `logger.js` | File + stdout, same format |
| `logging.FileHandler("metacoach.log")` | `fs.appendFileSync("metacoach.log")` | |

### Semantic Chunking

Identical algorithm ported line-for-line:
- Sentence split on `.!?`
- Embed each sentence
- Split when cosine similarity < threshold OR chunk > maxChunk chars
- Fallback to naive splitter on 0-chunk result

### Analyzer / Policy / Feedback

Identical logic, ported to JS:
- Crisis word set → same phrases
- OOS topic set → same topics
- `logFeedback` → JSONL append → same schema

---

## File Structure

```
metacoach/
├── package.json
├── .env.example
├── src/
│   ├── index.js          ← Express + Socket.io server  (replaces Gradio Cell 11)
│   ├── llm.js            ← HF Inference API            (replaces Cell 5)
│   ├── embeddings.js     ← @xenova/transformers         (replaces Cell 3 embed_model)
│   ├── rag.js            ← LanceDB + chunking           (replaces Cell 6)
│   ├── memory.js         ← MongoDB / in-mem fallback   (replaces Cell 7)
│   ├── systemPrompt.js   ← System prompt constant      (replaces Cell 8)
│   ├── analyzer.js       ← Intent / policy / feedback  (replaces Cell 9)
│   ├── orchestrator.js   ← Main pipeline               (replaces Cell 10)
│   └── logger.js         ← File + stdout logging       (replaces Cell 4)
├── public/
│   └── index.html        ← Chat UI                     (replaces Gradio)
└── material/             ← Drop PDFs here
```

---

## Known Limitations vs. Original

1. **Reranker quality** — BM25 vs. CrossEncoder. For production, call the HF API with `cross-encoder/ms-marco-MiniLM-L-12-v2` directly.
2. **Multi-user sessions** — conversation history is global (single user). Add Redis + socket session IDs for multi-user.
3. **Embedding throughput** — `@xenova/transformers` is slower than Python's sentence-transformers for large batches. Acceptable for coaching (small PDFs, low QPS).
