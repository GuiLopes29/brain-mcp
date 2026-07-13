import '../env.js';
import { getDb } from './sqlite.js';

/**
 * Local vector store backed by sqlite-vec — replaces ChromaDB/Docker. Vectors
 * live in the SAME SQLite file as everything else (vec_knowledge, a vec0
 * virtual table), eliminating the heaviest dependency this project had: a
 * Docker Desktop / WSL2 VM running just to host a vector database container.
 *
 * vec0 tables key by INTEGER rowid, not our TEXT UUIDs, so knowledge_vec_map
 * (schema in sqlite.ts) bridges the two. Project-level filtering that Chroma's
 * `where` used to do is intentionally NOT reproduced here — every real caller
 * already passed an empty filter and post-filtered in JS instead (see
 * search.ts), since the dataset is small enough that brute-force KNN over
 * everything, then filtering in JS, is simpler and just as fast.
 */

function toVectorBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Upsert a knowledge item's embedding. Re-storing an existing id overwrites in
 * place (same rowid reused) rather than churning through new rowids.
 *
 * New rows MUST let vec0 auto-assign the rowid (`INSERT INTO vec_knowledge(embedding)`,
 * then read back `lastInsertRowid`) — passing an explicit rowid value to a fresh
 * INSERT throws "Only integers are allays for primary key values on vec_knowledge"
 * even for a plain JS integer (confirmed empirically; better-sqlite3 binds it in
 * a form vec0's stricter C-level check rejects). Once a row exists, UPDATE/DELETE
 * by that same rowid work fine with a plain number — the strict check is INSERT-only.
 */
export async function storeEmbedding(id: string, embedding: number[]): Promise<void> {
  const db = getDb();
  const vector = toVectorBuffer(embedding);
  const existing = db.prepare(`SELECT vec_rowid FROM knowledge_vec_map WHERE knowledge_id = ?`).get(id) as
    | { vec_rowid: number }
    | undefined;

  if (existing) {
    db.prepare(`UPDATE vec_knowledge SET embedding = ? WHERE rowid = ?`).run(vector, existing.vec_rowid);
  } else {
    const info = db.prepare(`INSERT INTO vec_knowledge(embedding) VALUES (?)`).run(vector);
    db.prepare(`INSERT INTO knowledge_vec_map(knowledge_id, vec_rowid) VALUES (?, ?)`).run(id, info.lastInsertRowid);
  }
}

/** Which of these ids already have an embedding stored? (used by restore) */
export async function getExistingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT knowledge_id FROM knowledge_vec_map WHERE knowledge_id IN (${placeholders})`)
    .all(...ids) as { knowledge_id: string }[];
  return new Set(rows.map((r) => r.knowledge_id));
}

/**
 * KNN search. Queries the vector table alone first (proven-safe pattern —
 * avoids joining a virtual table mid-MATCH-query, which sqlite-vec's own
 * examples never do either), then resolves rowids back to our knowledge ids
 * via the map table as a separate step.
 */
export async function queryEmbeddings(
  embedding: number[],
  limit: number,
): Promise<{ ids: string[]; distances: number[] }> {
  const db = getDb();
  const vector = toVectorBuffer(embedding);

  const rows = db
    .prepare(
      `SELECT rowid, distance
       FROM vec_knowledge
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`,
    )
    .all(vector, limit) as { rowid: number; distance: number }[];

  if (rows.length === 0) return { ids: [], distances: [] };

  const rowids = rows.map((r) => r.rowid);
  const placeholders = rowids.map(() => '?').join(',');
  const mapRows = db
    .prepare(`SELECT knowledge_id, vec_rowid FROM knowledge_vec_map WHERE vec_rowid IN (${placeholders})`)
    .all(...rowids) as { knowledge_id: string; vec_rowid: number }[];
  const byRowid = new Map(mapRows.map((m) => [m.vec_rowid, m.knowledge_id]));

  const ids: string[] = [];
  const distances: number[] = [];
  for (const r of rows) {
    const id = byRowid.get(r.rowid);
    if (!id) continue; // orphaned vector row (map entry missing) — skip rather than surface a null id
    ids.push(id);
    distances.push(r.distance);
  }
  return { ids, distances };
}

export async function deleteEmbedding(id: string): Promise<void> {
  const db = getDb();
  const existing = db.prepare(`SELECT vec_rowid FROM knowledge_vec_map WHERE knowledge_id = ?`).get(id) as
    | { vec_rowid: number }
    | undefined;
  if (!existing) return;
  db.prepare(`DELETE FROM vec_knowledge WHERE rowid = ?`).run(existing.vec_rowid);
  db.prepare(`DELETE FROM knowledge_vec_map WHERE knowledge_id = ?`).run(id);
}
