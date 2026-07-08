import './env.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getEmbedding, warmUp } from './services/embeddings.js';
import { storeEmbedding, getExistingIds } from './services/chroma.js';
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
  await storeEmbedding(
    item.id,
    embedding,
    {
      title: item.title,
      project: item.project,
      tags: item.tags.join(','),
      source: item.source,
      created_at: item.created_at,
    },
    textToEmbed,
  );
}

/**
 * Restore knowledge into SQLite + ChromaDB. Handles BOTH disaster modes:
 *
 * 1. SQLite lost → rows missing from brain.db are re-inserted from the JSON
 *    backup (and embedded into Chroma).
 * 2. ChromaDB lost (e.g. container recreated with data in the wrong volume
 *    path) → SQLite rows whose embeddings are missing from Chroma are
 *    re-embedded, with SQLite as the source of truth (it may be newer than
 *    the JSON backup).
 *
 * Idempotent: items already present in both stores are skipped.
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

  // ── Phase 2: SQLite → ChromaDB (embeddings missing from the vector store) ──
  // SQLite is the source of truth here — it may contain items newer than the
  // JSON backup (e.g. added after the last daily export).
  const all = getAllKnowledge();
  const present = await getExistingIds(all.map((i) => i.id));
  const missing = all.filter((i) => !present.has(i.id));
  log(`chroma: ${present.size}/${all.length} embeddings present, ${missing.length} to rebuild`);

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
  // consider batching or parallelising the getEmbedding calls (ChromaDB writes
  // must remain sequential to avoid race conditions on the collection).
  process.exit(0);
}

main().catch((err) => {
  log(`fatal: ${err}`);
  process.exit(1);
});
