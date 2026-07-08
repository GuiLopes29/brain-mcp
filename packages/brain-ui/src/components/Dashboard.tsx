import { useEffect, useState, useCallback, useMemo } from 'react';
import type { BrainStats, ActivityRow, GraphNode } from '../hooks/useBrain';
import { kindMeta, KINDS } from '../lib/kinds';

interface Props {
  fetchStats: () => Promise<BrainStats>;
  fetchActivity: (limit?: number) => Promise<ActivityRow[]>;
  nodes: GraphNode[];
  onSelectNode: (node: GraphNode) => void;
  onClose: () => void;
}

type SortKey = 'recent' | 'access' | 'title';

const SOURCE_COLOR: Record<string, string> = {
  claude: '#00F5FF',
  cursor: '#7B2FBE',
  browser: '#FF3366',
  manual: '#E0E8F0',
  api: '#4ADE80',
  unknown: '#64748B',
};

const ACTION_LABEL: Record<string, string> = {
  add: '＋ criado',
  view: '👁 visto',
  search: '🔍 busca',
  update: '✎ editado',
  delete: '🗑 removido',
  guidelines: '◆ guardrails',
};

function colorFor(source: string): string {
  return SOURCE_COLOR[source] ?? SOURCE_COLOR.unknown;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl bg-brain-surface/80 border border-brain-cyan/15 p-4 flex flex-col gap-1">
      <span className="font-display text-3xl glow-text" style={{ color: accent ?? '#00F5FF' }}>
        {value}
      </span>
      <span className="font-display text-[10px] tracking-widest text-brain-text/40">{label}</span>
    </div>
  );
}

export function Dashboard({ fetchStats, fetchActivity, nodes, onSelectNode, onClose }: Props) {
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // node explorer state
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [kindFilter, setKindFilter] = useState<string>('');
  const [textFilter, setTextFilter] = useState('');

  const explorerNodes = useMemo(() => {
    let list = [...nodes];
    if (kindFilter) list = list.filter((n) => (n.kind ?? 'solution') === kindFilter);
    if (textFilter.trim()) {
      const q = textFilter.toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.project.toLowerCase().includes(q) ||
          (!n.project && 'global'.includes(q)),
      );
    }
    list.sort((a, b) => {
      if (sortKey === 'access') return b.access_count - a.access_count;
      if (sortKey === 'title') return a.title.localeCompare(b.title);
      const ta = new Date(a.last_accessed_at ?? a.created_at).getTime();
      const tb = new Date(b.last_accessed_at ?? b.created_at).getTime();
      return tb - ta;
    });
    return list;
  }, [nodes, kindFilter, textFilter, sortKey]);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([fetchStats(), fetchActivity(80)]);
      setStats(s);
      setActivity(a);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  }, [fetchStats, fetchActivity]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const maxSource = Math.max(1, ...(stats?.bySource.map((s) => s.count) ?? [1]));
  const maxTimeline = Math.max(1, ...(stats?.timeline.map((t) => t.events) ?? [1]));

  return (
    <div className="absolute inset-0 z-40 bg-brain-bg/95 backdrop-blur-md overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* header */}
        <div className="flex items-center justify-between sticky top-0 bg-brain-bg/95 backdrop-blur-md py-2 z-10">
          <h1 className="font-display text-brain-cyan text-lg tracking-widest glow-text">
            BRAIN · CONTROL ROOM
          </h1>
          <button
            onClick={onClose}
            className="font-display text-xs tracking-widest text-brain-text/50 hover:text-brain-cyan border border-brain-cyan/20 rounded-lg px-3 py-1.5 hover:border-brain-cyan transition-all"
          >
            ✕ FECHAR
          </button>
        </div>

        {err && <p className="text-brain-red text-xs">{err}</p>}
        {!stats && !err && <p className="text-brain-text/40 text-sm">Carregando métricas...</p>}

        {stats && (
          <>
            {/* top stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard label="NÓDULOS" value={stats.totals.nodes} />
              <StatCard label="EVENTOS" value={stats.totals.events} accent="#7B2FBE" />
              <StatCard label="BUSCAS" value={stats.totals.searches} accent="#FF3366" />
              <StatCard label="VISUALIZAÇÕES" value={stats.totals.views} accent="#4ADE80" />
              <StatCard label="DIAS ATIVOS" value={stats.activeDays} accent="#E0E8F0" />
            </div>

            {/* node explorer */}
            <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="font-display text-xs tracking-widest text-brain-cyan/70">
                  EXPLORADOR DE NÓDULOS ({explorerNodes.length})
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    placeholder="filtrar..."
                    className="bg-brain-bg border border-brain-cyan/20 rounded px-2 py-1 text-xs text-brain-text outline-none focus:border-brain-cyan w-32"
                  />
                  <select
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value)}
                    className="bg-brain-bg border border-brain-cyan/20 rounded px-2 py-1 text-xs text-brain-text outline-none focus:border-brain-cyan"
                  >
                    <option value="">todos os tipos</option>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>{kindMeta(k).label}</option>
                    ))}
                  </select>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="bg-brain-bg border border-brain-cyan/20 rounded px-2 py-1 text-xs text-brain-text outline-none focus:border-brain-cyan"
                  >
                    <option value="recent">recente</option>
                    <option value="access">+ acessos</option>
                    <option value="title">título</option>
                  </select>
                </div>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-brain-cyan/5">
                {explorerNodes.map((n) => {
                  const m = kindMeta(n.kind);
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        onSelectNode(n);
                        onClose();
                      }}
                      className="w-full text-left py-2 flex items-center gap-3 hover:bg-brain-cyan/5 px-2 rounded transition-colors"
                    >
                      <span
                        className="shrink-0 text-[10px] font-display px-1.5 py-0.5 rounded w-20 text-center"
                        style={{ color: m.color, border: `1px solid ${m.color}44`, backgroundColor: m.color + '12' }}
                      >
                        {m.icon} {m.label}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-brain-text/85 truncate">{n.title}</span>
                        {n.directive && (
                          <span className="block text-[11px] text-brain-text/40 truncate">{n.directive}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] text-brain-cyan/40 font-display w-16 text-right truncate">{n.project || '🌐 global'}</span>
                      <span className="shrink-0 text-[10px] text-brain-text/40 font-display w-12 text-right" title="acessos por IA">{n.access_count}×</span>
                    </button>
                  );
                })}
                {explorerNodes.length === 0 && (
                  <p className="text-brain-text/30 text-xs py-4 text-center">Nenhum nódulo com esse filtro.</p>
                )}
              </div>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* source breakdown — quem consumiu */}
              <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
                <h2 className="font-display text-xs tracking-widest text-brain-cyan/70 mb-4">
                  QUEM CONSUMIU (POR FONTE)
                </h2>
                <div className="space-y-3">
                  {stats.bySource.map((s) => (
                    <div key={s.source} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="font-display tracking-wide" style={{ color: colorFor(s.source) }}>
                          {s.source.toUpperCase()}
                        </span>
                        <span className="text-brain-text/50">{s.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-brain-bg/80 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${(s.count / maxSource) * 100}%`, backgroundColor: colorFor(s.source) }}
                        />
                      </div>
                    </div>
                  ))}
                  {stats.bySource.length === 0 && (
                    <p className="text-brain-text/30 text-xs">Sem eventos ainda.</p>
                  )}
                </div>
              </section>

              {/* timeline — atividade por dia */}
              <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
                <h2 className="font-display text-xs tracking-widest text-brain-cyan/70 mb-4">
                  ATIVIDADE (ÚLTIMOS 30 DIAS)
                </h2>
                <div className="flex items-end gap-1 h-32">
                  {stats.timeline.map((t) => (
                    <div key={t.day} className="flex-1 flex flex-col items-center justify-end group relative">
                      <div
                        className="w-full rounded-t bg-brain-cyan/60 hover:bg-brain-cyan transition-all"
                        style={{ height: `${(t.events / maxTimeline) * 100}%`, minHeight: t.events > 0 ? '3px' : '0' }}
                      />
                      <span className="absolute -top-5 text-[9px] text-brain-text/70 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                        {t.day.slice(5)} · {t.events}
                      </span>
                    </div>
                  ))}
                  {stats.timeline.length === 0 && (
                    <p className="text-brain-text/30 text-xs">Sem atividade registrada.</p>
                  )}
                </div>
              </section>

              {/* by project */}
              <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
                <h2 className="font-display text-xs tracking-widest text-brain-cyan/70 mb-4">POR PROJETO</h2>
                <div className="space-y-2">
                  {stats.byProject.map((p) => (
                    <div key={p.project} className="flex justify-between items-center text-xs border-b border-brain-cyan/5 pb-2">
                      <span className="text-brain-text/80 font-body truncate">{p.project || '🌐 global'}</span>
                      <span className="text-brain-text/40 font-display whitespace-nowrap ml-2">
                        {p.nodes} nós · {p.events} ev
                      </span>
                    </div>
                  ))}
                  {stats.byProject.length === 0 && <p className="text-brain-text/30 text-xs">Vazio.</p>}
                </div>
              </section>

              {/* top accessed */}
              <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
                <h2 className="font-display text-xs tracking-widest text-brain-cyan/70 mb-4">MAIS ACESSADOS</h2>
                <div className="space-y-2">
                  {stats.topAccessed.map((t, i) => (
                    <div key={t.id} className="flex justify-between items-center text-xs">
                      <span className="text-brain-text/80 font-body truncate">
                        <span className="text-brain-cyan/50 mr-2">{i + 1}.</span>
                        {t.title}
                      </span>
                      <span className="text-brain-cyan/60 font-display whitespace-nowrap ml-2">{t.access_count}×</span>
                    </div>
                  ))}
                  {stats.topAccessed.length === 0 && <p className="text-brain-text/30 text-xs">Vazio.</p>}
                </div>
              </section>
            </div>

            {/* live activity feed */}
            <section className="rounded-xl bg-brain-surface/60 border border-brain-cyan/10 p-5">
              <h2 className="font-display text-xs tracking-widest text-brain-cyan/70 mb-4">
                FEED DE ATIVIDADE · O QUE ESTÁ INDO E VINDO
              </h2>
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-brain-cyan/5">
                    <span
                      className="font-display text-[10px] px-2 py-0.5 rounded tracking-wide shrink-0"
                      style={{ color: colorFor(a.source), borderColor: colorFor(a.source) + '40', border: '1px solid' }}
                    >
                      {a.source.toUpperCase()}
                    </span>
                    <span className="text-brain-text/50 shrink-0 w-20">{ACTION_LABEL[a.action] ?? a.action}</span>
                    <span className="text-brain-text/80 truncate flex-1">
                      {a.action === 'search'
                        ? `"${a.query}" → ${a.results_count ?? 0} resultados`
                        : a.knowledge_title ?? a.knowledge_id ?? '—'}
                    </span>
                    <span className="text-brain-text/30 shrink-0">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
                {activity.length === 0 && <p className="text-brain-text/30 text-xs">Nenhum evento ainda.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
