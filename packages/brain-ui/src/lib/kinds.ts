import type { KnowledgeKind } from '../hooks/useBrain';

export const KINDS: KnowledgeKind[] = ['solution', 'rule', 'pitfall', 'decision'];

export const KIND_META: Record<KnowledgeKind, { label: string; color: string; icon: string }> = {
  solution: { label: 'SOLUÇÃO', color: '#00F5FF', icon: '✔' },
  rule: { label: 'REGRA', color: '#4ADE80', icon: '◆' },
  pitfall: { label: 'ARMADILHA', color: '#FF3366', icon: '⚠' },
  decision: { label: 'DECISÃO', color: '#C084FC', icon: '⚙' },
};

export function kindMeta(kind?: KnowledgeKind) {
  return KIND_META[kind ?? 'solution'];
}
