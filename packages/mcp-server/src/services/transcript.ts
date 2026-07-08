/**
 * Parses AI-coding-assistant JSONL transcripts into a compact digest suitable
 * for feeding to the session-capture classifier.
 *
 * Supports TWO schemas, both undocumented and subject to change:
 *   - Claude Code:  {"type": "user"|"assistant", "message": {"role": ..., "content": ...}}
 *   - Cursor:       {"role": "user"|"assistant", "message": {"content": ...}}
 * (role lives in different places — everything else here is written to be
 * tolerant of either). Every access is defensive (optional chaining, try/catch
 * per line) so a schema drift degrades to "less context extracted", never a crash.
 */

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface TranscriptLine {
  /** Claude Code puts role at the top level type sometimes; Cursor puts it here directly. */
  role?: string;
  message?: {
    /** Claude Code's actual role field. */
    role?: string;
    content?: string | ContentBlock[];
  };
}

const CONTINUATION_PREFIX = 'This session is being continued from a previous conversation';

/** Known mutating tool names across clients (Claude Code + Cursor). */
const MUTATING_TOOL_NAMES = new Set(['Edit', 'Write', 'NotebookEdit']);
/** Known read-only tool names that happen to take a file_path/path input — never count as mutating. */
const READ_ONLY_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob', 'Search', 'CodebaseSearch', 'ListDir']);
/** Subagent/delegation tool names across clients. */
const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

function extractRole(line: TranscriptLine): string | undefined {
  return line.role ?? line.message?.role;
}

function extractText(content: string | ContentBlock[] | undefined): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!.trim())
    .filter(Boolean);
}

interface ToolUseInfo {
  name: string;
  /** true if this looks like a file-mutating or shell-command tool (Edit/Write/Bash/Shell/...). */
  isMutating: boolean;
  isSubagent: boolean;
  detail: string;
}

/**
 * Classify a tool_use block WITHOUT hardcoding every client's tool names —
 * Claude Code calls it "Bash", Cursor calls the same concept "Shell". Instead,
 * match by the SHAPE of `input` (does it have `command`? `file_path`/`path`?)
 * combined with a small name allowlist for cases shape alone can't distinguish.
 */
function classifyToolUse(b: ContentBlock): ToolUseInfo | null {
  if (b.type !== 'tool_use' || !b.name) return null;
  const input = b.input ?? {};
  const name = b.name;

  const isSubagent = SUBAGENT_TOOL_NAMES.has(name);
  const filePath = typeof input.file_path === 'string' ? input.file_path
    : typeof input.path === 'string' ? input.path : undefined;
  const command = typeof input.command === 'string' ? input.command : undefined;
  const description = typeof input.description === 'string' ? input.description : undefined;

  const isMutating = !READ_ONLY_TOOL_NAMES.has(name) && (MUTATING_TOOL_NAMES.has(name) || !!filePath);

  let detail = '';
  if (isSubagent && description) detail = description;
  else if (filePath) detail = filePath;
  else if (command) detail = command;

  if (!isMutating && !isSubagent && !command) return null; // read-only tool (Read/Grep/Glob/...) — not notable

  return { name, isMutating, isSubagent, detail: detail.slice(0, 200) };
}

export interface SessionDigest {
  digest: string;
  /** Number of transcript lines actually parsed (for state tracking). */
  linesProcessed: number;
  /** Rough signal of "real work happened" — used to skip trivial sessions cheaply. */
  hasSubstance: boolean;
}

/**
 * Build a compact digest from a slice of transcript JSONL lines (already split by \n).
 * Pass only the NEW lines since the last processed offset to avoid re-summarizing
 * the whole session on every hook firing.
 */
export function buildSessionDigest(lines: string[], maxChars = 12000): SessionDigest {
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];
  const filesTouched = new Set<string>();
  const commandsRun = new Set<string>();
  const subagentTasks = new Set<string>();
  let mutatingToolCount = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // malformed/partial line — skip, never crash
    }

    const role = extractRole(parsed);
    if (role !== 'user' && role !== 'assistant') continue; // also skips bookkeeping lines (e.g. Cursor's turn_ended)

    const texts = extractText(parsed.message?.content);
    for (const t of texts) {
      if (t.startsWith(CONTINUATION_PREFIX)) continue; // skip auto-injected continuation summaries
      if (role === 'user') userTexts.push(t);
      else assistantTexts.push(t);
    }

    const content = parsed.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        const use = classifyToolUse(b);
        if (!use) continue;
        if (use.isSubagent && use.detail) subagentTasks.add(use.detail);
        else if (use.isMutating) {
          mutatingToolCount++;
          if (use.detail) filesTouched.add(use.detail);
        } else if (use.detail) {
          commandsRun.add(use.detail);
        }
      }
    }
  }

  const hasSubstance = mutatingToolCount > 0 || commandsRun.size > 0 || userTexts.length > 0;

  const sections: string[] = [];
  if (userTexts.length) sections.push(`## Pedidos do usuário\n${userTexts.map((t) => `- ${t}`).join('\n')}`);
  if (filesTouched.size) sections.push(`## Arquivos modificados\n${[...filesTouched].map((f) => `- ${f}`).join('\n')}`);
  if (commandsRun.size) sections.push(`## Comandos executados\n${[...commandsRun].map((c) => `- ${c}`).join('\n')}`);
  if (subagentTasks.size) sections.push(`## Sub-tarefas delegadas\n${[...subagentTasks].map((s) => `- ${s}`).join('\n')}`);
  if (assistantTexts.length) {
    // Keep only the last few assistant responses — those tend to contain conclusions/summaries.
    const tail = assistantTexts.slice(-5);
    sections.push(`## Respostas finais do assistente\n${tail.map((t) => `- ${t}`).join('\n')}`);
  }

  let digest = sections.join('\n\n');
  if (digest.length > maxChars) digest = digest.slice(0, maxChars) + '\n\n[...truncado...]';

  return { digest, linesProcessed: lines.length, hasSubstance };
}
