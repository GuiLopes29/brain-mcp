import { describe, it, expect } from 'vitest';
import { AddKnowledgeSchema } from '../tools/add.js';
import { UpdateKnowledgeSchema } from '../tools/update.js';
import { SearchKnowledgeSchema } from '../tools/search.js';
import { ListKnowledgeSchema } from '../tools/list.js';

const VALID_UUID = '00000000-0000-0000-0000-000000000000';

describe('AddKnowledgeSchema', () => {
  const base = { title: 'T', content: 'C', tags: ['ts'], project: 'proj' };

  it('accepts valid minimal input', () => {
    expect(AddKnowledgeSchema.safeParse(base).success).toBe(true);
  });

  it('defaults kind to solution', () => {
    expect(AddKnowledgeSchema.parse(base).kind).toBe('solution');
  });

  it('defaults source to manual', () => {
    expect(AddKnowledgeSchema.parse(base).source).toBe('manual');
  });

  it('rejects content over 50 000 chars', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, content: 'x'.repeat(50001) }).success).toBe(false);
  });

  it('rejects title over 500 chars', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, title: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects directive over 500 chars', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, directive: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects empty string inside tags array', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, tags: ['valid', ''] }).success).toBe(false);
  });

  it('rejects more than 30 tags', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, tags: Array(31).fill('t') }).success).toBe(false);
  });

  it('rejects invalid kind value', () => {
    expect(AddKnowledgeSchema.safeParse({ ...base, kind: 'unknown' }).success).toBe(false);
  });

  it('accepts all valid kind values', () => {
    for (const kind of ['solution', 'rule', 'pitfall', 'decision']) {
      expect(AddKnowledgeSchema.safeParse({ ...base, kind }).success).toBe(true);
    }
  });
});

describe('UpdateKnowledgeSchema', () => {
  it('rejects non-UUID id', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: 'not-uuid' }).success).toBe(false);
  });

  it('accepts valid UUID with no other fields', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID }).success).toBe(true);
  });

  it('rejects content over 50 000 chars', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, content: 'x'.repeat(50001) }).success).toBe(false);
  });

  it('rejects priority < 1 or > 5', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, priority: 0 }).success).toBe(false);
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, priority: 6 }).success).toBe(false);
  });

  it('accepts valid priority values 1-5', () => {
    for (const priority of [1, 2, 3, 4, 5]) {
      expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, priority }).success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, status: 'deleted' }).success).toBe(false);
  });

  it('accepts valid status values', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, status: 'active' }).success).toBe(true);
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, status: 'deprecated' }).success).toBe(true);
  });

  it('accepts superseded_by as null or valid UUID', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, superseded_by: null }).success).toBe(true);
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, superseded_by: VALID_UUID }).success).toBe(true);
  });

  it('rejects superseded_by as non-UUID string', () => {
    expect(UpdateKnowledgeSchema.safeParse({ id: VALID_UUID, superseded_by: 'not-uuid' }).success).toBe(false);
  });
});

describe('SearchKnowledgeSchema', () => {
  it('rejects empty query', () => {
    expect(SearchKnowledgeSchema.safeParse({ query: '' }).success).toBe(false);
  });

  it('rejects query over 2 000 chars', () => {
    expect(SearchKnowledgeSchema.safeParse({ query: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('rejects limit over 50', () => {
    expect(SearchKnowledgeSchema.safeParse({ query: 'test', limit: 51 }).success).toBe(false);
  });

  it('defaults source to claude (direct MCP callers are always Claude Code or Cursor)', () => {
    expect(SearchKnowledgeSchema.parse({ query: 'test' }).source).toBe('claude');
  });

  it('defaults limit to 5', () => {
    expect(SearchKnowledgeSchema.parse({ query: 'test' }).limit).toBe(5);
  });
});

describe('ListKnowledgeSchema', () => {
  it('rejects limit over 500', () => {
    expect(ListKnowledgeSchema.safeParse({ limit: 501 }).success).toBe(false);
  });

  it('defaults limit to 50', () => {
    expect(ListKnowledgeSchema.parse({}).limit).toBe(50);
  });

  it('rejects empty string inside tags', () => {
    expect(ListKnowledgeSchema.safeParse({ tags: ['ok', ''] }).success).toBe(false);
  });
});
