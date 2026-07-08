import '../env.js';

export interface ClassificationResult {
  worth_keeping: boolean;
  suggested_priority: 1 | 2 | 3 | 4 | 5;
  suggested_kind: 'solution' | 'rule' | 'pitfall' | 'decision';
  /** Imperative directive (max ~15 words). null when suggested_kind is 'solution'. */
  directive: string | null;
  /** One sentence — why the model decided this way (for auditing). */
  reasoning: string;
}

/**
 * CLASSIFIER_LANGUAGE controls the language of *generated content* (reasoning,
 * title, content, directive) — not the prompts themselves, which are always in
 * English since the model understands English instructions regardless of what
 * language it needs to write the output in. Defaults to English (the OSS
 * default); set to "pt-BR" (or any other language name) in a private .env to
 * keep an existing knowledge base's language consistent without touching code.
 */
function responseLanguage(): string {
  const lang = process.env.CLASSIFIER_LANGUAGE?.trim();
  if (!lang || /^en(glish)?$/i.test(lang)) return 'English';
  if (/^pt(-br)?$/i.test(lang)) return 'Brazilian Portuguese (pt-BR)';
  return lang;
}

function classifySystemPrompt(): string {
  return `You evaluate entries for a backend developer's technical knowledge base.

Value criteria: only worth keeping (worth_keeping: true) if at least one of these is true:
(a) the problem wasn't obvious — it required real investigation,
(b) it cost real time (>10 min of debugging/research),
(c) it's a decision another AI would repeat without this context,
(d) it's a recurring pattern in the project.

NOT worth keeping: trivial fixes, typos, obvious language/framework behavior, requirement lists for features already implemented.

About suggested_priority (1-5):
1 = critical, should always appear in guardrails
2 = very important, project-specific
3 = useful but not urgent (default)
4 = relatively low value
5 = almost no value, can be ignored in ranking

If suggested_kind is 'rule' or 'pitfall', generate a directive: one imperative sentence, max 15 words, summarizing the action to take.
If it's 'solution' or 'decision', directive should be null.

Respond in ${responseLanguage()} in the reasoning field, even if the input is in a different language or mixed.

Respond ONLY with valid JSON, no markdown, no text before or after:
{"worth_keeping": bool, "suggested_priority": 1-5, "suggested_kind": "solution|rule|pitfall|decision", "directive": "..." | null, "reasoning": "one sentence"}`;
}

function isValidResult(obj: unknown): obj is ClassificationResult {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.worth_keeping === 'boolean' &&
    typeof r.suggested_priority === 'number' &&
    r.suggested_priority >= 1 && r.suggested_priority <= 5 &&
    ['solution', 'rule', 'pitfall', 'decision'].includes(r.suggested_kind as string) &&
    (r.directive === null || typeof r.directive === 'string') &&
    typeof r.reasoning === 'string'
  );
}

// ── Session capture (auto-capture hook) ──────────────────────────────────────

export interface CaptureCandidate {
  title: string;
  content: string;
  problem: string;
  tags: string[];
  kind: 'solution' | 'rule' | 'pitfall' | 'decision';
  directive: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
}

function captureSystemPrompt(): string {
  return `You read a summary of a development session (user requests, assistant responses, files touched, commands run) and extract KNOWLEDGE ITEMS worth persisting in a technical memory base.

Value criteria per item — only extract if at least one of these is true:
(a) the problem wasn't obvious — it required real investigation,
(b) it cost real time (>10 min of debugging/research),
(c) it's a decision another AI would repeat without this context,
(d) it's a recurring pattern in the project.

DO NOT extract: small talk, questions answered without action, trivial fixes, exploration that led nowhere, what's already obvious in the code.

Extract AT MOST 3 items (usually 0 or 1). If nothing in the session is worth noting, return an empty list — that's the most common and correct result.

IMPORTANT: write title, content, problem, and directive in ${responseLanguage()}, even if the input summary is in a different language or mixed. The knowledge base is in ${responseLanguage()} — responses in a different language create duplicates that similarity search won't catch (different languages embed far apart even when describing the same fact).

For each item:
- title: one line summarizing what was solved/decided
- content: full description — problem, root cause, solution applied, alternatives considered
- problem: the original problem description in 1 sentence
- tags: 2-6 technologies/concepts involved
- kind: "solution" (one-off fix) | "rule" (best practice to always follow) | "pitfall" (anti-pattern to avoid) | "decision" (architectural decision)
- directive: if kind is "rule" or "pitfall", one imperative sentence (max 15 words); otherwise null
- priority: 1 (critical) to 5 (low value), 3 is the default

Respond ONLY with valid JSON, no markdown, no text before or after:
{"candidates": [{"title": "...", "content": "...", "problem": "...", "tags": ["..."], "kind": "...", "directive": "..." | null, "priority": 1-5}]}`;
}

function isValidCandidate(obj: unknown): obj is CaptureCandidate {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r.title === 'string' && r.title.length > 0 &&
    typeof r.content === 'string' && r.content.length > 0 &&
    typeof r.problem === 'string' &&
    Array.isArray(r.tags) && r.tags.every((t) => typeof t === 'string') &&
    ['solution', 'rule', 'pitfall', 'decision'].includes(r.kind as string) &&
    (r.directive === null || typeof r.directive === 'string') &&
    typeof r.priority === 'number' && r.priority >= 1 && r.priority <= 5
  );
}

function isValidCandidateList(obj: unknown): obj is { candidates: CaptureCandidate[] } {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  return Array.isArray(r.candidates) && r.candidates.every(isValidCandidate);
}

/**
 * Calls Ollama Cloud with automatic model fallback: tries OLLAMA_CLOUD_MODEL first,
 * then each model in OLLAMA_FALLBACK_MODELS (comma-separated) in order, moving to
 * the next on ANY failure — HTTP error, network error/timeout, malformed JSON, or
 * a response that fails `isValid`. A malformed-but-200-OK response is treated the
 * same as an outage: that model just isn't usable for this call, try the next one.
 *
 * Returns null (never throws) if every model in the list fails. Callers decide the
 * fallback-of-last-resort (pending_review status / empty candidate list).
 */
async function callOllamaCloudWithFallback<T>(
  systemPrompt: string,
  userContent: string,
  isValid: (obj: unknown) => obj is T,
  logLabel: string,
): Promise<T | null> {
  if (process.env.CLASSIFIER_ENABLED === 'false') return null;

  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    process.stderr.write(`[classifier] OLLAMA_API_KEY not set — skipping ${logLabel}\n`);
    return null;
  }

  const primary = process.env.OLLAMA_CLOUD_MODEL ?? 'gpt-oss:20b-cloud';
  const fallbacks = (process.env.OLLAMA_FALLBACK_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== primary);
  const modelsToTry = [primary, ...fallbacks];

  const timeoutMs = parseInt(process.env.CLASSIFIER_TIMEOUT_MS ?? '60000', 10);

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const isFallbackAttempt = i > 0;

    try {
      const res = await fetch('https://ollama.com/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        process.stderr.write(`[classifier] HTTP ${res.status} from ${model} (${logLabel})\n`);
        continue;
      }

      const body = await res.json() as { message?: { content?: string } };
      const raw = body?.message?.content?.trim() ?? '';
      // Strip accidental markdown fences
      const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      const parsed = JSON.parse(json) as unknown;

      if (!isValid(parsed)) {
        process.stderr.write(`[classifier] unexpected ${logLabel} response shape from ${model}: ${json.slice(0, 200)}\n`);
        continue;
      }

      if (isFallbackAttempt) {
        process.stderr.write(`[classifier] ${logLabel}: primary model "${primary}" failed — used fallback "${model}"\n`);
      }
      return parsed;
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err);
      process.stderr.write(`[classifier] ${model} failed (${name}) for ${logLabel}\n`);
      continue;
    }
  }

  if (modelsToTry.length > 1) {
    process.stderr.write(`[classifier] ${logLabel}: all models failed (tried: ${modelsToTry.join(', ')})\n`);
  }
  return null;
}

/**
 * Summarize a dev session digest into 0-N knowledge candidates worth persisting.
 * Returns [] on any failure (timeout, quota, bad JSON) or when nothing qualifies —
 * never throws. Used by the SessionEnd auto-capture hook.
 */
export async function summarizeSessionForCapture(digest: string): Promise<CaptureCandidate[]> {
  const result = await callOllamaCloudWithFallback(captureSystemPrompt(), digest, isValidCandidateList, 'session capture');
  return result?.candidates ?? [];
}

/**
 * Classify a knowledge entry using the Ollama Cloud model.
 * Returns null on any failure (timeout, quota, bad JSON) — never throws.
 * Callers decide the fallback (pending_review status).
 */
export async function classifyKnowledge(input: {
  title: string;
  content: string;
  problem?: string;
  tags: string[];
}): Promise<ClassificationResult | null> {
  return callOllamaCloudWithFallback(classifySystemPrompt(), JSON.stringify(input), isValidResult, 'classification');
}

// ── Consolidation (recurring solutions → one generalized rule/pitfall) ───────

export interface ConsolidationProposal {
  should_consolidate: boolean;
  /** null when should_consolidate is false (cluster turned out unrelated). */
  kind: 'rule' | 'pitfall' | null;
  title: string | null;
  /** Imperative directive (max ~15 words), fed to get_guidelines. */
  directive: string | null;
  content: string | null;
  /** true if the lesson applies beyond the project(s) these solutions came from. */
  is_global: boolean;
  reasoning: string;
}

function consolidateSystemPrompt(): string {
  return `You receive a group of 2+ "solution" items (one-off fixes) from a technical knowledge base that a semantic similarity system grouped together for being alike.

Your task: decide whether they REALLY represent the SAME recurring pattern — not just vaguely related topics — and, if so, synthesize ONE stronger, more generalized rule or anti-pattern (pitfall) that generalizes them, instead of keeping N loose solutions repeating the same lesson.

If the items aren't actually the same recurring lesson (a similarity false positive — e.g. same technology but different problems), return should_consolidate: false and the remaining fields null.

If you decide to consolidate:
- kind: "rule" (best practice to always follow) or "pitfall" (anti-pattern to avoid) — whichever fits the observed pattern best
- title: one line summarizing the generalized rule
- directive: ONE imperative sentence, max 15 words, actionable — feeds get_guidelines
- content: the full generalized lesson (don't just repeat one of the items — synthesize the common pattern between them, mentioning the concrete cases as examples)
- is_global: true if the lesson applies to any project/stack (e.g. a shell/Windows quirk, a generic tool), false if it's specific to the originating project(s)

Respond in ${responseLanguage()}.

Respond ONLY with valid JSON, no markdown, no text before or after:
{"should_consolidate": bool, "kind": "rule|pitfall" | null, "title": "..." | null, "directive": "..." | null, "content": "..." | null, "is_global": bool, "reasoning": "one sentence"}`;
}

function isValidConsolidation(obj: unknown): obj is ConsolidationProposal {
  if (!obj || typeof obj !== 'object') return false;
  const r = obj as Record<string, unknown>;
  if (typeof r.should_consolidate !== 'boolean' || typeof r.reasoning !== 'string') return false;
  if (!r.should_consolidate) return true; // other fields are expected null, not worth strict-checking
  return (
    ['rule', 'pitfall'].includes(r.kind as string) &&
    typeof r.title === 'string' && r.title.length > 0 &&
    typeof r.directive === 'string' && r.directive.length > 0 &&
    typeof r.content === 'string' && r.content.length > 0 &&
    typeof r.is_global === 'boolean'
  );
}

/**
 * Given a cluster of semantically-similar "solution" items, ask the model whether
 * they're really the same recurring pattern and, if so, synthesize one generalized
 * rule/pitfall. Returns null on any failure — never throws. Used by scripts/consolidate.ts.
 */
export async function synthesizeConsolidation(
  items: { title: string; content: string; directive: string | null; project: string }[],
): Promise<ConsolidationProposal | null> {
  return callOllamaCloudWithFallback(
    consolidateSystemPrompt(),
    JSON.stringify(items),
    isValidConsolidation,
    'consolidation',
  );
}
