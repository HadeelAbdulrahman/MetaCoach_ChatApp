import { logger } from './logger.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.3-70b-versatile';

// ── Streaming generation ─────────────────────────────────────────
export async function* callLLMStream(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env');

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
      stream: true,
      temperature: 0.5,   // lowered from 0.7 for more faithful KB grounding
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Groq stream error: ${response.status} - ${err}`);
    throw new Error(`Groq API ${response.status}`);
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
        try {
          const data  = JSON.parse(line.slice(6));
          const token = data.choices[0]?.delta?.content || '';
          if (token) yield token;
        } catch {}
      }
    }
  }
}

// ── Non-streaming call (supports options) ───────────────────────
async function _callBase(messages, opts = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env');

  const body = {
    model:       MODEL,
    messages:    Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
    temperature: opts.temperature ?? 0.7,
    max_tokens:  opts.max_tokens  ?? 1000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Groq error: ${response.status} - ${err}`);
    return null;
  }
  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

export async function callLLM(promptOrMessages, opts = {}) {
  return _callBase(promptOrMessages, opts);
}

export async function callUpdateLLM(prompt) {
  const content = await _callBase(prompt, { temperature: 0.1, json: true });
  return extractJSON(content);
}

export function extractJSON(text) {
  if (!text) return null;
  try {
    const match = text.match(/```(?:json)?\n?([\s\S]*?)```/);
    if (match) return JSON.parse(match[1].trim());
    return JSON.parse(text);
  } catch (e) {
    logger.warn(`extractJSON failed: ${e.message}`);
    return null;
  }
}
