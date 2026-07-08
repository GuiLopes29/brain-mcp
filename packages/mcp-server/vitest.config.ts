import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each test FILE runs in its own process — module singletons (SQLite db) reset between files.
    pool: 'forks',
    setupFiles: ['./src/__tests__/setup.ts'],
    // Belt-and-suspenders: tsconfig now excludes __tests__ from the build so dist/
    // shouldn't contain compiled *.test.js, but this guards against ever silently
    // double-running (and double-counting) the suite against source + compiled
    // copies again if that build config regresses.
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
