import { describe, it, expect } from 'vitest';
import { normalizeWorkspaceRoot, detectHookSource } from '../services/hookInput.js';

describe('normalizeWorkspaceRoot', () => {
  it('strips the leading slash before a Windows drive letter', () => {
    expect(normalizeWorkspaceRoot('/c:/Users/foo/repo')).toBe('c:/Users/foo/repo');
  });

  it('is case-insensitive on the drive letter', () => {
    expect(normalizeWorkspaceRoot('/C:/Users/foo/repo')).toBe('C:/Users/foo/repo');
  });

  it('leaves already-normal Windows paths untouched', () => {
    expect(normalizeWorkspaceRoot('c:/Users/foo/repo')).toBe('c:/Users/foo/repo');
  });

  it('leaves POSIX paths untouched (no drive letter to strip)', () => {
    expect(normalizeWorkspaceRoot('/home/foo/repo')).toBe('/home/foo/repo');
  });
});

describe('detectHookSource', () => {
  it('detects cursor when cursor_version is present', () => {
    expect(detectHookSource({ cursor_version: '3.10.11' })).toBe('cursor');
  });

  it('defaults to claude when cursor_version is absent', () => {
    expect(detectHookSource({ session_id: 'abc', transcript_path: '/x' })).toBe('claude');
  });

  it('defaults to claude for an empty payload', () => {
    expect(detectHookSource({})).toBe('claude');
  });

  it('ignores a non-string cursor_version (defensive against schema drift)', () => {
    expect(detectHookSource({ cursor_version: 123 })).toBe('claude');
  });
});
