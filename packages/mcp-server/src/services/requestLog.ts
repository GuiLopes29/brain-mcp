/**
 * Live, human-readable request log for `pnpm dev` — one line per meaningful
 * action (add/search/guidelines/update/delete/view/list) so the terminal
 * shows what's being registered/consulted in real time. Deliberately skips
 * dashboard polling routes (/stats, /activity, /export, /knowledge/graph,
 * /health) — those aren't "actions", they'd just spam the log.
 */

export type LogAction = 'add' | 'search' | 'guidelines' | 'update' | 'delete' | 'view' | 'list';

export interface LogEventInput {
  action: LogAction;
  source: string;
  project?: string;
  /** Short, already-truncated description of the subject (title/query/id). */
  detail: string;
  /** Outcome summary (e.g. "3 resultados", "auto_classified (rule, p2)"). */
  result: string;
}

const ICONS: Record<LogAction, string> = {
  add: '➕',
  search: '🔍',
  guidelines: '📋',
  update: '✏️ ',
  delete: '🗑️ ',
  view: '👁️ ',
  list: '📄',
};

// +1 over the longest action name ("guidelines" = 10 chars) so padEnd always
// leaves at least one real separating space — exact-length strings otherwise
// produce zero padding and run straight into the next field.
const ACTION_WIDTH = 11;
const SOURCE_WIDTH = 9;

/** Truncate to maxLen, appending "…" if cut — never breaks mid-emoji/surrogate pair. */
export function truncate(text: string, maxLen = 50): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

/** Pure formatting — no I/O, no Date.now() dependency (caller passes `now`) so it's fully testable. */
export function formatLogLine(input: LogEventInput, now: Date): string {
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS, locale-independent
  const icon = ICONS[input.action];
  const action = input.action.padEnd(ACTION_WIDTH);
  const source = input.source.padEnd(SOURCE_WIDTH);
  const project = input.project ? `[${input.project}] ` : '';
  return `${time}  ${icon} ${action}${source}${project}${input.detail}  →  ${input.result}`;
}

/**
 * @param stream Defaults to stdout (safe for the HTTP bridge). The stdio MCP
 *   server MUST pass process.stderr instead — writing to stdout there would
 *   corrupt the JSON-RPC protocol framing.
 */
export function logEvent(input: LogEventInput, stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(formatLogLine(input, new Date()) + '\n');
}
