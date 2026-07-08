import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  insertKnowledge,
  getKnowledgeRaw,
  updateKnowledge,
  deleteKnowledge,
  getGuidelines,
  listKnowledge,
  isLLMSource,
  bumpAccess,
  markSeen,
} from '../services/sqlite.js';
import type { KnowledgeItem } from '../types.js';

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  const now = new Date().toISOString();
  const id = uuidv4();
  return {
    id,
    // Unique per call by default — content_hash has a UNIQUE index, so two
    // items sharing the literal title+content would collide unless a test
    // explicitly wants that (pass matching title/content via overrides).
    title: `Test item ${id}`,
    content: `Test content ${id}`,
    tags: ['test'],
    project: 'test-project',
    source: 'manual',
    kind: 'solution',
    status: 'active',
    priority: 3,
    access_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ── isLLMSource ────────────────────────────────────────────────────────────────

describe('isLLMSource', () => {
  it('returns true for claude and cursor', () => {
    expect(isLLMSource('claude')).toBe(true);
    expect(isLLMSource('cursor')).toBe(true);
  });

  it('returns false for browser, manual, unknown', () => {
    expect(isLLMSource('browser')).toBe(false);
    expect(isLLMSource('manual')).toBe(false);
    expect(isLLMSource('unknown')).toBe(false);
    expect(isLLMSource(undefined)).toBe(false);
  });
});

// ── insertKnowledge / getKnowledgeRaw ──────────────────────────────────────────

describe('insertKnowledge / getKnowledgeRaw', () => {
  it('stores and retrieves an item by id', () => {
    const item = makeItem({ title: 'Unique title A' });
    insertKnowledge(item);
    const retrieved = getKnowledgeRaw(item.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe('Unique title A');
  });

  it('returns undefined for unknown id', () => {
    expect(getKnowledgeRaw(uuidv4())).toBeUndefined();
  });

  it('stores and deserializes tags as array', () => {
    const item = makeItem({ tags: ['alpha', 'beta', 'gamma'] });
    insertKnowledge(item);
    expect(getKnowledgeRaw(item.id)!.tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('defaults status to active', () => {
    const item = makeItem();
    delete (item as Partial<KnowledgeItem>).status;
    insertKnowledge(item);
    expect(getKnowledgeRaw(item.id)!.status).toBe('active');
  });

  it('defaults priority to 3', () => {
    const item = makeItem();
    delete (item as Partial<KnowledgeItem>).priority;
    insertKnowledge(item);
    expect(getKnowledgeRaw(item.id)!.priority).toBe(3);
  });
});

// ── updateKnowledge ────────────────────────────────────────────────────────────

describe('updateKnowledge', () => {
  it('updates title and content', () => {
    const item = makeItem({ title: 'Old title' });
    insertKnowledge(item);
    updateKnowledge(item.id, { title: 'New title', content: 'New content' });
    const updated = getKnowledgeRaw(item.id)!;
    expect(updated.title).toBe('New title');
    expect(updated.content).toBe('New content');
  });

  it('updates status to deprecated', () => {
    const item = makeItem({ kind: 'rule' });
    insertKnowledge(item);
    updateKnowledge(item.id, { status: 'deprecated' });
    expect(getKnowledgeRaw(item.id)!.status).toBe('deprecated');
  });

  it('sets superseded_by', () => {
    const oldItem = makeItem({ kind: 'rule' });
    const newItem = makeItem({ kind: 'rule' });
    insertKnowledge(oldItem);
    insertKnowledge(newItem);
    updateKnowledge(oldItem.id, { status: 'deprecated', superseded_by: newItem.id });
    const updated = getKnowledgeRaw(oldItem.id)!;
    expect(updated.status).toBe('deprecated');
    expect(updated.superseded_by).toBe(newItem.id);
  });

  it('updates priority', () => {
    const item = makeItem({ kind: 'pitfall', priority: 3 });
    insertKnowledge(item);
    updateKnowledge(item.id, { priority: 1 });
    expect(getKnowledgeRaw(item.id)!.priority).toBe(1);
  });

  it('returns undefined for non-existent id', () => {
    expect(updateKnowledge(uuidv4(), { title: 'x' })).toBeUndefined();
  });
});

// ── deleteKnowledge ────────────────────────────────────────────────────────────

describe('deleteKnowledge', () => {
  it('deletes an existing item', () => {
    const item = makeItem();
    insertKnowledge(item);
    expect(deleteKnowledge(item.id)).toBe(true);
    expect(getKnowledgeRaw(item.id)).toBeUndefined();
  });

  it('returns false for non-existent id', () => {
    expect(deleteKnowledge(uuidv4())).toBe(false);
  });
});

// ── bumpAccess / markSeen ──────────────────────────────────────────────────────

describe('bumpAccess / markSeen', () => {
  it('bumpAccess increments access_count', () => {
    const item = makeItem({ access_count: 0 });
    insertKnowledge(item);
    bumpAccess(item.id);
    bumpAccess(item.id);
    expect(getKnowledgeRaw(item.id)!.access_count).toBe(2);
  });

  it('markSeen does NOT increment access_count', () => {
    const item = makeItem({ access_count: 0 });
    insertKnowledge(item);
    markSeen(item.id);
    markSeen(item.id);
    expect(getKnowledgeRaw(item.id)!.access_count).toBe(0);
  });
});

// ── getGuidelines ──────────────────────────────────────────────────────────────

describe('getGuidelines', () => {
  it('only returns rule and pitfall kinds', () => {
    insertKnowledge(makeItem({ kind: 'rule', directive: 'Rule directive X', project: 'gtest' }));
    insertKnowledge(makeItem({ kind: 'pitfall', directive: 'Pitfall directive X', project: 'gtest' }));
    insertKnowledge(makeItem({ kind: 'solution', directive: 'Solution directive X', project: 'gtest' }));
    insertKnowledge(makeItem({ kind: 'decision', directive: 'Decision directive X', project: 'gtest' }));
    const results = getGuidelines('gtest');
    expect(results.every((r) => r.kind === 'rule' || r.kind === 'pitfall')).toBe(true);
  });

  it('excludes deprecated items', () => {
    const dep = makeItem({ kind: 'rule', directive: 'Deprecated rule ZZZZZ', project: 'deptest', status: 'deprecated' });
    insertKnowledge(dep);
    const results = getGuidelines('deptest');
    expect(results.some((r) => r.directive.includes('Deprecated rule ZZZZZ'))).toBe(false);
  });

  it('includes active items', () => {
    const act = makeItem({ kind: 'rule', directive: 'Active rule YYYYY', project: 'acttest', status: 'active' });
    insertKnowledge(act);
    const results = getGuidelines('acttest');
    expect(results.some((r) => r.directive.includes('Active rule YYYYY'))).toBe(true);
  });

  it('respects the limit', () => {
    const proj = 'limittest';
    for (let i = 0; i < 20; i++) {
      insertKnowledge(makeItem({ kind: 'rule', directive: `Rule number ${i}`, project: proj }));
    }
    expect(getGuidelines(proj, 5).length).toBeLessThanOrEqual(5);
    expect(getGuidelines(proj, 12).length).toBeLessThanOrEqual(12);
  });

  it('deduplicates by directive text (case-insensitive)', () => {
    const proj = 'deduptest';
    insertKnowledge(makeItem({ kind: 'rule', directive: 'Unique dedup rule QQQQ', project: proj }));
    insertKnowledge(makeItem({ kind: 'rule', directive: 'unique dedup rule QQQQ', project: proj }));
    const results = getGuidelines(proj);
    const count = results.filter((r) => r.directive.toLowerCase().includes('unique dedup rule qqqq')).length;
    expect(count).toBe(1);
  });

  it('surfaces priority=1 before priority=5', () => {
    const proj = 'priotest';
    insertKnowledge(makeItem({ kind: 'rule', directive: 'Low priority rule AAAA', project: proj, priority: 5 }));
    insertKnowledge(makeItem({ kind: 'rule', directive: 'High priority rule BBBB', project: proj, priority: 1 }));
    const results = getGuidelines(proj);
    const hiIdx = results.findIndex((r) => r.directive.includes('High priority rule BBBB'));
    const loIdx = results.findIndex((r) => r.directive.includes('Low priority rule AAAA'));
    expect(hiIdx).toBeLessThan(loIdx);
  });

  it('returns project-specific items when project matches', () => {
    const proj = 'scopetest';
    insertKnowledge(makeItem({ kind: 'rule', directive: 'Scoped rule CCCC', project: proj, priority: 3 }));
    insertKnowledge(makeItem({ kind: 'rule', directive: 'Global rule DDDD', project: '', priority: 3 }));
    const results = getGuidelines(proj);
    const scopedIdx = results.findIndex((r) => r.directive.includes('Scoped rule CCCC'));
    const globalIdx = results.findIndex((r) => r.directive.includes('Global rule DDDD'));
    expect(scopedIdx).not.toBe(-1);
    expect(globalIdx).not.toBe(-1);
    expect(scopedIdx).toBeLessThan(globalIdx);
  });
});

// ── listKnowledge ──────────────────────────────────────────────────────────────

describe('listKnowledge', () => {
  it('filters by project', () => {
    const proj = 'listproj-' + uuidv4().slice(0, 8);
    insertKnowledge(makeItem({ project: proj, title: 'In project' }));
    insertKnowledge(makeItem({ project: 'other-proj', title: 'Not in project' }));
    const results = listKnowledge({ project: proj });
    expect(results.every((r) => r.project === proj)).toBe(true);
    expect(results.some((r) => r.title === 'In project')).toBe(true);
  });

  it('respects limit', () => {
    const proj = 'listlimit-' + uuidv4().slice(0, 8);
    for (let i = 0; i < 10; i++) insertKnowledge(makeItem({ project: proj }));
    expect(listKnowledge({ project: proj, limit: 3 }).length).toBe(3);
  });

  it('filters by tags (OR logic)', () => {
    const proj = 'listtags-' + uuidv4().slice(0, 8);
    insertKnowledge(makeItem({ project: proj, tags: ['alpha', 'beta'], title: 'Has alpha' }));
    insertKnowledge(makeItem({ project: proj, tags: ['gamma'], title: 'Has gamma' }));
    const results = listKnowledge({ project: proj, tags: ['alpha'] });
    expect(results.some((r) => r.title === 'Has alpha')).toBe(true);
    expect(results.some((r) => r.title === 'Has gamma')).toBe(false);
  });
});
