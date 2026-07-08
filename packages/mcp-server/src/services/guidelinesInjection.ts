/**
 * Pure logic for the UserPromptSubmit auto-injection hook — decides WHEN to
 * inject guardrails (throttled per session) and HOW to format them, kept
 * separate from the I/O (stdin/stdout/file state) for testability.
 *
 * Why throttle at all: get_guidelines is cheap per-call, but re-injecting the
 * same ~12 directives on EVERY single prompt in a long conversation adds up.
 * Throttling by time (not "once ever") is what actually fixes the problem we
 * set out to solve: a long, compacted, multi-day conversation losing track of
 * whether guardrails were ever loaded. A stale one-time load doesn't help
 * either — inject again once enough time has passed, or the project changed.
 */

export interface InjectionState {
  [sessionId: string]: { lastInjectedAt: string; project?: string };
}

/** Default: re-inject after 20 minutes of the same session/project, or immediately on first prompt or project change. */
export const DEFAULT_THROTTLE_MS = 20 * 60 * 1000;

export function shouldInject(
  state: InjectionState,
  sessionId: string,
  project: string | undefined,
  now: Date,
  throttleMs = DEFAULT_THROTTLE_MS,
): boolean {
  const prev = state[sessionId];
  if (!prev) return true;
  if (prev.project !== project) return true;
  return now.getTime() - new Date(prev.lastInjectedAt).getTime() > throttleMs;
}

export interface GuidelineRow {
  kind: string;
  directive: string;
}

/** Caller should skip calling this (and skip injecting) when rows is empty — nothing worth adding to context. */
export function formatGuidelinesContext(rows: GuidelineRow[], project: string | undefined): string {
  const label = project ?? 'geral';
  const lines = rows.map((r) => `- [${r.kind}] ${r.directive}`).join('\n');
  return `## 🧠 Guardrails do Brain MCP (${label})\n${lines}\n\n(Injetado automaticamente via hook — não precisa chamar get_guidelines manualmente.)`;
}
