import { MongoClient, ObjectId } from 'mongodb';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

const MONGO_URI = process.env.MONGO_URI   ?? 'mongodb://localhost:27017';
const USE_MONGO = process.env.USE_MONGO   !== 'false';
const SESSIONS_FILE = './sessions.jsonl';

let _mongoClient = null;
let _sessionsCol = null;
let _MONGO_OK    = false;
let _memSessions = []; // Fallback for file-based storage

export async function initSessions() {
  if (!USE_MONGO) {
    logger.info('Sessions: Using local file storage (JSONL)');
    _loadLocalSessions();
    return;
  }
  try {
    _mongoClient = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    await _mongoClient.connect();
    const db = _mongoClient.db('metacoach');
    _sessionsCol = db.collection('sessions');
    await _sessionsCol.createIndex({ updatedAt: -1 });
    _MONGO_OK = true;
    logger.info('✅ Sessions: MongoDB connected');
  } catch (e) {
    logger.warn(`⚠️  Sessions: MongoDB unreachable (${e.message}) — using JSONL`);
    _MONGO_OK = false;
    _loadLocalSessions();
  }
}

function _loadLocalSessions() {
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const content = fs.readFileSync(SESSIONS_FILE, 'utf8');
      _memSessions = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (e) {
      logger.error(`Error loading local sessions: ${e.message}`);
    }
  }
}

function _saveLocalSessions() {
  const content = _memSessions.map(s => JSON.stringify(s)).join('\n');
  fs.writeFileSync(SESSIONS_FILE, content, 'utf8');
}

export async function getSessions() {
  if (_MONGO_OK) {
    // Return summaries only (id, title, updatedAt)
    return _sessionsCol.find({}, { projection: { messages: 0 } }).sort({ updatedAt: -1 }).toArray();
  }
  return _memSessions.map(({ messages, ...rest }) => rest).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getSession(id) {
  if (_MONGO_OK) {
    try {
      return _sessionsCol.findOne({ _id: new ObjectId(id) });
    } catch (e) {
      return null;
    }
  }
  return _memSessions.find(s => s._id === id) || null;
}

export async function createSession(title = 'New Chat') {
  const newSession = {
    title,
    messages: [],
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  if (_MONGO_OK) {
    const res = await _sessionsCol.insertOne(newSession);
    return { ...newSession, _id: res.insertedId };
  } else {
    newSession._id = Date.now().toString();
    _memSessions.push(newSession);
    _saveLocalSessions();
    return newSession;
  }
}

export async function updateSession(id, updates) {
  updates.updatedAt = new Date().toISOString();
  if (_MONGO_OK) {
    try {
      await _sessionsCol.updateOne({ _id: new ObjectId(id) }, { $set: updates });
    } catch (e) {
      logger.error(`Error updating session ${id}: ${e.message}`);
    }
  } else {
    const idx = _memSessions.findIndex(s => s._id === id);
    if (idx !== -1) {
      _memSessions[idx] = { ..._memSessions[idx], ...updates };
      _saveLocalSessions();
    }
  }
}

export async function deleteSession(id) {
  if (_MONGO_OK) {
    try {
      await _sessionsCol.deleteOne({ _id: new ObjectId(id) });
    } catch (e) {
      logger.error(`Error deleting session ${id}: ${e.message}`);
    }
  } else {
    _memSessions = _memSessions.filter(s => s._id !== id);
    _saveLocalSessions();
  }
}
