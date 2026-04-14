// ── Orchestrator ──────────────────────────────────────────────────

import { SYSTEM_PROMPT }                          from './systemPrompt.js';   // was ../systemPrompt.js ❌
import { callLLMStream }                           from './llm.js';
import { retrieve, rerankAndFilter, getKBCount }   from './rag.js';
import { updateMemory, retrieveMemoryContext }     from './memory.js';        // was ../client/src/components/Memory.jsx ❌
import { analyzer, policyRouter, rewriteQuery, MAX_TURNS } from './analyzer.js';
import { logger }                                  from './logger.js';
import { getSession, updateSession }                from './sessions.js';

// conversationHistory is now handled per session in sessions.js

function _buildMessages(userInput, memCtx, ragCtx, history) {
  const blocks = [];

  if (memCtx) blocks.push(`## User Memory\n${memCtx}`);

  if (history && history.length) {
    const recent   = history.slice(-MAX_TURNS);
    const histStr  = recent
      .map(t => `${t.role === 'user' ? 'User' : 'Coach'}: ${t.content}`)
      .join('\n');
    blocks.push(`## Conversation History\n${histStr}`);
  }

  if (ragCtx) blocks.push(`## Knowledge Base Context\n${ragCtx}`);

  const combined    = blocks.join('\n\n');
  const userMessage = combined
    ? `${combined}\n\n## Current Question\n${userInput}`
    : userInput;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userMessage   },
  ];
}

async function* _generate(userInput, memCtx, ragCtx, history) {
  yield* callLLMStream(_buildMessages(userInput, memCtx, ragCtx, history));
}

export async function* orchestrator(userInput, sessionId) {
  const session = await getSession(sessionId);
  const conversationHistory = session ? session.messages : [];

  const analysis = analyzer(userInput);
  logger.info(`INPUT: ${userInput.slice(0, 100)} | intent=${analysis.intent}`);

  const policy = policyRouter(analysis);
  if (policy) { yield policy; return; }

  // Memory update runs in the background
  updateMemory(userInput).catch(e => logger.warn(`Memory update failed: ${e.message}`));

  const kbCount = await getKBCount();

  // Run knowledge and memory retrieval in parallel
  const [memCtx, ragCtx] = await Promise.all([
    retrieveMemoryContext(userInput),
    (async () => {
      if (kbCount === 0) return '';
      const rewritten = await rewriteQuery(userInput, kbCount);
      const docs      = await retrieve(rewritten);
      return docs.length ? rerankAndFilter(rewritten, docs) : '';
    })()
  ]);

  let fullResponse = '';
  for await (const token of _generate(userInput, memCtx, ragCtx, conversationHistory)) {
    fullResponse += token;
    yield token;
  }

  const updatedHistory = [
    ...conversationHistory,
    { role: 'user',      content: userInput      },
    { role: 'assistant', content: fullResponse   }
  ].slice(-(MAX_TURNS * 2));

  // Auto-generate title if it's the first message
  const updates = { messages: updatedHistory };
  if (session && (session.title === 'New Chat' || !session.title) && updatedHistory.length <= 2) {
    updates.title = userInput.slice(0, 40) + (userInput.length > 40 ? '...' : '');
  }

  await updateSession(sessionId, updates);

  logger.info(`RESPONSE: ${fullResponse.slice(0, 120)}`);
}

// Export helpers for legacy cleanup if needed
export function clearHistory() { /* Handled per session now */ }
export function getHistory()   { return []; }
