import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getEmbedding } from '../services/embeddings.js';
import { storeEmbedding, queryEmbeddings, deleteEmbedding } from '../services/vectorStore.js';
import { insertKnowledge, logAccess, findByContentHash, getKnowledgeRaw, insertContradiction } from '../services/sqlite.js';
import { classifyKnowledge } from '../services/classifier.js';
import type { KnowledgeReviewStatus } from '../types.js';

/** Omitted, empty, or the literal "global" all mean "applies to every project" — normalized to ''. */
const ProjectSchema = z.string().max(200).optional().default('').transform(
  (v) => (v.trim().toLowerCase() === 'global' ? '' : v.trim()),
);

export const AddKnowledgeSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50000),
  tags: z.array(z.string().min(1)).max(30),
  project: ProjectSchema,
  source: z.string().optional().default('manual'),
  problem: z.string().max(10000).optional(),
  kind: z.enum(['solution', 'rule', 'pitfall', 'decision']).optional().default('solution'),
  directive: z.string().max(500).optional(),
  /** Caller can suggest a priority; the classifier may override it. */
  priority: z.number().int().min(1).max(5).optional().default(3),
});

export type AddKnowledgeInput = z.input<typeof AddKnowledgeSchema>;

/** SHA-256 of normalised title+content — same as SQLite's computeContentHash. */
function contentHash(title: string, content: string): string {
  return createHash('sha256')
    .update(title.trim().toLowerCase() + '::' + content.trim())
    .digest('hex');
}

const SIMILARITY_THRESHOLD = 0.92; // cosine distance below this → warn as near-duplicate

export async function addKnowledge(
  input: AddKnowledgeInput,
): Promise<{
  id: string;
  message: string;
  review_status: KnowledgeReviewStatus;
  classifier_applied: boolean;
  kind: string;
  priority: number;
  duplicate_of?: string;
  similar_to?: { id: string; title: string };
}> {
  const parsed = AddKnowledgeSchema.parse(input);

  // ── 1. SHA-256 dedup ─────────────────────────────────────────────────────────
  const hash = contentHash(parsed.title, parsed.content);
  const existing = findByContentHash(hash);
  if (existing) {
    return {
      id: existing.id,
      message: `Duplicate detected — identical content already stored as "${existing.title}" (id: ${existing.id}). Use update_knowledge to modify it instead.`,
      review_status: existing.review_status ?? 'reviewed',
      classifier_applied: false,
      kind: existing.kind ?? 'solution',
      priority: existing.priority ?? 3,
      duplicate_of: existing.id,
    };
  }

  // ── 2. Classifier ─────────────────────────────────────────────────────────────
  const classification = await classifyKnowledge({
    title: parsed.title,
    content: parsed.content,
    problem: parsed.problem,
    tags: parsed.tags,
  });

  let finalKind = parsed.kind;
  let finalDirective = parsed.directive ?? undefined;
  let finalPriority = parsed.priority;
  let reviewStatus: KnowledgeReviewStatus = 'pending_review';

  if (classification) {
    reviewStatus = 'auto_classified';
    finalKind = classification.suggested_kind;
    finalPriority = classification.worth_keeping ? classification.suggested_priority : 5;
    if (classification.directive) finalDirective = classification.directive;
  }

  // ── 3. Embedding ─────────────────────────────────────────────────────────────
  const textToEmbed = [parsed.title, parsed.content, parsed.tags.join(' ')].join('\n');
  let embedding: number[];
  try {
    embedding = await getEmbedding(textToEmbed);
  } catch (err) {
    throw new Error(`Embedding generation failed (${String(err)})`);
  }

  // ── 4. Contradiction detection ───────────────────────────────────────────────
  // Non-blocking: warn if a very similar node already exists (semantic near-duplicate)
  let similarTo: { id: string; title: string } | undefined;
  let similarToScore = 0;
  try {
    const { ids: nearIds, distances: nearDist } = await queryEmbeddings(embedding, 1);
    const score = 1 - (nearDist[0] ?? 1);
    if (nearIds.length > 0 && score >= SIMILARITY_THRESHOLD) {
      const near = getKnowledgeRaw(nearIds[0]);
      if (near) {
        similarTo = { id: near.id, title: near.title };
        similarToScore = score;
      }
    }
  } catch {
    // Non-fatal — skip the check if the vector store errors for any reason
  }

  // ── 5. Persist ───────────────────────────────────────────────────────────────
  const id = uuidv4();
  const created_at = new Date().toISOString();

  await storeEmbedding(id, embedding);

  try {
    insertKnowledge({
      id,
      title: parsed.title,
      content: parsed.content,
      tags: parsed.tags,
      project: parsed.project,
      source: parsed.source,
      problem: parsed.problem,
      kind: finalKind,
      directive: finalDirective,
      priority: finalPriority,
      review_status: reviewStatus,
      created_at,
      updated_at: created_at,
      access_count: 0,
    });
  } catch (err) {
    // Race: another process (a second MCP server, the HTTP bridge, an auto-capture worker)
    // inserted the identical content between our pre-check above and this insert — the
    // UNIQUE index on content_hash is what actually catches it now, the pre-check is just
    // the fast path. Clean up the orphaned vector row we just wrote for this `id`
    // (the knowledge table never got a matching row) and fall back to the same duplicate response shape.
    if (String(err).includes('UNIQUE constraint failed') && String(err).includes('content_hash')) {
      await deleteEmbedding(id).catch(() => {});
      const raceWinner = findByContentHash(hash);
      if (raceWinner) {
        return {
          id: raceWinner.id,
          message: `Duplicate detected — identical content already stored as "${raceWinner.title}" (id: ${raceWinner.id}). Use update_knowledge to modify it instead.`,
          review_status: raceWinner.review_status ?? 'reviewed',
          classifier_applied: false,
          kind: raceWinner.kind ?? 'solution',
          priority: raceWinner.priority ?? 3,
          duplicate_of: raceWinner.id,
        };
      }
    }
    throw err;
  }

  logAccess({ knowledge_id: id, action: 'add', source: parsed.source, project: parsed.project });

  // Persist the contradiction warning — otherwise it only ever reaches whoever's looking
  // at THIS response, and is lost forever the moment auto-capture (no human watching) is
  // the caller. list_contradictions/resolve_contradiction make it reviewable later.
  if (similarTo) {
    insertContradiction({ new_id: id, similar_id: similarTo.id, similarity: similarToScore });
  }

  const classifierNote = classification
    ? ` [auto_classified: ${classification.suggested_kind}, priority=${finalPriority}]`
    : ' [pending_review: classifier unavailable]';

  const similarNote = similarTo ? ` ⚠ Similar node already exists: "${similarTo.title}" (${similarTo.id})` : '';

  return {
    id,
    message: `Knowledge "${parsed.title}" stored with id ${id}${classifierNote}${similarNote}`,
    review_status: reviewStatus,
    classifier_applied: classification !== null,
    kind: finalKind,
    priority: finalPriority,
    ...(similarTo ? { similar_to: similarTo } : {}),
  };
}
