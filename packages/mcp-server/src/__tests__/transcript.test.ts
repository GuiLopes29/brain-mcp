import { describe, it, expect } from 'vitest';
import { buildSessionDigest } from '../services/transcript.js';

function userLine(content: string | object[]): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content } });
}
function assistantLine(content: string | object[]): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content } });
}

describe('buildSessionDigest', () => {
  it('extracts plain-string user and assistant messages', () => {
    const lines = [
      userLine('Fix the login bug'),
      assistantLine([{ type: 'text', text: 'Fixed it by adding null check.' }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).toContain('Fix the login bug');
    expect(digest).toContain('Fixed it by adding null check.');
    expect(hasSubstance).toBe(true);
  });

  it('skips continuation-summary preambles', () => {
    const lines = [
      userLine('This session is being continued from a previous conversation. Blah blah.'),
    ];
    const { digest } = buildSessionDigest(lines);
    expect(digest).not.toContain('This session is being continued');
  });

  it('ignores malformed JSON lines without throwing', () => {
    const lines = ['{not valid json', userLine('Real message')];
    expect(() => buildSessionDigest(lines)).not.toThrow();
    const { digest } = buildSessionDigest(lines);
    expect(digest).toContain('Real message');
  });

  it('ignores tool_result blocks (not real user speech)', () => {
    const lines = [
      userLine([{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'huge tool output' }] }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).not.toContain('huge tool output');
    expect(hasSubstance).toBe(false);
  });

  it('extracts file paths from Edit/Write tool_use blocks', () => {
    const lines = [
      assistantLine([
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/foo.ts' } },
        { type: 'tool_use', name: 'Write', input: { file_path: 'src/bar.ts' } },
      ]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).toContain('src/foo.ts');
    expect(digest).toContain('src/bar.ts');
    expect(hasSubstance).toBe(true);
  });

  it('extracts bash commands from tool_use blocks', () => {
    const lines = [
      assistantLine([{ type: 'tool_use', name: 'Bash', input: { command: 'pnpm test' } }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).toContain('pnpm test');
    expect(hasSubstance).toBe(true);
  });

  it('extracts subagent task descriptions from Agent tool_use blocks', () => {
    const lines = [
      assistantLine([{ type: 'tool_use', name: 'Agent', input: { description: 'Audit security' } }]),
    ];
    const { digest } = buildSessionDigest(lines);
    expect(digest).toContain('Audit security');
  });

  it('ignores read-only tools like Read/Grep/Glob', () => {
    const lines = [
      assistantLine([
        { type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } },
      ]),
    ];
    const { hasSubstance } = buildSessionDigest(lines);
    expect(hasSubstance).toBe(false);
  });

  it('reports hasSubstance=false for an empty or trivial session', () => {
    const { hasSubstance } = buildSessionDigest([]);
    expect(hasSubstance).toBe(false);
  });

  it('keeps only the last 5 assistant text responses', () => {
    const lines = Array.from({ length: 8 }, (_, i) =>
      assistantLine([{ type: 'text', text: `response ${i}` }]),
    );
    const { digest } = buildSessionDigest(lines);
    expect(digest).not.toContain('response 0');
    expect(digest).not.toContain('response 2');
    expect(digest).toContain('response 7');
  });

  it('truncates digest beyond maxChars', () => {
    const lines = [userLine('x'.repeat(20000))];
    const { digest } = buildSessionDigest(lines, 500);
    expect(digest.length).toBeLessThan(600);
    expect(digest).toContain('[...truncado...]');
  });

  it('reports linesProcessed matching input length', () => {
    const lines = [userLine('a'), userLine('b'), userLine('c')];
    const { linesProcessed } = buildSessionDigest(lines);
    expect(linesProcessed).toBe(3);
  });

  it('ignores system/queue-operation/mode lines', () => {
    const lines = [
      JSON.stringify({ type: 'mode', mode: 'normal' }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
      userLine('Real request'),
    ];
    const { digest } = buildSessionDigest(lines);
    expect(digest).toContain('Real request');
  });
});

// ── Cursor transcript schema (role at top level, not message.role) ─────────

function cursorUserLine(content: string | object[]): string {
  return JSON.stringify({ role: 'user', message: { content } });
}
function cursorAssistantLine(content: string | object[]): string {
  return JSON.stringify({ role: 'assistant', message: { content } });
}

describe('buildSessionDigest — Cursor schema', () => {
  it('extracts messages when role is at the top level (Cursor format)', () => {
    const lines = [
      cursorUserLine([{ type: 'text', text: 'list os ultimos 3 commits' }]),
      cursorAssistantLine([{ type: 'text', text: 'Aqui estão os commits.' }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).toContain('list os ultimos 3 commits');
    expect(digest).toContain('Aqui estão os commits.');
    expect(hasSubstance).toBe(true);
  });

  it('recognizes Cursor\'s "Shell" tool as a command (not a mutating file edit)', () => {
    const lines = [
      cursorAssistantLine([{ type: 'tool_use', name: 'Shell', input: { command: 'git log -3 --oneline' } }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).toContain('git log -3 --oneline');
    expect(digest).toContain('## Comandos executados');
    expect(digest).not.toContain('## Arquivos modificados');
    expect(hasSubstance).toBe(true);
  });

  it('ignores Cursor\'s turn_ended bookkeeping line', () => {
    const lines = [
      cursorUserLine('Real request'),
      JSON.stringify({ type: 'turn_ended', status: 'success' }),
    ];
    const { digest } = buildSessionDigest(lines);
    expect(digest).toContain('Real request');
  });

  it('treats a tool with file_path as mutating unless it is a known read-only tool', () => {
    const lines = [
      cursorAssistantLine([{ type: 'tool_use', name: 'ApplyPatch', input: { file_path: 'src/foo.ts' } }]),
    ];
    const { digest } = buildSessionDigest(lines);
    expect(digest).toContain('## Arquivos modificados');
    expect(digest).toContain('src/foo.ts');
  });

  it('does not misclassify a Read-equivalent tool with file_path as mutating', () => {
    const lines = [
      cursorAssistantLine([{ type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } }]),
    ];
    const { digest, hasSubstance } = buildSessionDigest(lines);
    expect(digest).not.toContain('## Arquivos modificados');
    expect(hasSubstance).toBe(false);
  });
});
