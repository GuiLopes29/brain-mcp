import '../env.js';

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'nomic-embed-text';

export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
  });

  if (!res.ok) {
    throw new Error(`Ollama embeddings error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

export async function warmUp(): Promise<void> {
  try {
    await getEmbedding('warm up');
    process.stderr.write('[embeddings] warm-up complete\n');
  } catch (err) {
    process.stderr.write(`[embeddings] warm-up failed: ${err}\n`);
  }
}
