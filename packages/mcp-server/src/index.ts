import './env.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { addKnowledge } from './tools/add.js';
import { searchKnowledge } from './tools/search.js';
import { listKnowledgeTool } from './tools/list.js';
import { deleteKnowledgeTool } from './tools/delete.js';
import { updateKnowledgeTool } from './tools/update.js';
import { getGuidelinesTool } from './tools/guidelines.js';
import { warmUp } from './services/embeddings.js';
import { logEvent, truncate, type LogAction } from './services/requestLog.js';

const server = new Server(
  { name: 'brain-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

const TOOLS: Tool[] = [
  {
    name: 'add_knowledge',
    description: 'Store a piece of knowledge, decision, or learned solution into the semantic memory.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title' },
        content: { type: 'string', description: 'Full solution, decision, or learning' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Technology and concept tags' },
        project: { type: 'string', description: 'Repository or project name. Omit (or pass "global") when the lesson applies to every project — e.g. a general Windows/shell/tooling pitfall, not something specific to this repo. Global items surface in get_guidelines/search_knowledge for ALL projects.' },
        source: { type: 'string', description: 'Who is storing this: claude, cursor, browser, or manual', default: 'manual' },
        problem: { type: 'string', description: 'Original problem description (optional)' },
        kind: { type: 'string', enum: ['solution', 'rule', 'pitfall', 'decision'], description: 'solution=learned fix; rule=best practice to always follow; pitfall=anti-pattern to avoid; decision=architectural choice', default: 'solution' },
        directive: { type: 'string', description: 'ONE imperative line capturing the actionable takeaway (e.g. "Sempre validar X antes de Y"). Used by get_guidelines.' },
      },
      required: ['title', 'content', 'tags'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Semantically search stored knowledge using natural language.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        limit: { type: 'number', description: 'Max results (default: 5)' },
        project: { type: 'string', description: 'Filter by project' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        source: { type: 'string', description: 'Who is searching: claude, cursor, browser', default: 'claude' },
      },
      required: ['query'],
    },
  },
  {
    name: 'delete_knowledge',
    description: 'Permanently delete a knowledge item by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the knowledge item to delete' },
        source: { type: 'string', description: 'Who is deleting: claude, cursor, browser', default: 'claude' },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_knowledge',
    description: 'Update an existing knowledge item (title, content, tags, problem, kind, directive, priority, status). Re-embeds automatically when semantic fields change.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'UUID of the knowledge item to update' },
        title: { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New content (optional)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags (optional)' },
        problem: { type: 'string', description: 'New problem description (optional)' },
        kind: { type: 'string', enum: ['solution', 'rule', 'pitfall', 'decision'], description: 'Reclassify this item (optional)' },
        directive: { type: 'string', description: 'New one-line actionable directive (optional)' },
        priority: { type: 'number', description: '1 (critical, always in guardrails) to 5 (low, may be cut). Default 3.' },
        status: { type: 'string', enum: ['active', 'deprecated'], description: 'Deprecate a rule/pitfall that is no longer relevant.' },
        superseded_by: { type: 'string', description: 'UUID of the item that replaces this one (audit trail).' },
        source: { type: 'string', description: 'Who is updating: claude, cursor, browser', default: 'claude' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_guidelines',
    description:
      'TOKEN-CHEAP. Returns the compact list of guardrails (rules + pitfalls) for a project as one-line directives — NOT full content. Call this ONCE at the start of a coding task to load best practices and anti-patterns to follow, instead of repeatedly searching.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project to scope guardrails to (project rules + global rules). Omit for all.' },
        limit: { type: 'number', description: 'Max directives (default 12)' },
        source: { type: 'string', description: 'Who is asking: claude, cursor', default: 'claude' },
      },
    },
  },
  {
    name: 'list_knowledge',
    description: 'List stored knowledge items with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Filter by project' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
        limit: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const TOOL_TO_ACTION: Record<string, LogAction> = {
  add_knowledge: 'add',
  search_knowledge: 'search',
  delete_knowledge: 'delete',
  update_knowledge: 'update',
  get_guidelines: 'guidelines',
  list_knowledge: 'list',
};

/** Live one-line-per-call log to stderr — stdout is reserved for JSON-RPC framing. */
function logToolCall(name: string, args: Record<string, unknown>, result: Record<string, unknown>): void {
  const action = TOOL_TO_ACTION[name];
  if (!action) return;

  const source = typeof args.source === 'string' ? args.source : 'unknown';
  const project = typeof args.project === 'string' ? args.project : undefined;

  let detail = '';
  let outcome = '';
  switch (action) {
    case 'add':
      detail = `"${truncate(String(args.title ?? ''), 50)}"`;
      outcome = result.duplicate_of
        ? 'duplicata — não gravado'
        : `${result.review_status} (${result.kind}, p${result.priority})`;
      break;
    case 'search':
      detail = `"${truncate(String(args.query ?? ''), 50)}"`;
      outcome = `${(result.results as unknown[] | undefined)?.length ?? 0} resultado(s)`;
      break;
    case 'guidelines':
      outcome = `${result.count} diretriz(es)`;
      break;
    case 'update':
      detail = `id=${args.id}`;
      outcome = result.success ? 'ok' : 'não encontrado';
      break;
    case 'delete':
      detail = `id=${args.id}`;
      outcome = result.success ? 'removido' : 'não encontrado';
      break;
    case 'list':
      detail = project ?? '(sem filtro)';
      outcome = `${(result.items as unknown[] | undefined)?.length ?? 0} itens`;
      break;
  }

  logEvent({ action, source, project, detail, result: outcome }, process.stderr);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    if (name === 'add_knowledge') {
      result = await addKnowledge(args as Parameters<typeof addKnowledge>[0]);
    } else if (name === 'search_knowledge') {
      result = await searchKnowledge(args as Parameters<typeof searchKnowledge>[0]);
    } else if (name === 'delete_knowledge') {
      result = await deleteKnowledgeTool(args as Parameters<typeof deleteKnowledgeTool>[0]);
    } else if (name === 'update_knowledge') {
      result = await updateKnowledgeTool(args as Parameters<typeof updateKnowledgeTool>[0]);
    } else if (name === 'get_guidelines') {
      result = await getGuidelinesTool(args as Parameters<typeof getGuidelinesTool>[0]);
    } else if (name === 'list_knowledge') {
      result = await listKnowledgeTool(args as Parameters<typeof listKnowledgeTool>[0]);
    } else {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    logToolCall(name, (args ?? {}) as Record<string, unknown>, result as Record<string, unknown>);

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[brain-mcp] error in ${name}: ${message}\n`);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  process.stderr.write('[brain-mcp] starting...\n');
  await warmUp();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[brain-mcp] ready (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`[brain-mcp] fatal: ${err}\n`);
  process.exit(1);
});
