import { describe, it, expect } from 'vitest';
import { cosineSim, clusterBySimilarity } from '../services/clustering.js';

describe('cosineSim', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1);
  });
});

describe('clusterBySimilarity', () => {
  it('groups items transitively (A~B, B~C but not A~C directly) into one cluster', () => {
    // A and B are similar, B and C are similar, A and C are not directly similar —
    // union-find must still put all three in the same cluster via B.
    const a = [1, 0, 0];
    const b = [0.9, 0.1, 0]; // close to a
    const c = [0.85, 0.2, 0]; // close to b, but cosineSim(a,c) may fall just under threshold
    const unrelated = [0, 0, 1];

    const groups = clusterBySimilarity([a, b, c, unrelated], 0.8);
    const clusterWithA = groups.find((g) => g.includes(0))!;

    expect(clusterWithA).toContain(1); // b
    expect(clusterWithA).toContain(2); // c
    expect(clusterWithA).not.toContain(3); // unrelated stays out
  });

  it('leaves dissimilar items in singleton groups', () => {
    const groups = clusterBySimilarity([[1, 0], [0, 1], [-1, 0]], 0.9);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it('returns one group containing everything when all items are identical', () => {
    const v = [1, 2, 3];
    const groups = clusterBySimilarity([v, v, v], 0.99);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('handles a single item without error', () => {
    const groups = clusterBySimilarity([[1, 0, 0]], 0.8);
    expect(groups).toEqual([[0]]);
  });

  it('handles an empty list without error', () => {
    expect(clusterBySimilarity([], 0.8)).toEqual([]);
  });
});
