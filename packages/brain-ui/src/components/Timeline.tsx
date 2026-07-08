interface Props {
  min: number;
  max: number;
  value: number;
  playing: boolean;
  visibleCount: number;
  totalCount: number;
  onChange: (v: number) => void;
  onTogglePlay: () => void;
  onReset: () => void;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
}

export function Timeline({
  min,
  max,
  value,
  playing,
  visibleCount,
  totalCount,
  onChange,
  onTogglePlay,
  onReset,
}: Props) {
  if (max <= min) return null; // not enough temporal spread

  const isLive = value >= max;
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-4">
      <div className="rounded-xl bg-brain-surface/85 backdrop-blur-md border border-brain-cyan/20 px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={onTogglePlay}
          title={playing ? 'Pausar' : 'Reproduzir evolução'}
          className="shrink-0 w-8 h-8 rounded-full border border-brain-cyan/40 text-brain-cyan flex items-center justify-center hover:bg-brain-cyan/10 transition-all"
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="font-display text-[9px] tracking-widest text-brain-text/40">
              LINHA DO TEMPO
            </span>
            <span className="font-display text-[10px] tracking-wide text-brain-cyan/70">
              {isLive ? 'AGORA' : fmtDate(value)} · {visibleCount}/{totalCount}
            </span>
          </div>
          <div className="relative">
            <input
              type="range"
              min={min}
              max={max}
              value={value}
              step={Math.max(1, Math.floor((max - min) / 500))}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full h-1.5 appearance-none bg-brain-bg rounded-full outline-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brain-cyan
                [&::-webkit-slider-thumb]:shadow-[0_0_8px_#00F5FF] [&::-webkit-slider-thumb]:cursor-pointer"
              style={{ background: `linear-gradient(to right, rgba(0,245,255,0.4) ${pct}%, rgba(13,27,42,0.9) ${pct}%)` }}
            />
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[8px] text-brain-text/25 font-display">{fmtDate(min)}</span>
            <span className="text-[8px] text-brain-text/25 font-display">{fmtDate(max)}</span>
          </div>
        </div>

        {!isLive && (
          <button
            onClick={onReset}
            title="Voltar para agora"
            className="shrink-0 font-display text-[9px] tracking-widest text-brain-cyan/60 hover:text-brain-cyan border border-brain-cyan/20 rounded px-2 py-1"
          >
            AGORA
          </button>
        )}
      </div>
    </div>
  );
}
