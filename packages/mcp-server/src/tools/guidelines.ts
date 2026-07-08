import { z } from 'zod';
import { getGuidelines, logAccess } from '../services/sqlite.js';

export const GetGuidelinesSchema = z.object({
  project: z.string().optional(),
  limit: z.number().int().positive().max(30).optional().default(12),
  // Direct MCP callers are, in practice, always Claude Code or Cursor — 'unknown'
  // has zero diagnostic value and only happens when a caller omits `source`
  // despite index.ts's advertised tool schema claiming the default IS "claude".
  // Match that promise instead of silently breaking Control Room attribution.
  source: z.string().optional().default('claude'),
});

export type GetGuidelinesInput = z.input<typeof GetGuidelinesSchema>;

/**
 * Token-cheap guardrails for a consuming AI. Returns ONLY short directive lines
 * (rules + pitfalls), never full content. Call once at the start of a task.
 */
export async function getGuidelinesTool(input: GetGuidelinesInput): Promise<{
  project: string;
  count: number;
  guidelines: string[];
}> {
  const parsed = GetGuidelinesSchema.parse(input);
  const rows = getGuidelines(parsed.project, parsed.limit);

  logAccess({
    action: 'guidelines',
    source: parsed.source,
    project: parsed.project,
    results_count: rows.length,
  });

  return {
    project: parsed.project ?? 'all',
    count: rows.length,
    guidelines: rows.map((r) => `[${r.kind}] ${r.directive}`),
  };
}
