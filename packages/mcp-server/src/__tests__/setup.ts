// Use an in-memory SQLite for all tests — no file I/O, resets per process (pool: 'forks').
process.env.SQLITE_PATH = ':memory:';
