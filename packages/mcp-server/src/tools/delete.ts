import { z } from 'zod';
import { deleteKnowledge, logAccess } from '../services/sqlite.js';
import { deleteEmbedding } from '../services/vectorStore.js';

export const DeleteKnowledgeSchema = z.object({
  id: z.string().uuid(),
  // See guidelines.ts for why 'claude' (not 'unknown') is the right default for
  // direct MCP callers omitting `source` — matches what index.ts already advertises.
  source: z.string().optional().default('claude'),
});

export type DeleteKnowledgeInput = z.input<typeof DeleteKnowledgeSchema>;

export async function deleteKnowledgeTool(input: DeleteKnowledgeInput): Promise<{ success: boolean; message: string }> {
  const { id, source } = DeleteKnowledgeSchema.parse(input);

  const deleted = deleteKnowledge(id);
  if (!deleted) {
    return { success: false, message: `No knowledge found with id ${id}` };
  }

  await deleteEmbedding(id).catch(() => {});

  logAccess({ knowledge_id: id, action: 'delete', source });

  return { success: true, message: `Knowledge ${id} deleted` };
}
