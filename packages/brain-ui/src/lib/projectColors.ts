// Stable, distinct neon palette assigned per project (sorted for determinism).
const PALETTE = [
  '#00F5FF', // cyan
  '#FF3366', // red
  '#7B2FBE', // purple
  '#4ADE80', // green
  '#FBBF24', // amber
  '#F472B6', // pink
  '#38BDF8', // sky
  '#A3E635', // lime
  '#FB923C', // orange
  '#C084FC', // violet
];

export function buildProjectColors(projects: string[]): Record<string, string> {
  const unique = [...new Set(projects)].sort();
  const map: Record<string, string> = {};
  unique.forEach((p, i) => {
    map[p] = PALETTE[i % PALETTE.length];
  });
  return map;
}

export function projectColor(project: string, map: Record<string, string>): string {
  return map[project] ?? '#00F5FF';
}
