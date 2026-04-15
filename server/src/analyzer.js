// ── Analyzer · Policy Router · Query Rewriter · Feedback ──────────

import fs         from 'fs';
import { callLLM } from './llm.js';
import { logger }  from './logger.js';

export const MAX_TURNS     = 6;
export const FEEDBACK_PATH = 'feedback.jsonl';

const _CRISIS_WORDS = new Set([
  'suicide', 'suicidal', 'kill myself', 'end my life', 'self-harm',
  'self harm', 'hurt myself', 'want to die', 'dying inside',
]);

const _OOS_TOPICS = new Set([
  'recipe', 'weather', 'sport', 'movie', 'stock', 'crypto',
  'politics', 'news', 'celebrity',
]);

const _CRISIS_RESPONSE = [
  "I hear that you're going through something very difficult right now.",
  "I'm not equipped to provide the support you need in this moment —",
  'please reach out to a crisis helpline or a trusted person in your life.',
].join(' ');

const _OOS_RESPONSE = [
  'That topic falls outside my scope as a coaching assistant.',
  "I'm here to help with reflection, goal-setting, decision-making,",
  'and habit-building. What would you like to work on in those areas?',
].join(' ');

export function analyzer(userInput) {
  const text  = userInput.toLowerCase();
  const words = new Set((text.match(/\b\w+\b/g) ?? []));
  for (const phrase of _CRISIS_WORDS) {
    if (text.includes(phrase)) return { intent: 'crisis', flags: [phrase] };
  }
  const oosHits = [...words].filter(w => _OOS_TOPICS.has(w));
  if (oosHits.length) return { intent: 'out_of_scope', flags: oosHits };
  return { intent: 'coaching', flags: [] };
}

export function policyRouter(analysis) {
  const { intent } = analysis;
  if (intent === 'crisis')       return _CRISIS_RESPONSE;
  if (intent === 'out_of_scope') return _OOS_RESPONSE;
  return null;
}

// ── Query Rewriter ───────────────────────────────────────────────
// Extracts the core semantic search terms from a conversational question.
// Uses temperature=0 for deterministic keyword extraction.
export async function rewriteQuery(userInput, kbCount) {
  if (!kbCount) return userInput;

  const prompt =
    'Extract the core search keywords from this coaching question (max 12 words).\n' +
    'Return ONLY the keywords as a search query — no explanation, no punctuation.\n\n' +
    `Question: ${userInput}\n\nKeywords:`;

  try {
    const rewritten = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0, max_tokens: 30 }
    );
    const result = rewritten.trim().replace(/^["']|["']$/g, '');
    logger.info(`rewriteQuery: "${userInput.slice(0,50)}" → "${result.slice(0,50)}"`);
    return result || userInput;
  } catch (e) {
    logger.warn(`rewriteQuery failed: ${e.message}`);
    return userInput;
  }
}

export function logFeedback(history, feedbackType) {
  if (!history?.length) return;
  const lastUser = [...history].reverse().find(m => m.role === 'user')?.content ?? '';
  const lastBot  = [...history].reverse().find(m => m.role === 'assistant')?.content ?? '';
  const record = { timestamp: new Date().toISOString(), feedback: feedbackType, lastUserMsg: lastUser, lastBotMsg: lastBot };
  fs.appendFileSync(FEEDBACK_PATH, JSON.stringify(record, null, 0) + '\n', 'utf8');
  logger.info(`Feedback: ${feedbackType}`);
}
