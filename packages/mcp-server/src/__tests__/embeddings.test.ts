/**
 * Unit test for the document/query prefix logic — the actual model load/inference
 * is mocked out (loading nomic-embed-text for real would be slow and make this
 * suite's ~1s runtime meaningless). This only verifies OUR logic: which prefix
 * gets prepended for which call, since that's genuinely new behavior added
 * alongside the Ollama → Transformers.js migration (Ollama's raw /api/embeddings
 * never applied a prefix — the caller always had to, and nothing here did until now).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExtractor = vi.fn();

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockImplementation(() => Promise.resolve(mockExtractor)),
}));

import { getEmbedding } from '../services/embeddings.js';

beforeEach(() => {
  mockExtractor.mockReset().mockResolvedValue({ data: new Float32Array([0.1, 0.2, 0.3]) });
});

describe('getEmbedding — task-instruction prefix', () => {
  it('defaults to the "document" prefix when kind is omitted', async () => {
    await getEmbedding('some knowledge content');

    expect(mockExtractor).toHaveBeenCalledWith(
      'search_document: some knowledge content',
      expect.objectContaining({ pooling: 'mean', normalize: true }),
    );
  });

  it('uses the "document" prefix explicitly', async () => {
    await getEmbedding('some knowledge content', 'document');

    expect(mockExtractor).toHaveBeenCalledWith('search_document: some knowledge content', expect.anything());
  });

  it('uses the "query" prefix for search queries', async () => {
    await getEmbedding('how do I fix the csv bug', 'query');

    expect(mockExtractor).toHaveBeenCalledWith('search_query: how do I fix the csv bug', expect.anything());
  });

  it('returns the vector as a plain number array', async () => {
    const result = await getEmbedding('text');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    // Float32Array round-trips lose precision (e.g. 0.3 -> 0.30000001192092896) — compare approximately.
    result.forEach((v, i) => expect(v).toBeCloseTo([0.1, 0.2, 0.3][i]));
  });
});
