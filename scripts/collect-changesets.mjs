// `changeset version` deletes each pending .changeset/*.md once it consumes them,
// so their summaries have to be captured before that step runs. finalize-release.mjs
// reads this file afterwards to write one consolidated root CHANGELOG.md entry —
// per-package changelogs are disabled (`"changelog": false`) since this is a single
// product shipped as one unit, not independently-versioned libraries.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = '.changeset';
const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md');

const summaries = files
  .map((f) => {
    const raw = readFileSync(join(dir, f), 'utf8');
    // Body is everything after the frontmatter's closing `---`.
    const parts = raw.split('---');
    return parts.slice(2).join('---').trim();
  })
  .filter(Boolean);

writeFileSync(join(dir, '.pending-summary.json'), JSON.stringify(summaries, null, 2));
