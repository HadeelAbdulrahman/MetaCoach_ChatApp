// ── RAG Module v2 — LanceDB + Score Fix + Guaranteed Fallback ────
//
// SCORE FIX: LanceDB returns L2 distance. For normalized vectors:
//   cosine_similarity = 1 - (L2² / 2)
// Original used (1 - L2) which silently discarded all valid chunks.
//
// GUARANTEED FALLBACK: If nothing passes the threshold, return the
// top 3 by raw score anyway. KB context is always better than nothing.

import * as lancedb from '@lancedb/lancedb';
import pdfParse     from 'pdf-parse';
import fs           from 'fs';
import path         from 'path';
import { encode, EMBED_DIM } from './embeddings.js';
import { logger }            from './logger.js';

const DB_PATH  = './lancedb_store';
const TABLE    = 'metacoach_kb';
const TOP_K    = 10;
const SIM_THR  = 0.10;   // soft threshold — fallback bypasses this anyway
const FALLBACK_K = 3;    // guaranteed top-K even if below threshold

let _db    = null;
let _table = null;
let _lastRetrieval = null;

export function getLastRetrieval() { return _lastRetrieval; }

async function getTable() {
  if (_table) return _table;
  _db = await lancedb.connect(DB_PATH);
  const names = await _db.tableNames();
  if (names.includes(TABLE)) {
    _table = await _db.openTable(TABLE);
    logger.info(`Opened LanceDB table '${TABLE}'`);
  } else {
    const dummy = { id: 0, text: '__init__', source: '', chunkIdx: 0, vector: Array(EMBED_DIM).fill(0) };
    _table = await _db.createTable(TABLE, [dummy]);
    await _table.delete('id = 0');
    logger.info(`Created LanceDB table '${TABLE}'`);
  }
  return _table;
}

// ── Chunker ──────────────────────────────────────────────────────
function semanticChunk(text, { chunkSize = 700, chunkOverlap = 150 } = {}) {
  const separators = ['\n\n', '\n', '.', '?', '!', ' '];
  const chunks = [];
  function splitText(str) {
    if (str.length <= chunkSize) { if (str.trim().length > 20) chunks.push(str.trim()); return; }
    let splitAt = -1;
    for (const sep of separators) {
      const idx = str.lastIndexOf(sep, chunkSize);
      if (idx !== -1 && idx > chunkSize * 0.3) { splitAt = idx + sep.length; break; }
    }
    if (splitAt === -1) splitAt = chunkSize;
    const chunk = str.substring(0, splitAt).trim();
    if (chunk.length > 20) chunks.push(chunk);
    const remainder = str.substring(Math.max(0, splitAt - chunkOverlap)).trim();
    if (remainder.length > 0 && remainder !== str.trim()) splitText(remainder);
  }
  splitText(text);
  return chunks;
}

// ── PDF ingestion ────────────────────────────────────────────────
export async function loadPDFsFromFolder(folder = process.env.PDF_FOLDER ?? './material') {
  const tbl = await getTable();
  if (!fs.existsSync(folder)) { const m = `❌ Folder not found: '${folder}'`; logger.warn(m); return m; }
  const pdfs = fs.readdirSync(folder, { recursive: true })
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(folder, f));
  if (!pdfs.length) { const m = `⚠️  No PDFs in '${folder}'`; logger.warn(m); return m; }

  let existingSources = new Set();
  try {
    const existing = await tbl.search(Array(EMBED_DIM).fill(0)).select(['source']).limit(100_000).toArray();
    existingSources = new Set(existing.map(r => r.source));
  } catch {}

  let pointId = Date.now(), totalChunks = 0, skipped = 0;
  for (const pdfPath of pdfs) {
    const name = path.basename(pdfPath);
    if (existingSources.has(name)) { logger.info(`⏩ ${name}: already ingested`); skipped++; continue; }
    try {
      const buffer = fs.readFileSync(pdfPath);
      const parsed = await pdfParse(buffer);
      const chunks = semanticChunk(parsed.text);
      logger.info(`${name}: ${chunks.length} chunks → LanceDB...`);
      const BATCH = 120;
      for (let i = 0; i < chunks.length; i += BATCH) {
        const batch = chunks.slice(i, i + BATCH);
        const vecs  = await encode(batch);
        await tbl.add(batch.map((c, j) => ({ id: pointId++, text: c, source: name, chunkIdx: i + j, vector: Array.from(vecs[j]) })));
        totalChunks += batch.length;
        await new Promise(r => setTimeout(r, 20));
      }
      logger.info(`✅ ${name} synced`);
    } catch (e) { logger.error(`Failed ${name}: ${e.message}`); }
  }
  const msg = skipped && !totalChunks
    ? `✅ All PDFs already ingested (${skipped} skipped)`
    : `✅ ${totalChunks} new chunks from ${pdfs.length} PDF(s) (${skipped} skipped)`;
  logger.info(msg);
  return msg;
}

// ── L2 distance → cosine similarity (for normalized vectors) ────
// cosine_sim = 1 - (L2² / 2)   range: [-1, 1] but practically [0, 1]
function l2ToCosine(l2) { return 1 - (l2 * l2) / 2; }

// ── Retrieval ────────────────────────────────────────────────────
export async function retrieve(query) {
  const tbl   = await getTable();
  const count = await tbl.countRows();
  if (!count) { logger.warn('RAG: table is empty'); return []; }

  const qVec    = (await encode([query]))[0];
  const results = await tbl.vectorSearch(Array.from(qVec)).limit(TOP_K * 3).toArray();

  const seen     = new Set();
  const passed   = [];   // above threshold
  const allScored = [];  // all for fallback + debug

  for (const row of results) {
    const l2    = row._distance ?? 0;
    const score = l2ToCosine(l2);
    const fp    = row.text.slice(0, 120).toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(fp)) continue;
    seen.add(fp);

    const entry = { text: row.text, score, source: row.source, l2: l2.toFixed(3) };
    allScored.push(entry);
    if (score >= SIM_THR && passed.length < TOP_K) passed.push(entry);
  }

  // ── Guaranteed fallback: if nothing passed threshold, return top-K ─
  let output = passed;
  if (output.length === 0 && allScored.length > 0) {
    output = allScored.slice(0, FALLBACK_K);
    logger.warn(`RAG FALLBACK: 0 passed threshold (${SIM_THR}), using top ${output.length} by raw score. Top cosine=${output[0]?.score?.toFixed(3)}`);
  }

  // ── Store debug snapshot ─────────────────────────────────────
  _lastRetrieval = {
    query, timestamp: new Date().toISOString(),
    retrieved: output.length, usedFallback: passed.length === 0 && output.length > 0,
    threshold: SIM_THR,
    topResults: output.map(d => ({ source: d.source, score: d.score.toFixed(3), preview: d.text.slice(0, 150) })),
    allCandidates: allScored.map(d => ({ text: d.text.slice(0, 100), source: d.source, l2: d.l2, cosine: d.score.toFixed(3) }))
  };

  logger.info(`RAG: "${query.slice(0, 60)}" → ${output.length} chunks (fallback=${passed.length === 0}) | top score=${output[0]?.score?.toFixed(3) ?? 'N/A'}`);
  return output;
}

// ── BM25-style reranker ──────────────────────────────────────────
function bm25Score(query, doc, k1 = 1.5, b = 0.75, avgLen = 300) {
  const qTerms = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const terms  = doc.toLowerCase().split(/\W+/).filter(Boolean);
  const tf     = {};
  for (const t of terms) tf[t] = (tf[t] ?? 0) + 1;
  let score = 0;
  for (const term of qTerms) {
    const f = tf[term] ?? 0;
    score += (f * (k1 + 1)) / (f + k1 * (1 - b + b * (terms.length / avgLen)));
  }
  return score;
}

export function rerankAndFilter(query, docs, maxChars = 4000) {
  if (!docs.length) return '';
  const scored = docs.map(d => ({ ...d, bm25: bm25Score(query, d.text) })).sort((a, b) => b.bm25 - a.bm25);
  let ctx = '';
  for (const { text, source } of scored) {
    const entry = `[Source: ${source}]\n${text}\n`;
    if (ctx.length + entry.length < maxChars) ctx += entry + '\n';
  }
  return ctx.trim();
}

export async function getKBCount() {
  const tbl = await getTable();
  return tbl.countRows();
}

// ── RAG Eval Runner ──────────────────────────────────────────────
export async function runRagEval(testQueries) {
  const results = [];
  for (const { query, expectedKeywords = [], expectedSource = null } of testQueries) {
    const docs    = await retrieve(query);
    const context = rerankAndFilter(query, docs);
    const hits    = expectedKeywords.filter(kw => context.toLowerCase().includes(kw.toLowerCase()));
    const srcHit  = expectedSource ? docs.some(d => d.source?.toLowerCase().includes(expectedSource.toLowerCase())) : null;
    results.push({
      query, chunksRetrieved: docs.length,
      topScore: docs[0]?.score?.toFixed(3) ?? 'N/A',
      topSource: docs[0]?.source ?? 'none',
      keywordRecall: expectedKeywords.length ? `${hits.length}/${expectedKeywords.length} (${Math.round(hits.length / expectedKeywords.length * 100)}%)` : 'N/A',
      keywordsFound: hits,
      keywordsMissed: expectedKeywords.filter(k => !hits.includes(k)),
      sourceMatch: srcHit,
      contextPreview: context.slice(0, 300),
      pass: docs.length > 0 && (expectedKeywords.length === 0 || hits.length > 0)
    });
  }
  const passed = results.filter(r => r.pass).length;
  return { summary: { total: results.length, passed, failed: results.length - passed, passRate: `${Math.round(passed / results.length * 100)}%` }, results };
}
