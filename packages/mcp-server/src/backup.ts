import './env.js';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAllKnowledge } from './services/sqlite.js';
import type { KnowledgeItem } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/ or dist/ → mcp-server → packages → repo root
const REPO_ROOT = join(__dirname, '..', '..', '..');
const BACKUP_DIR = join(REPO_ROOT, 'backups');
const EXPORT_FILE = join(BACKUP_DIR, 'brain-export.json');

function log(msg: string): void {
  process.stderr.write(`[brain-backup] ${msg}\n`);
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * This repo's own `backups/brain-export.json` is committed and pushed to a
 * (currently private) GitHub remote — but the Brain is shared across every repo
 * the user works in, including client/employer projects. Exporting everything
 * unfiltered is fine for a private repo, but becomes a real leak the moment this
 * repo goes public: client project knowledge (bug details, internal feature
 * names, architecture decisions) would ship in the OSS export.
 *
 * BACKUP_EXCLUDE_PROJECTS (comma-separated) lets you scope the export down to
 * "this project + global" before open-sourcing, without touching the private
 * SQLite DB itself — set it in .env (gitignored), not committed. Unset by
 * default so existing private-repo behavior (export everything) is unchanged.
 */
export function scopeForExport(knowledge: KnowledgeItem[]): KnowledgeItem[] {
  const excluded = (process.env.BACKUP_EXCLUDE_PROJECTS ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (excluded.length === 0) return knowledge;
  return knowledge.filter((k) => !excluded.includes(k.project));
}

/** Export all knowledge to a portable JSON dump, then commit + push if a remote exists. */
export function runBackup(opts: { push?: boolean } = {}): { ok: boolean; committed: boolean; pushed: boolean } {
  const push = opts.push ?? true;

  // 1. Export to JSON (diffable, restoreable — never the raw .db binary).
  mkdirSync(BACKUP_DIR, { recursive: true });
  const knowledge = scopeForExport(getAllKnowledge());
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    count: knowledge.length,
    knowledge,
  };
  writeFileSync(EXPORT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  log(`exported ${knowledge.length} items → backups/brain-export.json`);

  let committed = false;
  let pushed = false;

  // 2. Commit if there are staged changes.
  try {
    git(`add backups/brain-export.json`);
    let hasChanges = false;
    try {
      git(`diff --cached --quiet`);
    } catch {
      hasChanges = true; // non-zero exit means there ARE staged changes
    }

    if (hasChanges) {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      git(`commit -m "chore(brain): knowledge backup ${stamp} (${knowledge.length} items)"`);
      committed = true;
      log(`committed backup`);
    } else {
      log(`no changes since last backup — skipping commit`);
    }
  } catch (err) {
    log(`commit step failed: ${String(err)}`);
    return { ok: false, committed, pushed };
  }

  // 3. Push if a remote is configured.
  if (push && committed) {
    try {
      const remote = git(`remote`).split('\n')[0];
      if (remote) {
        const branch = git(`rev-parse --abbrev-ref HEAD`);
        git(`push ${remote} ${branch}`);
        pushed = true;
        log(`pushed to ${remote}/${branch}`);
      } else {
        log(`no git remote configured — committed locally only`);
      }
    } catch (err) {
      log(`push failed (committed locally): ${String(err)}`);
    }
  }

  return { ok: true, committed, pushed };
}

// CLI entry: `node dist/backup.js` or `tsx src/backup.ts`
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m) => m.toUpperCase());

if (invokedDirectly || process.argv[1]?.endsWith('backup.ts') || process.argv[1]?.endsWith('backup.js')) {
  const result = runBackup({ push: true });
  process.exit(result.ok ? 0 : 1);
}
