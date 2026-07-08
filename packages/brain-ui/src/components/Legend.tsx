const ITEMS = [
  { color: '#FF3366', label: 'RECENTE (24h)' },
  { color: '#00F5FF', label: 'ATIVO' },
  { color: '#7B2FBE', label: 'DORMENTE' },
];

export function Legend() {
  return (
    <div className="flex flex-col gap-1">
      {ITEMS.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: it.color, boxShadow: `0 0 6px ${it.color}` }}
          />
          <span className="font-display text-[9px] tracking-widest text-brain-text/40">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
