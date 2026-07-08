import { z } from 'zod';
import { listKnowledge } from '../services/sqlite.js';

export const ListKnowledgeSchema = z.object({
  project: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).max(30).optional(),
  limit: z.number().int().positive().max(500).optional().default(50),
});

export type ListKnowledgeInput = z.input<typeof ListKnowledgeSchema>;

export async function listKnowledgeTool(input: ListKnowledgeInput): Promise<{
  items: Array<{ id: string; title: string; tags: string[]; project: string; created_at: string }>;
}> {
  const parsed = ListKnowledgeSchema.parse(input);
  const items = listKnowledge(parsed);

  return {
    items: items.map(({ id, title, tags, project, created_at }) => ({
      id,
      title,
      tags,
      project,
      created_at,
    })),
  };
}
