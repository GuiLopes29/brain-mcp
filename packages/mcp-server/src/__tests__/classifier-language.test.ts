import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyKnowledge, summarizeSessionForCapture, synthesizeConsolidation } from '../services/classifier.js';

const ORIGINAL_ENV = { ...process.env };

function mockFetchCapturingSystemPrompt(): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      calls.push(body.messages[0].content);
      return {
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              worth_keeping: true, suggested_priority: 3, suggested_kind: 'solution', directive: null, reasoning: 'ok',
              candidates: [], should_consolidate: false, kind: null, title: null, content: null, is_global: false,
            }),
          },
        }),
      };
    }),
  );
  return { calls };
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

describe('CLASSIFIER_LANGUAGE — defaults to English', () => {
  it('classifyKnowledge instructs the model to respond in English by default', async () => {
    delete process.env.CLASSIFIER_LANGUAGE;
    const { calls } = mockFetchCapturingSystemPrompt();

    await classifyKnowledge({ title: 't', content: 'c', tags: [] });

    expect(calls[0]).toContain('English');
    expect(calls[0]).not.toContain('Portuguese');
  });

  it('summarizeSessionForCapture instructs the model to respond in English by default', async () => {
    delete process.env.CLASSIFIER_LANGUAGE;
    const { calls } = mockFetchCapturingSystemPrompt();

    await summarizeSessionForCapture('some digest');

    expect(calls[0]).toContain('English');
  });

  it('synthesizeConsolidation instructs the model to respond in English by default', async () => {
    delete process.env.CLASSIFIER_LANGUAGE;
    const { calls } = mockFetchCapturingSystemPrompt();

    await synthesizeConsolidation([{ title: 't', content: 'c', directive: null, project: 'p' }]);

    expect(calls[0]).toContain('English');
  });
});

describe('CLASSIFIER_LANGUAGE=pt-BR — private/local override', () => {
  it('switches all three prompts to Brazilian Portuguese without any code change', async () => {
    process.env.CLASSIFIER_LANGUAGE = 'pt-BR';
    const { calls } = mockFetchCapturingSystemPrompt();

    await classifyKnowledge({ title: 't', content: 'c', tags: [] });
    await summarizeSessionForCapture('digest');
    await synthesizeConsolidation([{ title: 't', content: 'c', directive: null, project: 'p' }]);

    calls.forEach((c) => expect(c).toContain('Brazilian Portuguese'));
  });
});

describe('CLASSIFIER_LANGUAGE — arbitrary value passthrough', () => {
  it('passes through any other language name verbatim (e.g. Spanish)', async () => {
    process.env.CLASSIFIER_LANGUAGE = 'Spanish';
    const { calls } = mockFetchCapturingSystemPrompt();

    await classifyKnowledge({ title: 't', content: 'c', tags: [] });

    expect(calls[0]).toContain('Spanish');
  });
});
