/**
 * Consolidation pass: finds clusters of semantically-similar "solution" entries
 * and, when the model confirms they're really the same recurring pattern,
 * synthesizes ONE generalized rule/pitfall from them — instead of letting N flat
 * solutions about the same lesson pile up forever.
 *
 * This is what turns "we solved this 3 times" into "we now have a guardrail that
 * prevents it a 4th time" — get_guidelines only ever surfaces rule/pitfall, so a
 * cluster of solutions sitting there never reaches an AI's context on its own.
 *
 * Usage:
 *   pnpm consolidate              # dry-run — prints proposed clusters, writes nothing
 *   pnpm consolidate -- --apply   # creates the rule/pitfall, deprecates the originals
 */
import '../src/env.js';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getEmbedding } from '../src/services/embeddings.js';
import { storeEmbedding } from '../src/services/vectorStore.js';
import { listKnowledge, insertKnowledge, updateKnowledge } from '../src/services/sqlite.js';
import { synthesizeConsolidation } from '../src/services/classifier.js';
import { clusterBySimilarity } from '../src/services/clustering.js';

const APPLY = process.argv.includes('--apply');
const SIMILARITY_THRESHOLD = parseFloat(process.env.CONSOLIDATE_THRESHOLD ?? '0.80');
const MIN_CLUSTER_SIZE = 2;

async function main(): Promise<void> {
  const solutions = listKnowledge({ limit: 2000 }).filter(
    (k) => k.kind === 'solution' && (k.status ?? 'active') === 'active',
  );

  if (solutions.length < MIN_CLUSTER_SIZE) {
    console.log(`Only ${solutions.length} active solution(s) — nothing to cluster.`);
    return;
  }

  console.log(`Embedding ${solutions.length} solution(s) for similarity clustering...`);
  const embeddings: number[][] = [];
  for (const s of solutions) {
    embeddings.push(await getEmbedding([s.title, s.content, s.tags.join(' ')].join('\n')));
  }

  const clusters = clusterBySimilarity(embeddings, SIMILARITY_THRESHOLD).filter((g) => g.length >= MIN_CLUSTER_SIZE);
  console.log(`Found ${clusters.length} cluster(s) of ${MIN_CLUSTER_SIZE}+ similar solutions (cosine >= ${SIMILARITY_THRESHOLD}).\n`);

  let created = 0, deprecated = 0, rejected = 0;

  for (const cluster of clusters) {
    const items = cluster.map((i) => solutions[i]);
    console.log(`=== Cluster: ${items.length} items ===`);
    items.forEach((it) => console.log(`  - [${it.project || 'global'}] ${it.title}`));

    const proposal = await synthesizeConsolidation(
      items.map((it) => ({ title: it.title, content: it.content, directive: it.directive ?? null, project: it.project })),
    );

    if (!proposal) {
      console.log('  ⚠ classifier unavailable — skipped\n');
      continue;
    }
    if (!proposal.should_consolidate) {
      console.log(`  ✗ not consolidated: ${proposal.reasoning}\n`);
      rejected++;
      continue;
    }

    console.log(`  ✓ PROPOSED ${proposal.kind}: "${proposal.title}"`);
    console.log(`    directive: ${proposal.directive}`);
    console.log(`    global: ${proposal.is_global}`);
    console.log(`    reasoning: ${proposal.reasoning}`);

    if (!APPLY) {
      console.log('  (dry-run — nothing written)\n');
      continue;
    }

    const projectCounts = new Map<string, number>();
    for (const it of items) projectCounts.set(it.project, (projectCounts.get(it.project) ?? 0) + 1);
    const majorityProject = [...projectCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const project = proposal.is_global ? '' : majorityProject;

    const id = uuidv4();
    const now = new Date().toISOString();
    const title = proposal.title!;
    const content = proposal.content!;
    const tags = [...new Set(items.flatMap((it) => it.tags))];
    const textToEmbed = [title, content, tags.join(' ')].join('\n');

    const embedding = await getEmbedding(textToEmbed);
    await storeEmbedding(id, embedding);

    insertKnowledge({
      id, title, content, tags, project,
      source: 'claude',
      kind: proposal.kind!,
      directive: proposal.directive!,
      priority: 2,
      review_status: 'auto_classified',
      created_at: now, updated_at: now, access_count: 0,
    });

    for (const it of items) {
      updateKnowledge(it.id, { status: 'deprecated', superseded_by: id });
    }

    console.log(`  → created ${proposal.kind} ${id} (project: ${project || 'global'}), deprecated ${items.length} solution(s)\n`);
    created++;
    deprecated += items.length;
  }

  console.log(`Done. ${created} rule(s)/pitfall(s) created, ${deprecated} solution(s) deprecated, ${rejected} cluster(s) rejected as false positives.`);
  if (!APPLY && clusters.length > 0) console.log('Run with --apply to write these changes.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
