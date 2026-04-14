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
import { loadPDFsFromFolder, getKBCount }               from './rag.js';
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

// ── Middleware ───────────────────────────────────────────────────
app.use(cors({ origin: CLIENT }));
app.use(express.json());

// ── File upload (drag-and-drop PDFs) ────────────────────────────
const upload = multer({ dest: process.env.PDF_FOLDER ?? './material' });

app.post('/api/upload', upload.array('pdfs'), async (req, res) => {
  const result = await loadPDFsFromFolder();
  res.json({ message: result });
});

// ── REST API ─────────────────────────────────────────────────────
app.get('/api/status', async (_req, res) => {
  const kbChunks = await getKBCount();
  res.json({
    kbChunks,
    pdfFolder:     process.env.PDF_FOLDER ?? './material',
    memoryBackend: isMongoOK() ? 'MongoDB' : 'in-memory',
    model:         'mistralai/Mistral-7B-Instruct-v0.3',
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

// // ── Graceful Shutdown for node --watch ───────────────────────────
// function shutdown() {
//   logger.info('Shutting down server, releasing port...');
//   server.close(() => {
//     process.exit(0);
//   });
// }

// process.on('SIGINT', shutdown);
// process.on('SIGTERM', shutdown);