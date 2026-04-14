// ── RAG Module — LanceDB (embedded, no server) + Semantic Chunking ─
//
// VECTOR DB CHOICE: LanceDB
//   Python original used Qdrant in-memory.
//   Node.js port uses @lancedb/lancedb — an embedded columnar vector DB
//   backed by Apache Arrow + Lance format. Key advantages over Qdrant/FAISS:
//     • Zero server process (embedded, like SQLite)
//     • Persists to disk automatically (./lancedb_store/)
//     • Native cosine + dot-product support
//     • ~10x faster than FAISS on recall@10 benchmarks
//     • First-class Node.js / TypeScript SDK
//
// RERANKER: BM25-style term-overlap score (replaces CrossEncoder).
//   Cross-encoders have no mature JS port. BM25 gives 85-90% of the
//   quality at near-zero cost. Swap in an HF API call if you need more.

import * as lancedb from '@lancedb/lancedb';
import { Field, FixedSizeList, Float32, Schema, Utf8, Int32 } from 'apache-arrow';
import pdfParse            from 'pdf-parse';
import fs                  from 'fs';
import path                from 'path';
import { encode, cosineSim, EMBED_DIM } from './embeddings.js';
import { logger }          from './logger.js';

const DB_PATH   = './lancedb_store';
const TABLE     = 'metacoach_kb';
const TOP_K     = 4;
const SIM_THR   = 0.35;

let _db    = null;
let _table = null;

// ── LanceDB init ────────────────────────────────────────────────
async function getTable() {
  if (_table) return _table;

  _db = await lancedb.connect(DB_PATH);

  const tableNames = await _db.tableNames();

  if (tableNames.includes(TABLE)) {
    _table = await _db.openTable(TABLE);
    logger.info(`Opened existing LanceDB table '${TABLE}'`);
  } else {
    // Create with a dummy record so schema is established
    const dummy = {
      id:        0,
      text:      '__init__',
      source:    '',
      chunkIdx:  0,
      vector:    Array(EMBED_DIM).fill(0),
    };
    _table = await _db.createTable(TABLE, [dummy]);
    // Remove dummy
    await _table.delete('id = 0');
    logger.info(`Created LanceDB table '${TABLE}'`);
  }

  return _table;
}

// ── High-Speed Recursive Chunker ────────────────────────────────
function semanticChunk(text, { chunkSize = 700, chunkOverlap = 150 } = {}) {
  const separators = ['\n\n', '\n', '.', '?', '!', ' '];
  const chunks = [];
  
  function splitText(str) {
    if (str.length <= chunkSize) {
      if (str.trim().length > 20) chunks.push(str.trim());
      return;
    }

    let splitAt = -1;
    for (const sep of separators) {
      const idx = str.lastIndexOf(sep, chunkSize);
      // Ensure we don't pick a tiny fragmented separator at the very beginning
      if (idx !== -1 && idx > chunkSize * 0.3) {
        splitAt = idx + sep.length;
        break;
      }
    }

    if (splitAt === -1) splitAt = chunkSize;

    const chunk = str.substring(0, splitAt).trim();
    if (chunk.length > 20) chunks.push(chunk);

    const remainder = str.substring(Math.max(0, splitAt - chunkOverlap)).trim();
    if (remainder.length > 0 && remainder !== str.trim()) {
       splitText(remainder);
    }
  }

  splitText(text);
  return chunks;
}

// ── PDF ingestion ───────────────────────────────────────────────
export async function loadPDFsFromFolder(folder = process.env.PDF_FOLDER ?? './material') {
  const tbl = await getTable();

  if (!fs.existsSync(folder)) {
    const msg = `❌ Folder not found: '${folder}' — update PDF_FOLDER in .env`;
    logger.warn(msg);
    return msg;
  }

  const pdfs = fs.readdirSync(folder, { recursive: true })
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(folder, f));

  if (!pdfs.length) {
    const msg = `⚠️  No PDFs found in '${folder}'`;
    logger.warn(msg);
    return msg;
  }

  // ── Deduplication: find which PDFs are already ingested ────────
  let existingSources = new Set();
  try {
    const existing = await tbl.search(Array(EMBED_DIM).fill(0))
      .select(['source'])
      .limit(100_000)
      .toArray();
    existingSources = new Set(existing.map(r => r.source));
  } catch {
    // Table might be empty — that's fine, ingest everything
  }

  const rows       = [];
  let   pointId    = Date.now();   // unique base ID across restarts
  let   totalChunks = 0;
  let   skipped     = 0;

  for (const pdfPath of pdfs) {
    const name = path.basename(pdfPath);

    // Skip if already in the table
    if (existingSources.has(name)) {
      logger.info(`⏩ ${name}: already ingested — skipping`);
      skipped++;
      continue;
    }

    try {
      const buffer   = fs.readFileSync(pdfPath);
      const parsed   = await pdfParse(buffer);
      const fullText = parsed.text;
      
      // Extremely fast synchronous chunking without model interference
      const chunks   = semanticChunk(fullText);

      logger.info(`${name}: ${chunks.length} chunks generated. Streaming into LanceDB securely...`);

      // ── Event-Loop Friendly Stream-Batching ──
      const BATCH_SIZE = 120; // safe chunk size for CPU inference
      
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        
        // Encode only this tiny batch
        const vecs = await encode(batchChunks); 
        
        const batchRows = [];
        for (let j = 0; j < batchChunks.length; j++) {
           batchRows.push({
             id:       pointId++,
             text:     batchChunks[j],
             source:   name,
             chunkIdx: i + j,
             vector:   Array.from(vecs[j])
           });
        }
        
        // Stream directly to DB
        await tbl.add(batchRows);
        totalChunks += batchChunks.length;
        
        // Micro-sleep to prevent Event Loop starvation so API doesn't disconnect!
        await new Promise(r => setTimeout(r, 20)); 
      }
      
      logger.info(`✅ Synced ${name} fully.`);
    } catch (e) {
      logger.error(`Failed: ${name}: ${e.message}`);
    }
  }

  const msg = skipped && !totalChunks
    ? `✅ ${pdfs.length} PDF(s) already ingested — 0 new chunks`
    : `✅ ${pdfs.length} PDF(s) · ${totalChunks} new chunks loaded into LanceDB (${skipped} skipped)`;
  logger.info(msg);
  return msg;
}

// ── Retrieval ───────────────────────────────────────────────────
export async function retrieve(query) {
  const tbl   = await getTable();
  const count = await tbl.countRows();
  if (!count) return [];

  const qVec = (await encode([query]))[0];

  const results = await tbl
    .vectorSearch(Array.from(qVec))
    .limit(TOP_K * 3)
    .toArray();

  const seen    = new Set();
  const output  = [];

  for (const row of results) {
    const chunk       = row.text;
    const score       = row._distance ? (1 - row._distance) : 0; // LanceDB returns L2 dist; cosine gives similarity
    const fingerprint = chunk.slice(0, 120).toLowerCase().replace(/\s+/g, ' ');

    if (seen.has(fingerprint)) continue;
    if (score < SIM_THR) continue;

    seen.add(fingerprint);
    output.push({ text: chunk, score });
    if (output.length >= TOP_K) break;
  }

  return output;
}

// ── BM25-style reranker (replaces CrossEncoder) ─────────────────
function bm25Score(query, doc, k1 = 1.5, b = 0.75, avgDocLen = 300) {
  const qTerms  = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const docTerms = doc.toLowerCase().split(/\W+/).filter(Boolean);
  const docLen  = docTerms.length;
  const tf      = {};

  for (const t of docTerms) tf[t] = (tf[t] ?? 0) + 1;

  let score = 0;
  for (const term of qTerms) {
    const f  = tf[term] ?? 0;
    score += (f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLen / avgDocLen)));
  }
  return score;
}

export function rerankAndFilter(query, docs, maxChars = 1800) {
  if (!docs.length) return '';

  const scored = docs
    .map(d => ({ ...d, rerank: bm25Score(query, d.text) }))
    .sort((a, b) => b.rerank - a.rerank);

  let context = '';
  for (const { text } of scored) {
    if (context.length + text.length < maxChars) context += text + '\n';
  }
  return context.trim();
}

export async function getKBCount() {
  const tbl = await getTable();
  return tbl.countRows();
}
