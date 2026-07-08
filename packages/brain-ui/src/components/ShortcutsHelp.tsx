interface Props {
  onClose: () => void;
}

const SHORTCUTS: { key: string; desc: string }[] = [
  { key: '/', desc: 'Focar a busca' },
  { key: 'Esc', desc: 'Limpar busca / fechar painéis' },
  { key: 'D', desc: 'Abrir/fechar Control Room' },
  { key: 'G', desc: 'Guardrails ativos (regras & armadilhas)' },
  { key: 'A', desc: 'Adicionar conhecimento' },
  { key: '?', desc: 'Mostrar este guia' },
];

const TIPS: string[] = [
  'Clique num resultado da busca para dar zoom no nó.',
  'Arraste a borda esquerda do painel para redimensionar; ⤢ abre leitura ampla.',
  'Use a linha do tempo (▶) para ver o cérebro crescer cronologicamente.',
  'Em VIEW, colora por projeto e ligue/desligue projetos.',
];

export function ShortcutsHelp({ onClose }: Props) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-brain-bg/85 backdrop-blur-md p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-brain-surface border border-brain-cyan/30 rounded-2xl p-6 space-y-5 glow-cyan"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm text-brain-cyan tracking-widest glow-text">ATALHOS & DICAS</h2>
          <button onClick={onClose} className="text-brain-text/40 hover:text-brain-cyan text-lg">✕</button>
        </div>

        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <kbd className="min-w-[2.2rem] text-center px-2 py-1 rounded bg-brain-bg border border-brain-cyan/30 text-brain-cyan font-display text-xs">
                {s.key}
              </kbd>
              <span className="text-sm text-brain-text/70 font-body">{s.desc}</span>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-brain-cyan/10 space-y-1.5">
          {TIPS.map((t) => (
            <p key={t} className="text-xs text-brain-text/45 font-body leading-relaxed flex gap-2">
              <span className="text-brain-cyan/50">›</span>
              {t}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
