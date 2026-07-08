import { useRef, useCallback, useEffect, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { GraphData, GraphNode, KnowledgeItem, KnowledgeSearchResult } from '../hooks/useBrain';
import type { ColorMode } from './ViewControls';
import { projectColor } from '../lib/projectColors';

interface Props {
  data: GraphData;
  searchResultIds: Set<string>;
  hasSearch: boolean;
  focusNodeId?: string | null;
  colorMode: ColorMode;
  projectColors: Record<string, string>;
  hiddenProjects: Set<string>;
  timeCutoff: number;
  freshIds: Set<string>;
  onNodeClick: (node: KnowledgeItem | KnowledgeSearchResult) => void;
}

type FGNode = GraphNode & { x?: number; y?: number };

export function BrainGraph({
  data,
  searchResultIds,
  hasSearch,
  focusNodeId,
  colorMode,
  projectColors,
  hiddenProjects,
  timeCutoff,
  freshIds,
  onNodeClick,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // One-time fit when the graph first populates (not on every poll/refresh).
  const fittedRef = useRef(false);
  useEffect(() => {
    if (fittedRef.current || !fgRef.current || data.nodes.length === 0) return;
    fittedRef.current = true;
    const t = setTimeout(() => fgRef.current?.zoomToFit(600, 80), 400);
    return () => clearTimeout(t);
  }, [data.nodes.length]);

  // Auto-frame matched nodes on search; restore full view when the search is
  // cleared. Intentionally NOT dependent on `data` so background refreshes
  // never hijack the user's zoom while they navigate.
  useEffect(() => {
    if (!fgRef.current) return;
    const t = setTimeout(() => {
      if (hasSearch && searchResultIds.size > 0) {
        fgRef.current.zoomToFit(700, 160, (n: FGNode) => searchResultIds.has(n.id));
      } else if (!hasSearch) {
        fgRef.current.zoomToFit(700, 80);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [hasSearch, searchResultIds]);

  // Center + zoom on a node picked from the results list.
  useEffect(() => {
    if (!focusNodeId || !fgRef.current) return;
    const node = (data.nodes as FGNode[]).find((n) => n.id === focusNodeId);
    if (node && node.x != null && node.y != null) {
      fgRef.current.centerAt(node.x, node.y, 600);
      fgRef.current.zoom(3.5, 600);
    }
  }, [focusNodeId, data]);

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNode;
      if (n.x == null || n.y == null) return;

      // temporal filter: hide nodes created after the timeline cutoff
      if (new Date(n.created_at).getTime() > timeCutoff) return;

      const isResult = searchResultIds.has(n.id);
      const isHidden = hiddenProjects.has(n.project);
      let opacity = hasSearch ? (isResult ? 1 : 0.12) : 1;
      if (isHidden) opacity = 0.06;
      // Size = popularity (views), gently logarithmic and hard-capped so a
      // heavily-used node never dominates the canvas. Base 3 → cap 6.5.
      const radius = Math.min(6.5, 3 + Math.log2((n.access_count ?? 0) + 1) * 0.9);
      const glowRadius = isResult ? radius * 3 : radius * 2;

      // glow
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowRadius);
      const hex = colorMode === 'project' ? projectColor(n.project, projectColors) : (n.color ?? '#00F5FF');
      grd.addColorStop(0, hex + Math.round(opacity * 0x88).toString(16).padStart(2, '0'));
      grd.addColorStop(1, hex + '00');
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowRadius, 0, 2 * Math.PI);
      ctx.fillStyle = grd;
      ctx.fill();

      // core node
      ctx.beginPath();
      ctx.arc(n.x, n.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = hex + Math.round(opacity * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // matched-node emphasis ring
      if (hasSearch && isResult && !isHidden) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // freshly-captured node: expanding pulse + steady ring (red = new)
      if (freshIds.has(n.id) && !isHidden) {
        const phase = (performance.now() % 1400) / 1400;
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 4 + phase * 12, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,51,102,${(1 - phase) * 0.7})`;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,51,102,0.9)';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // label (only when zoomed in or result)
      if ((globalScale > 1.5 || isResult) && !isHidden) {
        ctx.font = `${Math.max(8, 10 / globalScale)}px Orbitron, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = `rgba(224,232,240,${opacity * 0.9})`;
        ctx.fillText(n.title.length > 20 ? n.title.slice(0, 18) + '…' : n.title, n.x, n.y + radius + 3);
      }
    },
    [searchResultIds, hasSearch, colorMode, projectColors, hiddenProjects, timeCutoff, freshIds],
  );

  const linkCanvasObject = useCallback(
    (link: object, ctx: CanvasRenderingContext2D) => {
      const l = link as { source: FGNode; target: FGNode };
      if (!l.source.x || !l.source.y || !l.target.x || !l.target.y) return;

      // temporal filter: drop links touching a not-yet-created node
      if (
        new Date(l.source.created_at).getTime() > timeCutoff ||
        new Date(l.target.created_at).getTime() > timeCutoff
      )
        return;

      // project filter: drop links touching a hidden project
      if (hiddenProjects.has(l.source.project) || hiddenProjects.has(l.target.project)) return;

      const srcInResult = searchResultIds.has(l.source.id);
      const tgtInResult = searchResultIds.has(l.target.id);
      const opacity = hasSearch ? (srcInResult && tgtInResult ? 0.6 : 0.04) : 0.2;

      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.strokeStyle = `rgba(0,245,255,${opacity})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    },
    [searchResultIds, hasSearch, hiddenProjects, timeCutoff],
  );

  const handleNodeClick = useCallback(
    (node: object) => {
      onNodeClick(node as KnowledgeItem);
    },
    [onNodeClick],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(10,22,40,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(10,22,40,0.4) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }}
      />

      <ForceGraph2D
        ref={fgRef}
        graphData={data}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="transparent"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => 'replace'}
        onNodeClick={handleNodeClick}
        nodeLabel={(n) => (n as GraphNode).title}
        enableNodeDrag
        enableZoomInteraction
        cooldownTicks={80}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
      />
    </div>
  );
}
