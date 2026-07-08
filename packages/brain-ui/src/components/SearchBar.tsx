import { useState, useEffect, useRef } from 'react';

interface Props {
  onSearch: (query: string) => void;
  onClear: () => void;
}

export function SearchBar({ onSearch, onClear }: Props) {
  const [value, setValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!value.trim()) {
      onClear();
      return;
    }
    timerRef.current = setTimeout(() => onSearch(value), 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, onSearch, onClear]);

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-xl px-4">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brain-cyan"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <input
          id="brain-search"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Buscar conhecimento  ·  / para focar"
          className="
            w-full pl-10 pr-4 py-2.5 rounded-lg
            bg-brain-surface/90 backdrop-blur-sm
            border border-brain-cyan/30 focus:border-brain-cyan
            text-brain-text placeholder-brain-text/40
            font-body text-sm outline-none
            transition-all duration-200
            glow-cyan
          "
        />

        {value && (
          <button
            onClick={() => { setValue(''); onClear(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-brain-text/40 hover:text-brain-cyan transition-colors"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
