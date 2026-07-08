import './env.js';
import express from 'express';
import cors from 'cors';
import { addKnowledge } from './tools/add.js';
import { searchKnowledge } from './tools/search.js';
import { listKnowledgeTool } from './tools/list.js';
import { deleteKnowledgeTool } from './tools/delete.js';
import { updateKnowledgeTool } from './tools/update.js';
import { getGuidelinesTool } from './tools/guidelines.js';
import {
  getAllKnowledge,
  getStats,
  getActivity,
  getKnowledgeDetail,
  viewKnowledge,
} from './services/sqlite.js';
import { warmUp } from './services/embeddings.js';
import { runBackup } from './backup.js';
import { logEvent, truncate } from './services/requestLog.js';
import type { GraphData, GraphNode, GraphEdge } from './types.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = Number(process.env.API_PORT ?? 3456);

/** Resolve the actor for a request: ?source= wins, then X-Brain-Source header, else 'browser'. */
function sourceOf(req: express.Request): string {
  const q = req.query.source;
  if (typeof q === 'string' && q) return q;
  const h = req.header('x-brain-source');
  if (h) return h;
  return 'browser';
}

// GET /knowledge — list
app.get('/knowledge', async (req, res) => {
  try {
    const { project, tags, limit } = req.query;
    const result = await listKnowledgeTool({
      project: project as string | undefined,
      tags: tags ? String(tags).split(',') : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    logEvent({
      action: 'list',
      source: sourceOf(req),
      project: project as string | undefined,
      detail: tags ? `tags=${tags}` : '(sem filtro)',
      result: `${result.items.length} itens`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /knowledge — add
app.post('/knowledge', async (req, res) => {
  try {
    const result = await addKnowledge({ source: sourceOf(req), ...req.body });
    const outcome = result.duplicate_of
      ? 'duplicata — não gravado'
      : result.similar_to
        ? `gravado, mas parecido com "${truncate(result.similar_to.title, 40)}"`
        : `${result.review_status} (${result.kind}, p${result.priority})`;
    logEvent({
      action: 'add',
      source: sourceOf(req),
      project: req.body?.project,
      detail: `"${truncate(String(req.body?.title ?? ''), 50)}"`,
      result: outcome,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// GET /knowledge/search?q=
app.get('/knowledge/search', async (req, res) => {
  try {
    const { q, project, tags, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const result = await searchKnowledge({
      query: String(q),
      project: project as string | undefined,
      tags: tags ? String(tags).split(',') : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      source: sourceOf(req),
    });
    logEvent({
      action: 'search',
      source: sourceOf(req),
      project: project as string | undefined,
      detail: `"${truncate(String(q), 50)}"`,
      result: `${result.results.length} resultado(s)`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /guidelines?project= — compact guardrails (rules + pitfalls)
app.get('/guidelines', async (req, res) => {
  try {
    const result = await getGuidelinesTool({
      project: req.query.project as string | undefined,
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      source: sourceOf(req),
    });
    logEvent({
      action: 'guidelines',
      source: sourceOf(req),
      project: req.query.project as string | undefined,
      detail: '',
      result: `${result.count} diretriz(es)`,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /stats — dashboard aggregates
app.get('/stats', (_req, res) => {
  try {
    res.json(getStats());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /activity?limit= — recent audit feed
app.get('/activity', (req, res) => {
  try {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 100;
    res.json({ activity: getActivity(limit) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /export — full portable JSON dump
app.get('/export', (_req, res) => {
  try {
    res.json({
      version: 1,
      exported_at: new Date().toISOString(),
      knowledge: getAllKnowledge(),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /knowledge/graph — graph data for UI
app.get('/knowledge/graph', async (_req, res) => {
  try {
    const items = getAllKnowledge();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const nodes: GraphNode[] = items.map((item) => {
      const isNew = now - new Date(item.created_at).getTime() < oneDayMs;
      const isNeverAccessed = item.access_count === 0;

      let color = '#00F5FF'; // cyan — active
      if (isNew) color = '#FF3366'; // red — recent
      else if (isNeverAccessed) color = '#7B2FBE'; // purple — dormant

      return {
        id: item.id,
        title: item.title,
        content: item.content,
        project: item.project,
        source: item.source,
        problem: item.problem,
        kind: item.kind,
        directive: item.directive,
        tags: item.tags,
        created_at: item.created_at,
        updated_at: item.updated_at,
        last_accessed_at: item.last_accessed_at,
        access_count: item.access_count,
        val: Math.max(1, Math.log2(item.access_count + 2)) * 4,
        color,
      };
    });

    const links: GraphEdge[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));
        if (sharedTags.length === 0) continue;

        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        links.push({ source: a.id, target: b.id, sharedTags });
      }
    }

    const graphData: GraphData = { nodes, links };
    res.json(graphData);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /knowledge/:id — single item + per-node detail (logs a 'view')
app.get('/knowledge/:id', (req, res) => {
  try {
    viewKnowledge(req.params.id, sourceOf(req));
    const detail = getKnowledgeDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'not found' });
    logEvent({
      action: 'view',
      source: sourceOf(req),
      project: detail.item.project,
      detail: `"${truncate(detail.item.title, 50)}"`,
      result: `acessado ${detail.item.access_count}x`,
    });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /knowledge/:id — update
app.patch('/knowledge/:id', async (req, res) => {
  try {
    const result = await updateKnowledgeTool({ id: req.params.id, source: sourceOf(req), ...req.body });
    logEvent({
      action: 'update',
      source: sourceOf(req),
      detail: `id=${req.params.id}`,
      result: result.success ? Object.keys(req.body ?? {}).join(', ') || 'ok' : 'não encontrado',
    });
    if (!result.success) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// DELETE /knowledge/:id
app.delete('/knowledge/:id', async (req, res) => {
  try {
    const result = await deleteKnowledgeTool({ id: req.params.id, source: sourceOf(req) });
    logEvent({
      action: 'delete',
      source: sourceOf(req),
      detail: `id=${req.params.id}`,
      result: result.success ? 'removido' : 'não encontrado',
    });
    if (!result.success) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function scheduleBackups() {
  if (process.env.BRAIN_AUTO_BACKUP === 'false') {
    process.stderr.write('[brain-api] auto-backup disabled (BRAIN_AUTO_BACKUP=false)\n');
    return;
  }
  const ONE_DAY = 24 * 60 * 60 * 1000;
  // initial backup shortly after boot (don't block startup)
  setTimeout(() => {
    try {
      runBackup({ push: true });
    } catch (err) {
      process.stderr.write(`[brain-api] startup backup failed: ${err}\n`);
    }
  }, 10_000);
  // then once per day while the API stays up
  setInterval(() => {
    try {
      runBackup({ push: true });
    } catch (err) {
      process.stderr.write(`[brain-api] scheduled backup failed: ${err}\n`);
    }
  }, ONE_DAY);
}

async function main() {
  await warmUp();
  app.listen(PORT, '127.0.0.1', () => {
    process.stderr.write(`[brain-api] listening on http://127.0.0.1:${PORT}\n`);
  });
  scheduleBackups();
}

main().catch((err) => {
  process.stderr.write(`[brain-api] fatal: ${err}\n`);
  process.exit(1);
});
