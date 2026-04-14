// ── Embeddings — Transformers.js (all-MiniLM-L6-v2, runs locally) ─
//
// Uses @xenova/transformers which downloads & caches the model on
// first run (~22 MB). No GPU required. Replaces sentence-transformers.

import { pipeline, env } from '@xenova/transformers';
import { logger }        from './logger.js';

// Suppress verbose model download logs
env.allowLocalModels = false;

let _embedPipeline = null;

async function _getEmbedder() {
  if (!_embedPipeline) {
    logger.info('Loading all-MiniLM-L6-v2 embedding model (first run: downloads ~22 MB)...');
    _embedPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    logger.info('Embedding model ready');
  }
  return _embedPipeline;
}

/**
 * Encode an array of strings → Float32Array[] (L2-normalised, dim=384)
 */
export async function encode(sentences) {
  const embedder = await _getEmbedder();
  const results  = [];

  for (const text of sentences) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    results.push(Float32Array.from(output.data));
  }

  return results;
}

/**
 * Cosine similarity between two Float32Arrays (already normalised → dot product).
 */
export function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export const EMBED_DIM = 384;
