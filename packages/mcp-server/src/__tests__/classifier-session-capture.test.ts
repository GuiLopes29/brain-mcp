import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeSessionForCapture } from '../services/classifier.js';

const ORIGINAL_ENV = { ...process.env };

function mockOllamaResponse(candidates: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: JSON.stringify({ candidates }) } }),
    }),
  );
}

beforeEach(() => {
  process.env.OLLAMA_API_KEY = 'test-key';
  process.env.CLASSIFIER_ENABLED = 'true';
  process.env.OLLAMA_CLOUD_MODEL = 'primary-model';
  // Explicit empty string, not just "unset" — isolates these tests from whatever
  // OLLAMA_FALLBACK_MODELS happens to be in the real .env loaded by env.js.
  process.env.OLLAMA_FALLBACK_MODELS = '';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('summarizeSessionForCapture', () => {
  it('returns candidates from a valid classifier response', async () => {
    mockOllamaResponse([
      {
        title: 'Fixed race condition in getDb()',
        content: 'Detailed explanation...',
        problem: 'DB init raced under concurrent calls',
        tags: ['sqlite', 'concurrency'],
        kind: 'pitfall',
        directive: 'Always guard getDb() singleton init with busy_timeout.',
        priority: 2,
      },
    ]);

    const result = await summarizeSessionForCapture('some digest text');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Fixed race condition in getDb()');
    expect(result[0].kind).toBe('pitfall');
  });

  it('returns empty array when classifier says nothing qualifies', async () => {
    mockOllamaResponse([]);
    const result = await summarizeSessionForCapture('trivial digest');
    expect(result).toEqual([]);
  });

  it('returns [] when OLLAMA_API_KEY is not set', async () => {
    delete process.env.OLLAMA_API_KEY;
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('returns [] when CLASSIFIER_ENABLED=false', async () => {
    process.env.CLASSIFIER_ENABLED = 'false';
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('returns [] on HTTP error from Ollama Cloud', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('returns [] on malformed JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'not json' } }) }),
    );
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('returns [] when a candidate has invalid shape (missing required field)', async () => {
    mockOllamaResponse([{ title: 'Missing everything else' }]);
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('returns [] when fetch throws (network error / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });

  it('strips markdown fences from the response before parsing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: '```json\n{"candidates": []}\n```' },
        }),
      }),
    );
    const result = await summarizeSessionForCapture('digest');
    expect(result).toEqual([]);
  });
});

describe('summarizeSessionForCapture — model fallback', () => {
  function respondFor(model: string, ok: boolean, candidates: unknown[] = []) {
    return async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.model !== model) return { ok: false, status: 500 };
      return ok
        ? { ok: true, json: async () => ({ message: { content: JSON.stringify({ candidates }) } }) }
        : { ok: false, status: 500 };
    };
  }

  it('falls back to the next model when the primary fails, and returns its result', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'fallback-model';
    const candidate = {
      title: 'Falha do modelo primário tratada',
      content: 'Detalhes...',
      problem: 'Modelo primário indisponível',
      tags: ['ollama'],
      kind: 'solution',
      directive: null,
      priority: 3,
    };
    vi.stubGlobal('fetch', vi.fn(respondFor('fallback-model', true, [candidate])));

    const result = await summarizeSessionForCapture('digest');

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Falha do modelo primário tratada');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2); // primary attempt, then fallback
  });

  it('tries multiple fallback models in the configured order', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'fallback-a,fallback-b';
    vi.stubGlobal('fetch', vi.fn(respondFor('fallback-b', true, [])));

    const result = await summarizeSessionForCapture('digest');

    expect(result).toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3); // primary, fallback-a, fallback-b
  });

  it('returns [] when the primary AND all fallbacks fail', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'fallback-model';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const result = await summarizeSessionForCapture('digest');

    expect(result).toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('does not call any fallback when the primary succeeds', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'fallback-model';
    vi.stubGlobal('fetch', vi.fn(respondFor('primary-model', true, [])));

    await summarizeSessionForCapture('digest');

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('falls back when the primary returns a malformed/invalid response, not just on HTTP errors', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'fallback-model';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (body.model === 'primary-model') {
        return { ok: true, json: async () => ({ message: { content: 'not valid json' } }) };
      }
      return { ok: true, json: async () => ({ message: { content: JSON.stringify({ candidates: [] }) } }) };
    }));

    const result = await summarizeSessionForCapture('digest');

    expect(result).toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('ignores a fallback entry that duplicates the primary model', async () => {
    process.env.OLLAMA_FALLBACK_MODELS = 'primary-model,fallback-model';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await summarizeSessionForCapture('digest');

    // Should try primary-model once and fallback-model once — NOT primary-model twice.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
