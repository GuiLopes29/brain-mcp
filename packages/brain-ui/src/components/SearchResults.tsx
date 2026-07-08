import type { KnowledgeSearchResult } from '../hooks/useBrain';

interface Props {
  results: KnowledgeSearchResult[];
  isSearching: boolean;
  activeId: string | null;
  onSelect: (node: KnowledgeSearchResult) => void;
}

function matchColor(sim: number): string {
  if (sim >= 0.7) return '#4ADE80'; // strong — green
  if (sim >= 0.5) return '#00F5FF'; // good — cyan
  if (sim >= 0.35) return '#FBBF24'; // weak — amber
  return '#FF3366'; // faint — red
}

export function SearchResults({ results, isSearching, activeId, onSelect }: Props) {
  if (!isSearching && results.length === 0) return null;

  return (
    <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4 animate-fade-slide-in">
      <div className="rounded-xl bg-brain-surface/95 backdrop-blur-md border border-brain-cyan/20 overflow-hidden glow-cyan">
        <div className="px-4 py-2 border-b border-brain-cyan/10 flex items-center justify-between">
          <span className="font-display text-[10px] tracking-widest text-brain-cyan/60">
            {isSearching ? 'ESCANEANDO MEMÓRIA...' : `${results.length} RESULTADOS · ORDENADOS POR RELEVÂNCIA`}
          </span>
        </div>

        <div className="max-h-[55vh] overflow-y-auto divide-y divide-brain-cyan/5">
          {results.map((r) => {
            const pct = Math.round(r.similarity * 100);
            const c = matchColor(r.similarity);
            const isActive = r.id === activeId;
            return (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className={`w-full text-left px-4 py-3 flex gap-3 items-start transition-colors ${
                  isActive ? 'bg-brain-cyan/10' : 'hover:bg-brain-cyan/5'
                }`}
              >
                {/* relevance dial */}
                <div className="shrink-0 flex flex-col items-center pt-0.5">
                  <span className="font-display text-sm leading-none" style={{ color: c }}>
                    {pct}%
                  </span>
                  <div className="mt-1 h-12 w-1 rounded-full bg-brain-bg/80 overflow-hidden flex flex-col justify-end">
                    <div className="w-full rounded-full" style={{ height: `${pct}%`, backgroundColor: c }} />
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm text-brain-text font-body leading-snug break-words line-clamp-2">
                    {r.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-brain-cyan/40 font-display tracking-wide truncate">
                    {r.project || '🌐 global'}
                  </p>
                  <p className="mt-1 text-xs text-brain-text/45 leading-relaxed line-clamp-2 break-words">
                    {r.content}
                  </p>
                  {r.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {r.tags.slice(0, 4).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-brain-bg/70 text-brain-text/40 font-body">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}

          {!isSearching && results.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-brain-text/40">
              Nenhum resultado. Tente outros termos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
