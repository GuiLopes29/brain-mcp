# Brain MCP

Semantic memory server for Claude and Cursor. Stores knowledge, decisions, and learned solutions as vector embeddings, searchable via natural language.

## Architecture

```
packages/mcp-server/   — Node.js MCP server (stdio) + HTTP bridge (Express :3456)
packages/brain-ui/     — React + Vite UI (force-directed knowledge graph, :5173)
SQLite                 — Metadata + vectors (sqlite-vec), packages/mcp-server/data/brain.db
```

No Docker, no local Ollama — vectors live in the same SQLite file as everything else via `sqlite-vec`, and embeddings run in-process via `@huggingface/transformers` (Transformers.js).

## Starting the stack

```bash
# 1. Start HTTP bridge (for the UI) — first run downloads the embedding model (ONNX, cached locally)
pnpm start:api      # http://127.0.0.1:3456

# 2. Start UI (optional)
pnpm dev:ui         # http://localhost:5173
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `get_guidelines` | **Token-cheap.** Compact rules + pitfalls for a project (one-line directives). Call once at task start. |
| `add_knowledge` | Store a solution, decision, or learning (with `kind` + `directive`) |
| `search_knowledge` | Semantic search across all stored knowledge |
| `list_knowledge` | List items, with optional project/tag filters |
| `update_knowledge` | Edit an existing item (re-embeds automatically) |
| `delete_knowledge` | Permanently remove an item by id |

All tools accept a `source` field (`claude` / `cursor` / `browser` / `manual`) used by the Control Room dashboard for attribution.

### Active-improvement loop (token-controlled)

The Brain is not just storage — it actively shapes how AIs work:

1. **At task start**, the consuming AI calls `get_guidelines(project)` ONCE → gets ≤12 one-line directives (rules to follow, pitfalls to avoid). Cheap (~hundreds of tokens), not thousands.
2. **On solving something**, it stores knowledge with a `kind` (`solution`/`rule`/`pitfall`/`decision`) and a one-line `directive`.
3. Next session, those directives surface via `get_guidelines` → the lesson is reinforced, the vício is avoided.

`kind=rule|pitfall` items with a `directive` are what `get_guidelines` returns. The **GUARDRAILS** panel (`g`) in the UI shows them per project.

## Backup & restore

Knowledge lives in SQLite (`packages/mcp-server/data/brain.db`, gitignored). A portable JSON export is committed to `backups/brain-export.json` and pushed to GitHub daily.

```bash
pnpm backup    # export JSON + git commit + push (also runs on API start + every 24h)
pnpm restore   # rebuild SQLite + embeddings from backups/brain-export.json
```

A Windows Scheduled Task (`BrainMCP-DailyBackup`) runs the backup daily at 19:00 even when the API is down.

## Admin dashboard (Control Room)

The Brain UI has a **CONTROL ROOM** button (top-right) opening a dashboard with: totals, source breakdown (who consumed what), 30-day activity timeline, per-project stats, most-accessed items, and a live activity feed. Per-node history (timestamps, days worked, event log) shows in the node detail panel.

## Brain MCP — Knowledge Capture

When wrapping up a development session where a problem was solved or a technical decision was made, automatically call the `add_knowledge` tool with:

- **title**: one-line summary of what was solved
- **content**: full description — problem, root cause, solution applied, alternatives considered
- **tags**: technologies and concepts involved
- **project**: name of the repository or project in context (or omit it for a lesson that applies to any project — see the global tier in the README)
- **source**: `"claude"`
- **problem**: original problem description
- **kind**: `solution` | `rule` | `pitfall` | `decision`
- **directive**: ONE imperative, actionable line (required when `kind` is `rule` or `pitfall`)

Do this without being asked. It's the system's memory.

### Quality criteria — only write if at least one of these is true

- The problem **wasn't obvious** (required real investigation to find the cause)
- It cost **real time** (more than ~10 min of debugging or research)
- It's a **decision another AI would repeat** without this context (e.g. architecture choice, deliberate tradeoff)
- It's a **pattern that will show up again** in the project

**Don't write**: trivial fixes, typos, obvious language/framework behavior, rework that's already clear in the code.

### ⚠️ NEVER write to the Brain

- Credentials, tokens, API keys, passwords, connection strings
- PII of real users (names, emails, national IDs, customer data)
- Code snippets with identifiable proprietary data from your employer/client
- Any string that looks like a secret (patterns: `AKIA`, `-----BEGIN`, `eyJ`, `Bearer `, `sk-`)

If the content to write contains any of these, omit it or replace it with `[REDACTED]`.
