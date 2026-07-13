/**
 * Unit tests for searchKnowledge's hybrid RRF fusion, added while auditing —
 * this function had zero test coverage before and a real project-leak bug
 * was found in it (searchFts has no project scoping, only the vector side
 * did, so a project-filtered search could return other projects' items via
 * the keyword-match path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnowledgeItem } from '../types.js';

vi.mock('../services/embeddings.js', () => ({ getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) }));
vi.mock('../services/vectorStore.js', () => ({ queryEmbeddings: vi.fn() }));
vi.mock('../services/sqlite.js', () => ({
  getKnowledgeRaw: vi.fn(),
  bumpAccess: vi.fn(),
  isLLMSource: (s: string) => s === 'claude' || s === 'cursor',
  logAccess: vi.fn(),
  searchFts: vi.fn(),
}));

import { searchKnowledge } from '../tools/search.js';
import { queryEmbeddings } from '../services/vectorStore.js';
import { getKnowledgeRaw, searchFts } from '../services/sqlite.js';

const mockQueryEmbeddings = vi.mocked(queryEmbeddings);
const mockGetKnowledgeRaw = vi.mocked(getKnowledgeRaw);
const mockSearchFts = vi.mocked(searchFts);

function item(id: string, project: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id,
    title: `Item ${id}`,
    content: 'content',
    tags: [],
    project,
    source: 'claude',
    kind: 'solution',
    priority: 3,
    access_count: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockQueryEmbeddings.mockReset().mockResolvedValue({ ids: [], distances: [] });
  mockSearchFts.mockReset().mockReturnValue([]);
  mockGetKnowledgeRaw.mockReset();
});

describe('searchKnowledge — project scoping', () => {
  it('does NOT leak results from other projects in via the keyword-match (FTS) path', async () => {
    // Vector search correctly returns nothing for project "a" (no project-level filtering in the vector store itself).
    mockQueryEmbeddings.mockResolvedValue({ ids: [], distances: [] });
    // FTS has no project scoping — it returns a match from a DIFFERENT project ("b").
    mockSearchFts.mockReturnValue([{ id: 'leaked-id', bm25Score: -5 }]);
    mockGetKnowledgeRaw.mockImplementation((id: string) =>
      id === 'leaked-id' ? item('leaked-id', 'project-b') : undefined,
    );

    const { results } = await searchKnowledge({ query: 'test', project: 'project-a', source: 'browser' });

    expect(results).toHaveLength(0);
  });

  it('keeps a result whose project matches the requested filter', async () => {
    mockSearchFts.mockReturnValue([{ id: 'ok-id', bm25Score: -5 }]);
    mockGetKnowledgeRaw.mockImplementation((id: string) =>
      id === 'ok-id' ? item('ok-id', 'project-a') : undefined,
    );

    const { results } = await searchKnowledge({ query: 'test', project: 'project-a', source: 'browser' });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('ok-id');
  });

  it('includes global (project="") items even when a project filter is set', async () => {
    mockSearchFts.mockReturnValue([
      { id: 'scoped-id', bm25Score: -5 },
      { id: 'global-id', bm25Score: -4 },
    ]);
    mockGetKnowledgeRaw.mockImplementation((id: string) =>
      id === 'scoped-id' ? item('scoped-id', 'project-a') : item('global-id', ''),
    );

    const { results } = await searchKnowledge({ query: 'test', project: 'project-a', source: 'browser' });

    expect(results.map((r) => r.id).sort()).toEqual(['global-id', 'scoped-id']);
  });

  it('does not filter by project when none is requested', async () => {
    mockSearchFts.mockReturnValue([{ id: 'any-id', bm25Score: -5 }]);
    mockGetKnowledgeRaw.mockImplementation((id: string) =>
      id === 'any-id' ? item('any-id', 'whatever-project') : undefined,
    );

    const { results } = await searchKnowledge({ query: 'test', source: 'browser' });

    expect(results).toHaveLength(1);
  });
});

describe('searchKnowledge — RRF fusion', () => {
  it('ranks an item appearing in BOTH vector and keyword results above one appearing in only one', async () => {
    mockQueryEmbeddings.mockResolvedValue({ ids: ['both', 'vector-only'], distances: [0.1, 0.2] });
    mockSearchFts.mockReturnValue([{ id: 'both', bm25Score: -5 }, { id: 'fts-only', bm25Score: -3 }]);
    mockGetKnowledgeRaw.mockImplementation((id: string) => item(id, 'p'));

    const { results } = await searchKnowledge({ query: 'test', source: 'browser', limit: 10 });

    const ids = results.map((r) => r.id);
    expect(ids[0]).toBe('both'); // appears in both lists — highest RRF score
  });

  it('assigns a real cosine similarity to vector matches and a neutral value to keyword-only matches', async () => {
    mockQueryEmbeddings.mockResolvedValue({ ids: ['vec-id'], distances: [0.2] }); // similarity = 0.8
    mockSearchFts.mockReturnValue([{ id: 'fts-id', bm25Score: -5 }]);
    mockGetKnowledgeRaw.mockImplementation((id: string) => item(id, 'p'));

    const { results } = await searchKnowledge({ query: 'test', source: 'browser', limit: 10 });

    const vecResult = results.find((r) => r.id === 'vec-id')!;
    const ftsResult = results.find((r) => r.id === 'fts-id')!;
    expect(vecResult.similarity).toBeCloseTo(0.8);
    expect(ftsResult.similarity).toBe(0.6);
  });
});

describe('searchKnowledge — project diversification', () => {
  it('caps results at 3 per project when no project filter is given', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'b1'];
    mockSearchFts.mockReturnValue(ids.map((id, i) => ({ id, bm25Score: -10 + i })));
    mockGetKnowledgeRaw.mockImplementation((id: string) => item(id, id.startsWith('a') ? 'noisy-project' : 'other-project'));

    const { results } = await searchKnowledge({ query: 'test', source: 'browser', limit: 10 });

    const fromNoisy = results.filter((r) => r.project === 'noisy-project');
    expect(fromNoisy.length).toBeLessThanOrEqual(3);
    expect(results.some((r) => r.project === 'other-project')).toBe(true);
  });

  it('disables diversification when a project filter is explicitly given', async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5'];
    mockSearchFts.mockReturnValue(ids.map((id, i) => ({ id, bm25Score: -10 + i })));
    mockGetKnowledgeRaw.mockImplementation((id: string) => item(id, 'single-project'));

    const { results } = await searchKnowledge({ query: 'test', project: 'single-project', source: 'browser', limit: 10 });

    expect(results).toHaveLength(5);
  });
});
