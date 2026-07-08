# Contributing

Thanks for your interest! This is a personal open-source project — contributions are welcome, but without a response SLA.

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d         # ChromaDB
ollama pull nomic-embed-text
pnpm build:server
pnpm test                    # 155+ tests, ~1s, no need for Docker/Ollama running (everything's mocked)
pnpm dev                     # API + UI together
```

See the [README](README.md) for the full architecture and troubleshooting.

## Before opening a PR

- `pnpm test` and `pnpm exec tsc --noEmit` (inside `packages/mcp-server`) need to pass — CI runs both on every PR.
- New behavior in `add.ts`/`search.ts`/`services/*.ts` needs a matching test in `src/__tests__/` — see the existing files for the mocking pattern (`vi.mock` + `vi.stubGlobal('fetch', ...)` for the classifier).
- If you add a new script under `scripts/`, make sure `tsconfig.json` still excludes `src/__tests__` from the build (avoids the silent test-duplication bug documented in the commit history).
- Run `pnpm build:server` before manually testing against a real MCP client (Claude Code/Cursor) — they run the compiled `dist/`, not `src/` directly.

## Platforms

Developed and tested on Windows. Never validated on Mac/Linux — if you test on one, a PR reporting what worked/broke is very welcome, especially:
- The automatic backup schedule (today only has a Windows Scheduled Task, `scripts/brain-backup.cmd` — needs a cron/launchd equivalent).
- The Cursor/Claude Code hooks (`scripts/inject-guidelines-hook.ts`, `scripts/auto-capture-hook.ts`) use `pnpm --dir` specifically because `cd X && Y` breaks under Windows PowerShell — in theory it's already portable to POSIX shells, but that's never been confirmed in practice.

## Reporting bugs

Open an issue with: what you expected, what happened, and (if possible) the output of `pnpm test` or the relevant log (`data/*.log`, gitignored — paste the excerpt, not the whole file).

## What to NEVER commit

Credentials, tokens, API keys, or any content from `backups/brain-export.json` that isn't yours — see the security section in `CLAUDE.md`.
