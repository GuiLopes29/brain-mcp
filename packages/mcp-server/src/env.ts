/**
 * Loads the monorepo-root .env regardless of the process's cwd.
 *
 * Bare `import 'dotenv/config'` resolves .env relative to process.cwd() —
 * when a script is launched with cwd=packages/mcp-server (e.g. `pnpm start:api`
 * run from that workspace), it silently finds nothing there (.env only lives
 * at the repo root) and every var falls back to its in-code default. That
 * masks the problem for vars with defaults (OLLAMA_URL, CHROMA_URL) but not
 * for ones without (OLLAMA_API_KEY) — which fail with no error, just silently
 * missing.
 *
 * Import this file FIRST (before any other local import) in every entry point
 * and every service that reads process.env directly.
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/ → mcp-server/ → packages/ → monorepo root
config({ path: join(__dirname, '..', '..', '..', '.env') });
