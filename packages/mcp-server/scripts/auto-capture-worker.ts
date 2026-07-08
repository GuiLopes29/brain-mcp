/**
 * Background worker for the SessionEnd auto-capture hook.
 * Spawned detached by auto-capture-hook.ts so it never blocks the CLI from exiting.
 *
 * Reads the transcript since the last processed offset for this session,
 * asks the classifier for 0-N knowledge candidates, and POSTs each to the
 * local Brain API (which itself runs dedup/classifier/contradiction checks —
 * this worker's job is only to decide WHAT to propose, not to bypass those guards).
 */
import '../src/env.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { buildSessionDigest } from '../src/services/transcript.js';
import { summarizeSessionForCapture } from '../src/services/classifier.js';

const DATA_DIR = join(__dirname, '..', 'data');
const STATE_FILE = join(DATA_DIR, 'auto-capture-state.json');
const LOG_FILE = join(DATA_DIR, 'auto-capture.log');
const API_URL = process.env.BRAIN_API_URL ?? 'http://127.0.0.1:3456';

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(LOG_FILE, line, { flag: 'a' });
  } catch {
    /* best-effort logging only */
  }
}

interface State {
  [sessionId: string]: { lastLine: number };
}

function readState(): State {
  try {
    if (!existsSync(STATE_FILE)) return {};
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state: State): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* non-fatal */
  }
}

/**
 * Concurrent workers are realistic here — the user works across 3 repos and
 * could have Cursor/Claude sessions open in more than one at once, each
 * spawning their own worker process for a DIFFERENT session_id. Reading the
 * whole state.json once at startup and writing the whole (possibly
 * many-seconds-stale) object back at the end is a classic read-modify-write
 * race: a slower process's write can silently revert a faster process's
 * lastLine update for an unrelated session. Re-reading fresh immediately
 * before writing narrows that window from "the whole worker runtime"
 * (seconds, while the classifier call is in flight) down to a few ms.
 */
function advanceState(sessionId: string, lastLine: number): void {
  const fresh = readState();
  fresh[sessionId] = { lastLine };
  writeState(fresh);
}

async function main(): Promise<void> {
  // Passed via env vars by auto-capture-hook.ts — this process runs detached,
  // so it has no access to the parent's already-consumed stdin.
  const session_id = process.env.BRAIN_HOOK_SESSION_ID;
  const transcript_path = process.env.BRAIN_HOOK_TRANSCRIPT_PATH;
  const cwd = process.env.BRAIN_HOOK_CWD;
  // Which client actually triggered this — both Claude Code's SessionEnd and
  // Cursor's stop hook route through this same worker, so without this the
  // Control Room misattributes every Cursor auto-capture as Claude.
  const source = process.env.BRAIN_HOOK_SOURCE === 'cursor' ? 'cursor' : 'claude';

  if (!session_id || !transcript_path) {
    log(`missing session_id/transcript_path — aborting (session_id=${session_id})`);
    return;
  }

  if (!existsSync(transcript_path)) {
    log(`transcript not found at ${transcript_path} — aborting`);
    return;
  }

  const state = readState();
  const lastLine = state[session_id]?.lastLine ?? 0;

  const allLines = readFileSync(transcript_path, 'utf8').split('\n');
  const newLines = allLines.slice(lastLine);

  if (newLines.length === 0) {
    log(`session ${session_id}: no new lines since last capture — skipping`);
    return;
  }

  const { digest, hasSubstance } = buildSessionDigest(newLines);

  if (!hasSubstance) {
    log(`session ${session_id}: no mutating tool use or user text in ${newLines.length} new lines — skipping classifier call`);
    advanceState(session_id, allLines.length);
    return;
  }
  if (digest.length < 200) {
    log(`session ${session_id}: digest too short (${digest.length} chars) to be worth a classifier call — skipping`);
    advanceState(session_id, allLines.length);
    return;
  }

  const project = cwd ? basename(cwd) : 'unknown';
  log(`session ${session_id}: digest built (${digest.length} chars, project=${project}, source=${source}) — calling classifier`);

  const candidates = await summarizeSessionForCapture(digest);

  if (candidates.length === 0) {
    log(`session ${session_id}: classifier found nothing worth capturing`);
    advanceState(session_id, allLines.length);
    return;
  }

  let stored = 0;
  for (const c of candidates) {
    try {
      const res = await fetch(`${API_URL}/knowledge?source=${source}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: c.title,
          content: c.content,
          problem: c.problem,
          tags: c.tags,
          project,
          kind: c.kind,
          directive: c.directive ?? undefined,
          priority: c.priority,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        stored++;
        log(`session ${session_id}: captured "${c.title}" (${body.duplicate_of ? 'duplicate' : 'new'}, id=${body.id})`);
      } else {
        log(`session ${session_id}: failed to store "${c.title}" — HTTP ${res.status}: ${JSON.stringify(body)}`);
      }
    } catch (err) {
      log(`session ${session_id}: failed to store "${c.title}" — ${String(err)} (is the Brain API running? pnpm start:api)`);
    }
  }

  log(`session ${session_id}: done — ${stored}/${candidates.length} candidate(s) stored`);
  advanceState(session_id, allLines.length);
}

main().catch((err) => log(`fatal: ${String(err)}`));
