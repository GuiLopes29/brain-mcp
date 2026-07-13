import '../env.js';
import { pipeline } from '@huggingface/transformers';

/**
 * Embeddings run in-process via Transformers.js (ONNX) instead of calling out
 * to a separately-running Ollama service — one less thing to install and
 * remember to start. Same model as before (nomic-embed-text), so search
 * quality/behavior is unchanged; only the delivery mechanism moved.
 *
 * The model downloads once (cached under the OS's Hugging Face cache dir) on
 * first use, then loads from disk on every subsequent process start.
 */
const MODEL_ID = process.env.EMBEDDING_MODEL ?? 'nomic-ai/nomic-embed-text-v1.5';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractorPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
  }
  return extractorPromise;
}

/**
 * nomic-embed-text was trained with task-instruction prefixes for asymmetric
 * retrieval — the SAME text embeds differently depending on whether it's a
 * document being indexed or a query searching against it. This was never
 * applied when embeddings went through Ollama's raw /api/embeddings endpoint
 * (the caller is responsible for the prefix; Ollama doesn't add one), so this
 * is a quality improvement that happens to ride along with this migration —
 * every existing embedding is being regenerated anyway (different backend).
 *
 * Default 'document' matches every caller except search.ts's query text.
 */
export async function getEmbedding(text: string, kind: 'document' | 'query' = 'document'): Promise<number[]> {
  const prefix = kind === 'query' ? 'search_query: ' : 'search_document: ';
  const extractor = await getExtractor();
  const output = await extractor(prefix + text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function warmUp(): Promise<void> {
  try {
    await getEmbedding('warm up');
    process.stderr.write('[embeddings] warm-up complete\n');
  } catch (err) {
    process.stderr.write(`[embeddings] warm-up failed: ${err}\n`);
  }
}
