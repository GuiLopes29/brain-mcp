import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { synthesizeConsolidation } from '../services/classifier.js';

const ORIGINAL_ENV = { ...process.env };

function mockOllamaResponse(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(body) } }),
    }),
  );
}

beforeEach(() => {
  process.env.OLLAMA_API_KEY = 'test-key';
  process.env.CLASSIFIER_ENABLED = 'true';
  process.env.OLLAMA_CLOUD_MODEL = 'primary-model';
  process.env.OLLAMA_FALLBACK_MODELS = '';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

const SAMPLE_ITEMS = [
  { title: 'Fix A', content: 'Node ABI mismatch after nvm switch', directive: null, project: 'llm-megabrain' },
  { title: 'Fix B', content: 'Pin node.exe to avoid ABI mismatch', directive: null, project: 'llm-megabrain' },
];

describe('synthesizeConsolidation', () => {
  it('returns a proposal when the model confirms a recurring pattern', async () => {
    mockOllamaResponse({
      should_consolidate: true,
      kind: 'pitfall',
      title: 'Node ABI mismatch breaks native modules',
      directive: 'Pin node.exe path across all MCP configs.',
      content: 'Generalized lesson combining both fixes.',
      is_global: true,
      reasoning: 'Both items describe the same root cause.',
    });

    const result = await synthesizeConsolidation(SAMPLE_ITEMS);

    expect(result?.should_consolidate).toBe(true);
    expect(result?.kind).toBe('pitfall');
    expect(result?.is_global).toBe(true);
  });

  it('returns should_consolidate: false when the cluster is a false positive', async () => {
    mockOllamaResponse({
      should_consolidate: false,
      kind: null,
      title: null,
      directive: null,
      content: null,
      is_global: false,
      reasoning: 'Same technology, unrelated problems.',
    });

    const result = await synthesizeConsolidation(SAMPLE_ITEMS);

    expect(result?.should_consolidate).toBe(false);
  });

  it('returns null when the response shape is invalid (should_consolidate: true but missing fields)', async () => {
    mockOllamaResponse({ should_consolidate: true, reasoning: 'missing everything else' });

    const result = await synthesizeConsolidation(SAMPLE_ITEMS);

    expect(result).toBeNull();
  });

  it('returns null when OLLAMA_API_KEY is not set', async () => {
    delete process.env.OLLAMA_API_KEY;

    const result = await synthesizeConsolidation(SAMPLE_ITEMS);

    expect(result).toBeNull();
  });

  it('returns null when the HTTP call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await synthesizeConsolidation(SAMPLE_ITEMS);

    expect(result).toBeNull();
  });
});
