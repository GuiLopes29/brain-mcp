# 🧠 Brain MCP

[![Test](https://github.com/GuiLopes29/brain-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/GuiLopes29/brain-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](CHANGELOG.md)

**Active** semantic memory for Claude and Cursor. Not just a knowledge store: it **reinforces good practices, prevents recurring mistakes, and improves code quality/security** for the AIs that use it — with **controlled token cost**, and without depending on the AI "remembering" to read or write.

Every solution, decision, or lesson becomes a node searchable by natural language (vector embeddings). Lessons become **compact guardrails** injected automatically at the start of every interaction.

### Index

[What Brain does](#-what-brain-does) · [Measurable gains](#-measurable-gains) · [Comparison with other solutions](#-comparison-with-other-solutions) · [Architecture](#-architecture) · [Quick start](#-quick-start) · [MCP Tools](#️-mcp-tools) · [Classifier](#-quality-classifier-ollama-cloud) · [Hybrid search](#-hybrid-search-vector--bm25) · [Dedup/contradiction](#-deduplication-and-contradiction-detection) · [Active loop + auto-injection + auto-capture](#-the-active-improvement-loop-with-token-control) · [Control Room](#-control-room-admin-panel) · [Brain UI](#-brain-ui--features) · [Backup](#-backup--restore) · [Live log](#-live-log) · [Scripts](#-scripts) · [Integration](#-integration) · [Security](#️-security) · [Troubleshooting](#-troubleshooting) · [Roadmap](#️-in-progress--next-steps) · [Changelog](CHANGELOG.md)

---

## ✨ What Brain does

- **Self-sufficient active improvement loop**: guardrails (rules + pitfalls) for the current project are **automatically injected** before every message (`UserPromptSubmit` hook) — doesn't depend on the AI remembering to check. At the end of a task, new knowledge is **automatically captured** (`SessionEnd`/`stop` hooks) — doesn't depend on the AI remembering to write.
- **Quality classifier** (Ollama Cloud, with automatic model fallback): every write goes through a server-side second opinion that adjusts `kind`/`priority`/`directive` and flags how much to trust the entry.
- **Hybrid search** (vector + BM25 via SQLite FTS5, fused by Reciprocal Rank Fusion) — finds matches both by meaning and by exact keyword, with per-project diversification.
- **Deduplication and contradiction detection**: a real UNIQUE constraint in the database (not just an application-level check) rejects exact duplicates before spending embedding/classifier calls; semantically near-identical nodes (similarity ≥ 0.92) trigger a non-blocking warning.
- **Ebbinghaus decay** in guardrail ranking — knowledge reinforced by recurring use rises; what's no longer accessed decays (~14-day half-life).
- **Full traceability**: who consumed what, when, and from where (claude / cursor / browser), with correct attribution even when the client forgets to report its own source.
- **Interactive neural visualization**: a force-directed knowledge graph, with timeline, filters, and search.
- **Durability**: automatic daily backup to GitHub (versioned JSON export) + restore with full reconstruction (metadata + vectors) from scratch.
- **100% embedded, no Docker and no local Ollama**: vectors live in the same SQLite file as the metadata (via `sqlite-vec`), and embeddings run in-process (via `@huggingface/transformers`) — there's no longer any external service (ChromaDB/Docker Desktop, local Ollama) to keep running.

---

## 📈 Measurable gains

Real numbers measured from the project's own usage, not estimates:

| Metric | Value |
|---|---|
| Cost of `get_guidelines` vs. reading the full rule files | Hundreds of tokens vs. thousands — the return is just `[kind] directive` for up to 12 items |
| Quality classifier calls per week | ~44-50, a residual fraction (~0.3%) of Ollama Cloud's free-tier quota (measured in GPU-time) |
| Automated tests | 168+, whole suite runs in ~1s |
| Accumulated knowledge nodes (across 3 repos) | 45+ active (+ 12 consolidated into 4 generalized rules/pitfalls), growing organically without manual intervention |
| `get_guidelines` calls before vs. after auto-injection | 3 calls in ~2 weeks of manual use → guaranteed on every message (Claude) / every new session (Cursor) via hooks |
| Real bugs found in a self-audit | 6 confirmed and fixed in a single pass (a 1000x-wrong timeout, invalid model IDs, 2 race conditions, a project leak in search, a fragile disaster-recovery script) — no memory system "just works" without periodic auditing |
| Heavy dependencies removed | 2 (Docker Desktop, local Ollama) — the vector store ran on ChromaDB via container (Docker on Windows allocates up to 50% of the machine's RAM to the WSL2 VM by default) and embeddings ran via local Ollama. Migrated to `sqlite-vec` + `@huggingface/transformers` (both embedded in the same Node process) — zero external services |

---

## 🏆 Comparison with other solutions

We researched how well-known AI agent memory systems solve the same problems before deciding to build our own. Honest summary — not everything here is unique to us, and they have capabilities we don't:

| Capability | **Brain MCP (ours)** | [agentmemory](https://github.com/rohitg00/agentmemory) | [Mem0](https://mem0.ai) | [Letta/MemGPT](https://letta.com) | [Zep](https://getzep.com) |
|---|---|---|---|---|---|
| Automatic capture (hooks) | ✅ `SessionEnd`/`stop`, 2 clients | ✅ 12 hooks, 15+ clients | Partial (via marketplace) | ❌ (memory managed via tool calls) | ❌ |
| Automatic guardrail injection (without the AI remembering to ask) | ✅ every message in Claude Code, every session in Cursor — the only pattern like this we found | ❌ | ❌ | ❌ | ❌ |
| Quality classifier (2nd opinion before persisting) | ✅ with automatic model fallback | ❌ (compression, not a quality gate) | ❌ | ❌ | ❌ |
| Hybrid search (vector + keyword) | ✅ FTS5 + sqlite-vec, RRF | ✅ BM25 + vector + graph, RRF | ✅ vector + graph | Searchable (recall memory) | ✅ temporal knowledge graph |
| Dedup with a real database guarantee (not just app-level) | ✅ UNIQUE index | Partial (5-min window by hash) | ADD-only (never overwrites) | N/A | N/A |
| Decay/ranking by usage reinforcement | ✅ Ebbinghaus | 4 consolidation tiers (sleep curve) | Recency-based ranking | 3 tiers (core/recall/archival) | Versioned temporal graph |
| Infrastructure cost | Free (embeddings + SQLite embedded in-process, no Docker, no local Ollama); cloud classifier uses a residual fraction of the free tier | Free (local SQLite) | Paid SaaS | SaaS/self-host | Paid SaaS |
| Hosting | 100% local, no Docker, no separate services | 100% local | Cloud | Cloud or self-host | Cloud |
| Retroactive quality audit | ✅ `audit:brain` (dry-run + apply) | ❌ | ❌ | ❌ | ❌ |
| Consolidation of recurring knowledge (N loose solutions → 1 generalized rule) | ✅ `consolidate` (embedding clustering + model synthesis) | ❌ | ❌ | Partial (sleep-time consolidation, doesn't generate a new rule) | ❌ |
| Cross-project knowledge (one lesson applies to any repo) | ✅ global tier (`project` optional) | ❌ (per session/agent) | ❌ (per user) | N/A (per-agent memory) | ❌ (per group/user) |

**Where they beat us**: agentmemory supports far more clients (15+) and has a session-replay visualizer; Letta has "sleep-time agents" (asynchronous memory refinement during idle time) that we haven't implemented; Zep has a versioned temporal knowledge graph, more sophisticated than our simple Ebbinghaus decay.

**Where we win**: we're the only one we found with a **dedicated quality classifier** (a model's second opinion before persisting, with automatic fallback) and **deterministic guardrail injection on every turn** — the others rely either on context compression (fragile, as discussed) or on the agent itself deciding to search memory.

---

## 🧱 Architecture

```
packages/mcp-server/   Node + TypeScript — MCP server (stdio) + HTTP bridge (Express :3456)
packages/brain-ui/     React + Vite + Tailwind — neural graph (:5173)
SQLite                 Metadata + vectors (sqlite-vec) + access log, all in packages/mcp-server/data/brain.db
```

| Layer | Technology |
|--------|-----------|
| MCP Server | Node.js + TypeScript + `@modelcontextprotocol/sdk` |
| Vector DB | `sqlite-vec` — embedded in the same SQLite file, no external service |
| Embeddings | `@huggingface/transformers` (Transformers.js) — `nomic-embed-text-v1.5` running in-process (ONNX), no external service |
| Metadata | SQLite (`better-sqlite3`, WAL) |
| HTTP Bridge | Express :3456 |
| UI | React + Vite + TailwindCSS + `react-force-graph-2d` |

> **No Docker.** Until mid-July/2026 the vector store ran on ChromaDB via Docker Desktop — the heaviest piece of the stack (the WSL2 VM allocates up to 50% of the machine's RAM by default). We migrated to `sqlite-vec`, which runs embedded in the Node process — one less dependency, one less service that can go down on its own.
>
> **No local Ollama.** Embeddings used to run via local Ollama (`nomic-embed-text` on `:11434`) — one more service to keep alive. We migrated to `@huggingface/transformers`, which loads the same model (in ONNX) inside the Node process itself, with no exposed port and no separate service. (The quality classifier still uses Ollama Cloud — a remote API call, not a local service to keep running.)

---

## 🚀 Quick start

```bash
cp .env.example .env         # 1. local config (OLLAMA_API_KEY is optional — without it, the classifier stays pending_review)
pnpm install                 # 2. dependencies (downloads the embedding model on first use, via Transformers.js)
pnpm build:server            # 3. compiles the MCP server (generates dist/)
pnpm dev                     # 4. brings up API + UI together
```

- UI: <http://localhost:5173>
- API: <http://127.0.0.1:3456>

> Prerequisites: Node **22+** (`.nvmrc`/`engines` in `package.json`) and pnpm. **Docker and local Ollama are no longer required** (embeddings run embedded via Transformers.js; `OLLAMA_API_KEY` is only for the optional quality classifier, via Ollama Cloud).

---

## 🛠️ MCP Tools

| Tool | Purpose |
|------|----------|
| `get_guidelines` | **Token-cheap.** Rules + pitfalls for a project as one-line directives. Call **once** at the start of a task. |
| `add_knowledge` | Stores a solution/decision/lesson. `project` is optional — omit it (or pass `"global"`) to mark the lesson as valid for any repo. Goes through the classifier, dedup, and contradiction detection before writing (see sections below). |
| `search_knowledge` | Hybrid search (vector + BM25) with per-project diversification. |
| `list_knowledge` | Lists items, with optional project/tag filters. |
| `update_knowledge` | Edits an item (auto re-embeds when title/content/tags change). Also accepts `priority`, `status`, `superseded_by`. |
| `delete_knowledge` | Removes an item by id. |

Every tool accepts `source` (`claude` / `cursor` / `browser` / `manual`) — used for attribution in the dashboard.

`add_knowledge` returns, besides `id`: `review_status` (see classifier below), `classifier_applied`, and optionally `duplicate_of` (blocked by dedup) or `similar_to` (contradiction/near-duplicate warning).

### Knowledge classification (`kind`)

| kind | meaning |
|------|-------------|
| `solution` | a one-off fix/lesson (default) |
| `rule` | a best practice to **always follow** |
| `pitfall` | an anti-pattern to **avoid** |
| `decision` | an architectural decision |

`rule` and `pitfall` with a `directive` (one imperative line) are what `get_guidelines` delivers to AIs.

### Lifecycle fields

| field | type | description |
|-------|------|-----------|
| `priority` | `1–5` | `1` = critical, always appears first in `get_guidelines`; `5` = low, may be cut at the limit. Default `3`. |
| `status` | `active` \| `deprecated` | Only `active` items appear in `get_guidelines`. |
| `superseded_by` | UUID (optional) | Tracks which item replaced this one — useful for auditing decisions that changed. |

To deprecate a guardrail that's gone stale:
```bash
# via update_knowledge (MCP)
update_knowledge({ id: "...", status: "deprecated", superseded_by: "new-uuid" })
```

---

## 🤖 Quality classifier (Ollama Cloud)

Every call to `add_knowledge` goes through a second evaluation, done by a server-side model via Ollama Cloud, **before** the embedding is generated. The classifier decides:

- `worth_keeping` — is it worth keeping? If not, `priority` is forced to `5` (never removed, just loses ranking relevance).
- `suggested_kind` / `suggested_priority` — may reclassify what the writing AI suggested.
- `directive` — automatically generates the one-line directive when `kind` is `rule`/`pitfall` (useful when Cursor writes without filling that field).

The result is recorded in each node's `review_status` field:

| review_status | meaning |
|---------------|-------------|
| `auto_classified` | the classifier ran and adjusted the fields |
| `pending_review` | classifier unavailable (no `OLLAMA_API_KEY`, timeout, error) — the calling AI's values were kept as-is |
| `reviewed` | node reviewed manually (or created before the classifier existed) |

**The write is never blocked** — a classifier failure only changes `review_status` to `pending_review`, it never prevents `add_knowledge`.

### Configuration

```bash
# .env
OLLAMA_API_KEY=...              # required for the classifier to run
OLLAMA_CLOUD_MODEL=qwen3-coder:480b-cloud
OLLAMA_FALLBACK_MODELS=minimax-m2.1:cloud   # optional, comma-separated
CLASSIFIER_TIMEOUT_MS=60000      # real observed latency: 2-20s
CLASSIFIER_ENABLED=true          # false disables it without touching code
CLASSIFIER_LANGUAGE=en            # language of generated content (title/content/directive/reasoning) — defaults to "en" if omitted
```

The classifier's prompts themselves are always in English (the model follows English instructions fine regardless of what language it needs to write in) — only `CLASSIFIER_LANGUAGE` changes the language of the **generated content**. This matters in practice: a knowledge base ends up mixing languages if this value changes midway, because similarity search won't merge the same lesson written in two different languages (embeddings land far apart). Pick a language and stick with it.

### Automatic model fallback

If `OLLAMA_CLOUD_MODEL` fails (HTTP error, timeout, malformed JSON, or an invalid response shape), the classifier automatically tries each model in `OLLAMA_FALLBACK_MODELS`, in order, before giving up. Every attempt is logged to stderr (`used fallback "..."`), so you can tell from the log if the primary model is having issues.

**Why we don't hardcode one model forever**: Ollama's cloud models come and go (deprecation, free/paid tier changes). We tested several candidates against 3 fixed real samples (`pnpm classify:test`) before deciding:

| Model | Accessible on free tier? | Notes |
|---|---|---|
| `qwen3-coder:480b-cloud` (current) | ✅ | Best latency (1.5-2.7s), but with a known deprecation date |
| `minimax-m2.1:cloud` (fallback) | ✅ | The only one to consistently get `worth_keeping` right across repeated runs; slower (9-12s) |
| `gpt-oss:20b-cloud` / `gpt-oss:120b-cloud` | ✅ | Fast, but already flagged with factual/judgment errors in production |
| `glm-4.7:cloud` | ✅ | Inconsistent across runs, unstable latency (up to 60s) |
| `nemotron-3-super:cloud` | ✅ | Unstable latency (one call took 53s) |
| `deepseek-v4-*`, `kimi-k2.6/2.7`, `qwen3.5-*`, `glm-5*` | ❌ 403 | Require Ollama Cloud's Pro plan |

Measured usage (`pnpm classify:test` + organic capture): ~44-50 calls/week, a small fraction of the free-tier quota (measured in GPU-time, not requests).

### Test in isolation / audit existing nodes

```bash
pnpm classify:test    # runs 3 real sample nodes, shows the model's judgment
pnpm audit:brain              # dry-run — re-evaluates ALL nodes, saves a report in backups/
pnpm audit:brain -- --apply   # applies the suggestions (review the report first!)
```

`audit:brain` is the mechanism for retroactively reclassifying nodes written before the classifier existed, or written by Cursor without `kind`/`directive`. **Reviewing the report manually before running with `--apply` is recommended** — the model sometimes downgrades items that are already useful `rule`/`pitfall` entries to `solution`, which would remove them from `get_guidelines`.

---

## 🔎 Hybrid search (vector + BM25)

`search_knowledge` fuses two relevance signals via **Reciprocal Rank Fusion** (k=60):

1. **Vector search** (`sqlite-vec` + embeddings via Transformers.js) — captures semantic similarity.
2. **Keyword search** (SQLite FTS5, BM25 ranking) — captures exact matches that embeddings alone miss (e.g. `TIP-2375`, package names, acronyms).

Items that rank well in both searches come out on top. The FTS5 index is kept up to date automatically by triggers on every `INSERT`/`UPDATE`/`DELETE` — no need to reindex manually.

**Per-project diversification**: when a search has no explicit `project`, at most 3 results from the same project show up — this keeps a project with lots of nodes from drowning out relevant results from others.

---

## 🧬 Deduplication and contradiction detection

On write (`add_knowledge`):

1. **Exact dedup** — SHA-256 hash of normalized `title + content`. If an identical node already exists, the write is aborted **before** the classifier and embedding (zero API cost), and the response carries `duplicate_of` pointing at the existing node.
2. **Contradiction/near-duplicate detection** — after embedding, a 1-result vector search checks whether something with cosine similarity ≥ 0.92 already exists. If so, the node **is still written normally**, but the response includes `similar_to` as a warning — useful for catching cases like "decision X" vs. "revised decision X" that aren't identical but deserve a look.

Neither check blocks the write beyond the exact-duplicate case — the goal is to flag, not to prevent.

---

## 🔁 The active improvement loop (with token control)

1. **Task start** → the AI calls `get_guidelines(project)` **once** → gets ≤12 short directives (hundreds of tokens, not thousands).
2. **Solving something** → writes with `kind` + `directive` (only if it was worth it — see criteria below).
3. **Next session** → the directive resurfaces via `get_guidelines` → the lesson is reinforced, the mistake is avoided.

The instructions that trigger this loop live in `~/.claude/CLAUDE.md` (global, loads for every project), in the repo's own `CLAUDE.md`, and in `.cursor/rules/brain.mdc` (Cursor, Project Rules format with `alwaysApply: true`).

### Auto-injection of guardrails (Claude Code + Cursor) — doesn't depend on the AI remembering to read

"Call `get_guidelines` once per task" assumes you can tell when a new task begins. In a long, continuous conversation (days, with context compaction along the way), that boundary gets ambiguous — real data showed `get_guidelines` being called only 2-3 times across weeks of use, even with dozens of writes in the same period. The problem isn't memory loss (the Brain lives outside the context, immune to compaction) — it's losing the **trigger** for when to re-check it.

Fix: a per-client hook automatically injects the current project's guardrails, without depending on the AI remembering to call the tool — sharing the same script (`inject-guidelines-hook.ts`) and the same throttle logic (`services/guidelinesInjection.ts`: only re-injects if >20min have passed since the last time in this session, or if the project changed — avoids repeating the same block over and over):

- **Claude Code**: `UserPromptSubmit` hook (`.claude/settings.json`) — fires **before every message**, injects via `hookSpecificOutput.additionalContext`.
- **Cursor**: `sessionStart` hook (`.cursor/hooks.json`) — fires **once per new session/conversation** (Cursor doesn't expose a per-turn hook with injection capability — `beforeSubmitPrompt` fires on every prompt, but its output schema only has `continue`/`user_message`, confirmed against a real captured payload; it doesn't inject context). Output format is also different: a flat `{"additional_context": "..."}`, matching Cursor's own snake_case convention (vs. Claude Code's nested object).

The script auto-detects which client called it (`detectHookSource`, same logic as auto-capture) and builds the output in the right shape — one single file covers both.

**A real gotcha that silently broke both Cursor hooks (`sessionStart` and `stop`) for a while:** the commands used `cd "<path>" && pnpm exec tsx <script>`. Native Claude Code runs these commands via `cmd.exe` (where `&&` works), but Cursor runs them via **PowerShell**, which doesn't accept `&&` as a separator — every hook failed with exit code 1, and it stayed masked because manually calling the tool (`get_guidelines` via `.cursor/rules/brain.mdc`) kept working and gave the false impression that auto-injection was active. The root cause only became visible by reading Cursor's own internal log (`%APPDATA%/Cursor/logs/<timestamp>/window*/output_*/cursor.hooks.workspaceId-*.log`), which records STDERR for every hook execution. Fix: drop `cd &&` entirely and use `pnpm --dir "<path>" exec tsx <script>`, which runs in any shell with no separator at all. Confirmed working in production (Cursor's log: `exit code: 0` + `Merged 1 valid response(s) for step sessionStart`).

### Auto-capture (Claude Code + Cursor) — doesn't depend on the AI remembering

The AI doesn't always remember to call `add_knowledge` at the end of a task. This is solved by native hooks that run **automatically at the end of every interaction**, no manual step needed — in **both** clients:

- **Claude Code**: `SessionEnd` hook in `.claude/settings.json`.
- **Cursor**: `stop` hook in `.cursor/hooks.json` — fires at the end of every agent response (more reliable than `sessionEnd`, which Cursor aborts on window close before the process can finish running).

Pipeline (shared by both clients — `auto-capture-hook.ts` → `auto-capture-worker.ts`):

1. The hook receives `transcript_path` (the conversation's JSONL) and spawns a **detached** process — the session closes immediately, without waiting.
2. The worker reads only the **new** lines since its last run (tracked in `data/auto-capture-state.json`, per `session_id`), builds a compact summary (user requests, files edited, commands run, the assistant's latest responses). The parser (`services/transcript.ts`) tolerates both transcript formats — Claude Code nests `role` inside `message.role`; Cursor puts it at the object's top level — and identifies mutating/reading tools by the *shape* of `input` (`file_path`/`command`), not by a fixed name, since each client names its tools differently (`Bash` vs. `Shell`, for example).
3. If there's substance (something beyond pure exploration), the summary goes to the classifier (`summarizeSessionForCapture`), which extracts 0–3 knowledge candidates worth noting — the common case is **zero**.
4. Each candidate goes through the normal `POST /knowledge` — i.e. it goes through the per-item classifier, hash dedup, and contradiction detection described above all over again.
5. Everything is logged to `data/auto-capture.log` (outside git) for debugging.

Each consuming repo needs its own `.claude/settings.json` and `.cursor/hooks.json` pointing (by absolute path) to this repo's `auto-capture-hook.ts` — the script is shared, but the hook config is per-repo in both clients.

### Quality criteria — when to write

Only write if at least one of these is true:
- The problem **wasn't obvious** (required real investigation)
- It cost **real time** (>10 min of debugging or research)
- It's a **decision another AI would repeat** without this context
- It's a **pattern that will show up again** in the project

**Don't write**: trivial fixes, typos, obvious language/framework behavior.

### Global knowledge (cross-project)

`project` is optional in `add_knowledge` — omitted (or `"global"`) marks the lesson as valid for **any** project. `get_guidelines` and `search_knowledge` always included this tier (`project = ''`) in search; what was missing was a way to write to it — `project` used to be required in the schema, so this tier was never populated. Use it for lessons that aren't specific to one repo: shell/Windows quirks, patterns from a generic tool (pnpm, Docker, Git), decisions that would apply to any stack.

### Consolidation — from loose solutions to generalized rules (`pnpm consolidate`)

Knowledge accumulates horizontally by default: every `add_knowledge`/auto-capture writes an isolated `solution`, even when it's the 3rd time the same lesson shows up. Only `rule`/`pitfall` reach `get_guidelines` — a pile of similar solutions never becomes a guardrail on its own.

`scripts/consolidate.ts` closes this loop:

1. Embeds all active `solution` items and clusters them by cosine similarity (union-find, threshold configurable via `CONSOLIDATE_THRESHOLD`, default 0.80).
2. For each cluster of 2+, asks the classifier (same Ollama Cloud fallback infra) to confirm whether it's *really* the same recurring pattern — not just the same topic — and, if so, synthesize ONE generalized `rule`/`pitfall` (and decide whether it's `global` or project-specific).
3. Applies (`--apply`): creates the new item and marks the original solutions as `deprecated` with `superseded_by` pointing at the new id — reversible, nothing is deleted.

```bash
pnpm consolidate              # dry-run — shows the proposed clusters, writes nothing
pnpm consolidate -- --apply   # creates the rules/pitfalls, deprecates the original solutions
```

Run it periodically (no automatic scheduling yet) — the more solutions accumulate, the more genuine clusters show up.

### `get_guidelines` ranking

Returned directives are ordered by:
1. `priority` ASC — `priority=1` items always come first, regardless of recency
2. Project scope — project-specific items before global ones
3. **Ebbinghaus strength** — `(access_count + 1) × e^(-0.05 × days since last access)`. Models forgetting: knowledge that isn't reinforced loses strength with a ~14-day half-life; frequent, recent access beats old access, even if more numerous.

When a directive goes stale, mark it `deprecated` instead of deleting it — this preserves the decision history, with `superseded_by` pointing at the replacement.

---

## 📊 Control Room (admin panel)

**▣ CONTROL ROOM** button (or `d` key):

- Totals: nodes, events, searches, views, active days
- **Who's consuming** (by source: claude / cursor / browser)
- Activity timeline (30 days)
- Per-project stats
- Most accessed
- **Live activity feed** (what's coming and going)
- **Node explorer**: table with text/type filters, sorting, click to open

**◆ GUARDRAILS** panel (`g` key): shows the active directives per project — what the brain is currently reinforcing.

### Node size = real AI usage

Each node's size grows with `access_count`, which **only increases when an AI (claude/cursor) actually consumes** the node** (search or view). Browser opens are **recorded** (where/when), but don't inflate the node — that's just user curiosity. Growth is logarithmic and capped.

---

## 🎨 Brain UI — features

- **Neural graph**, force-directed; colors: 🔴 recent (24h) · 🔵 active · 🟣 dormant (or **color by project**)
- **Semantic search** with a ranked results panel and **automatic zoom** onto matches
- **Node detail**: resizable (drag the edge), reading mode (⤢), **inline editing** (full CRUD: kind, directive, tags, content) + event history
- **Timeline** (▶): watch the brain grow chronologically
- **Per-project filters** (toggle on/off) and an ambient particle field
- **Live pulse** when a new node is captured
- **Shortcuts**: `/` search · `Esc` clear/close · `d` Control Room · `g` Guardrails · `a` add · `?` help

---

## 💾 Backup & restore

Knowledge lives in SQLite (`packages/mcp-server/data/brain.db`, outside git). A **portable, versioned JSON export** is committed to `backups/brain-export.json` and pushed to GitHub.

```bash
pnpm backup    # exports JSON + git commit + push
pnpm restore   # rebuilds SQLite + embeddings from the backup
```

- The backup runs **on API start** and **every 24h** while it's running — this alone already covers most cases, on any OS.
- A **Windows Scheduled Task** (`BrainMCP-DailyBackup`) runs the backup **every day at 7pm**, even with the API turned off (`scripts/brain-backup.cmd`).
- Turn off auto-backup: `BRAIN_AUTO_BACKUP=false`.

**Mac/Linux — cron equivalent** (not validated in practice; this project has only ever been developed on Windows — if you test it, a PR with fixes is welcome):

```bash
# crontab -e — runs the backup every day at 7pm even with the API off
0 19 * * * cd /absolute/path/to/brain-mcp/packages/mcp-server && pnpm backup
```

### Export scope (a repo shared between public and private projects)

The same Brain can run as a central server for multiple repos — if one of them is private/client work, knowledge written from there (feature names, architecture decisions, internal bug details) **also goes into the export**, unfiltered, by default. That's fine while this repo stays private, but it becomes a real leak the moment it goes public.

`BACKUP_EXCLUDE_PROJECTS` (comma-separated, in `.env`, never committed) removes specific projects from the export before it's written/committed:

```bash
# .env — excludes these projects from the public backups/brain-export.json
BACKUP_EXCLUDE_PROJECTS=client-project-a,client-project-b
```

This only affects backups going forward — it doesn't retroactively scrub anything already committed to git history.

---

## 📟 Live log

Running `pnpm dev` (or `pnpm start:api`), every relevant action prints a compact line to the terminal — no need to open the UI to know what's happening:

```
18:31:18  📋 guidelines cursor    [my-project]     →  10 directive(s)
18:32:07  🔍 search     claude    [other-project]  "csv import bug"  →  3 result(s)
18:32:19  ➕ add        claude    [other-project]  "Fix CSV bug..."  →  auto_classified (rule, p2)
18:33:10  👁  view       browser                    "TIP-2375..."      →  accessed 4x
```

Covers `add`, `search`, `guidelines`, `update`, `delete`, `view`, `list` — both in the HTTP bridge (`api.ts`, used by the UI and by auto-capture) and in the stdio MCP server (`index.ts`, used directly by Claude/Cursor during a real coding session). Dashboard polling routes (`/stats`, `/activity`, `/export`, `/knowledge/graph`, `/health`) are deliberately silent — they're not "actions", they'd just spam the log.

**Important**: `pnpm dev` only brings up the HTTP bridge + the UI. The stdio MCP server that Claude/Cursor actually use during a coding session is a **separate process**, spawned by the client itself (`.mcp.json`/`.cursor/mcp.json`) — it doesn't show up in `pnpm dev`'s terminal. To see those calls live, either (a) run `pnpm dev:server` in a separate terminal, or (b) watch the Control Room's **Activity feed** in the UI, which reads the same table (`access_log`) both processes write to.

The stdio server's code writes exclusively to `stderr` — never to `stdout`, which is reserved for the JSON-RPC protocol (writing there would corrupt communication with the client).

| Method | Route | Description |
|--------|------|-----------|
| GET | `/knowledge/graph` | nodes + edges for the UI |
| GET | `/knowledge/search?q=` | semantic search |
| GET | `/knowledge/:id` | detail + history (records a view) |
| POST | `/knowledge` | adds |
| PATCH | `/knowledge/:id` | updates |
| DELETE | `/knowledge/:id` | removes |
| GET | `/guidelines?project=` | compact directives |
| GET | `/stats` | dashboard aggregates |
| GET | `/activity?limit=` | activity feed |
| GET | `/export` | full JSON dump |
| GET | `/health` | health check |

Source is read from `?source=` or the `X-Brain-Source` header (the UI sends `browser`).

---

## 📦 Scripts

| Script | Action |
|--------|------|
| `pnpm dev` | API + UI together (concurrently) |
| `pnpm dev:server` / `pnpm dev:ui` | server only / UI only |
| `pnpm build` | compiles server + UI |
| `pnpm start:api` | HTTP bridge |
| `pnpm backup` / `pnpm restore` | export+push / restore |
| `pnpm test` | runs the test suite (168+ tests, ~1s) |
| `pnpm test:watch` | watch mode for development |
| `pnpm classify:test` | tests the classifier in isolation with 3 sample nodes |
| `pnpm audit:brain` / `pnpm audit:brain -- --apply` | reclassifies existing nodes (dry-run / apply) |
| `pnpm consolidate` / `pnpm consolidate -- --apply` | groups recurring solutions and synthesizes generalized rules/pitfalls (dry-run / apply) |

---

## 🔌 Integration

### Claude Code
`.mcp.json` (at the project root) registers the `brain` server; `.claude/settings.local.json` enables it via `enabledMcpjsonServers`. **Inside this repo, `.mcp.json` and `.claude/settings.json` already use `command: "node"` (generic, via PATH) and relative paths/`$CLAUDE_PROJECT_DIR`** — works out-of-the-box on any clone, nothing to edit. To use the Brain **from another repo** (consuming this one's server), replicate a `.mcp.json` there pointing at the **absolute** path of this repo's `dist/index.js` — that's genuinely necessary there, since it's a cross-repo reference.

`.claude/settings.json` (versioned, shared) also registers the auto-capture `SessionEnd` hook — nothing extra to configure, it already ships in the repo. Requires the HTTP bridge to be running (`pnpm start:api`) to actually write.

> If you use **nvm** with multiple Node versions installed, the generic `command: "node"` can cause the ABI-mismatch error described in [Troubleshooting](#-troubleshooting) — in that case, swap it for an absolute path to a fixed version's `node.exe`.

### Cursor
`~/.cursor/mcp.json` (global) registers the `brain` server for **all** projects. This repo's own `.cursor/mcp.json` does the same at the project level, with a relative path (`packages/mcp-server/dist/index.js`) — this only resolves correctly when Cursor invokes it with cwd at this repo's root, which is the default for project-scoped configs. Each **external** working repo (one that only consumes the server, isn't this repo) needs its own `.cursor/rules/brain.mdc` with the loop instructions (copy this repo's and adjust `project`) and its own `.mcp.json`/`.cursor/mcp.json` pointing at this repo's `dist/index.js` absolute path — the root `.cursorrules` format is legacy/deprecated since Cursor 0.43.

#### Claude subagents in Cursor

Cursor 2.4+ reads `.claude/agents/` natively, but **doesn't resolve Claude Code's model aliases** (`sonnet`/`haiku`/`opus`) — it silently falls back to the parent agent's model. This repo's converter generates native versions in `.cursor/agents/` (which take precedence over `.claude/agents/` when names collide), mapping `sonnet → claude-sonnet-5`, `haiku → claude-4.5-haiku`, `opus → claude-opus-4.8`, deriving `readonly: true` when tools don't include Write/Edit/Bash, and stripping fields Cursor ignores (`tools`, `memory`):

```bash
pnpm sync:cursor-agents -- "C:/path/to/repo" [other-repo...]
```

`.claude/agents/*.md` remains the source of truth — edit there and rerun the script.

> ⚠️ **Both clients (Claude and Cursor) run the compiled `dist/`** — after any change to `mcp-server`, run `pnpm build:server`, otherwise they keep silently running the old code.

---

## 🛡️ Security

- The HTTP bridge listens **only on `127.0.0.1`** — not exposed to the network.
- Every MCP tool input is validated with Zod (max lengths, restricted enums, non-empty tags).
- Your own backup repo/mirror should be **private** if it holds anything sensitive.
- `CLAUDE.md` and `.cursor/rules/brain.mdc` explicitly instruct **never to write** credentials, tokens, PII, or connection strings into the Brain.

---

## 🔧 Troubleshooting

### "Brain MCP is down (native module version mismatch)"

`better-sqlite3` is a native module compiled for a specific Node version (ABI/`NODE_MODULE_VERSION`). This breaks when:

1. **Multiple Node versions installed via nvm** and the active version changes between when the module was compiled and when the MCP client (Claude/Cursor) loads it.
2. **Zombie MCP processes** from old sessions keep running in the background with a different Node version, holding a lock on the `.node` file and blocking the rebuild.

This project's requirement: **Node ≥ 22** (see `.nvmrc` and `engines` in `package.json`). If you hit this, pin both `.mcp.json` (Claude) and `.cursor/mcp.json` (Cursor) to a fixed version's `node.exe` instead of the generic `"node"` — resolving via PATH would inherit whatever `nvm use` is active at spawn time, which is exactly what caused this.

**Fix:**
```bash
# 1. Kill zombie MCP processes (Windows) — look for "dist/index.js" in the CommandLine
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*dist*index.js*' } | Select ProcessId
Stop-Process -Id <PID...> -Force

# 2. Rebuild the native module for the active Node version
pnpm rebuild

# 3. Rebuild dist and restart the MCP clients (Claude/Cursor)
pnpm build:server
```

If `pnpm rebuild` fails with `EBUSY`/`EPERM`, that's a sign a zombie process is still holding the file — repeat step 1.

---

## 🗺️ In progress / next steps

Implemented and stable: full MCP tools, guardrail loop with Ebbinghaus ranking and deprecation, server-side quality classifier with automatic fallback, hybrid search (BM25 + vector via `sqlite-vec`, **no Docker**) with per-project diversification, hash-based dedup with a real database constraint + contradiction detection, **auto-capture via `SessionEnd`/`stop` hooks** (Claude Code + Cursor), **auto-injection of guardrails via `UserPromptSubmit`/`sessionStart`** (Claude Code + Cursor), **cross-project global knowledge tier**, and **automatic consolidation of recurring solutions into generalized rules/pitfalls** (`pnpm consolidate`), hardened security, a test suite (168+), Control Room, node explorer, backup/restore with full reconstruction, and the full visualization layer.

Deliberately deferred ideas (low cost/benefit today — open an issue when a real need shows up):

- [ ] **Multi-machine sync** beyond git (current limitation: don't use on two machines at once without a manual `git pull` first). We evaluated moving to a hosted DB (Mongo Atlas free tier) — dropped for now: no serious self-hosted competitor (Letta/agentmemory) uses Mongo, and the migration would mean rewriting BM25 (FTS5 is SQLite-specific) without solving the real problem (public-backup scope).
- [ ] **Neighbor highlighting** on hover / a graph minimap.
- [ ] **Impact metrics** — a cheap proxy: count how often a consulted `pitfall` reappears as a tag on new `solution` nodes.
- [ ] **Parallelizing restore** above ~100 nodes (sequential today; SQLite writes are fast enough on their own, but `getEmbedding` calls (local inference via Transformers.js) could be batched).

### Known limitations

- **Never validated on Mac/Linux.** Everything here has been developed and tested on Windows. `pnpm --dir` should in theory be portable to POSIX shells, and a cron equivalent is documented above for the backup schedule, but neither has been confirmed in practice. If you try it, a PR with fixes (or just a "this worked" confirmation) is very welcome.
- **This repo's git history predates the public release** and may still contain internal references from the private repo it was extracted from. If you're forking this to build your own private version, treat the initial commit as the clean baseline.

> When a concrete need shows up, just open an issue — the system is modular enough to grow without rework.
