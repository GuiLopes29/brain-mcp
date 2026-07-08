import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useBrain } from './hooks/useBrain';
import type { KnowledgeItem, KnowledgeSearchResult, KnowledgeKind } from './hooks/useBrain';
import { BrainGraph } from './components/BrainGraph';
import { SearchBar } from './components/SearchBar';
import { SearchResults } from './components/SearchResults';
import { NodeDetail } from './components/NodeDetail';
import { AddKnowledge } from './components/AddKnowledge';
import { Dashboard } from './components/Dashboard';
import { Legend } from './components/Legend';
import { ViewControls, type ColorMode } from './components/ViewControls';
import { Timeline } from './components/Timeline';
import { AmbientField } from './components/AmbientField';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { GuidelinesPanel } from './components/GuidelinesPanel';
import { buildProjectColors } from './lib/projectColors';

export default function App() {
  const {
    graph, searchResults, isSearching, loading, error,
    search, clearSearch, addKnowledge, deleteKnowledge, updateKnowledge,
    fetchStats, fetchActivity, fetchNodeDetail, fetchGuidelines,
  } = useBrain();

  const [selectedNode, setSelectedNode] = useState<KnowledgeItem | KnowledgeSearchResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hasSearch, setHasSearch] = useState(false);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);

  // view controls
  const [colorMode, setColorMode] = useState<ColorMode>('recency');
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());

  // timeline (Infinity = live / show everything)
  const [timeCutoff, setTimeCutoff] = useState<number>(Infinity);
  const [playing, setPlaying] = useState(false);

  // nodes that just appeared (pulse-in highlight)
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const knownIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const current = new Set(graph.nodes.map((n) => n.id));
    if (knownIdsRef.current === null) {
      knownIdsRef.current = current; // first load: don't flash everything
      return;
    }
    const added = [...current].filter((id) => !knownIdsRef.current!.has(id));
    knownIdsRef.current = current;
    if (added.length === 0) return;
    setFreshIds((prev) => new Set([...prev, ...added]));
    const t = setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        added.forEach((id) => next.delete(id));
        return next;
      });
    }, 6000);
    return () => clearTimeout(t);
  }, [graph.nodes]);

  const searchResultIds = useMemo(
    () => new Set(searchResults.map((r) => r.id)),
    [searchResults],
  );

  // projects + colors derived from the graph
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph.nodes) counts.set(n.project, (counts.get(n.project) ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [graph.nodes]);

  const projectColors = useMemo(() => buildProjectColors(projects.map((p) => p.name)), [projects]);

  // temporal range
  const { minTime, maxTime } = useMemo(() => {
    const times = graph.nodes.map((n) => new Date(n.created_at).getTime()).filter((t) => !isNaN(t));
    return { minTime: times.length ? Math.min(...times) : 0, maxTime: times.length ? Math.max(...times) : 0 };
  }, [graph.nodes]);

  const effectiveCutoff = timeCutoff === Infinity ? maxTime : timeCutoff;
  const visibleCount = useMemo(
    () => graph.nodes.filter((n) => new Date(n.created_at).getTime() <= effectiveCutoff).length,
    [graph.nodes, effectiveCutoff],
  );

  // timeline playback — animate the brain growing from first to latest node
  useEffect(() => {
    if (!playing || maxTime <= minTime) return;
    let cur = minTime;
    setTimeCutoff(cur);
    const stepMs = 60;
    const inc = (maxTime - minTime) / (7000 / stepMs);
    const id = setInterval(() => {
      cur += inc;
      if (cur >= maxTime) {
        setTimeCutoff(Infinity);
        setPlaying(false);
        clearInterval(id);
      } else {
        setTimeCutoff(cur);
      }
    }, stepMs);
    return () => clearInterval(id);
  }, [playing, minTime, maxTime]);

  const handleSearch = useCallback((q: string) => {
    setHasSearch(true);
    search(q);
  }, [search]);

  const handleClear = useCallback(() => {
    setHasSearch(false);
    setFocusNodeId(null);
    clearSearch();
  }, [clearSearch]);

  const handleNodeClick = useCallback((node: KnowledgeItem | KnowledgeSearchResult) => {
    const fromSearch = searchResults.find((r) => r.id === node.id);
    setSelectedNode(fromSearch ?? node);
  }, [searchResults]);

  const handleResultSelect = useCallback((node: KnowledgeSearchResult) => {
    setSelectedNode(node);
    setFocusNodeId(node.id);
  }, []);

  const handleUpdate = useCallback(
    async (
      id: string,
      fields: { title?: string; content?: string; tags?: string[]; problem?: string; kind?: KnowledgeKind; directive?: string },
    ) => {
      await updateKnowledge(id, fields);
      setSelectedNode((prev) =>
        prev && prev.id === id ? { ...prev, ...fields, updated_at: new Date().toISOString() } : prev,
      );
    },
    [updateKnowledge],
  );

  const toggleProject = useCallback((name: string) => {
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const showAllProjects = useCallback(() => setHiddenProjects(new Set()), []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Escape') {
        handleClear();
        setSelectedNode(null);
        setShowDashboard(false);
        setShowAdd(false);
        setShowHelp(false);
        setShowGuidelines(false);
        (document.getElementById('brain-search') as HTMLInputElement | null)?.blur();
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('brain-search')?.focus();
      } else if (e.key === 'd') {
        setShowDashboard((s) => !s);
      } else if (e.key === 'a') {
        setShowAdd(true);
      } else if (e.key === 'g') {
        setShowGuidelines((s) => !s);
      } else if (e.key === '?') {
        setShowHelp((s) => !s);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClear]);

  return (
    <div className="relative w-full h-full bg-brain-bg overflow-hidden">
      {/* ambient particle field */}
      <AmbientField />

      {/* graph */}
      {!loading && !error && (
        <BrainGraph
          data={graph}
          searchResultIds={searchResultIds}
          hasSearch={hasSearch}
          focusNodeId={focusNodeId}
          colorMode={colorMode}
          projectColors={projectColors}
          hiddenProjects={hiddenProjects}
          timeCutoff={timeCutoff}
          freshIds={freshIds}
          onNodeClick={handleNodeClick}
        />
      )}

      {/* boot/loading overlay */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <p className="font-display text-brain-cyan text-2xl glow-text tracking-widest animate-pulse">
            BRAIN MCP
          </p>
          <p className="font-display text-brain-cyan/40 text-xs tracking-widest">
            INITIALIZING NEURAL NETWORK...
          </p>
        </div>
      )}

      {/* error state */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <p className="font-display text-brain-red text-sm tracking-widest">CONNECTION ERROR</p>
          <p className="text-brain-text/50 text-xs max-w-xs text-center">{error}</p>
          <p className="text-brain-text/30 text-xs mt-2">
            Make sure the HTTP bridge is running: <code className="text-brain-cyan">pnpm start:api</code>
          </p>
        </div>
      )}

      {/* search */}
      <SearchBar onSearch={handleSearch} onClear={handleClear} />

      {/* search results list */}
      {hasSearch && (
        <SearchResults
          results={searchResults}
          isSearching={isSearching}
          activeId={selectedNode?.id ?? null}
          onSelect={handleResultSelect}
        />
      )}

      {/* header wordmark */}
      <div className="absolute top-4 left-4 z-20">
        <p className="font-display text-xs text-brain-cyan/40 tracking-widest glow-text">BRAIN MCP</p>
      </div>

      {/* view controls */}
      {!loading && !error && (
        <ViewControls
          colorMode={colorMode}
          setColorMode={setColorMode}
          projects={projects}
          projectColors={projectColors}
          hiddenProjects={hiddenProjects}
          toggleProject={toggleProject}
          showAllProjects={showAllProjects}
        />
      )}

      {/* top-right action bar */}
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        <button
          onClick={() => setShowAdd(true)}
          title="Adicionar conhecimento (a)"
          className="px-3 py-2 rounded-lg border border-brain-cyan/40 text-brain-cyan font-display text-xs tracking-widest bg-brain-surface/80 backdrop-blur-sm hover:bg-brain-cyan/10 hover:border-brain-cyan transition-all duration-200 glow-cyan"
        >
          + ADD
        </button>
        <button
          onClick={() => setShowGuidelines(true)}
          title="Guardrails ativos (g)"
          className="px-3 py-2 rounded-lg border border-emerald-400/40 text-emerald-300 font-display text-xs tracking-widest bg-brain-surface/80 backdrop-blur-sm hover:bg-emerald-400/10 hover:border-emerald-400 transition-all duration-200"
        >
          ◆ GUARDRAILS
        </button>
        <button
          onClick={() => setShowDashboard(true)}
          title="Control Room (d)"
          className="px-3 py-2 rounded-lg border border-brain-purple/40 text-purple-300 font-display text-xs tracking-widest bg-brain-surface/80 backdrop-blur-sm hover:bg-brain-purple/10 hover:border-brain-purple transition-all duration-200"
        >
          ▣ CONTROL ROOM
        </button>
      </div>

      {/* node count badge + legend */}
      <div className="absolute bottom-20 left-4 z-20 flex flex-col gap-2">
        <p className="font-display text-xs text-brain-cyan/30 tracking-widest">
          {graph.nodes.length} NODES · {graph.links.length} SYNAPSES
        </p>
        {colorMode === 'recency' && <Legend />}
        {error === null && !loading && graph.nodes.length === 0 && (
          <p className="text-xs text-brain-text/30">No knowledge stored yet. Add some!</p>
        )}
      </div>

      {/* timeline scrubber */}
      {!loading && !error && (
        <Timeline
          min={minTime}
          max={maxTime}
          value={effectiveCutoff}
          playing={playing}
          visibleCount={visibleCount}
          totalCount={graph.nodes.length}
          onChange={(v) => {
            setPlaying(false);
            setTimeCutoff(v >= maxTime ? Infinity : v);
          }}
          onTogglePlay={() => setPlaying((p) => !p)}
          onReset={() => {
            setPlaying(false);
            setTimeCutoff(Infinity);
          }}
        />
      )}

      {/* node detail panel */}
      <NodeDetail
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onDelete={deleteKnowledge}
        onUpdate={handleUpdate}
        fetchNodeDetail={fetchNodeDetail}
      />

      {/* add knowledge modal */}
      {showAdd && (
        <AddKnowledge onAdd={addKnowledge} onClose={() => setShowAdd(false)} />
      )}

      {/* admin dashboard */}
      {showDashboard && (
        <Dashboard
          fetchStats={fetchStats}
          fetchActivity={fetchActivity}
          nodes={graph.nodes}
          onSelectNode={(n) => setSelectedNode(n)}
          onClose={() => setShowDashboard(false)}
        />
      )}

      {/* guardrails panel */}
      {showGuidelines && (
        <GuidelinesPanel
          projects={projects}
          fetchGuidelines={fetchGuidelines}
          onClose={() => setShowGuidelines(false)}
        />
      )}

      {/* shortcuts help */}
      <button
        onClick={() => setShowHelp(true)}
        title="Atalhos e dicas (?)"
        className="absolute bottom-4 right-4 z-20 w-9 h-9 rounded-full border border-brain-cyan/30 text-brain-cyan/70 bg-brain-surface/80 backdrop-blur-sm hover:bg-brain-cyan/10 hover:border-brain-cyan transition-all font-display"
      >
        ?
      </button>
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
