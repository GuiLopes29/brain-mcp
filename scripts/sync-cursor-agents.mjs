#!/usr/bin/env node
/**
 * Converts Claude Code subagents (.claude/agents/*.md) into Cursor subagents
 * (.cursor/agents/*.md) so Cursor uses the CORRECT models.
 *
 * Why: Cursor 2.4+ reads .claude/agents/ natively for compatibility, but the
 * `model:` field there uses Claude Code ALIASES (sonnet/haiku/opus) that Cursor
 * cannot resolve — so Cursor silently falls back to the parent model. Cursor
 * also ignores Claude-specific fields (tools, memory) and has its own ones
 * (readonly, is_background). When names collide, .cursor/agents/ takes
 * precedence over .claude/agents/ — so these generated files "shadow" the
 * Claude ones inside Cursor without touching the source of truth.
 *
 * Keep editing ONLY .claude/agents/*.md, then re-run this script.
 *
 * Usage:
 *   node scripts/sync-cursor-agents.mjs <repo-path> [<repo-path> ...]
 *   pnpm sync:cursor-agents "C:/path/to/repo"
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// Claude Code alias → real Anthropic model id (verified against Anthropic's
// official ID list, NOT the "kebab-case of the display name" guess this used
// to be — that guess was wrong for haiku (missing the dated suffix entirely)
// and opus (hyphen vs period before the minor version), silently defeating
// the whole point of this script for any agent pinned to those tiers.
const MODEL_MAP = {
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-4-8',
  inherit: 'inherit',
};

function convert(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null; // no frontmatter — not an agent file
  const [, front, body] = m;

  const lines = front.split(/\r?\n/);
  const out = [];
  let toolsLine = null;
  let inFoldedBlock = false;

  for (const line of lines) {
    // Track folded/indented continuation lines (e.g. `description: >`) — pass through.
    if (/^\s/.test(line)) {
      if (!inFoldedBlock) continue; // continuation of a dropped key (tools/memory) — drop too
      out.push(line);
      continue;
    }

    const key = line.match(/^(\w[\w-]*):/)?.[1];
    inFoldedBlock = false;

    if (key === 'tools') {
      toolsLine = line;
      continue; // Cursor has no `tools` field
    }
    if (key === 'memory') continue; // Claude-specific
    if (key === 'model') {
      const alias = line.replace(/^model:\s*/, '').trim();
      const mapped = MODEL_MAP[alias] ?? alias; // full ids pass through untouched
      out.push(`model: ${mapped}`);
      continue;
    }

    out.push(line);
    // If this key opens a folded/multi-line block, keep its continuations.
    if (/:\s*[>|]\S*\s*$/.test(line) || /:\s*$/.test(line)) inFoldedBlock = true;
  }

  // No Write/Edit/Bash tools in the Claude definition → read-only agent in Cursor.
  const tools = toolsLine ?? '';
  if (toolsLine && !/\b(Write|Edit|Bash|NotebookEdit)\b/.test(tools)) {
    out.push('readonly: true');
  }

  return `---\n${out.join('\n')}\n---\n${body}`;
}

const repos = process.argv.slice(2);
if (repos.length === 0) {
  console.error('usage: node scripts/sync-cursor-agents.mjs <repo-path> [...]');
  process.exit(1);
}

for (const repo of repos) {
  const srcDir = join(repo, '.claude', 'agents');
  const dstDir = join(repo, '.cursor', 'agents');
  if (!existsSync(srcDir)) {
    console.log(`skip ${repo} — no .claude/agents/`);
    continue;
  }
  mkdirSync(dstDir, { recursive: true });

  for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.md'))) {
    const converted = convert(readFileSync(join(srcDir, file), 'utf8'));
    if (!converted) {
      console.log(`  skip ${file} — no frontmatter`);
      continue;
    }
    writeFileSync(join(dstDir, file), converted);
    console.log(`  ${basename(repo)}: .claude/agents/${file} → .cursor/agents/${file}`);
  }
}
console.log('done — re-run after editing .claude/agents/*.md');
