import '../env.js';
import { ChromaClient, Collection } from 'chromadb';

const CHROMA_URL = process.env.CHROMA_URL ?? 'http://localhost:8000';
const CHROMA_COLLECTION = process.env.CHROMA_COLLECTION ?? 'brain_knowledge';

let client: ChromaClient | null = null;
let collection: Collection | null = null;

async function getCollection(): Promise<Collection> {
  if (collection) return collection;

  client = new ChromaClient({ path: CHROMA_URL });
  collection = await client.getOrCreateCollection({
    name: CHROMA_COLLECTION,
    metadata: { 'hnsw:space': 'cosine' },
  });

  return collection;
}

function isStaleCollectionError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('ChromaNotFoundError') || msg.includes('could not be found');
}

/**
 * Run an operation against the collection; if the cached handle points to a
 * collection that no longer exists (e.g. the Chroma container was recreated
 * and `pnpm restore` rebuilt the collection under a new UUID), drop the cache
 * and retry ONCE with a fresh handle — otherwise a long-running API process
 * would need a manual restart to recover.
 */
async function withCollection<T>(op: (col: Collection) => Promise<T>): Promise<T> {
  const col = await getCollection();
  try {
    return await op(col);
  } catch (err) {
    if (!isStaleCollectionError(err)) throw err;
    process.stderr.write('[chroma] stale collection handle — refreshing and retrying\n');
    collection = null;
    const fresh = await getCollection();
    return op(fresh);
  }
}

export async function storeEmbedding(
  id: string,
  embedding: number[],
  metadata: Record<string, string | number | boolean>,
  document: string,
): Promise<void> {
  // upsert (not add): re-storing an existing id must overwrite, not throw —
  // restore.ts depends on this for idempotent embedding rebuilds.
  await withCollection((col) =>
    col.upsert({
      ids: [id],
      embeddings: [embedding],
      metadatas: [metadata],
      documents: [document],
    }),
  );
}

/** Which of these ids already have an embedding stored? (used by restore) */
export async function getExistingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const res = await withCollection((col) => col.get({ ids }));
  return new Set((res.ids as string[]) ?? []);
}

export async function queryEmbeddings(
  embedding: number[],
  limit: number,
  where?: Record<string, string>,
): Promise<{ ids: string[]; distances: number[] }> {
  const results = await withCollection((col) => {
    const params: Parameters<typeof col.query>[0] = {
      queryEmbeddings: [embedding],
      nResults: limit,
    };
    if (where && Object.keys(where).length > 0) {
      params.where = where as Record<string, string>;
    }
    return col.query(params);
  });

  const ids = (results.ids[0] as string[]) ?? [];
  const distances = (results.distances?.[0] as number[]) ?? [];

  return { ids, distances };
}

export async function deleteEmbedding(id: string): Promise<void> {
  await withCollection((col) => col.delete({ ids: [id] }));
}
