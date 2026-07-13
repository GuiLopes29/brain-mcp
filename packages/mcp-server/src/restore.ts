import './env.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getEmbedding, warmUp } from './services/embeddings.js';
import { storeEmbedding, getExistingIds } from './services/vectorStore.js';
import { insertKnowledge, getKnowledgeRaw, getAllKnowledge } from './services/sqlite.js';
import type { KnowledgeItem } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const EXPORT_FILE = join(REPO_ROOT, 'backups', 'brain-export.json');

function log(msg: string): void {
  process.stderr.write(`[brain-restore] ${msg}\n`);
}

interface ExportFile {
  version: number;
  exported_at: string;
  count: number;
  knowledge: KnowledgeItem[];
}

async function embedAndStore(item: KnowledgeItem): Promise<void> {
  const textToEmbed = [item.title, item.content, item.tags.join(' ')].join('\n');
  const embedding = await getEmbedding(textToEmbed);
  await storeEmbedding(item.id, embedding);
}

/**
 * Restore knowledge from the JSON backup into brain.db — both the `knowledge`
 * table and its vectors (vec_knowledge) live in that same SQLite file now, so
 * "lost the DB" is a single disaster mode, not two separate stores to reconcile:
 *
 * 1. Rows missing from `knowledge` are re-inserted from the JSON backup (which
 *    has no embeddings — only metadata).
 * 2. Any row whose vector is missing (every row, on a fresh DB; or just the
 *    gap, if `knowledge` survived but vectors didn't for some other reason)
 *    gets re-embedded, with `knowledge` as the source of truth — it may
 *    contain items newer than the JSON backup (e.g. added after the last
 *    daily export).
 *
 * Idempotent: items already present (row + vector) are skipped.
 */
async function main(): Promise<void> {
  const path = process.argv[2] ?? EXPORT_FILE;
  log(`reading ${path}`);
  const data = JSON.parse(readFileSync(path, 'utf8')) as ExportFile;
  log(`backup has ${data.knowledge.length} items (exported ${data.exported_at})`);

  await warmUp();
  const t0 = Date.now();

  // ── Phase 1: JSON → SQLite (rows missing from the metadata store) ──────────
  // insertKnowledge can throw a UNIQUE constraint error (content_hash) if the
  // backup contains — or the live DB already has — an item with identical
  // title+content. restore.ts is the disaster-recovery path: one bad row must
  // never abort the whole run and leave every item after it unrestored.
  let inserted = 0;
  let skipped = 0;
  for (const item of data.knowledge) {
    if (getKnowledgeRaw(item.id)) continue;
    try {
      insertKnowledge({
        ...item,
        updated_at: item.updated_at ?? item.created_at,
        last_accessed_at: item.last_accessed_at,
        access_count: item.access_count ?? 0,
      });
      inserted++;
      log(`sqlite: restored row "${item.title}"`);
    } catch (err) {
      skipped++;
      log(`sqlite: SKIPPED "${item.title}" (id=${item.id}) — ${err}`);
    }
  }

  // ── Phase 2: rebuild any missing vectors (knowledge table is the source of truth) ──
  const all = getAllKnowledge();
  const present = await getExistingIds(all.map((i) => i.id));
  const missing = all.filter((i) => !present.has(i.id));
  log(`vectors: ${present.size}/${all.length} present, ${missing.length} to rebuild`);

  let embedded = 0;
  for (const item of missing) {
    const itemStart = Date.now();
    await embedAndStore(item);
    embedded++;
    const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
    log(`[${embedded}/${missing.length}] embedded "${item.title}" (${elapsed}s)`);
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done — ${inserted} SQLite row(s) restored, ${skipped} skipped (conflict), ${embedded} embedding(s) rebuilt — total ${totalElapsed}s`);
  // NOTE: sequential embedding is fine up to ~100 nodes (~30s). Beyond that,
  // consider batching/parallelising the getEmbedding calls themselves — the
  // actual SQLite writes are already fast and don't need the same care Chroma's
  // HTTP API once did.
  process.exit(0);
}

main().catch((err) => {
  log(`fatal: ${err}`);
  process.exit(1);
});
