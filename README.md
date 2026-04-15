# AI Meta-Coach v2

A RAG-powered coaching assistant grounded in your PDF knowledge base.

## What Changed in v2

### 🐛 Critical RAG Bug Fixed
LanceDB returns **L2 distance**, not cosine distance. The original code used
`1 - L2_distance` which is wrong for normalized vectors. The correct formula is:
```
cosine_similarity = 1 - (L2_distance² / 2)
```
This caused nearly all relevant chunks to score below the threshold (0.35),
meaning the model had zero KB context and was responding from its training knowledge only.

### New Features
- **Voice input** — browser Web Speech API mic button in the chat input
- **White + green UI** — full design overhaul (DM Sans + DM Serif Display)
- **RAG Eval tab** — test your retrieval pipeline directly in the UI
- **Auto-refresh logs** — live log view with color coding and filter
- **Affirmation suppression** — system prompt bans hollow openers

---

## Setup

```bash
# Server
cd server && npm install
echo "GROQ_API_KEY=your_key" > .env
node src/index.js

# Client
cd client && npm install && npm run dev
```

Put PDFs in `server/material/` before starting.

---

## RAG Debugging & Evaluation

### Quick Probe (UI)
Go to **🔬 RAG Eval** tab → Quick Probe. Type any query and see which chunks were retrieved and their cosine similarity scores.

### Quick Probe (API)
```
GET /api/rag-probe?q=what+does+the+doc+say+about+habits
```

### Last Chat Snapshot (UI)
After sending any chat message, open RAG Eval → "Last Chat Retrieval Snapshot" → Load Debug.
Shows exactly what was retrieved, all candidate scores, and threshold pass/fail.

### Last Retrieval (API)
```
GET /api/rag-debug
```

### Eval Suite (UI)
Define test queries with expected keywords and run a batch evaluation to score your RAG pipeline.

### Eval Suite (API)
```bash
POST /api/rag-eval
Content-Type: application/json

{
  "queries": [
    {
      "query": "What is the meta-learning framework?",
      "expectedKeywords": ["meta", "learning", "framework"],
      "expectedSource": "metacoach_guide.pdf"
    },
    {
      "query": "How do I build better habits?",
      "expectedKeywords": ["habit", "routine", "consistency"]
    }
  ]
}
```

Response:
```json
{
  "summary": { "total": 2, "passed": 2, "failed": 0, "passRate": "100%" },
  "results": [
    {
      "query": "...",
      "chunksRetrieved": 5,
      "topScore": "0.821",
      "topSource": "metacoach_guide.pdf",
      "keywordRecall": "3/3 (100%)",
      "keywordsFound": ["meta", "learning", "framework"],
      "keywordsMissed": [],
      "sourceMatch": true,
      "pass": true
    }
  ]
}
```

---

## Evaluation Criteria

| Metric | Description | Healthy Range |
|--------|-------------|---------------|
| `chunksRetrieved` | Chunks passing cosine threshold | ≥ 1 per query |
| `topScore` | Best cosine similarity | > 0.4 = strong |
| `keywordRecall` | Expected keywords found in context | ≥ 70% |
| `sourceMatch` | Correct PDF was retrieved | true |
| `passRate` | % of eval queries that passed | ≥ 80% |

**If chunksRetrieved = 0:**
1. Check `/api/rag-debug` candidate cosines — if all < 0.15, the query doesn't match KB vocabulary
2. Try rephrasing the query using terms from your PDFs
3. Check that PDFs were actually ingested (see `📚 N chunks` in the header)
4. Use `/api/rag-probe` to test specific queries before chatting

---

## Architecture

```
Client (React + Vite)
  └── Chat.jsx        — messaging + voice input
  └── RagEval.jsx     — retrieval testing UI
  └── Memory.jsx      — memory viewer
  └── Logs.jsx        — server log viewer

Server (Node.js + Express + Socket.IO)
  └── orchestrator.js — pipeline coordinator
  └── rag.js          — LanceDB vector store + retrieval
  └── embeddings.js   — all-MiniLM-L6-v2 (local, ~22MB)
  └── memory.js       — MongoDB or in-memory
  └── sessions.js     — conversation sessions
  └── llm.js          — Groq Llama 3.3 70B (streaming)
  └── analyzer.js     — intent detection + query rewriting
```
