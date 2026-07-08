import { useState, useEffect, useRef, useCallback } from 'react';
import type { KnowledgeItem, KnowledgeSearchResult, NodeDetailData, KnowledgeKind } from '../hooks/useBrain';
import { KINDS, kindMeta } from '../lib/kinds';

interface Props {
  node: KnowledgeItem | KnowledgeSearchResult | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onUpdate: (id: string, fields: { title?: string; content?: string; tags?: string[]; problem?: string; kind?: KnowledgeKind; directive?: string }) => Promise<void>;
  fetchNodeDetail: (id: string) => Promise<NodeDetailData>;
}

const INPUT_CLS =
  'w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan';

function isSR(n: KnowledgeItem | KnowledgeSearchResult): n is KnowledgeSearchResult {
  return 'similarity' in n;
}

function fmt(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

const ACTION_LABEL: Record<string, string> = {
  add: 'criado', view: 'visto', search: 'busca', update: 'editado', delete: 'removido',
};

const TAG_COLORS = [
  'bg-brain-cyan/20 text-brain-cyan border-brain-cyan/30',
  'bg-brain-purple/20 text-purple-300 border-brain-purple/30',
  'bg-brain-red/20 text-rose-300 border-brain-red/30',
];

const MIN_W = 340;
const MAX_W = 900;

export function NodeDetail({ node, onClose, onDelete, onUpdate, fetchNodeDetail }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detail, setDetail] = useState<NodeDetailData | null>(null);
  const [width, setWidth] = useState(420);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: '',
    content: '',
    problem: '',
    tagsRaw: '',
    kind: 'solution' as KnowledgeKind,
    directive: '',
  });
  const dragging = useRef(false);

  useEffect(() => {
    setConfirming(false);
    setDeleting(false);
    setDetail(null);
    setExpanded(false);
    setEditing(false);
    if (node?.id) {
      fetchNodeDetail(node.id).then(setDetail).catch(() => {});
    }
  }, [node?.id, fetchNodeDetail]);

  // resize: drag the left edge
  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = window.innerWidth - ev.clientX;
      setWidth(Math.min(MAX_W, Math.max(MIN_W, next)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ESC closes the expanded reader
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (!node) return null;

  const similarity = isSR(node) ? node.similarity : null;

  function copyToClipboard() {
    const text = `# ${node!.title}\n\n${node!.content}${node!.problem ? `\n\n**Problem:** ${node!.problem}` : ''}`;
    navigator.clipboard.writeText(text);
  }

  function startEdit() {
    if (!node) return;
    setDraft({
      title: node.title,
      content: node.content,
      problem: node.problem ?? '',
      tagsRaw: node.tags.join(', '),
      kind: node.kind ?? 'solution',
      directive: node.directive ?? '',
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!node) return;
    setSaving(true);
    try {
      await onUpdate(node.id, {
        title: draft.title,
        content: draft.content,
        problem: draft.problem || undefined,
        tags: draft.tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        kind: draft.kind,
        directive: draft.directive || undefined,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="absolute right-0 top-0 h-full z-30 animate-fade-slide-in" style={{ width }}>
        {/* resize handle */}
        <div
          onMouseDown={startDrag}
          title="Arraste para redimensionar"
          className="absolute left-0 top-0 h-full w-1.5 -ml-0.5 cursor-ew-resize z-40 group"
        >
          <div className="h-full w-full group-hover:bg-brain-cyan/40 transition-colors" />
        </div>

        <div className="h-full bg-brain-surface/95 backdrop-blur-md border-l border-brain-cyan/20 flex flex-col">
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-brain-cyan/10">
            <span className="font-display text-xs text-brain-cyan/60 tracking-widest">NODE DETAIL</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setExpanded(true)}
                title="Expandir (leitura)"
                className="text-brain-text/40 hover:text-brain-cyan transition-colors text-sm"
              >
                ⤢
              </button>
              <button
                onClick={onClose}
                title="Fechar"
                className="text-brain-text/40 hover:text-brain-cyan transition-colors text-lg"
              >
                ✕
              </button>
            </div>
          </div>

          {/* content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-display text-brain-cyan/60 tracking-widest mb-1">TÍTULO</label>
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-display text-brain-cyan/60 tracking-widest mb-1">TIPO</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {KINDS.map((k) => {
                      const m = kindMeta(k);
                      const active = draft.kind === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                          className="px-2 py-1 rounded text-[10px] font-display tracking-wide border transition-all"
                          style={{
                            color: active ? m.color : 'rgba(224,232,240,0.4)',
                            borderColor: active ? m.color + '88' : 'rgba(0,245,255,0.12)',
                            backgroundColor: active ? m.color + '18' : 'transparent',
                          }}
                        >
                          {m.icon} {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-display tracking-widest mb-1" style={{ color: kindMeta(draft.kind).color }}>
                    DIRETRIZ (1 linha acionável — alimenta o get_guidelines)
                  </label>
                  <input
                    value={draft.directive}
                    onChange={(e) => setDraft((d) => ({ ...d, directive: e.target.value }))}
                    placeholder="Ex: Sempre validar o CSV antes de persistir AQFMs"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-display text-brain-cyan/60 tracking-widest mb-1">TAGS (vírgula)</label>
                  <input
                    value={draft.tagsRaw}
                    onChange={(e) => setDraft((d) => ({ ...d, tagsRaw: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-display text-brain-purple/70 tracking-widest mb-1">PROBLEMA</label>
                  <input
                    value={draft.problem}
                    onChange={(e) => setDraft((d) => ({ ...d, problem: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-display text-brain-cyan/60 tracking-widest mb-1">CONTEÚDO</label>
                  <textarea
                    value={draft.content}
                    onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                    rows={10}
                    className={`${INPUT_CLS} resize-none leading-relaxed`}
                  />
                </div>
                <p className="text-[10px] text-brain-text/30">O embedding é regenerado automaticamente ao salvar.</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-base text-brain-cyan glow-text leading-snug break-words">
                  {node.title}
                </h2>

                <div className="flex flex-wrap gap-2 items-center">
                  <span
                    className="px-2 py-0.5 rounded text-xs border font-display"
                    style={{
                      color: kindMeta(node.kind).color,
                      borderColor: kindMeta(node.kind).color + '55',
                      backgroundColor: kindMeta(node.kind).color + '14',
                    }}
                  >
                    {kindMeta(node.kind).icon} {kindMeta(node.kind).label}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs border bg-brain-bg/60 border-brain-cyan/20 text-brain-text/60 font-display break-all">
                    {node.project || '🌐 global'}
                  </span>
                  {similarity !== null && (
                    <span className="px-2 py-0.5 rounded text-xs border bg-brain-red/10 border-brain-red/30 text-brain-red font-display">
                      {(similarity * 100).toFixed(0)}% MATCH
                    </span>
                  )}
                </div>

                {node.directive && (
                  <div
                    className="rounded-lg p-3 border-l-2"
                    style={{
                      backgroundColor: kindMeta(node.kind).color + '0E',
                      borderColor: kindMeta(node.kind).color,
                    }}
                  >
                    <p className="text-[10px] font-display tracking-widest mb-1" style={{ color: kindMeta(node.kind).color }}>
                      DIRETRIZ
                    </p>
                    <p className="text-sm text-brain-text leading-relaxed break-words">{node.directive}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {node.tags.map((tag, i) => (
                    <span
                      key={tag}
                      className={`px-2 py-0.5 rounded-full text-xs border font-body break-all ${TAG_COLORS[i % TAG_COLORS.length]}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {node.problem && (
                  <div className="rounded-lg bg-brain-bg/60 border border-brain-purple/20 p-3">
                    <p className="text-xs font-display text-brain-purple/80 mb-1">PROBLEM</p>
                    <p className="text-sm text-brain-text/70 leading-relaxed whitespace-pre-wrap break-words">{node.problem}</p>
                  </div>
                )}

                <div className="rounded-lg bg-brain-bg/60 border border-brain-cyan/10 p-3">
                  <p className="text-sm text-brain-text leading-relaxed whitespace-pre-wrap break-words">{node.content}</p>
                </div>
              </>
            )}

            {/* timeline metrics */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-brain-bg/60 border border-brain-cyan/10 p-2.5">
                <p className="font-display text-lg text-brain-cyan glow-text">{node.access_count}</p>
                <p className="text-[10px] text-brain-text/40 font-display tracking-wide">ACESSOS</p>
              </div>
              <div className="rounded-lg bg-brain-bg/60 border border-brain-purple/10 p-2.5">
                <p className="font-display text-lg text-purple-300">{detail?.activeDays ?? '·'}</p>
                <p className="text-[10px] text-brain-text/40 font-display tracking-wide">DIAS TRABALHADOS</p>
              </div>
            </div>

            <div className="text-xs text-brain-text/40 font-body space-y-1 break-words">
              <p>Origem: <span className="text-brain-text/70">{node.source}</span></p>
              <p>Criado: <span className="text-brain-text/70">{fmt(node.created_at)}</span></p>
              <p>Atualizado: <span className="text-brain-text/70">{fmt(node.updated_at)}</span></p>
              <p>Último acesso: <span className="text-brain-text/70">{fmt(node.last_accessed_at ?? detail?.item.last_accessed_at)}</span></p>
            </div>

            {/* event history */}
            {detail && detail.events.length > 0 && (
              <div className="rounded-lg bg-brain-bg/40 border border-brain-cyan/10 p-3">
                <p className="text-[10px] font-display text-brain-cyan/60 tracking-widest mb-2">HISTÓRICO</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {detail.events.map((e, i) => (
                    <div key={i} className="flex justify-between text-[11px] text-brain-text/50">
                      <span>
                        <span className="text-brain-cyan/60">{e.source}</span> · {ACTION_LABEL[e.action] ?? e.action}
                      </span>
                      <span className="text-brain-text/30">{new Date(e.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* footer */}
          <div className="px-5 py-4 border-t border-brain-cyan/10 space-y-2">
            {editing ? (
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={saving || !draft.title.trim() || !draft.content.trim()}
                  className="flex-1 py-2 rounded-lg bg-brain-cyan/15 border border-brain-cyan text-brain-cyan font-display text-xs tracking-widest hover:bg-brain-cyan/25 transition-all disabled:opacity-40"
                >
                  {saving ? 'SALVANDO...' : 'SALVAR'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg border border-brain-text/20 text-brain-text/40 font-display text-xs tracking-widest hover:border-brain-text/40 transition-all"
                >
                  CANCELAR
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="flex-1 py-2 rounded-lg border border-brain-cyan/40 text-brain-cyan font-display text-xs tracking-widest hover:bg-brain-cyan/10 hover:border-brain-cyan transition-all duration-200"
                  >
                    COPIAR
                  </button>
                  <button
                    onClick={startEdit}
                    className="flex-1 py-2 rounded-lg border border-brain-purple/40 text-purple-300 font-display text-xs tracking-widest hover:bg-brain-purple/10 hover:border-brain-purple transition-all duration-200"
                  >
                    ✎ EDITAR
                  </button>
                </div>

                {!confirming ? (
                  <button
                    onClick={() => setConfirming(true)}
                    className="
                      w-full py-2 rounded-lg
                      border border-brain-red/30 text-brain-red/60
                      font-display text-xs tracking-widest
                      hover:bg-brain-red/10 hover:border-brain-red hover:text-brain-red
                      transition-all duration-200
                    "
                  >
                    DELETE NODE
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setDeleting(true);
                        await onDelete(node.id);
                        setDeleting(false);
                        onClose();
                      }}
                      disabled={deleting}
                      className="flex-1 py-2 rounded-lg bg-brain-red/20 border border-brain-red text-brain-red font-display text-xs tracking-widest hover:bg-brain-red/30 transition-all disabled:opacity-50"
                    >
                      {deleting ? 'DELETING...' : 'CONFIRM'}
                    </button>
                    <button
                      onClick={() => setConfirming(false)}
                      className="flex-1 py-2 rounded-lg border border-brain-text/20 text-brain-text/40 font-display text-xs tracking-widest hover:border-brain-text/40 transition-all"
                    >
                      CANCEL
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* expanded reader modal */}
      {expanded && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-brain-bg/85 backdrop-blur-md p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-brain-surface border border-brain-cyan/30 rounded-2xl flex flex-col glow-cyan"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-brain-cyan/10">
              <span className="font-display text-xs text-brain-cyan/60 tracking-widest">LEITURA</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-brain-text/40 hover:text-brain-cyan transition-colors text-lg"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto px-8 py-6 space-y-5">
              <h1 className="font-display text-2xl text-brain-cyan glow-text leading-snug break-words">
                {node.title}
              </h1>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded text-xs border bg-brain-bg/60 border-brain-cyan/20 text-brain-text/60 font-display break-all">
                  {node.project}
                </span>
                {node.tags.map((tag, i) => (
                  <span
                    key={tag}
                    className={`px-2 py-0.5 rounded-full text-xs border font-body break-all ${TAG_COLORS[i % TAG_COLORS.length]}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {node.problem && (
                <div className="rounded-lg bg-brain-bg/60 border border-brain-purple/20 p-4">
                  <p className="text-xs font-display text-brain-purple/80 mb-2">PROBLEM</p>
                  <p className="text-base text-brain-text/80 leading-relaxed whitespace-pre-wrap break-words">{node.problem}</p>
                </div>
              )}
              <p className="text-base text-brain-text leading-relaxed whitespace-pre-wrap break-words">
                {node.content}
              </p>
            </div>
            <div className="px-6 py-3 border-t border-brain-cyan/10 flex justify-end">
              <button
                onClick={copyToClipboard}
                className="px-4 py-2 rounded-lg border border-brain-cyan/40 text-brain-cyan font-display text-xs tracking-widest hover:bg-brain-cyan/10 hover:border-brain-cyan transition-all"
              >
                COPY TO CONTEXT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
