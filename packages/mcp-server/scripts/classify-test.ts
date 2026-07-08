/**
 * Standalone test for the Ollama Cloud classifier.
 * Uses 3 real nodes from the brain to validate output quality before wiring into add_knowledge.
 *
 * Usage: pnpm classify:test
 */
import '../src/env.js';
import { classifyKnowledge } from '../src/services/classifier.js';

const SAMPLES = [
  {
    label: '[1] TIP-2375 — Requisitos de feature (expectativa: baixo valor, solution)',
    input: {
      title: 'TIP-2375 — Requisitos: Edição de Produto via CSV',
      content:
        'Feature de edição de produto e AQFMs via CSV (PUT /product/import).\n\n**Novos endpoints:**\n- POST /product/check-import/update — valida CSV, retorna {aqfmsToCreate, aqfmsToPatch}\n- PUT /product/import — atualiza produto + AQFMs (modo create_aqfms ou patch_aqfms)\n- GET /product/{id}/import/history — histórico de CSVs\n\n**Regras de negócio:**\n- Produto identificado por product.name normalizado (não cria novo — usa updateOneProduct)\n- Campos bloqueados (quebram progresso): questionIds, flashcardIds, conteúdos de Aula\n- AQFM matched por aqfmAdminName normalizado\n- Histórico em product_csv_history (MySQL/Prisma)\n\nOpen questions pendentes: identificação de produto, matching AQFM, storage do histórico.',
      problem: 'Permitir edição de produto e AQFMs via upload de CSV sem criar produto novo',
      tags: ['product', 'csv', 'import', 'aqfm', 'TIP-2375', 'feature'],
    },
  },
  {
    label: '[2] TIP-2375 — Implementação concluída (expectativa: solução com valor médio)',
    input: {
      title: 'TIP-2375 — Implementação concluída: PUT /product/import',
      content:
        'Feature de edição de produto e AQFMs via CSV implementada e testada.\n\n**Decisões técnicas:**\n- Histórico em MongoDB: collection `apollo_product_csv_history` (productId indexado)\n- updateBlockAqfms usa $transaction (deleteMany + createMany atômicos)\n- resolveVideos/createProfessors/createSpecialties/resolveTagIds extraídos em ProductImportHelpers.ts (compartilhado entre Create e Update)\n- questionIds/flashcardIds/minimumTaskIds ignorados silenciosamente no update (não zeram campos existentes)\n- AQFMs ausentes no CSV → soft-delete via deleteAQFMByAQFMId\n- blockId no CSV: presente + pertence ao produto → updateBlockAqfms; ausente/inválido → createBlock\n\n**Testes:** 21 unitários passando (CheckUpdate: 14, Update: 7)\n**TypeScript:** zero erros de compilação',
      problem: 'Editar produto e AQFMs via upload de CSV sem criar produto novo',
      tags: ['product', 'csv', 'import', 'update', 'aqfm', 'TIP-2375', 'mongodb', 'block'],
    },
  },
  {
    label: '[3] Brain MCP: loop de diretrizes (expectativa: decision, alta prioridade)',
    input: {
      title: 'Brain MCP: loop de melhoria ativa via Diretrizes (get_guidelines) com controle de tokens',
      content:
        'Transformação do Brain de armazenamento passivo para reforço ativo de boas práticas, com consumo barato de tokens.\n\nPROBLEMA: ter conhecimento e não aplicá-lo não melhora as IAs. Mas fazer a IA buscar/ler conteúdos longos a cada tarefa gasta milhares de tokens.\n\nSOLUÇÃO — camada de Diretrizes:\n1. Cada conhecimento tem kind (solution|rule|pitfall|decision) + directive (1 linha imperativa acionável).\n2. Nova tool get_guidelines({project}) retorna SÓ rules+pitfalls como linhas curtas (≤12, ~centenas de tokens, nunca o conteúdo completo).\n3. Loop: no início da tarefa a IA chama get_guidelines UMA vez; ao resolver algo, grava com kind+directive. Próxima sessão recebe o guardrail.\n\nBUG DE ROBUSTEZ CORRIGIDO: getDb() cacheava a conexão ANTES de migrar; se o ALTER batia em SQLITE_BUSY, deixava a conexão meio-migrada cacheada → "no such column" até reiniciar. Fix: busy_timeout=5000 + publicar singleton só após migração completa.',
      problem:
        'Fazer o Brain melhorar ativamente como as IAs operam sem gastar milhares de tokens de forma descontrolada.',
      tags: ['mcp', 'sqlite', 'ai-tooling', 'token-economy', 'architecture', 'llm-megabrain'],
    },
  },
];

async function main(): Promise<void> {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) {
    process.stderr.write('ERROR: OLLAMA_API_KEY not set in .env\n');
    process.exit(1);
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('  Brain MCP — Classifier test (3 real nodes)');
  console.log(`  Model: ${process.env.OLLAMA_CLOUD_MODEL ?? 'gpt-oss:20b-cloud'}`);
  console.log(`${'─'.repeat(60)}\n`);

  for (const sample of SAMPLES) {
    console.log(`\n${sample.label}`);
    console.log(`${'·'.repeat(60)}`);

    const t0 = Date.now();
    const result = await classifyKnowledge(sample.input);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!result) {
      console.log(`  ❌  classifier returned null (${elapsed}s) — check stderr for reason`);
      continue;
    }

    console.log(`  worth_keeping     : ${result.worth_keeping ? '✅ yes' : '❌ no'}`);
    console.log(`  suggested_kind    : ${result.suggested_kind}`);
    console.log(`  suggested_priority: ${result.suggested_priority}/5`);
    console.log(`  directive         : ${result.directive ?? '(none — solution/decision)'}`);
    console.log(`  reasoning         : ${result.reasoning}`);
    console.log(`  latency           : ${elapsed}s`);
  }

  console.log(`\n${'─'.repeat(60)}\n`);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${String(err)}\n`);
  process.exit(1);
});
