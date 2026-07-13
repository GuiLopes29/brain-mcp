/**
 * Isolated test for the insert-time UNIQUE-constraint race in addKnowledge:
 * two processes (e.g. two MCP servers, or an auto-capture worker racing a
 * manual add_knowledge) both pass the pre-check find-then-insert dedup at
 * nearly the same time. The DB's UNIQUE index on content_hash is what
 * actually catches it — this test verifies addKnowledge degrades that into
 * the same graceful "duplicate detected" response instead of throwing, and
 * cleans up the embedding it had already written to the vector store before
 * the conflict was discovered.
 *
 * Mocks sqlite.js directly (unlike add-classifier.test.ts, which uses the
 * real in-memory DB) because simulating a genuine cross-process race
 * requires controlling exactly when the UNIQUE violation fires relative to
 * the pre-check — something a real single-connection SQLite test can't do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnowledgeItem } from '../types.js';

const RACE_WINNER: KnowledgeItem = {
  id: 'winner-id',
  title: 'Race winner',
  content: 'Race winner content',
  tags: ['test'],
  project: 'p',
  source: 'claude',
  review_status: 'reviewed',
  kind: 'solution',
  priority: 3,
  created_at: new Date().toISOString(),
  access_count: 0,
};

// Hoisted mocks — vitest lifts vi.mock() above imports/consts in ESM, so mock
// functions must be created inline here (retrieved via vi.mocked() after
// import) rather than referenced from a top-level const declared below.
vi.mock('../services/classifier.js', () => ({ classifyKnowledge: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/embeddings.js', () => ({ getEmbedding: vi.fn().mockResolvedValue(new Array(8).fill(0.1)) }));
vi.mock('../services/vectorStore.js', () => ({
  storeEmbedding: vi.fn().mockResolvedValue(undefined),
  queryEmbeddings: vi.fn().mockResolvedValue({ ids: [], distances: [] }),
  deleteEmbedding: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/sqlite.js', () => ({
  findByContentHash: vi.fn(),
  insertKnowledge: vi.fn(),
  getKnowledgeRaw: vi.fn(),
  logAccess: vi.fn(),
  insertContradiction: vi.fn(),
}));

import { addKnowledge } from '../tools/add.js';
import { deleteEmbedding } from '../services/vectorStore.js';
import { findByContentHash, insertKnowledge } from '../services/sqlite.js';

const mockFindByContentHash = vi.mocked(findByContentHash);
const mockInsertKnowledge = vi.mocked(insertKnowledge);

const INPUT = { title: 'Race test', content: 'Some content', tags: ['test'], project: 'p', source: 'claude' };

beforeEach(() => {
  vi.mocked(deleteEmbedding).mockClear();
  mockFindByContentHash.mockReset();
  mockInsertKnowledge.mockReset();
});

describe('addKnowledge — insert-time UNIQUE constraint race', () => {
  it('returns the race winner as a duplicate instead of throwing', async () => {
    mockFindByContentHash
      .mockReturnValueOnce(undefined) // pre-check: no row yet — proceed
      .mockReturnValueOnce(RACE_WINNER); // post-throw re-check: other process's row now visible
    mockInsertKnowledge.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: knowledge.content_hash');
    });

    const res = await addKnowledge(INPUT);

    expect(res.duplicate_of).toBe('winner-id');
    expect(res.message).toContain('Duplicate detected');
    expect(res.message).toContain('Race winner');
  });

  it('cleans up the orphaned vector-store embedding written before the conflict was discovered', async () => {
    mockFindByContentHash.mockReturnValueOnce(undefined).mockReturnValueOnce(RACE_WINNER);
    mockInsertKnowledge.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: knowledge.content_hash');
    });

    const res = await addKnowledge(INPUT);

    // deleteEmbedding must target the id THIS call generated for its own attempted
    // insert (the orphan) — not the race winner's id (res.id), which is a different
    // row entirely that was never touched by this call.
    expect(deleteEmbedding).toHaveBeenCalledTimes(1);
    expect(deleteEmbedding).not.toHaveBeenCalledWith(res.id);
  });

  it('rethrows unrelated insert errors untouched (does not swallow real failures)', async () => {
    mockFindByContentHash.mockReturnValueOnce(undefined);
    mockInsertKnowledge.mockImplementation(() => {
      throw new Error('disk I/O error');
    });

    await expect(addKnowledge(INPUT)).rejects.toThrow('disk I/O error');
  });

  it('rethrows the UNIQUE error if the re-fetch surprisingly finds nothing', async () => {
    // Defends against silently swallowing a genuine bug if the constraint fired
    // for a reason other than the expected "someone else just inserted it" race.
    mockFindByContentHash.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
    mockInsertKnowledge.mockImplementation(() => {
      throw new Error('UNIQUE constraint failed: knowledge.content_hash');
    });

    await expect(addKnowledge(INPUT)).rejects.toThrow('UNIQUE constraint failed');
  });
});
