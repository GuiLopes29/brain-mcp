import { describe, it, expect } from 'vitest';
import { shouldInject, formatGuidelinesContext, type InjectionState } from '../services/guidelinesInjection.js';

const NOW = new Date('2026-07-07T12:00:00Z');

describe('shouldInject', () => {
  it('injects on the first prompt of a session (no prior state)', () => {
    expect(shouldInject({}, 'session-1', 'app-apollo-api', NOW)).toBe(true);
  });

  it('does not re-inject shortly after a previous injection for the same session/project', () => {
    const state: InjectionState = {
      'session-1': { lastInjectedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), project: 'app-apollo-api' },
    };
    expect(shouldInject(state, 'session-1', 'app-apollo-api', NOW)).toBe(false);
  });

  it('re-injects once the throttle window has elapsed', () => {
    const state: InjectionState = {
      'session-1': { lastInjectedAt: new Date(NOW.getTime() - 25 * 60_000).toISOString(), project: 'app-apollo-api' },
    };
    expect(shouldInject(state, 'session-1', 'app-apollo-api', NOW)).toBe(true);
  });

  it('re-injects immediately if the project changed, even within the throttle window', () => {
    const state: InjectionState = {
      'session-1': { lastInjectedAt: new Date(NOW.getTime() - 1 * 60_000).toISOString(), project: 'app-apollo-api' },
    };
    expect(shouldInject(state, 'session-1', 'app-aulas-ui', NOW)).toBe(true);
  });

  it('respects a custom throttle window', () => {
    const state: InjectionState = {
      'session-1': { lastInjectedAt: new Date(NOW.getTime() - 2 * 60_000).toISOString(), project: 'p' },
    };
    expect(shouldInject(state, 'session-1', 'p', NOW, 60_000)).toBe(true); // 2 min > 1 min custom throttle
    expect(shouldInject(state, 'session-1', 'p', NOW, 5 * 60_000)).toBe(false); // 2 min < 5 min custom throttle
  });

  it('treats an undefined project consistently (no project filter)', () => {
    const state: InjectionState = {
      'session-1': { lastInjectedAt: new Date(NOW.getTime() - 1 * 60_000).toISOString(), project: undefined },
    };
    expect(shouldInject(state, 'session-1', undefined, NOW)).toBe(false);
  });
});

describe('formatGuidelinesContext', () => {
  it('includes the project label and each directive with its kind', () => {
    const ctx = formatGuidelinesContext(
      [{ kind: 'rule', directive: 'Sempre X' }, { kind: 'pitfall', directive: 'Nunca Y' }],
      'app-apollo-api',
    );
    expect(ctx).toContain('app-apollo-api');
    expect(ctx).toContain('[rule] Sempre X');
    expect(ctx).toContain('[pitfall] Nunca Y');
  });

  it('falls back to a generic label when no project is given', () => {
    const ctx = formatGuidelinesContext([{ kind: 'rule', directive: 'X' }], undefined);
    expect(ctx).toContain('geral');
  });

  it('notes that injection is automatic (so the model does not redundantly call get_guidelines)', () => {
    const ctx = formatGuidelinesContext([{ kind: 'rule', directive: 'X' }], 'p');
    expect(ctx.toLowerCase()).toContain('automaticamente');
  });
});
