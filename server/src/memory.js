// ── Memory Module — MongoDB or in-memory fallback ─────────────────

import { MongoClient } from 'mongodb';
import { encode, cosineSim } from './embeddings.js';
import { callLLM }           from './llm.js';
import { logger }            from './logger.js';

const MONGO_URI = process.env.MONGO_URI   ?? 'mongodb://localhost:27017';
const USE_MONGO = process.env.USE_MONGO   !== 'false';

let _mongoClient = null;
let _memoryCol   = null;
let _MONGO_OK    = false;
let _memStore    = []; // in-memory fallback (array of objects)
let _nextId      = 0;

// ── Sentiment word sets ──────────────────────────────────────────
const _POS = new Set([
  'happy','excited','motivated','great','love','enjoy','succeed',
  'proud','confident','hopeful','grateful','energized','focused',
  'win','positive','progress','achieve','enthusiastic','inspired',
]);
const _NEG = new Set([
  'sad','anxious','stressed','frustrated','fail','hate','worried',
  'tired','stuck','overwhelmed','depressed','scared','angry',
  'hopeless','lost','confused','struggle','difficult','dread','fear',
]);

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
  if (existingSimilar) score = Math.min(score + 0.20, 1.0);
  if (text.split(/\s+/).length > 12) score = Math.min(score + 0.10, 1.0);
  return Math.round(score * 1000) / 1000;
}

// ── MongoDB init ─────────────────────────────────────────────────
export async function initMemory() {
  if (!USE_MONGO) {
    logger.info('MongoDB disabled — using in-memory dict store');
    return;
  }
  try {
    _mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await _mongoClient.connect();
    await _mongoClient.db('admin').command({ ping: 1 });

    const db   = _mongoClient.db('metacoach');
    _memoryCol = db.collection('memory');
    await _memoryCol.createIndex({ category: 1, importance: -1 });

    _MONGO_OK = true;
    logger.info(`✅ MongoDB connected @ ${MONGO_URI}`);
  } catch (e) {
    logger.warn(`⚠️  MongoDB not reachable (${e.message}) — using in-memory dict store`);
    _MONGO_OK = false;
  }
}

// ── Storage helpers ───────────────────────────────────────────────
async function _getByCat(category) {
  if (_MONGO_OK) {
    return _memoryCol.find({ category }, { projection: { _id: 1, embedding: 1 } }).toArray();
  }
  return _memStore.filter(r => r.category === category);
}

async function _boost(id, ts) {
  if (_MONGO_OK) {
    await _memoryCol.updateOne({ _id: id }, { $inc: { importance: 0.15 }, $set: { timestamp: ts } });
    await _memoryCol.updateOne({ _id: id, importance: { $gt: 1.0 } }, { $set: { importance: 1.0 } });
  } else {
    const rec = _memStore.find(r => r._id === id);
    if (rec) {
      rec.importance = Math.min(rec.importance + 0.15, 1.0);
      rec.timestamp  = ts;
    }
  }
}

async function _insert(doc) {
  if (_MONGO_OK) {
    await _memoryCol.insertOne(doc);
  } else {
    doc._id = _nextId++;
    _memStore.push(doc);
  }
}

async function _getAll(limit = 60) {
  if (_MONGO_OK) {
    return _memoryCol
      .find({}, { projection: { text: 1, category: 1, importance: 1, embedding: 1 } })
      .sort({ importance: -1, timestamp: -1 })
      .limit(limit)
      .toArray();
  }
  return [..._memStore]
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || (b.timestamp ?? '') - (a.timestamp ?? ''))
    .slice(0, limit);
}

// ── LLM-based memory extraction ──────────────────────────────────
export async function extractMemory(userInput) {
  const prompt = `Extract structured memory from this coaching message.
Return ONLY valid JSON — a list of objects, or [] if nothing applies.

Schema: [{"text": "short summary ≤20 words", "category": "goal"|"preference"|"habit"|"emotion"}]

Rules:
- goal       : concrete outcome the user wants to achieve
- preference : how they like to work or what they value
- habit      : a routine or regular behaviour they mention
- emotion    : a significant feeling or emotional state
- Return []  if nothing clearly applies — do NOT invent entries
- Max 3 items per message

Message: "${userInput}"

JSON:`;

  const raw  = await callLLM([{ role: 'user', content: prompt }], { temperature: 0, maxNewTokens: 200 });
  const VALID = new Set(['goal', 'preference', 'habit', 'emotion']);

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\[.*?\]/s);
    if (match) {
      const items = JSON.parse(match[0]);
      return items.filter(i => i?.text && VALID.has(i?.category))
                  .map(i => ({ text: String(i.text).slice(0, 200), category: i.category }));
    }
  } catch (e) {
    logger.warn(`extractMemory parse error: ${e.message} | raw: ${raw.slice(0, 120)}`);
  }
  return [];
}

// ── Public API ────────────────────────────────────────────────────
export async function updateMemory(userInput) {
  const items = await extractMemory(userInput);
  if (!items.length) return;

  const ts = new Date().toISOString();

  for (const item of items) {
    const { text, category } = item;
    const sentiment = detectSentiment(text);
    const [embVec]  = await encode([text]);
    const embedding = Array.from(embVec);

    const existing = await _getByCat(category);
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
      const importance = scoreImportance(text, sentiment, false);
      await _insert({ text, category, sentiment, importance, embedding, timestamp: ts });
    }
  }
}

export async function retrieveMemoryContext(query = '', topK = 5) {
  const rows = await _getAll();
  if (!rows.length) return '';

  let selected;

  if (query.trim()) {
    const [qVec]  = await encode([query]);
    const scored  = rows
      .filter(r => r.embedding)
      .map(r => {
        const memVec = Float32Array.from(r.embedding);
        const sim    = cosineSim(qVec, memVec);
        return { score: sim * (r.importance ?? 0.5), text: r.text, category: r.category };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    selected = scored;
  } else {
    selected = rows.slice(0, topK).map(r => ({ text: r.text, category: r.category }));
  }

  const byCat = {};
  for (const { text, category } of selected) {
    const label = category.charAt(0).toUpperCase() + category.slice(1) + 's';
    (byCat[label] ??= []).push(text);
  }

  return Object.entries(byCat)
    .map(([label, items]) => `${label}: ${items.join('; ')}`)
    .join('\n');
}

export const isMongoOK = () => _MONGO_OK;
