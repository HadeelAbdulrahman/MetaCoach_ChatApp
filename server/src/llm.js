import { logger } from './logger.js';

// Extremely fast Open-Source endpoint powered by Groq ASICs.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

/**
 * Standard Streaming Generation using Groq Llama 3
 */
export async function* callLLMStream(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in .env");

  // Ensure 'prompt' acts as messages if it's already an array
  const formattedMessages = Array.isArray(messages) ? messages : [{ role: 'user', content: messages }];

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: formattedMessages,
      stream: true,
      temperature: 0.7,
      max_tokens: 1500
    })
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Groq API Error: ${response.status} - ${err}`);
    throw new Error(`Groq API returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
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
          const data = JSON.parse(line.slice(6));
          const token = data.choices[0]?.delta?.content || "";
          if (token) yield token;
        } catch (e) {}
      }
    }
  }
}

/**
 * Internal helper for non-streaming calls
 */
async function _callBase(messages, { temperature = 0.7, json = false } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in .env");

  const body = {
    model: MODEL,
    messages: Array.isArray(messages) ? messages : [{ role: 'user', content: messages }],
    temperature
  };

  if (json) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error(`Groq API Error: ${response.status} - ${err}`);
    return null;
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "";
}

/**
 * Non-streaming call for simple queries (Analyzer, Memory extraction)
 */
export async function callLLM(promptOrMessages) {
  return _callBase(promptOrMessages);
}

/**
 * Background JSON Generation for Memory logic
 */
export async function callUpdateLLM(prompt) {
  const content = await _callBase(prompt, { temperature: 0.1, json: true });
  return extractJSON(content);
}

/**
 * Extracts a JSON dict safely from codeblocks
 */
export function extractJSON(text) {
  if (!text) return null;
  try {
    const jsonMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    return JSON.parse(text);
  } catch (e) {
    logger.warn(`Failed to parse extracted LLM JSON: ${e.message}`);
    return null;
  }
}
