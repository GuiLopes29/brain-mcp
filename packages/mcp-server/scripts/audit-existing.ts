/**
 * Retroactive classifier audit for existing brain nodes.
 *
 * Iterates all nodes, calls the Ollama Cloud classifier for each,
 * and reports discrepancies between current metadata and suggestions.
 *
 * Usage:
 *   pnpm audit:brain              # dry-run — report only, no changes
 *   pnpm audit:brain -- --apply   # apply suggested updates to SQLite
 *
 * Output: prints a table and saves backups/audit-report-<timestamp>.json
 */
import '../src/env.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { classifyKnowledge } from '../src/services/classifier.js';
import { listKnowledge, updateKnowledge } from '../src/services/sqlite.js';
import type { KnowledgeItem } from '../src/types.js';

const APPLY = process.argv.includes('--apply');
const DELAY_MS = 1500; // avoid hammering the API

interface AuditEntry {
  id: string;
  title: string;
  project: string;
  current_kind?: string;
  current_priority?: number;
  current_directive?: string;
  current_review_status?: string;
  suggested_kind?: string;
  suggested_priority?: number;
  suggested_directive?: string | null;
  worth_keeping?: boolean;
  reasoning?: string;
  action: 'updated' | 'skipped_no_change' | 'skipped_classifier_null' | 'skipped_no_key';
  applied: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hasChange(item: KnowledgeItem, entry: AuditEntry): boolean {
  return (
    entry.suggested_kind !== item.kind ||
    entry.suggested_priority !== (item.priority ?? 3) ||
    (entry.suggested_directive ?? undefined) !== (item.directive ?? undefined)
  );
}

async function main(): Promise<void> {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) {
    process.stderr.write('ERROR: OLLAMA_API_KEY not set in .env\n');
    process.exit(1);
  }

  const model = process.env.OLLAMA_CLOUD_MODEL ?? 'gpt-oss:20b-cloud';
  const mode = APPLY ? 'APPLY' : 'DRY-RUN';

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Brain MCP — Retroactive Audit  [${mode}]`);
  console.log(`  Model: ${model}`);
  console.log(`${'─'.repeat(70)}\n`);

  // Fetch all nodes (high limit — audit should see everything)
  const items = listKnowledge({ limit: 9999 });
  console.log(`  Nodes to audit: ${items.length}\n`);

  const report: AuditEntry[] = [];
  let updated = 0;
  let skipped = 0;
  let noChange = 0;
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const pos = `[${String(i + 1).padStart(3)}/${items.length}]`;
    const label = `${item.title.slice(0, 50).padEnd(50)} (${item.project})`;

    process.stdout.write(`  ${pos} ${label} … `);

    if (!key) {
      process.stdout.write('SKIP (no key)\n');
      report.push({ id: item.id, title: item.title, project: item.project, action: 'skipped_no_key', applied: false });
      skipped++;
      continue;
    }

    const t0 = Date.now();
    const classification = await classifyKnowledge({
      title: item.title,
      content: item.content,
      problem: item.problem,
      tags: item.tags,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!classification) {
      process.stdout.write(`null (${elapsed}s)\n`);
      report.push({ id: item.id, title: item.title, project: item.project, action: 'skipped_classifier_null', applied: false });
      failed++;
      if (i < items.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const entry: AuditEntry = {
      id: item.id,
      title: item.title,
      project: item.project,
      current_kind: item.kind,
      current_priority: item.priority ?? 3,
      current_directive: item.directive,
      current_review_status: item.review_status,
      suggested_kind: classification.suggested_kind,
      suggested_priority: classification.worth_keeping ? classification.suggested_priority : 5,
      suggested_directive: classification.directive,
      worth_keeping: classification.worth_keeping,
      reasoning: classification.reasoning,
      action: 'skipped_no_change',
      applied: false,
    };

    if (!hasChange(item, entry)) {
      process.stdout.write(`ok (${elapsed}s)\n`);
      entry.action = 'skipped_no_change';
      noChange++;
    } else {
      const changes = [
        item.kind !== entry.suggested_kind ? `kind: ${item.kind}→${entry.suggested_kind}` : '',
        (item.priority ?? 3) !== entry.suggested_priority ? `priority: ${item.priority ?? 3}→${entry.suggested_priority}` : '',
        (item.directive ?? null) !== (entry.suggested_directive ?? null) ? `directive changed` : '',
      ].filter(Boolean).join(', ');

      entry.action = 'updated';

      if (APPLY) {
        updateKnowledge(item.id, {
          kind: entry.suggested_kind,
          priority: entry.suggested_priority,
          directive: entry.suggested_directive ?? undefined,
          review_status: 'auto_classified',
        });
        entry.applied = true;
        updated++;
        process.stdout.write(`UPDATED (${elapsed}s) — ${changes}\n`);
      } else {
        process.stdout.write(`would update (${elapsed}s) — ${changes}\n`);
        updated++;
      }
    }

    report.push(entry);
    if (i < items.length - 1) await sleep(DELAY_MS);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Results:`);
  console.log(`    ${updated}  ${APPLY ? 'updated' : 'would update'}`);
  console.log(`    ${noChange}  no change needed`);
  console.log(`    ${failed}  classifier failed (see stderr)`);
  console.log(`    ${skipped}  skipped`);
  console.log(`${'─'.repeat(70)}\n`);

  // ── Persist report ─────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupsDir = resolve(__dirname, '../../../backups');
  mkdirSync(backupsDir, { recursive: true });
  const reportPath = resolve(backupsDir, `audit-report-${timestamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ timestamp, mode, model, stats: { updated, noChange, failed, skipped }, report }, null, 2));
  console.log(`  Report saved: backups/audit-report-${timestamp}.json\n`);

  if (!APPLY && updated > 0) {
    console.log(`  Re-run with --apply to commit the ${updated} suggested change(s).\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${String(err)}\n`);
  process.exit(1);
});
