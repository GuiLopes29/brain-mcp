// Runs after `pnpm changeset version`. Two jobs:
// 1. Sync the root package.json version — it's not a pnpm workspace member (only
//    packages/* are), so `changeset version` never touches it directly.
// 2. Write one consolidated entry to the root CHANGELOG.md from the summaries
//    collect-changesets.mjs saved before `changeset version` deleted the source
//    .changeset/*.md files (per-package changelogs are disabled on purpose).
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';

const pendingPath = '.changeset/.pending-summary.json';
if (!existsSync(pendingPath)) {
  console.log('No pending changeset summary found — nothing to finalize.');
  process.exit(0);
}

const summaries = JSON.parse(readFileSync(pendingPath, 'utf8'));
unlinkSync(pendingPath);

const mcpServer = JSON.parse(readFileSync('packages/mcp-server/package.json', 'utf8'));
const version = mcpServer.version;

const rootPath = 'package.json';
const root = JSON.parse(readFileSync(rootPath, 'utf8'));
if (root.version !== version) {
  root.version = version;
  writeFileSync(rootPath, JSON.stringify(root, null, 2) + '\n');
  console.log(`Synced root package.json version -> ${version}`);
}

if (summaries.length === 0) {
  console.log('No changeset summaries to add to CHANGELOG.md.');
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const bullets = summaries.map((s) => `- ${s.replace(/\s*\n+\s*/g, ' ')}`).join('\n');
const entry = `## [${version}] — ${date}\n\n${bullets}\n\n`;

const changelogPath = 'CHANGELOG.md';
const changelog = readFileSync(changelogPath, 'utf8');
const firstEntryIdx = changelog.indexOf('\n## ');
const updated =
  firstEntryIdx === -1
    ? `${changelog.trimEnd()}\n\n${entry}`
    : `${changelog.slice(0, firstEntryIdx + 1)}${entry}${changelog.slice(firstEntryIdx + 1)}`;

writeFileSync(changelogPath, updated);
console.log(`Added CHANGELOG.md entry for ${version}`);
