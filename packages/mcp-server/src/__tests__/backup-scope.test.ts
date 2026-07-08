import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scopeForExport } from '../backup.js';
import type { KnowledgeItem } from '../types.js';

const ORIGINAL_ENV = { ...process.env };

function item(project: string): KnowledgeItem {
  return {
    id: `id-${project}`,
    title: `Item for ${project || 'global'}`,
    content: 'content',
    tags: [],
    project,
    source: 'claude',
    created_at: new Date().toISOString(),
    access_count: 0,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('scopeForExport', () => {
  it('exports everything when BACKUP_EXCLUDE_PROJECTS is unset (default, private-repo behavior)', () => {
    delete process.env.BACKUP_EXCLUDE_PROJECTS;
    const all = [item('llm-megabrain'), item('client-a'), item('')];

    expect(scopeForExport(all)).toHaveLength(3);
  });

  it('excludes listed projects, keeps everything else including global', () => {
    process.env.BACKUP_EXCLUDE_PROJECTS = 'client-a,client-b';
    const all = [item('llm-megabrain'), item('client-a'), item('client-b'), item('')];

    const result = scopeForExport(all);

    expect(result.map((k) => k.project)).toEqual(['llm-megabrain', '']);
  });

  it('trims whitespace around comma-separated project names', () => {
    process.env.BACKUP_EXCLUDE_PROJECTS = ' client-a , client-b ';
    const all = [item('client-a'), item('llm-megabrain')];

    const result = scopeForExport(all);

    expect(result.map((k) => k.project)).toEqual(['llm-megabrain']);
  });

  it('is a no-op when set to an empty string', () => {
    process.env.BACKUP_EXCLUDE_PROJECTS = '';
    const all = [item('llm-megabrain'), item('client-a')];

    expect(scopeForExport(all)).toHaveLength(2);
  });
});
