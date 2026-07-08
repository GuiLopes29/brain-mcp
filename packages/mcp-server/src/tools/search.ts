import { z } from 'zod';
import { getEmbedding } from '../services/embeddings.js';
import { queryEmbeddings } from '../services/chroma.js';
import { getKnowledgeRaw, bumpAccess, isLLMSource, logAccess, searchFts } from '../services/sqlite.js';
import type { KnowledgeSearchResult } from '../types.js';

export const SearchKnowledgeSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().positive().max(50).optional().default(5),
  project: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).max(30).optional(),
  // See guidelines.ts for why 'claude' (not 'unknown') is the right default for
  // direct MCP callers omitting `source` — matches what index.ts already advertises.
  source: z.string().optional().default('claude'),
});

export type SearchKnowledgeInput = z.input<typeof SearchKnowledgeSchema>;

/**
 * Reciprocal Rank Fusion (k=60).
 * Fuses two ranked lists into a single score: higher = better.
 * Items appearing in both lists score higher than items in only one.
 */
function rrfScore(vectorRank: number | undefined, ftsRank: number | undefined, k = 60): number {
  return (vectorRank !== undefined ? 1 / (k + vectorRank) : 0)
       + (ftsRank    !== undefined ? 1 / (k + ftsRank)    : 0);
}

export async function searchKnowledge(input: SearchKnowledgeInput): Promise<{ results: KnowledgeSearchResult[] }> {
  const parsed = SearchKnowledgeSchema.parse(input);

  let embedding: number[];
  try {
    embedding = await getEmbedding(parsed.query);
  } catch (err) {
    throw new Error(`Ollama unreachable — ensure "ollama serve" is running (${String(err)})`);
  }

  // ── Vector search (ChromaDB) ─────────────────────────────────────────────────
  // No project filter at the Chroma level — a project filter must also admit
  // global (project='') items, and Chroma's `where` here only supports exact
  // match. Dataset is small enough that post-filtering below (line ~74) is cheap
  // and keeps this simple, matching getGuidelines()'s SQL-side `project = ''` rule.
  const chromaLimit = Math.min(parsed.limit * 3, 50);
  const { ids: vectorIds, distances } = await queryEmbeddings(embedding, chromaLimit, {});

  // ── BM25 keyword search (SQLite FTS5) ────────────────────────────────────────
  const ftsHits = searchFts(parsed.query, chromaLimit);

  // ── Reciprocal Rank Fusion ────────────────────────────────────────────────────
  const vectorRankMap = new Map(vectorIds.map((id, i) => [id, i]));
  const ftsRankMap    = new Map(ftsHits.map((r, i) => [r.id, i]));
  const allIds = new Set([...vectorRankMap.keys(), ...ftsRankMap.keys()]);

  const scored = Array.from(allIds)
    .map(id => ({ id, score: rrfScore(vectorRankMap.get(id), ftsRankMap.get(id)) }))
    .sort((a, b) => b.score - a.score);

  // ── Build result list with tag filter + project diversification ──────────────
  const countsAsUse = isLLMSource(parsed.source);
  // Diversify only when no explicit project filter (avoid swamping by one noisy project)
  const MAX_PER_PROJECT = parsed.project ? Infinity : 3;
  const projectCount = new Map<string, number>();
  const results: KnowledgeSearchResult[] = [];

  for (const { id, score } of scored) {
    if (results.length >= parsed.limit) break;

    const item = countsAsUse ? bumpAccess(id) : getKnowledgeRaw(id);
    if (!item) continue;

    // Project filter — a project-scoped search also admits global (project='')
    // items, same rule as getGuidelines(). searchFts() has no project scoping of
    // its own, so this is also what keeps other projects' items from leaking in
    // through the keyword-match side.
    if (parsed.project && item.project !== parsed.project && item.project !== '') continue;

    // Tag filter
    if (parsed.tags?.length && !parsed.tags.some(t => item.tags.includes(t))) continue;

    // Project diversification
    const count = projectCount.get(item.project) ?? 0;
    if (count >= MAX_PER_PROJECT) continue;
    projectCount.set(item.project, count + 1);

    // similarity: use actual cosine sim when available (vector match), otherwise RRF-derived
    const vectorRank = vectorRankMap.get(id);
    const similarity = vectorRank !== undefined
      ? 1 - (distances[vectorRank] ?? 0)
      : 0.6; // keyword-only match — use fixed neutral value for display

    results.push({ ...item, similarity });
  }

  logAccess({
    action: 'search',
    source: parsed.source,
    query: parsed.query,
    project: parsed.project,
    results_count: results.length,
  });

  return { results };
}
