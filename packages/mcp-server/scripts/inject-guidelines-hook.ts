/**
 * Guardrail auto-injection hook — registered for BOTH clients:
 *   - Claude Code: .claude/settings.json → UserPromptSubmit (fires before every
 *     prompt; input has `cwd`; output wraps additionalContext in hookSpecificOutput)
 *   - Cursor: .cursor/hooks.json → sessionStart (fires once per session, NOT per
 *     turn — Cursor's `beforeSubmitPrompt` fires per-turn like UserPromptSubmit
 *     but its output schema is only {continue, user_message}, confirmed against
 *     a real captured payload — no context-injection field exists there. Cursor's
 *     own docs say sessionStart supports "additional_context", flat at the top
 *     level, matching its snake_case input convention — unconfirmed empirically
 *     as of writing since Cursor's docs have been wrong before; log output to
 *     verify)
 *
 * Solves a problem "call get_guidelines once per task" never reliably fixed:
 * in a long, continued, multi-day conversation with context compaction, there
 * is no clean signal for "have I already loaded guardrails this task?" — the
 * model's own memory of having called it can get compacted away. Rather than
 * depend on that judgment, this hook injects the current project's guardrails
 * directly — deterministic, client-driven, immune to compaction or session length.
 *
 * Throttled (not injected on literally every single turn) via
 * services/guidelinesInjection.ts — see that file for why.
 *
 * IMPORTANT: unlike auto-capture-hook.ts, this hook is NOT fire-and-forget.
 * The caller needs the output JSON on stdout before continuing, so this does
 * its (fast, local SQLite-only) work synchronously and exits — no detached
 * child process here.
 */
import '../src/env.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { getGuidelines, logAccess } from '../src/services/sqlite.js';
import { shouldInject, formatGuidelinesContext, type InjectionState } from '../src/services/guidelinesInjection.js';
import { normalizeWorkspaceRoot, detectHookSource } from '../src/services/hookInput.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const STATE_FILE = join(DATA_DIR, 'guidelines-injection-state.json');
const DEBUG_LOG = join(DATA_DIR, 'inject-guidelines.log');

function readState(): InjectionState {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state: InjectionState): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* non-fatal */
  }
}

/** Same read-fresh-then-write pattern as auto-capture-worker.ts's advanceState — avoids
 * a read-modify-write race when prompts from different sessions/repos land close together. */
function markInjected(sessionId: string, project: string | undefined): void {
  const fresh = readState();
  fresh[sessionId] = { lastInjectedAt: new Date().toISOString(), project };
  writeState(fresh);
}

/** Cursor's sessionStart output shape is unconfirmed (docs-only) — log what we
 * send so a first real run can be diagnosed if the injection doesn't land. */
function debugLog(msg: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`, { flag: 'a' });
  } catch {
    /* non-fatal */
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

interface HookInput {
  session_id?: string;
  cwd?: string;
  workspace_roots?: string[];
  hook_event_name?: string;
  cursor_version?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const raw = (await readStdin()).replace(/^﻿/, ''); // strip UTF-8 BOM (seen from Cursor on Windows)

  // Unconditional entry log — proves the hook process was invoked at all,
  // regardless of which branch below exits early. Without this, every
  // early-exit path is indistinguishable from "Cursor never ran the hook".
  debugLog(`ENTRY raw_len=${raw.length} raw_preview=${raw.slice(0, 200).replace(/\n/g, '\\n')}`);

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    debugLog(`EXIT malformed_json err=${String(err)}`);
    process.exit(0); // malformed input — never block the user's prompt
  }

  const sessionId = input.session_id;
  if (!sessionId) {
    debugLog(`EXIT no_session_id keys=${Object.keys(input).join(',')}`);
    process.exit(0);
  }

  const source = detectHookSource(input);
  const project = input.cwd
    ? basename(input.cwd)
    : input.workspace_roots?.[0]
      ? basename(normalizeWorkspaceRoot(input.workspace_roots[0]))
      : undefined;

  if (!shouldInject(readState(), sessionId, project, new Date())) {
    debugLog(`EXIT throttled source=${source} session=${sessionId} project=${project ?? '(none)'}`);
    process.exit(0); // within the throttle window — stay silent, don't spam context
  }

  const rows = getGuidelines(project, 12);
  markInjected(sessionId, project);

  if (rows.length === 0) {
    debugLog(`EXIT zero_rows source=${source} session=${sessionId} project=${project ?? '(none)'}`);
    process.exit(0); // nothing worth injecting this time — still marked, avoids re-querying every turn
  }

  logAccess({ action: 'guidelines', source, project, results_count: rows.length });

  const context = formatGuidelinesContext(rows, project);
  const eventName = input.hook_event_name ?? 'UserPromptSubmit';

  const output = source === 'cursor'
    ? { additional_context: context } // Cursor's own convention — snake_case, flat (unconfirmed empirically, see header)
    : { hookSpecificOutput: { hookEventName: eventName, additionalContext: context } }; // Claude Code convention

  debugLog(`source=${source} event=${eventName} project=${project ?? '(none)'} rows=${rows.length} output_keys=${Object.keys(output).join(',')}`);

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main().catch((err) => {
  debugLog(`EXIT uncaught_error err=${String(err)}`);
  process.exit(0); // never fail/block the user's prompt submission
});
