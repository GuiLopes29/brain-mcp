import { useState, useCallback, useEffect, useRef } from 'react';

export type KnowledgeKind = 'solution' | 'rule' | 'pitfall' | 'decision';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  project: string;
  source: string;
  problem?: string;
  kind?: KnowledgeKind;
  directive?: string;
  created_at: string;
  updated_at?: string;
  last_accessed_at?: string;
  access_count: number;
}

export interface KnowledgeSearchResult extends KnowledgeItem {
  similarity: number;
}

export interface GraphNode {
  id: string;
  title: string;
  content: string;
  project: string;
  source: string;
  problem?: string;
  kind?: KnowledgeKind;
  directive?: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
  last_accessed_at?: string;
  access_count: number;
  val: number;
  color: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  sharedTags: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface AddKnowledgeInput {
  title: string;
  content: string;
  tags: string[];
  project: string;
  source?: string;
  problem?: string;
  kind?: KnowledgeKind;
  directive?: string;
}

export interface GuidelinesResult {
  project: string;
  count: number;
  guidelines: string[];
}

export interface BrainStats {
  totals: { nodes: number; events: number; searches: number; views: number; adds: number };
  bySource: { source: string; count: number }[];
  byAction: { action: string; count: number }[];
  byProject: { project: string; nodes: number; events: number }[];
  timeline: { day: string; events: number }[];
  topAccessed: { id: string; title: string; project: string; access_count: number }[];
  activeDays: number;
  firstEvent: string | null;
  lastEvent: string | null;
}

export interface ActivityRow {
  id: number;
  knowledge_id: string | null;
  knowledge_title: string | null;
  action: 'add' | 'view' | 'search' | 'update' | 'delete';
  source: string;
  query: string | null;
  project: string | null;
  results_count: number | null;
  created_at: string;
}

export interface NodeDetailData {
  item: KnowledgeItem;
  activeDays: number;
  events: { action: string; source: string; created_at: string }[];
}

const BASE = '';

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    ...opts,
    headers: { 'X-Brain-Source': 'browser', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function useBrain() {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Signature of the graph's *structure* (ids + tags + links). Used to skip
  // re-rendering when only volatile fields (access_count) changed — replacing
  // the graph object would make react-force-graph re-simulate and "reload".
  const sigRef = useRef<string>('');

  const fetchGraph = useCallback(async (force = false) => {
    try {
      const data = await apiFetch<GraphData>('/knowledge/graph');
      const sig =
        data.nodes
          .map((n) => `${n.id}:${n.tags.join(',')}:${n.updated_at ?? ''}`)
          .sort()
          .join('|') +
        `#${data.links.length}`;
      if (force || sig !== sigRef.current) {
        sigRef.current = sig;
        setGraph(data);
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for new nodes only while NOT searching — keeps the graph stable
  // during a search so matched nodes don't scatter on each refresh.
  useEffect(() => {
    if (searchActive) return;
    fetchGraph();
    const id = setInterval(fetchGraph, 5000);
    return () => clearInterval(id);
  }, [fetchGraph, searchActive]);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchActive(false);
      setSearchResults([]);
      return;
    }
    setSearchActive(true);
    setIsSearching(true);
    try {
      const data = await apiFetch<{ results: KnowledgeSearchResult[] }>(
        `/knowledge/search?q=${encodeURIComponent(query)}&limit=20`,
      );
      setSearchResults(data.results);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSearching(false);
    }
  }, []);

  const addKnowledge = useCallback(
    async (input: AddKnowledgeInput): Promise<{ id: string; message: string }> => {
      const result = await apiFetch<{ id: string; message: string }>('/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      await fetchGraph();
      return result;
    },
    [fetchGraph],
  );

  const clearSearch = useCallback(() => {
    setSearchActive(false);
    setSearchResults([]);
  }, []);

  const deleteKnowledge = useCallback(
    async (id: string): Promise<void> => {
      await apiFetch(`/knowledge/${id}`, { method: 'DELETE' });
      await fetchGraph();
      setSearchResults((prev) => prev.filter((r) => r.id !== id));
    },
    [fetchGraph],
  );

  const updateKnowledge = useCallback(
    async (
      id: string,
      fields: { title?: string; content?: string; tags?: string[]; problem?: string; kind?: KnowledgeKind; directive?: string },
    ): Promise<void> => {
      await apiFetch(`/knowledge/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      await fetchGraph();
    },
    [fetchGraph],
  );

  const fetchGuidelines = useCallback(
    (project?: string) =>
      apiFetch<GuidelinesResult>(`/guidelines${project ? `?project=${encodeURIComponent(project)}` : ''}`),
    [],
  );

  const fetchStats = useCallback(() => apiFetch<BrainStats>('/stats'), []);
  const fetchActivity = useCallback(
    (limit = 100) => apiFetch<{ activity: ActivityRow[] }>(`/activity?limit=${limit}`).then((r) => r.activity),
    [],
  );
  const fetchNodeDetail = useCallback(
    (id: string) => apiFetch<NodeDetailData>(`/knowledge/${id}`),
    [],
  );

  return {
    graph,
    searchResults,
    isSearching,
    searchActive,
    loading,
    error,
    search,
    clearSearch,
    addKnowledge,
    deleteKnowledge,
    updateKnowledge,
    refetch: fetchGraph,
    fetchStats,
    fetchActivity,
    fetchNodeDetail,
    fetchGuidelines,
  };
}
