/** Normalizes fields from auto-capture hook stdin JSON, tolerant of client differences. */

/** Cursor sends workspace_roots like "/c:/Users/..." — strip the leading slash before the drive letter. */
export function normalizeWorkspaceRoot(root: string): string {
  return root.replace(/^\/([a-zA-Z]:)/, '$1');
}

/**
 * Both clients route through the SAME auto-capture-hook.ts (Claude Code's
 * SessionEnd and Cursor's stop hook), so we must tell them apart from the
 * payload shape to attribute captures correctly in the Control Room —
 * otherwise every auto-capture gets mislabeled as one client regardless of
 * which one actually triggered it.
 *
 * Cursor's payload includes a `cursor_version` field; Claude Code's does not.
 */
export function detectHookSource(input: Record<string, unknown>): 'claude' | 'cursor' {
  return typeof input.cursor_version === 'string' ? 'cursor' : 'claude';
}
