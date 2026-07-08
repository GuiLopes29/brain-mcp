import '../env.js';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import { createHash } from 'crypto';
import type { KnowledgeItem } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolvePath(): string {
  const raw = process.env.SQLITE_PATH ?? './data/brain.db';
  if (raw.startsWith('./') || raw.startsWith('../')) {
    return join(__dirname, '..', '..', raw);
  }
  return raw;
}

const DB_PATH = resolvePath();

let db: Database.Database | null = null;

/** Known event types written to access_log. */
export type LogAction = 'add' | 'view' | 'search' | 'update' | 'delete' | 'guidelines';

function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  // Build on a LOCAL handle and only publish to the module singleton after
  // schema + migration fully succeed. If init throws (e.g. a transient
  // SQLITE_BUSY from another process during ALTER), we leave `db` null so the
  // next call retries a clean init instead of serving a half-migrated handle.
  const conn = new Database(DB_PATH);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000'); // wait on locks instead of throwing

  conn.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      content          TEXT NOT NULL,
      tags             TEXT NOT NULL DEFAULT '[]',
      project          TEXT NOT NULL DEFAULT '',
      source           TEXT NOT NULL DEFAULT 'manual',
      problem          TEXT,
      kind             TEXT NOT NULL DEFAULT 'solution',
      directive        TEXT,
      status           TEXT NOT NULL DEFAULT 'active',
      superseded_by    TEXT,
      priority         INTEGER NOT NULL DEFAULT 3,
      review_status    TEXT NOT NULL DEFAULT 'reviewed',
      content_hash     TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT,
      last_accessed_at TEXT,
      access_count     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_project ON knowledge(project);
    CREATE INDEX IF NOT EXISTS idx_created ON knowledge(created_at);
    CREATE INDEX IF NOT EXISTS idx_kind    ON knowledge(kind);
    CREATE INDEX IF NOT EXISTS idx_status  ON knowledge(status);
    -- idx_content_hash is created in migrate() AFTER the column is guaranteed to exist —
    -- creating it here breaks on pre-existing DBs where content_hash hasn't been ALTERed in yet.

    -- FTS5 full-text index (BM25 via bm25() function)
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      id     UNINDEXED,
      title,
      content,
      tags,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_ai AFTER INSERT ON knowledge BEGIN
      INSERT INTO knowledge_fts(id, title, content, tags)
      VALUES (new.id, new.title, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_au AFTER UPDATE ON knowledge BEGIN
      DELETE FROM knowledge_fts WHERE id = old.id;
      INSERT INTO knowledge_fts(id, title, content, tags)
      VALUES (new.id, new.title, new.content, new.tags);
    END;

    CREATE TRIGGER IF NOT EXISTS knowledge_fts_ad AFTER DELETE ON knowledge BEGIN
      DELETE FROM knowledge_fts WHERE id = old.id;
    END;

    CREATE TABLE IF NOT EXISTS access_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      knowledge_id  TEXT,
      action        TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'unknown',
      query         TEXT,
      project       TEXT,
      results_count INTEGER,
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_created ON access_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_log_knowledge ON access_log(knowledge_id);
    CREATE INDEX IF NOT EXISTS idx_log_source ON access_log(source);
    CREATE INDEX IF NOT EXISTS idx_log_action ON access_log(action);
  `);

  migrate(conn);

  db = conn;
  return db;
}

/** Idempotent migration for databases created before the tracking columns existed. */
function migrate(database: Database.Database): void {
  const cols = database.prepare(`PRAGMA table_info(knowledge)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('updated_at')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN updated_at TEXT`);
    database.exec(`UPDATE knowledge SET updated_at = created_at WHERE updated_at IS NULL`);
  }
  if (!names.has('last_accessed_at')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN last_accessed_at TEXT`);
  }
  if (!names.has('kind')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN kind TEXT NOT NULL DEFAULT 'solution'`);
  }
  if (!names.has('directive')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN directive TEXT`);
  }
  if (!names.has('status')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
  if (!names.has('superseded_by')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN superseded_by TEXT`);
  }
  if (!names.has('priority')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN priority INTEGER NOT NULL DEFAULT 3`);
  }
  if (!names.has('review_status')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN review_status TEXT NOT NULL DEFAULT 'reviewed'`);
  }
  if (!names.has('content_hash')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN content_hash TEXT`);
  }
  // Runs on EVERY startup, not just when the column is first added — a row can end up with
  // a NULL hash if it was inserted by a stale process still running pre-content_hash code
  // (e.g. an MCP server started before this feature shipped, only restarted later). Without
  // this, such rows would stay NULL forever, since the one-time ALTER-TABLE branch above
  // only runs once. Idempotent: after the first heal, this SELECT returns zero rows.
  {
    const rows = database.prepare(`SELECT id, title, content FROM knowledge WHERE content_hash IS NULL`).all() as { id: string; title: string; content: string }[];
    if (rows.length > 0) {
      const upd = database.prepare(`UPDATE knowledge SET content_hash = ? WHERE id = ?`);
      for (const row of rows) {
        upd.run(computeContentHash(row.title, row.content), row.id);
      }
    }
  }
  // UNIQUE turns the dedup check in add.ts (find-then-insert) into a real guarantee instead
  // of a check-then-act race between concurrent processes (multiple MCP servers, the HTTP
  // bridge, and auto-capture workers all write to this same file). `CREATE ... IF NOT EXISTS`
  // does NOT upgrade an already-existing non-unique index of the same name — databases created
  // before this line shipped need the old index dropped first, or this silently stays a no-op.
  const existingIndex = (database.prepare(`PRAGMA index_list(knowledge)`).all() as { name: string; unique: number }[])
    .find((idx) => idx.name === 'idx_content_hash');
  if (existingIndex && existingIndex.unique === 0) {
    database.exec(`DROP INDEX idx_content_hash`);
  }
  try {
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_content_hash ON knowledge(content_hash)`);
  } catch (err) {
    // Defensive fallback: if duplicate hashes somehow exist, don't crash the whole DB layer —
    // just keep a plain (non-unique) index and rely on add.ts's check-then-insert as before.
    process.stderr.write(`[sqlite] could not create UNIQUE index on content_hash (duplicate hashes present?) — falling back to non-unique: ${err}\n`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_content_hash ON knowledge(content_hash)`);
  }

  // Populate FTS5 if it's empty but knowledge rows exist (first run after adding FTS5)
  const ftsCount = (database.prepare(`SELECT COUNT(*) AS n FROM knowledge_fts`).get() as { n: number }).n;
  const rowCount = (database.prepare(`SELECT COUNT(*) AS n FROM knowledge`).get() as { n: number }).n;
  if (ftsCount < rowCount) {
    database.exec(`DELETE FROM knowledge_fts`);
    database.exec(`INSERT INTO knowledge_fts(id, title, content, tags) SELECT id, title, content, tags FROM knowledge`);
  }
}

function computeContentHash(title: string, content: string): string {
  return createHash('sha256')
    .update(title.trim().toLowerCase() + '::' + content.trim())
    .digest('hex');
}

/** Write an audit-log row. Never throws — logging must not break the primary operation. */
export function logAccess(entry: {
  knowledge_id?: string | null;
  action: LogAction;
  source?: string;
  query?: string;
  project?: string;
  results_count?: number;
}): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO access_log (knowledge_id, action, source, query, project, results_count, created_at)
       VALUES (@knowledge_id, @action, @source, @query, @project, @results_count, @created_at)`,
    ).run({
      knowledge_id: entry.knowledge_id ?? null,
      action: entry.action,
      source: entry.source ?? 'unknown',
      query: entry.query ?? null,
      project: entry.project ?? null,
      results_count: entry.results_count ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    /* swallow — never break the caller */
  }
}

export function insertKnowledge(item: KnowledgeItem): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO knowledge
      (id, title, content, tags, project, source, problem, kind, directive,
       status, superseded_by, priority, review_status, content_hash,
       created_at, updated_at, last_accessed_at, access_count)
    VALUES
      (@id, @title, @content, @tags, @project, @source, @problem, @kind, @directive,
       @status, @superseded_by, @priority, @review_status, @content_hash,
       @created_at, @updated_at, @last_accessed_at, @access_count)
  `).run({
    ...item,
    tags: JSON.stringify(item.tags),
    kind: item.kind ?? 'solution',
    directive: item.directive ?? null,
    status: item.status ?? 'active',
    superseded_by: item.superseded_by ?? null,
    priority: item.priority ?? 3,
    review_status: item.review_status ?? 'reviewed',
    content_hash: computeContentHash(item.title, item.content),
    updated_at: item.updated_at ?? item.created_at,
    last_accessed_at: item.last_accessed_at ?? null,
    problem: item.problem ?? null,
  });
}

/** Return the first item with this SHA-256 hash, or undefined if none. */
export function findByContentHash(hash: string): KnowledgeItem | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM knowledge WHERE content_hash = ? LIMIT 1`).get(hash) as RawRow | undefined;
  return row ? deserialize(row) : undefined;
}

/**
 * BM25 full-text search via SQLite FTS5.
 * Returns ids ordered by relevance (most relevant first).
 * Falls back to [] on any FTS query syntax error.
 */
export function searchFts(query: string, limit = 20): { id: string; bm25Score: number }[] {
  const db = getDb();
  // Build a safe FTS5 query: strip special chars, add prefix wildcard to each word
  const ftsQuery = query
    .replace(/["'*()\-+~^]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .map(w => `${w}*`)
    .join(' ');

  if (!ftsQuery) return [];

  try {
    const rows = db
      .prepare(
        `SELECT id, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         WHERE knowledge_fts MATCH ?
         ORDER BY score   -- FTS5 bm25() is negative: lower = better
         LIMIT ?`,
      )
      .all(ftsQuery, limit) as { id: string; score: number }[];

    return rows.map(r => ({ id: r.id, bm25Score: r.score }));
  } catch {
    return []; // gracefully degrade on bad FTS syntax
  }
}

/** Read a single item with NO side effects (used internally by search and export). */
export function getKnowledgeRaw(id: string): KnowledgeItem | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM knowledge WHERE id = ?`).get(id) as RawRow | undefined;
  return row ? deserialize(row) : undefined;
}

/** Only AI clients grow a node — browser/desktop views are user curiosity. */
const LLM_SOURCES = new Set(['claude', 'cursor']);
export function isLLMSource(source?: string): boolean {
  return !!source && LLM_SOURCES.has(source);
}

/** Real consumption by an AI: bump access_count (drives node size) + last_accessed_at. */
export function bumpAccess(id: string): KnowledgeItem | undefined {
  const db = getDb();
  db.prepare(
    `UPDATE knowledge SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`,
  ).run(new Date().toISOString(), id);
  return getKnowledgeRaw(id);
}

/** Someone looked at it (any source): refresh last_accessed_at WITHOUT growing the node. */
export function markSeen(id: string): KnowledgeItem | undefined {
  const db = getDb();
  db.prepare(`UPDATE knowledge SET last_accessed_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id,
  );
  return getKnowledgeRaw(id);
}

/**
 * Explicit single-item view. Always logs WHERE/WHEN. access_count (node size)
 * only grows for AI sources; browser/desktop curiosity just refreshes the
 * last-seen timestamp.
 */
export function viewKnowledge(id: string, source = 'unknown'): KnowledgeItem | undefined {
  const item = isLLMSource(source) ? bumpAccess(id) : markSeen(id);
  if (item) logAccess({ knowledge_id: id, action: 'view', source, project: item.project });
  return item;
}

export function updateKnowledge(
  id: string,
  fields: {
    title?: string; content?: string; tags?: string[]; problem?: string;
    kind?: string; directive?: string;
    status?: string; superseded_by?: string | null; priority?: number;
    review_status?: string;
  },
): KnowledgeItem | undefined {
  const db = getDb();
  const existing = getKnowledgeRaw(id);
  if (!existing) return undefined;

  const next = {
    title: fields.title ?? existing.title,
    content: fields.content ?? existing.content,
    tags: JSON.stringify(fields.tags ?? existing.tags),
    problem: fields.problem ?? existing.problem ?? null,
    kind: fields.kind ?? existing.kind ?? 'solution',
    directive: fields.directive ?? existing.directive ?? null,
    status: fields.status ?? existing.status ?? 'active',
    superseded_by: 'superseded_by' in fields ? (fields.superseded_by ?? null) : (existing.superseded_by ?? null),
    priority: fields.priority ?? existing.priority ?? 3,
    review_status: fields.review_status ?? existing.review_status ?? 'reviewed',
    updated_at: new Date().toISOString(),
    id,
  };

  db.prepare(
    `UPDATE knowledge
     SET title = @title, content = @content, tags = @tags, problem = @problem,
         kind = @kind, directive = @directive, status = @status,
         superseded_by = @superseded_by, priority = @priority,
         review_status = @review_status, updated_at = @updated_at
     WHERE id = @id`,
  ).run(next);

  return getKnowledgeRaw(id);
}

/**
 * Ebbinghaus memory strength: knowledge decays without reinforcement.
 * λ=0.05 → half-life ~14 days for a never-accessed item; frequent access
 * resets the clock and multiplies strength.
 */
function ebbinghausStrength(accessCount: number, lastAt: string | null, updatedAt: string | null): number {
  const ref = lastAt ?? updatedAt ?? new Date().toISOString();
  const daysSince = (Date.now() - new Date(ref).getTime()) / 86_400_000;
  return (accessCount + 1) * Math.exp(-0.05 * daysSince);
}

/**
 * Compact, token-cheap guardrails for a consuming AI.
 *
 * Ranking:
 *   1. priority ASC  — lower = more critical, always surfaces first
 *   2. project-scoped before global
 *   3. Ebbinghaus strength DESC — frequently accessed & recently touched items win;
 *      items never reinforced decay over ~14 days
 *
 * Only `rule` and `pitfall` with status='active' are returned.
 * Directives are deduped by text (case-insensitive) — keep highest-ranked occurrence.
 */
export function getGuidelines(
  project?: string,
  limit = 12,
): { kind: string; directive: string; project: string; priority: number }[] {
  const db = getDb();

  // Fetch more than needed for dedup; SQL handles the coarse filter only
  const rows = db
    .prepare(
      `SELECT kind,
              COALESCE(NULLIF(directive, ''), title) AS directive,
              project,
              priority,
              access_count,
              last_accessed_at,
              updated_at
       FROM knowledge
       WHERE status = 'active'
         AND kind IN ('rule', 'pitfall')
         AND (@project IS NULL OR project = @project OR project = '')
       ORDER BY priority ASC`,
    )
    .all({ project: project ?? null }) as {
      kind: string; directive: string; project: string; priority: number;
      access_count: number; last_accessed_at: string | null; updated_at: string | null;
    }[];

  // JS re-ranking within each priority tier using Ebbinghaus strength
  const isScoped = (r: (typeof rows)[0]) => project != null && r.project === project;
  rows.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    // project-scoped items beat global within the same priority
    const scopeDiff = (isScoped(b) ? 1 : 0) - (isScoped(a) ? 1 : 0);
    if (scopeDiff !== 0) return scopeDiff;
    return ebbinghausStrength(b.access_count, b.last_accessed_at, b.updated_at)
         - ebbinghausStrength(a.access_count, a.last_accessed_at, a.updated_at);
  });

  // Dedupe by directive text, keep first (highest-ranked) occurrence
  const seen = new Set<string>();
  const out: { kind: string; directive: string; project: string; priority: number }[] = [];
  for (const r of rows) {
    const key = r.directive.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, directive: r.directive, project: r.project, priority: r.priority });
    if (out.length >= limit) break;
  }
  return out;
}

export function listKnowledge(opts: {
  project?: string;
  tags?: string[];
  limit?: number;
}): KnowledgeItem[] {
  const db = getDb();
  let query = `SELECT * FROM knowledge WHERE 1=1`;
  const params: (string | number)[] = [];

  if (opts.project) {
    query += ` AND project = ?`;
    params.push(opts.project);
  }

  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(opts.limit ?? 50);

  const rows = db.prepare(query).all(...params) as RawRow[];
  let items = rows.map(deserialize);

  if (opts.tags && opts.tags.length > 0) {
    items = items.filter((item) =>
      opts.tags!.some((tag) => item.tags.includes(tag)),
    );
  }

  return items;
}

/** Test-only helper — clears all data from the in-memory DB. Never call in production. */
export function _clearAllForTesting(): void {
  const db = getDb();
  db.exec(`DELETE FROM knowledge_fts; DELETE FROM knowledge; DELETE FROM access_log;`);
}

export function deleteKnowledge(id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM knowledge WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getAllKnowledge(): KnowledgeItem[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM knowledge ORDER BY created_at DESC`).all() as RawRow[];
  return rows.map(deserialize);
}

// ── Activity & stats ────────────────────────────────────────────────────────

export interface ActivityRow {
  id: number;
  knowledge_id: string | null;
  knowledge_title: string | null;
  action: LogAction;
  source: string;
  query: string | null;
  project: string | null;
  results_count: number | null;
  created_at: string;
}

export function getActivity(limit = 100): ActivityRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT l.id, l.knowledge_id, k.title AS knowledge_title, l.action, l.source,
              l.query, l.project, l.results_count, l.created_at
       FROM access_log l
       LEFT JOIN knowledge k ON k.id = l.knowledge_id
       ORDER BY l.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as ActivityRow[];
}

export interface BrainStats {
  totals: { nodes: number; events: number; searches: number; views: number; adds: number };
  bySource: { source: string; count: number }[];
  byAction: { action: string; count: number }[];
  byProject: { project: string; nodes: number; events: number }[];
  timeline: { day: string; events: number }[];
  topAccessed: { id: string; title: string; project: string; access_count: number }[];
  activeDays: number;
  firstEvent: string | null;
  lastEvent: string | null;
}

export function getStats(): BrainStats {
  const db = getDb();

  const nodes = (db.prepare(`SELECT COUNT(*) AS n FROM knowledge`).get() as { n: number }).n;
  const events = (db.prepare(`SELECT COUNT(*) AS n FROM access_log`).get() as { n: number }).n;

  const actionCount = (a: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE action = ?`).get(a) as { n: number }).n;

  const bySource = db
    .prepare(`SELECT source, COUNT(*) AS count FROM access_log GROUP BY source ORDER BY count DESC`)
    .all() as { source: string; count: number }[];

  const byAction = db
    .prepare(`SELECT action, COUNT(*) AS count FROM access_log GROUP BY action ORDER BY count DESC`)
    .all() as { action: string; count: number }[];

  const byProject = db
    .prepare(
      `SELECT k.project AS project,
              COUNT(DISTINCT k.id) AS nodes,
              (SELECT COUNT(*) FROM access_log l WHERE l.project = k.project) AS events
       FROM knowledge k
       GROUP BY k.project
       ORDER BY nodes DESC`,
    )
    .all() as { project: string; nodes: number; events: number }[];

  const timeline = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS events
       FROM access_log
       GROUP BY day
       ORDER BY day DESC
       LIMIT 30`,
    )
    .all() as { day: string; events: number }[];

  const topAccessed = db
    .prepare(
      `SELECT id, title, project, access_count FROM knowledge
       ORDER BY access_count DESC LIMIT 10`,
    )
    .all() as { id: string; title: string; project: string; access_count: number }[];

  const activeDays = (
    db.prepare(`SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS n FROM access_log`).get() as {
      n: number;
    }
  ).n;

  const firstEvent =
    (db.prepare(`SELECT MIN(created_at) AS t FROM access_log`).get() as { t: string | null }).t;
  const lastEvent =
    (db.prepare(`SELECT MAX(created_at) AS t FROM access_log`).get() as { t: string | null }).t;

  return {
    totals: {
      nodes,
      events,
      searches: actionCount('search'),
      views: actionCount('view'),
      adds: actionCount('add'),
    },
    bySource,
    byAction,
    byProject,
    timeline: timeline.reverse(),
    topAccessed,
    activeDays,
    firstEvent,
    lastEvent,
  };
}

/** Per-node detail: timeline of its events + distinct active days. */
export function getKnowledgeDetail(id: string): {
  item: KnowledgeItem;
  activeDays: number;
  events: { action: LogAction; source: string; created_at: string }[];
} | undefined {
  const db = getDb();
  const item = getKnowledgeRaw(id);
  if (!item) return undefined;

  const activeDays = (
    db
      .prepare(`SELECT COUNT(DISTINCT substr(created_at, 1, 10)) AS n FROM access_log WHERE knowledge_id = ?`)
      .get(id) as { n: number }
  ).n;

  const events = db
    .prepare(
      `SELECT action, source, created_at FROM access_log WHERE knowledge_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(id) as { action: LogAction; source: string; created_at: string }[];

  return { item, activeDays, events };
}

interface RawRow {
  id: string;
  title: string;
  content: string;
  tags: string;
  project: string;
  source: string;
  problem: string | null;
  kind: string | null;
  directive: string | null;
  status: string | null;
  superseded_by: string | null;
  priority: number | null;
  review_status: string | null;
  content_hash: string | null;
  created_at: string;
  updated_at: string | null;
  last_accessed_at: string | null;
  access_count: number;
}

function deserialize(row: RawRow): KnowledgeItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    project: row.project,
    source: row.source,
    problem: row.problem ?? undefined,
    kind: (row.kind ?? 'solution') as KnowledgeItem['kind'],
    directive: row.directive ?? undefined,
    status: ((row.status ?? 'active') as KnowledgeItem['status']),
    superseded_by: row.superseded_by ?? undefined,
    priority: row.priority ?? 3,
    review_status: ((row.review_status ?? 'reviewed') as KnowledgeItem['review_status']),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    last_accessed_at: row.last_accessed_at ?? undefined,
    access_count: row.access_count,
  };
}
