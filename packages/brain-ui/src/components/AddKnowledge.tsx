import { useState } from 'react';
import type { AddKnowledgeInput } from '../hooks/useBrain';
import { KINDS, kindMeta } from '../lib/kinds';

interface Props {
  onAdd: (input: AddKnowledgeInput) => Promise<{ id: string; message: string }>;
  onClose: () => void;
}

export function AddKnowledge({ onAdd, onClose }: Props) {
  const [form, setForm] = useState<AddKnowledgeInput>({
    title: '',
    content: '',
    tags: [],
    project: '',
    source: 'manual',
    problem: '',
    kind: 'solution',
    directive: '',
  });
  const [tagsRaw, setTagsRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.content) return;
    setSaving(true);
    setError('');
    try {
      await onAdd({
        ...form,
        tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
        problem: form.problem || undefined,
        directive: form.directive || undefined,
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-brain-bg/80 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg bg-brain-surface border border-brain-cyan/30 rounded-xl p-6 space-y-4 glow-cyan"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-brain-cyan text-sm tracking-widest">ADD KNOWLEDGE</h2>
          <button type="button" onClick={onClose} className="text-brain-text/40 hover:text-brain-cyan">✕</button>
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">TITLE</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Short descriptive title"
            required
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          />
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">PROJECT (deixe vazio para 🌐 global — vale para todos os projetos)</label>
          <input
            value={form.project}
            onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
            placeholder="e.g. app-apollo-api (vazio = global)"
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          />
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">TIPO</label>
          <div className="flex gap-1.5 flex-wrap">
            {KINDS.map((k) => {
              const m = kindMeta(k);
              const active = form.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                  className="px-2.5 py-1 rounded text-[10px] font-display tracking-wide border transition-all"
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
          <label className="block text-xs font-display mb-1" style={{ color: kindMeta(form.kind).color }}>
            DIRECTIVE — 1 linha acionável (alimenta o get_guidelines)
          </label>
          <input
            value={form.directive}
            onChange={(e) => setForm((f) => ({ ...f, directive: e.target.value }))}
            placeholder="Ex: Nunca commitar node_modules; use .gitignore"
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          />
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">TAGS (comma separated)</label>
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="mongodb, index, performance"
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          />
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">PROBLEM (optional)</label>
          <input
            value={form.problem}
            onChange={(e) => setForm((f) => ({ ...f, problem: e.target.value }))}
            placeholder="What was the original problem?"
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan"
          />
        </div>

        <div>
          <label className="block text-xs font-display text-brain-cyan/60 mb-1">CONTENT</label>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Full solution, decision, or learning..."
            required
            rows={5}
            className="w-full bg-brain-bg border border-brain-cyan/20 rounded-lg px-3 py-2 text-sm text-brain-text outline-none focus:border-brain-cyan resize-none"
          />
        </div>

        {error && <p className="text-xs text-brain-red">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 rounded-lg bg-brain-cyan/10 border border-brain-cyan text-brain-cyan font-display text-xs tracking-widest hover:bg-brain-cyan/20 transition-all disabled:opacity-50"
        >
          {saving ? 'STORING...' : 'STORE KNOWLEDGE'}
        </button>
      </form>
    </div>
  );
}
