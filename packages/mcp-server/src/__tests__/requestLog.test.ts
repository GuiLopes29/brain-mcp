import { describe, it, expect } from 'vitest';
import { formatLogLine, truncate } from '../services/requestLog.js';

const FIXED_TIME = new Date('2026-07-03T14:32:07');

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('short text', 50)).toBe('short text');
  });

  it('cuts long text and appends an ellipsis', () => {
    const result = truncate('a'.repeat(100), 50);
    expect(result.length).toBe(50);
    expect(result.endsWith('…')).toBe(true);
  });

  it('respects a custom maxLen', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcd…');
  });
});

describe('formatLogLine', () => {
  it('includes time, icon, action, source, and result', () => {
    const line = formatLogLine(
      { action: 'add', source: 'claude', project: 'app-apollo-api', detail: '"Fix CSV bug"', result: 'auto_classified (rule, p2)' },
      FIXED_TIME,
    );
    expect(line).toContain('14:32:07');
    expect(line).toContain('➕');
    expect(line).toContain('add');
    expect(line).toContain('claude');
    expect(line).toContain('[app-apollo-api]');
    expect(line).toContain('"Fix CSV bug"');
    expect(line).toContain('auto_classified (rule, p2)');
  });

  it('omits the project bracket when project is absent', () => {
    const line = formatLogLine(
      { action: 'update', source: 'browser', detail: 'id=abc123', result: 'ok' },
      FIXED_TIME,
    );
    expect(line).not.toContain('[');
    expect(line).not.toContain(']');
  });

  it('formats each action with its own icon', () => {
    const actions = ['add', 'search', 'guidelines', 'update', 'delete', 'view', 'list'] as const;
    for (const action of actions) {
      const line = formatLogLine({ action, source: 'claude', detail: 'x', result: 'y' }, FIXED_TIME);
      expect(line).toContain(action);
    }
  });

  it('never runs the action label into the source (regression: "guidelines" is exactly as wide as the padding)', () => {
    const line = formatLogLine({ action: 'guidelines', source: 'cursor', detail: '', result: '10 diretrizes' }, FIXED_TIME);
    expect(line).not.toContain('guidelinescursor');
    expect(line).toMatch(/guidelines\s+cursor/);
  });
});
