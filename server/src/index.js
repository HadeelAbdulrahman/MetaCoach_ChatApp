import 'dotenv/config';
import express          from 'express';
import { createServer } from 'http';
import { Server }       from 'socket.io';
import cors             from 'cors';
import multer           from 'multer';
import path             from 'path';
import fs               from 'fs';
import { fileURLToPath } from 'url';

import { logger }                                       from './logger.js';
import { initMemory, retrieveMemoryContext, isMongoOK } from './memory.js';
import { loadPDFsFromFolder, getKBCount, retrieve, rerankAndFilter, runRagEval, getLastRetrieval } from './rag.js';
import { orchestrator, clearHistory, getHistory }       from './orchestrator.js';
import { logFeedback }                                  from './analyzer.js';
import { initSessions, getSessions, getSession, createSession, deleteSession } from './sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 5000;
const CLIENT    = process.env.CLIENT_URL ?? 'http://localhost:5173';

const app    = express();
const server = createServer(app);
const io     = new Server(server, {
  cors: { origin: CLIENT, methods: ['GET', 'POST'] },
});

app.use(cors({ origin: CLIENT }));
app.use(express.json());

const upload = multer({ dest: process.env.PDF_FOLDER ?? './material' });

app.post('/api/upload', upload.array('pdfs'), async (req, res) => {
  const result = await loadPDFsFromFolder();
  res.json({ message: result });
});

app.get('/api/status', async (_req, res) => {
  const kbChunks = await getKBCount();
  res.json({
    kbChunks,
    pdfFolder:     process.env.PDF_FOLDER ?? './material',
    memoryBackend: isMongoOK() ? 'MongoDB' : 'in-memory',
    model:         'llama-3.3-70b-versatile',
    vectorDB:      'LanceDB',
  });
});

app.get('/api/memory', async (req, res) => {
  const ctx = await retrieveMemoryContext(req.query.q ?? '');
  res.json({ memory: ctx || 'No memory stored yet.' });
});

app.post('/api/feedback', (req, res) => {
  logFeedback(getHistory(), req.body.type);
  res.json({ ok: true });
});

app.post('/api/clear', (_req, res) => {
  clearHistory();
  res.json({ ok: true });
});

app.get('/api/logs', (_req, res) => {
  res.json({ logs: logger.readLast(60) });
});

// ── Sessions API ────────────────────────────────────────────────
app.get('/api/sessions', async (_req, res) => {
  const sessions = await getSessions();
  res.json(sessions);
});

app.post('/api/sessions', async (_req, res) => {
  const session = await createSession();
  res.json(session);
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

app.delete('/api/sessions/:id', async (req, res) => {
  await deleteSession(req.params.id);
  res.json({ ok: true });
});

// ── RAG Debug — last retrieval snapshot ─────────────────────────
app.get('/api/rag-debug', (_req, res) => {
  const last = getLastRetrieval();
  if (!last) return res.json({ message: 'No retrieval yet. Send a chat message first.' });
  res.json(last);
});

// ── RAG Eval — run a test suite against the vector store ─────────
app.post('/api/rag-eval', async (req, res) => {
  try {
    const { queries } = req.body;
    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({ error: 'Body must be { queries: [{ query, expectedKeywords?, expectedSource? }] }' });
    }
    const evalResult = await runRagEval(queries);
    res.json(evalResult);
  } catch (e) {
    logger.error(`RAG eval error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ── RAG Quick Probe — test a single query retrieval ─────────────
app.get('/api/rag-probe', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Pass ?q=your+query' });
    const docs = await retrieve(query);
    const context = rerankAndFilter(query, docs);
    res.json({
      query,
      chunksFound: docs.length,
      chunks: docs.map(d => ({ source: d.source, score: d.score.toFixed(3), preview: d.text.slice(0, 200) })),
      fullContext: context.slice(0, 1000)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Socket.io — streaming ────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('chat', async ({ sessionId, message }) => {
    try {
      for await (const token of orchestrator(message, sessionId)) {
        socket.emit('token', token);
      }
      socket.emit('done');
    } catch (e) {
      logger.error(`Socket chat error: ${e.message}`);
      socket.emit('error', `⚠️ ${e.message}`);
    }
  });

  socket.on('disconnect', () => logger.info(`Client disconnected: ${socket.id}`));
});

// ── Startup ───────────────────────────────────────────────────────
async function main() {
  logger.info('═'.repeat(60));
  logger.info('MetaCoach server starting...');

  await initMemory();
  await initSessions();

  const materialDir = process.env.PDF_FOLDER ?? './material';
  if (!fs.existsSync(materialDir)) fs.mkdirSync(materialDir, { recursive: true });

  const ingest = await loadPDFsFromFolder();
  logger.info(ingest);

  server.listen(PORT, () => {
    logger.info(`✅ Server → http://localhost:${PORT}`);
    console.log(`\n🧠 MetaCoach API → http://localhost:${PORT}\n`);
  });
}

main().catch(e => { logger.error(e.message); process.exit(1); });
