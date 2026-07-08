import { useEffect, useState } from 'react';
import type { GuidelinesResult } from '../hooks/useBrain';
import { KIND_META } from '../lib/kinds';
import type { KnowledgeKind } from '../hooks/useBrain';

interface Props {
  projects: { name: string; count: number }[];
  fetchGuidelines: (project?: string) => Promise<GuidelinesResult>;
  onClose: () => void;
}

function parseLine(line: string): { kind: KnowledgeKind; text: string } {
  const m = line.match(/^\[(\w+)\]\s*(.*)$/);
  if (m && (m[1] in KIND_META)) return { kind: m[1] as KnowledgeKind, text: m[2] };
  return { kind: 'rule', text: line };
}

export function GuidelinesPanel({ projects, fetchGuidelines, onClose }: Props) {
  const [project, setProject] = useState<string>(projects[0]?.name ?? '');
  const [data, setData] = useState<GuidelinesResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchGuidelines(project || undefined)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [project, fetchGuidelines]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-brain-bg/85 backdrop-blur-md p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] bg-brain-surface border border-brain-cyan/30 rounded-2xl flex flex-col glow-cyan"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brain-cyan/10">
          <div>
            <h2 className="font-display text-sm text-brain-cyan tracking-widest glow-text">GUARDRAILS ATIVOS</h2>
            <p className="text-[10px] text-brain-text/40 mt-0.5">
              O que as IAs recebem ao chamar get_guidelines — regras & armadilhas
            </p>
          </div>
          <button onClick={onClose} className="text-brain-text/40 hover:text-brain-cyan text-lg">✕</button>
        </div>

        {/* project selector */}
        <div className="px-5 py-3 border-b border-brain-cyan/10">
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          >
            <option value="">Todos os projetos</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name || '🌐 global'} ({p.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading && <p className="text-xs text-brain-text/40">Carregando...</p>}
          {!loading && data && data.guidelines.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-brain-text/50">Nenhum guardrail para este projeto ainda.</p>
              <p className="text-xs text-brain-text/30 mt-2 leading-relaxed">
                Marque conhecimentos como <span className="text-brain-cyan">REGRA</span> ou{' '}
                <span className="text-brain-red">ARMADILHA</span> com uma diretriz de 1 linha — eles aparecem aqui e
                alimentam as IAs.
              </p>
            </div>
          )}
          {!loading &&
            data?.guidelines.map((line, i) => {
              const { kind, text } = parseLine(line);
              const m = KIND_META[kind];
              return (
                <div
                  key={i}
                  className="flex gap-3 items-start rounded-lg p-2.5 border-l-2"
                  style={{ backgroundColor: m.color + '0C', borderColor: m.color }}
                >
                  <span className="shrink-0 mt-0.5" style={{ color: m.color }}>{m.icon}</span>
                  <p className="text-sm text-brain-text/85 leading-relaxed break-words">{text}</p>
                </div>
              );
            })}
        </div>

        {data && data.guidelines.length > 0 && (
          <div className="px-5 py-2 border-t border-brain-cyan/10">
            <p className="text-[10px] text-brain-text/30 font-display tracking-wide text-center">
              {data.count} DIRETRIZES · ENTREGUE EM ~{Math.ceil(data.guidelines.join(' ').length / 4)} TOKENS
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
