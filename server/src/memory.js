// ── Memory Module — MongoDB or in-memory fallback ─────────────────
// v3 FIX: retrieveMemoryContext now applies a minimum relevance threshold
// so memories from unrelated past sessions don't bleed into new chats.

import { MongoClient } from 'mongodb';
import { encode, cosineSim } from './embeddings.js';
import { logger }            from './logger.js';

const MONGO_URI = process.env.MONGO_URI   ?? 'mongodb://localhost:27017';
const USE_MONGO = process.env.USE_MONGO   !== 'false';

// Minimum combined relevance score to include a memory in context.
// score = cosineSim(query, memory) * importance
// A cosine of 0.55 with importance 0.55 = 0.30 → included
// A cosine of 0.25 with importance 0.75 = 0.19 → excluded (not relevant enough)
const MEMORY_RELEVANCE_THRESHOLD = 0.28;

let _mongoClient = null;
let _memoryCol   = null;
let _MONGO_OK    = false;
let _memStore    = [];
let _nextId      = 0;

const _POS = new Set(['happy','excited','motivated','great','love','enjoy','succeed','proud','confident','hopeful','grateful','energized','focused','win','positive','progress','achieve','enthusiastic','inspired']);
const _NEG = new Set(['sad','anxious','stressed','frustrated','fail','hate','worried','tired','stuck','overwhelmed','depressed','scared','angry','hopeless','lost','confused','struggle','difficult','dread','fear']);

function detectSentiment(text) {
  const words = new Set(text.toLowerCase().match(/\b\w+\b/g) ?? []);
  const pos = [...words].filter(w => _POS.has(w)).length;
  const neg = [...words].filter(w => _NEG.has(w)).length;
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function scoreImportance(text, sentiment, existingSimilar) {
  const base = { positive: 0.55, negative: 0.75, neutral: 0.40 }[sentiment];
  let score  = base;
  if (existingSimilar)                    score = Math.min(score + 0.20, 1.0);
  if (text.split(/\s+/).length > 12)      score = Math.min(score + 0.10, 1.0);
  return Math.round(score * 1000) / 1000;
}

export async function initMemory() {
  if (!USE_MONGO) { logger.info('MongoDB disabled — using in-memory store'); return; }
  try {
    _mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await _mongoClient.connect();
    await _mongoClient.db('admin').command({ ping: 1 });
    const db = _mongoClient.db('metacoach');
    _memoryCol = db.collection('memory');
    await _memoryCol.createIndex({ category: 1, importance: -1 });
    _MONGO_OK = true;
    logger.info(`✅ MongoDB connected @ ${MONGO_URI}`);
  } catch (e) {
    logger.warn(`⚠️  MongoDB not reachable (${e.message}) — using in-memory store`);
    _MONGO_OK = false;
  }
}

async function _getByCat(category) {
  if (_MONGO_OK) return _memoryCol.find({ category }, { projection: { _id: 1, embedding: 1 } }).toArray();
  return _memStore.filter(r => r.category === category);
}

async function _boost(id, ts) {
  if (_MONGO_OK) {
    await _memoryCol.updateOne({ _id: id }, { $inc: { importance: 0.15 }, $set: { timestamp: ts } });
    await _memoryCol.updateOne({ _id: id, importance: { $gt: 1.0 } }, { $set: { importance: 1.0 } });
  } else {
    const rec = _memStore.find(r => r._id === id);
    if (rec) { rec.importance = Math.min(rec.importance + 0.15, 1.0); rec.timestamp = ts; }
  }
}

async function _insert(doc) {
  if (_MONGO_OK) { await _memoryCol.insertOne(doc); }
  else { doc._id = _nextId++; _memStore.push(doc); }
}

async function _getAll(limit = 60) {
  if (_MONGO_OK) {
    return _memoryCol.find({}, { projection: { text: 1, category: 1, importance: 1, embedding: 1 } })
      .sort({ importance: -1, timestamp: -1 }).limit(limit).toArray();
  }
  return [..._memStore]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (b.timestamp ?? '') - (a.timestamp ?? ''))
    .slice(0, limit);
}

// ── Local memory extraction — NO LLM call ────────────────────────
// Uses keyword/pattern matching to classify user input into memory categories.
// This saves 1 Groq API call per message (~50% rate limit savings).

const _GOAL_PATTERNS = /\b(i want to|my goal|i aim|i plan to|i need to|i'm trying to|i hope to|i wish to|i'd like to|i intend to|target is|objective is|i will|i'm going to)\b/i;
const _HABIT_PATTERNS = /\b(every day|daily|routine|habit|i usually|i always|i tend to|morning|evening|weekly|i regularly|each week|schedule)\b/i;
const _PREF_PATTERNS = /\b(i prefer|i like|i enjoy|i love|i hate|i dislike|i value|important to me|matters to me|rather|my style|works for me|comfortable with)\b/i;
const _EMOTION_KEYWORDS = new Set([..._POS, ..._NEG, 'anxious', 'overwhelmed', 'excited', 'nervous', 'calm', 'peaceful', 'burnout', 'lonely', 'content', 'fulfilled']);

export function extractMemory(userInput) {
  const text = userInput.trim();
  if (text.split(/\s+/).length < 5) return []; // too short to extract anything

  const items = [];
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);

  for (const sentence of sentences) {
    if (items.length >= 3) break;

    if (_GOAL_PATTERNS.test(sentence)) {
      items.push({ text: sentence.slice(0, 200), category: 'goal' });
    } else if (_HABIT_PATTERNS.test(sentence)) {
      items.push({ text: sentence.slice(0, 200), category: 'habit' });
    } else if (_PREF_PATTERNS.test(sentence)) {
      items.push({ text: sentence.slice(0, 200), category: 'preference' });
    } else {
      const words = new Set(sentence.toLowerCase().match(/\b\w+\b/g) ?? []);
      const emotionHits = [...words].filter(w => _EMOTION_KEYWORDS.has(w));
      if (emotionHits.length >= 1) {
        items.push({ text: sentence.slice(0, 200), category: 'emotion' });
      }
    }
  }

  return items;
}

export async function updateMemory(userInput) {
  const items = await extractMemory(userInput);
  if (!items.length) return;
  const ts = new Date().toISOString();
  for (const item of items) {
    const { text, category } = item;
    const sentiment = detectSentiment(text);
    const [embVec]  = await encode([text]);
    const embedding = Array.from(embVec);
    const existing  = await _getByCat(category);
    let foundSimilar = false;
    for (const row of existing) {
      if (!row.embedding) continue;
      const rowVec = Float32Array.from(row.embedding);
      if (cosineSim(embVec, rowVec) > 0.80) {
        await _boost(row._id, ts);
        foundSimilar = true;
        break;
      }
    }
    if (!foundSimilar) {
      await _insert({ text, category, sentiment, importance: scoreImportance(text, sentiment, false), embedding, timestamp: ts });
    }
  }
}

// ── retrieveMemoryContext — WITH RELEVANCE GATE ──────────────────
// Only returns memories that are genuinely similar to the current query.
// Prevents past unrelated session context from bleeding into new chats.
export async function retrieveMemoryContext(query = '', topK = 4) {
  const rows = await _getAll();
  if (!rows.length) return '';

  if (!query.trim()) return ''; // Don't inject memory for empty/trivial input

  const [qVec] = await encode([query]);
  const scored = rows
    .filter(r => r.embedding)
    .map(r => {
      const memVec = Float32Array.from(r.embedding);
      const sim    = cosineSim(qVec, memVec);
      return { score: sim * (r.importance ?? 0.5), sim, text: r.text, category: r.category };
    })
    .filter(r => r.score >= MEMORY_RELEVANCE_THRESHOLD) // ← RELEVANCE GATE
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (!scored.length) {
    logger.info(`MEMORY: 0 entries passed threshold (${MEMORY_RELEVANCE_THRESHOLD}) for query "${query.slice(0,50)}"`);
    return '';
  }

  logger.info(`MEMORY: ${scored.length} relevant entries found (top score=${scored[0].score.toFixed(3)})`);

  const byCat = {};
  for (const { text, category } of scored) {
    const label = category.charAt(0).toUpperCase() + category.slice(1) + 's';
    (byCat[label] ??= []).push(text);
  }
  return Object.entries(byCat).map(([label, items]) => `${label}: ${items.join('; ')}`).join('\n');
}

export const isMongoOK = () => _MONGO_OK;
