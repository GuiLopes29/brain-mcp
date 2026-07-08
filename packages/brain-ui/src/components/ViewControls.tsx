import { useState } from 'react';

export type ColorMode = 'recency' | 'project';

interface Props {
  colorMode: ColorMode;
  setColorMode: (m: ColorMode) => void;
  projects: { name: string; count: number }[];
  projectColors: Record<string, string>;
  hiddenProjects: Set<string>;
  toggleProject: (name: string) => void;
  showAllProjects: () => void;
}

export function ViewControls({
  colorMode,
  setColorMode,
  projects,
  projectColors,
  hiddenProjects,
  toggleProject,
  showAllProjects,
}: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="absolute top-14 left-4 z-20 w-56">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg bg-brain-surface/80 backdrop-blur-sm border border-brain-cyan/20 hover:border-brain-cyan/40 transition-colors"
      >
        <span className="font-display text-[10px] tracking-widest text-brain-cyan/60">VIEW</span>
        <span className="text-brain-cyan/40 text-xs">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-brain-surface/80 backdrop-blur-sm border border-brain-cyan/15 p-3 space-y-3 animate-fade-slide-in">
          {/* color mode */}
          <div>
            <p className="font-display text-[9px] tracking-widest text-brain-text/40 mb-1.5">COLORIR POR</p>
            <div className="flex gap-1.5">
              {(['recency', 'project'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setColorMode(m)}
                  className={`flex-1 py-1 rounded text-[10px] font-display tracking-wide transition-all ${
                    colorMode === m
                      ? 'bg-brain-cyan/15 border border-brain-cyan/50 text-brain-cyan'
                      : 'border border-brain-cyan/10 text-brain-text/40 hover:text-brain-text/70'
                  }`}
                >
                  {m === 'recency' ? 'RECÊNCIA' : 'PROJETO'}
                </button>
              ))}
            </div>
          </div>

          {/* project filter */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="font-display text-[9px] tracking-widest text-brain-text/40">PROJETOS</p>
              {hiddenProjects.size > 0 && (
                <button
                  onClick={showAllProjects}
                  className="font-display text-[9px] tracking-wide text-brain-cyan/60 hover:text-brain-cyan"
                >
                  TODOS
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {projects.map((p) => {
                const hidden = hiddenProjects.has(p.name);
                return (
                  <button
                    key={p.name}
                    onClick={() => toggleProject(p.name)}
                    className={`w-full flex items-center gap-2 px-1.5 py-1 rounded transition-all ${
                      hidden ? 'opacity-35 hover:opacity-60' : 'hover:bg-brain-cyan/5'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: projectColors[p.name] ?? '#00F5FF',
                        boxShadow: hidden ? 'none' : `0 0 6px ${projectColors[p.name] ?? '#00F5FF'}`,
                      }}
                    />
                    <span className="flex-1 text-left text-[11px] text-brain-text/70 font-body truncate">
                      {p.name || '🌐 global'}
                    </span>
                    <span className="text-[10px] text-brain-text/30 font-display">{p.count}</span>
                  </button>
                );
              })}
              {projects.length === 0 && <p className="text-[10px] text-brain-text/30">Vazio.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
