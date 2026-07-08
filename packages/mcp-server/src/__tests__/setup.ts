// Use an in-memory SQLite for all tests — no file I/O, resets per process (pool: 'forks').
process.env.SQLITE_PATH = ':memory:';
// Point at non-existent services so any accidental ChromaDB/Ollama call fails fast.
process.env.CHROMA_URL = 'http://127.0.0.1:1';
process.env.OLLAMA_URL = 'http://127.0.0.1:1';
