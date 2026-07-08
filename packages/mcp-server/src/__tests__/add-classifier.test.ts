/**
 * Integration tests for the add_knowledge ↔ classifier pipeline.
 * Mocks classifier, embeddings, and ChromaDB so no network I/O happens.
 * SQLite uses the in-memory DB from setup.ts (pool: 'forks').
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ClassificationResult } from '../services/classifier.js';

// Hoisted mocks — vitest lifts vi.mock() above imports in ESM
vi.mock('../services/classifier.js', () => ({ classifyKnowledge: vi.fn() }));
vi.mock('../services/embeddings.js', () => ({ getEmbedding: vi.fn() }));
vi.mock('../services/chroma.js', () => ({
  storeEmbedding: vi.fn(),
  // Default: no near-duplicates found — individual tests override as needed
  queryEmbeddings: vi.fn().mockResolvedValue({ ids: [], distances: [] }),
}));

import { addKnowledge } from '../tools/add.js';
import { classifyKnowledge } from '../services/classifier.js';
import { getEmbedding } from '../services/embeddings.js';
import { storeEmbedding, queryEmbeddings } from '../services/chroma.js';
import { getKnowledgeRaw, _clearAllForTesting } from '../services/sqlite.js';

const mockClassify = vi.mocked(classifyKnowledge);
const mockEmbed = vi.mocked(getEmbedding);
const mockStore = vi.mocked(storeEmbedding);
const mockQuery = vi.mocked(queryEmbeddings);

const DUMMY_EMBEDDING = new Array(384).fill(0.1);

const BASE_INPUT = {
  title: 'Test node',
  content: 'Some technical content worth keeping',
  tags: ['test', 'vitest'] as string[],
  project: 'llm-megabrain',
  source: 'claude',
};

function makeClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    worth_keeping: true,
    suggested_priority: 2,
    suggested_kind: 'decision',
    directive: null,
    reasoning: 'Architectural decision with long-term impact.',
    ...overrides,
  };
}

beforeEach(() => {
  // Reset SQLite so dedup/contradiction state doesn't bleed between tests
  _clearAllForTesting();
  // Reset all mocks (clears call history) then re-apply defaults
  mockClassify.mockReset();
  mockEmbed.mockReset().mockResolvedValue(DUMMY_EMBEDDING);
  mockStore.mockReset().mockResolvedValue(undefined);
  mockQuery.mockReset().mockResolvedValue({ ids: [], distances: [] });
});

// ── Classifier succeeds ─────────────────────────────────────────────────────

describe('when classifier succeeds', () => {
  it('overrides kind and priority from caller', async () => {
    mockClassify.mockResolvedValue(makeClassification({ suggested_kind: 'decision', suggested_priority: 2 }));

    const res = await addKnowledge({ ...BASE_INPUT, kind: 'solution', priority: 3 });

    expect(res.review_status).toBe('auto_classified');
    expect(res.classifier_applied).toBe(true);

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.kind).toBe('decision');
    expect(stored.priority).toBe(2);
    expect(stored.review_status).toBe('auto_classified');
  });

  it('applies directive when classifier generates one (rule/pitfall)', async () => {
    mockClassify.mockResolvedValue(
      makeClassification({ suggested_kind: 'rule', directive: 'Always wrap DB writes in transactions' }),
    );

    const res = await addKnowledge({ ...BASE_INPUT, kind: 'solution' });

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.kind).toBe('rule');
    expect(stored.directive).toBe('Always wrap DB writes in transactions');
  });

  it('keeps caller directive when classifier returns null directive', async () => {
    mockClassify.mockResolvedValue(makeClassification({ suggested_kind: 'solution', directive: null }));

    const res = await addKnowledge({ ...BASE_INPUT, directive: 'caller directive', kind: 'solution' });

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.directive).toBe('caller directive');
  });
});

// ── worth_keeping: false ────────────────────────────────────────────────────

describe('when worth_keeping is false', () => {
  it('forces priority to 5 regardless of suggestion', async () => {
    mockClassify.mockResolvedValue(
      makeClassification({ worth_keeping: false, suggested_priority: 3 }),
    );

    const res = await addKnowledge({ ...BASE_INPUT, priority: 3 });

    expect(res.review_status).toBe('auto_classified');
    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.priority).toBe(5);
  });

  it('still stores the node (write is never blocked)', async () => {
    mockClassify.mockResolvedValue(makeClassification({ worth_keeping: false }));

    const res = await addKnowledge(BASE_INPUT);

    expect(getKnowledgeRaw(res.id)).toBeDefined();
  });
});

// ── Classifier unavailable ──────────────────────────────────────────────────

describe('when classifier returns null', () => {
  it('falls back to pending_review and keeps caller values', async () => {
    mockClassify.mockResolvedValue(null);

    const res = await addKnowledge({ ...BASE_INPUT, kind: 'rule', directive: 'my directive', priority: 1 });

    expect(res.review_status).toBe('pending_review');
    expect(res.classifier_applied).toBe(false);

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.kind).toBe('rule');
    expect(stored.directive).toBe('my directive');
    expect(stored.priority).toBe(1);
    expect(stored.review_status).toBe('pending_review');
  });

  it('still stores the node even when classifier is unavailable', async () => {
    mockClassify.mockResolvedValue(null);

    const res = await addKnowledge(BASE_INPUT);

    expect(getKnowledgeRaw(res.id)).toBeDefined();
  });
});

// ── Embedding failure ───────────────────────────────────────────────────────

describe('when Ollama is unreachable', () => {
  it('throws a descriptive error and does not persist', async () => {
    mockClassify.mockResolvedValue(makeClassification());
    mockEmbed.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    await expect(addKnowledge(BASE_INPUT)).rejects.toThrow(/Ollama unreachable/);
  });
});

// ── Response shape ──────────────────────────────────────────────────────────

describe('response shape', () => {
  it('includes id, message, review_status, classifier_applied', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const res = await addKnowledge(BASE_INPUT);

    expect(res).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      message: expect.stringContaining('Test node'),
      review_status: expect.stringMatching(/^(auto_classified|pending_review|reviewed)$/),
      classifier_applied: expect.any(Boolean),
    });
  });

  it('message includes classifier annotation when applied', async () => {
    mockClassify.mockResolvedValue(makeClassification({ suggested_kind: 'decision', suggested_priority: 2 }));

    const res = await addKnowledge(BASE_INPUT);

    expect(res.message).toContain('[auto_classified:');
  });

  it('message includes pending_review annotation when classifier fails', async () => {
    mockClassify.mockResolvedValue(null);

    const res = await addKnowledge(BASE_INPUT);

    expect(res.message).toContain('[pending_review:');
  });
});

// ── SHA-256 dedup ───────────────────────────────────────────────────────────

describe('SHA-256 dedup', () => {
  it('detects exact duplicate and returns existing id without re-storing', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const first = await addKnowledge(BASE_INPUT);
    const second = await addKnowledge(BASE_INPUT); // identical title+content

    expect(second.duplicate_of).toBe(first.id);
    expect(second.id).toBe(first.id);
    expect(second.message).toContain('Duplicate detected');
    // storeEmbedding should only have been called once (for the first insert)
    expect(mockStore).toHaveBeenCalledTimes(1);
  });

  it('allows storage when only tags differ (content hash is title+content)', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const first = await addKnowledge(BASE_INPUT);
    const second = await addKnowledge({ ...BASE_INPUT, tags: ['other'] });

    expect(second.duplicate_of).toBe(first.id); // same title+content → same hash
  });

  it('allows storage when content differs', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const first  = await addKnowledge(BASE_INPUT);
    const second = await addKnowledge({ ...BASE_INPUT, content: 'Different content here' });

    expect(second.duplicate_of).toBeUndefined();
    expect(second.id).not.toBe(first.id);
    expect(mockStore).toHaveBeenCalledTimes(2);
  });
});

// ── Global / cross-project knowledge (project optional) ────────────────────

describe('global project tier', () => {
  it('stores as global (project: "") when project is omitted', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const { project: _drop, ...withoutProject } = BASE_INPUT;
    const res = await addKnowledge(withoutProject);

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.project).toBe('');
  });

  it('normalizes the literal "global" (any case) to ""', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const res = await addKnowledge({ ...BASE_INPUT, project: 'GLOBAL' });

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.project).toBe('');
  });

  it('keeps a real project name untouched', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    const res = await addKnowledge({ ...BASE_INPUT, project: 'app-apollo-api' });

    const stored = getKnowledgeRaw(res.id)!;
    expect(stored.project).toBe('app-apollo-api');
  });
});

// ── Contradiction detection ─────────────────────────────────────────────────

describe('contradiction detection', () => {
  it('includes similar_to when ChromaDB returns a very close match', async () => {
    mockClassify.mockResolvedValue(makeClassification());

    // First node already exists in ChromaDB (simulated)
    mockQuery.mockResolvedValueOnce({ ids: ['existing-id-abc'], distances: [0.05] }); // 1-0.05 = 0.95 > 0.92

    // Manually insert a "pre-existing" node so getKnowledgeRaw('existing-id-abc') returns it
    const { insertKnowledge } = await import('../services/sqlite.js');
    const now = new Date().toISOString();
    insertKnowledge({
      id: 'existing-id-abc',
      title: 'Very similar node',
      content: 'Nearly identical content',
      tags: ['test'],
      project: 'test',
      source: 'manual',
      kind: 'solution',
      status: 'active',
      priority: 3,
      access_count: 0,
      created_at: now,
      updated_at: now,
    });

    const res = await addKnowledge({ ...BASE_INPUT, content: 'Slightly different but semantically close' });

    expect(res.similar_to).toEqual({ id: 'existing-id-abc', title: 'Very similar node' });
    expect(res.message).toContain('Similar node already exists');
  });

  it('does not set similar_to when similarity is below threshold', async () => {
    mockClassify.mockResolvedValue(makeClassification());
    mockQuery.mockResolvedValueOnce({ ids: ['some-id'], distances: [0.15] }); // 1-0.15 = 0.85 < 0.92

    const res = await addKnowledge({ ...BASE_INPUT, content: 'Clearly different content here' });

    expect(res.similar_to).toBeUndefined();
  });

  it('still stores the node when ChromaDB query fails', async () => {
    mockClassify.mockResolvedValue(makeClassification());
    mockQuery.mockRejectedValueOnce(new Error('ChromaDB unavailable'));

    const res = await addKnowledge({ ...BASE_INPUT, content: 'Content when chroma is down' });

    expect(res.id).toBeDefined();
    expect(res.similar_to).toBeUndefined(); // gracefully skipped
    expect(getKnowledgeRaw(res.id)).toBeDefined();
  });
});
