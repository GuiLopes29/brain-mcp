import { z } from 'zod';
import { getEmbedding } from '../services/embeddings.js';
import { storeEmbedding, deleteEmbedding } from '../services/chroma.js';
import { updateKnowledge, getKnowledgeRaw, logAccess } from '../services/sqlite.js';

export const UpdateKnowledgeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().min(1).max(50000).optional(),
  tags: z.array(z.string().min(1)).max(30).optional(),
  problem: z.string().max(10000).optional(),
  kind: z.enum(['solution', 'rule', 'pitfall', 'decision']).optional(),
  directive: z.string().max(500).optional(),
  /** Mark a rule/pitfall as no longer relevant. */
  status: z.enum(['active', 'deprecated']).optional(),
  /** UUID of the item that supersedes this one (for audit trail). */
  superseded_by: z.string().uuid().nullable().optional(),
  /** 1 (critical, always surfaces in get_guidelines) to 5 (may be cut at limit). */
  priority: z.number().int().min(1).max(5).optional(),
  // See guidelines.ts for why 'claude' (not 'unknown') is the right default for
  // direct MCP callers omitting `source` — matches what index.ts already advertises.
  source: z.string().optional().default('claude'),
});

export type UpdateKnowledgeInput = z.input<typeof UpdateKnowledgeSchema>;

export async function updateKnowledgeTool(
  input: UpdateKnowledgeInput,
): Promise<{ success: boolean; message: string }> {
  const parsed = UpdateKnowledgeSchema.parse(input);

  const existing = getKnowledgeRaw(parsed.id);
  if (!existing) {
    return { success: false, message: `No knowledge found with id ${parsed.id}` };
  }

  // Re-embed FIRST when a semantic field changed, so that if embedding fails
  // (e.g. Ollama down) we abort before mutating SQLite — never leave the vector
  // store and metadata store out of sync.
  const semanticChange =
    parsed.title !== undefined || parsed.content !== undefined || parsed.tags !== undefined;

  if (semanticChange) {
    const title = parsed.title ?? existing.title;
    const content = parsed.content ?? existing.content;
    const tags = parsed.tags ?? existing.tags;
    const textToEmbed = [title, content, tags.join(' ')].join('\n');
    const embedding = await getEmbedding(textToEmbed);
    await deleteEmbedding(parsed.id).catch(() => {});
    await storeEmbedding(
      parsed.id,
      embedding,
      {
        title,
        project: existing.project,
        tags: tags.join(','),
        source: existing.source,
        created_at: existing.created_at,
      },
      textToEmbed,
    );
  }

  updateKnowledge(parsed.id, {
    title: parsed.title,
    content: parsed.content,
    tags: parsed.tags,
    problem: parsed.problem,
    kind: parsed.kind,
    directive: parsed.directive,
    status: parsed.status,
    superseded_by: parsed.superseded_by,
    priority: parsed.priority,
  });

  logAccess({ knowledge_id: parsed.id, action: 'update', source: parsed.source, project: existing.project });

  return { success: true, message: `Knowledge ${parsed.id} updated` };
}
