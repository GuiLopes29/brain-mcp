/**
 * Auto-capture hook entry point — registered for BOTH clients:
 *   - Claude Code: .claude/settings.json → SessionEnd (gives session_id, transcript_path, cwd)
 *   - Cursor:      .cursor/hooks.json → stop (gives session_id, transcript_path, workspace_roots;
 *                  NO cwd field, and sessionEnd specifically gets killed on window_close before
 *                  it can spawn — "stop" fires reliably at the end of each turn instead)
 *
 * The client invokes this synchronously and may wait for it to exit before
 * continuing. To keep that fast, this script only parses the hook's stdin
 * JSON, spawns the real work as a DETACHED background process, and exits
 * immediately.
 *
 * All actual transcript parsing + classifier calls + HTTP POSTs happen in
 * auto-capture-worker.ts, which the caller does not wait on.
 */
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { normalizeWorkspaceRoot, detectHookSource } from '../src/services/hookInput.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_DIR = join(__dirname, '..');

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // If stdin is already closed/empty (e.g. run manually with no piped input)
    if (process.stdin.isTTY) resolve('');
  });
}

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  workspace_roots?: string[];
  /** Present only in Cursor's payload — used by detectHookSource(). */
  cursor_version?: string;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const raw = (await readStdin()).replace(/^﻿/, ''); // strip UTF-8 BOM (seen from Cursor on Windows)

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // malformed input — silently no-op, never fail the session
  }

  if (!input.session_id || !input.transcript_path) {
    process.exit(0);
  }

  const cwd = input.cwd ?? (input.workspace_roots?.[0] ? normalizeWorkspaceRoot(input.workspace_roots[0]) : '');
  const source = detectHookSource(input);

  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'scripts/auto-capture-worker.ts'],
    {
      cwd: MCP_SERVER_DIR,
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        BRAIN_HOOK_SESSION_ID: input.session_id,
        BRAIN_HOOK_TRANSCRIPT_PATH: input.transcript_path,
        BRAIN_HOOK_CWD: cwd,
        BRAIN_HOOK_SOURCE: source,
      },
    },
  );
  child.unref();

  process.exit(0);
}

// Guard so this module is safely importable in tests (e.g. to test normalizeWorkspaceRoot)
// without triggering the real stdin-read + spawn + process.exit side effects.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m) => m.toUpperCase());

if (invokedDirectly || process.argv[1]?.endsWith('auto-capture-hook.ts') || process.argv[1]?.endsWith('auto-capture-hook.js')) {
  main();
}
