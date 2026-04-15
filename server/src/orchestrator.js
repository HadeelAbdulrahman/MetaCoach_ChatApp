// ── Orchestrator v3 ───────────────────────────────────────────────

import { SYSTEM_PROMPT }                          from './systemPrompt.js';
import { callLLMStream }                          from './llm.js';
import { retrieve, rerankAndFilter, getKBCount }  from './rag.js';
import { updateMemory, retrieveMemoryContext }    from './memory.js';
import { analyzer, policyRouter, rewriteQuery, MAX_TURNS } from './analyzer.js';
import { logger }                                 from './logger.js';
import { getSession, updateSession, WELCOME_MESSAGE } from './sessions.js';

function _buildMessages(userInput, memCtx, ragCtx, history) {
  let systemContent = SYSTEM_PROMPT;

  // ── Inject KB context directly into system prompt ──────────────
  if (ragCtx && ragCtx.trim()) {
    systemContent +=
      `\n\n${'═'.repeat(60)}\n` +
      `RETRIEVED KNOWLEDGE BASE CONTENT\n` +
      `Ground your entire response in the passages below.\n` +
      `${'═'.repeat(60)}\n` +
      `${ragCtx}\n` +
      `${'═'.repeat(60)}`;
    logger.info(`KB context: ${ragCtx.length} chars injected`);
  } else {
    systemContent +=
      `\n\n${'═'.repeat(60)}\n` +
      `NO KB CONTENT RETRIEVED FOR THIS QUERY\n` +
      `State this clearly before doing anything else.\n` +
      `${'═'.repeat(60)}`;
    logger.warn(`No KB context retrieved`);
  }

  // ── Build multi-turn message array ─────────────────────────────
  const messages = [{ role: 'system', content: systemContent }];

  if (history && history.length > 0) {
    // Skip the welcome message from history (it's not a real turn)
    const realHistory = history.filter(t =>
      !(t.role === 'assistant' && t.content === WELCOME_MESSAGE.content)
    );
    const recent = realHistory.slice(-(MAX_TURNS * 2));
    for (const turn of recent) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  // ── User message — memory context injected only if relevant ────
  let userContent = userInput;
  if (memCtx && memCtx.trim()) {
    userContent =
      `[Relevant context from previous sessions: ${memCtx}]\n\n` +
      `User message: ${userInput}`;
    logger.info(`Memory context injected: ${memCtx.length} chars`);
  }
  messages.push({ role: 'user', content: userContent });

  return messages;
}

async function _retrieveWithFallback(userInput, kbCount) {
  if (kbCount === 0) return '';
  let docs = [];
  try {
    const rewritten = await rewriteQuery(userInput, kbCount);
    logger.info(`Query rewrite: "${userInput.slice(0,50)}" → "${rewritten.slice(0,50)}"`);
    docs = await retrieve(rewritten);
    if (docs.length === 0 && rewritten !== userInput) {
      logger.info('Rewrite returned 0 — retrying with original');
      docs = await retrieve(userInput);
    }
  } catch (e) {
    logger.warn(`rewriteQuery error: ${e.message} — using original`);
    docs = await retrieve(userInput);
  }
  if (!docs.length) { logger.warn('0 docs found after fallback'); return ''; }
  logger.info(`Retrieved ${docs.length} chunks, top score=${docs[0]?.score?.toFixed(3)}`);
  return rerankAndFilter(userInput, docs);
}

export async function* orchestrator(userInput, sessionId) {
  const session = await getSession(sessionId);
  const conversationHistory = session ? session.messages : [];

  const analysis = analyzer(userInput);
  logger.info(`INPUT: ${userInput.slice(0,100)} | intent=${analysis.intent}`);

  const policy = policyRouter(analysis);
  if (policy) { yield policy; return; }

  updateMemory(userInput).catch(e => logger.warn(`Memory update failed: ${e.message}`));

  const kbCount = await getKBCount();

  const [memCtx, ragCtx] = await Promise.all([
    retrieveMemoryContext(userInput),
    _retrieveWithFallback(userInput, kbCount)
  ]);

  logger.info(`Context: mem=${memCtx.length}c rag=${ragCtx.length}c`);

  let fullResponse = '';
  for await (const token of callLLMStream(_buildMessages(userInput, memCtx, ragCtx, conversationHistory))) {
    fullResponse += token;
    yield token;
  }

  // Build updated history — keep welcome message at front
  const welcome  = conversationHistory.filter(t => t.role === 'assistant' && t.content === WELCOME_MESSAGE.content);
  const realTurns = conversationHistory.filter(t => !(t.role === 'assistant' && t.content === WELCOME_MESSAGE.content));

  const updatedHistory = [
    ...welcome,
    ...realTurns,
    { role: 'user',      content: userInput    },
    { role: 'assistant', content: fullResponse },
  ].slice(0, 1 + MAX_TURNS * 2); // welcome + N real turns

  const updates = { messages: updatedHistory };
  if (session && (session.title === 'New Chat' || !session.title) && realTurns.length === 0) {
    updates.title = userInput.slice(0, 40) + (userInput.length > 40 ? '...' : '');
  }

  await updateSession(sessionId, updates);
  logger.info(`RESPONSE: ${fullResponse.slice(0,100)}`);
}

export function clearHistory() {}
export function getHistory()   { return []; }
