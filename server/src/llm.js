import { logger } from './logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.3-70b-versatile';

// ── Helpers ──────────────────────────────────────────────────────
export function extractRetryTime(errMessage) {
  const mMatch = errMessage.match(/(\d+)m/);
  const sMatch = errMessage.match(/(\d+)s/);
  let ms = 0;
  if (mMatch) ms += parseInt(mMatch[1], 10) * 60000;
  if (sMatch) ms += parseInt(sMatch[1], 10) * 1000;
  return ms > 0 ? ms : 15000;
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Gemini Fallback implementations ──────────────────────────────
const MAX_GEMINI_RETRIES = 2;

function _buildGeminiPayload(messages) {
  const msgs = Array.isArray(messages) ? messages : [{ role: 'user', content: messages }];
  const contents = [];
  let systemText = "";
  for (const m of msgs) {
    if (m.role === 'system') systemText += m.content + '\n';
    else contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  return { contents, systemText };
}

async function* callGeminiStreamFallback(messages, maxTokens = 1500, attempt = 0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set for fallback in .env');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const { contents, systemText } = _buildGeminiPayload(messages);

  try {
    const result = await model.generateContentStream({
      contents,
      systemInstruction: systemText ? { role: 'system', parts: [{ text: systemText }]} : undefined,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5 }
    });
    for await (const chunk of result.stream) {
      if (chunk.text) yield chunk.text();
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('429') && attempt < MAX_GEMINI_RETRIES) {
      const retryAfter = extractRetryTime(msg);
      logger.warn(`Gemini stream 429 — sleeping ${Math.round(retryAfter / 1000)}s (attempt ${attempt + 1}/${MAX_GEMINI_RETRIES})...`);
      await sleep(retryAfter);
      yield* callGeminiStreamFallback(messages, maxTokens, attempt + 1);
    } else {
      throw e;
    }
  }
}

async function callGeminiBaseFallback(messages, opts = {}, attempt = 0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set for fallback in .env');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });
  const { contents, systemText } = _buildGeminiPayload(messages);

  try {
    const result = await model.generateContent({
      contents,
      systemInstruction: systemText ? { role: 'system', parts: [{ text: systemText }]} : undefined,
      generationConfig: { 
        maxOutputTokens: opts.max_tokens ?? 1000, 
        temperature: opts.temperature ?? 0.7,
        responseMimeType: opts.json ? 'application/json' : 'text/plain'
      }
    });
    return result.response.text();
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('429') && attempt < MAX_GEMINI_RETRIES) {
      const retryAfter = extractRetryTime(msg);
      logger.warn(`Gemini base 429 — sleeping ${Math.round(retryAfter / 1000)}s (attempt ${attempt + 1}/${MAX_GEMINI_RETRIES})...`);
      await sleep(retryAfter);
      return await callGeminiBaseFallback(messages, opts, attempt + 1);
    }
    throw e;
  }
}

// ── Streaming generation ─────────────────────────────────────────
export async function* callLLMStream(messages, retryCount = 0) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in .env');

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
      stream: true,
      temperature: 0.5,   
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Groq stream error: ${response.status} - ${err}`);
    
    // 429 Fallback Strategy
    if (response.status === 429 || response.status >= 500) {
      if (process.env.GEMINI_API_KEY) {
        logger.warn(`Fallback to Gemini Stream due to ${response.status}`);
        yield* callGeminiStreamFallback(messages, 1500);
        return;
      } else if (response.status === 429 && retryCount < 1) {
        // No Gemini key? Extract sleep time and try Groq again.
        const retryAfter = extractRetryTime(err);
        logger.warn(`No fallback. Sleeping for ${retryAfter}ms before retry...`);
        await sleep(retryAfter);
        yield* callLLMStream(messages, retryCount + 1);
        return;
      }
    }
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
async function _callBase(messages, opts = {}, retryCount = 0) {
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
    
    // 429 Fallback Strategy
    if (response.status === 429 || response.status >= 500) {
      if (process.env.GEMINI_API_KEY) {
        logger.warn(`Fallback to Gemini Base due to ${response.status}`);
        return await callGeminiBaseFallback(messages, opts);
      } else if (response.status === 429 && retryCount < 1) {
        const retryAfter = extractRetryTime(err);
        logger.warn(`No fallback. Sleeping for ${retryAfter}ms before retry...`);
        await sleep(retryAfter);
        return await _callBase(messages, opts, retryCount + 1);
      }
    }
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
