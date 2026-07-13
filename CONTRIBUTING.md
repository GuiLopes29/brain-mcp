# Contributing

Thanks for your interest! This is a personal open-source project — contributions are welcome, but without a response SLA.

## Local setup

```bash
cp .env.example .env
pnpm install
pnpm build:server
pnpm test                    # 168+ tests, ~1s, no need for any external service (everything's mocked)
pnpm dev                     # API + UI together
```

See the [README](README.md) for the full architecture and troubleshooting.

## Before opening a PR

- `pnpm test` and `pnpm exec tsc --noEmit` (inside `packages/mcp-server`) need to pass — CI runs both on every PR.
- New behavior in `add.ts`/`search.ts`/`services/*.ts` needs a matching test in `src/__tests__/` — see the existing files for the mocking pattern (`vi.mock` + `vi.stubGlobal('fetch', ...)` for the classifier).
- If you add a new script under `scripts/`, make sure `tsconfig.json` still excludes `src/__tests__` from the build (avoids the silent test-duplication bug documented in the commit history).
- Run `pnpm build:server` before manually testing against a real MCP client (Claude Code/Cursor) — they run the compiled `dist/`, not `src/` directly.
- Behavior changes (not just typo/doc fixes) need a changeset: run `pnpm changeset`, pick the bump type (patch/minor/major), and write a 1-2 line summary — it becomes a CHANGELOG.md entry automatically when the version is released (see `.changeset/README.md`).

## Releasing a version

Versioning is automated via [Changesets](https://github.com/changesets/changesets) (`.github/workflows/release.yml`):

1. PRs with behavior changes include a changeset (`pnpm changeset`).
2. On merge to `main`, the Action automatically opens/updates a "chore(release): version packages" PR with the version bump (`mcp-server` and `brain-ui` always together — `fixed` group in `.changeset/config.json`) and an updated `CHANGELOG.md`.
3. Merging that release PR runs the Action again — since no changesets remain pending, it creates and pushes the matching git tag (`vX.Y.Z`) instead. No npm publish (packages are `private`).

## Platforms

Developed and tested on Windows. Never validated on Mac/Linux — if you test on one, a PR reporting what worked/broke is very welcome, especially:
- The automatic backup schedule (today only has a Windows Scheduled Task, `scripts/brain-backup.cmd` — needs a cron/launchd equivalent).
- The Cursor/Claude Code hooks (`scripts/inject-guidelines-hook.ts`, `scripts/auto-capture-hook.ts`) use `pnpm --dir` specifically because `cd X && Y` breaks under Windows PowerShell — in theory it's already portable to POSIX shells, but that's never been confirmed in practice.

## Reporting bugs

Open an issue with: what you expected, what happened, and (if possible) the output of `pnpm test` or the relevant log (`data/*.log`, gitignored — paste the excerpt, not the whole file).

## What to NEVER commit

Credentials, tokens, API keys, or any content from `backups/brain-export.json` that isn't yours — see the security section in `CLAUDE.md`.
