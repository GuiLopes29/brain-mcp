# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-07-13

### Changed
- **Vector store**: ChromaDB (Docker) → `sqlite-vec`, embedded in the same SQLite file as the metadata. Removes the Docker Desktop dependency, which on Windows allocates up to 50% of the machine's RAM to its WSL2 VM by default.
- **Embeddings**: local Ollama (`nomic-embed-text` via `:11434`) → `@huggingface/transformers` (Transformers.js), running `nomic-embed-text-v1.5` in-process (ONNX). Now applies the model's recommended `search_document:`/`search_query:` instruction prefix, which the Ollama-based code never used.

### Result
Zero external services required to run the Brain — no Docker, no Ollama daemon. Ollama Cloud is unchanged, still used only for the optional quality classifier (a remote API call, not a local service).

## [1.0.0] — 2026-07-08

### Added
- Initial public release: MCP server (stdio) + HTTP bridge, semantic memory with hybrid search (vector + BM25), quality classifier (Ollama Cloud), guardrails with Ebbinghaus decay, auto-capture via hooks (Claude Code + Cursor), React UI with a neural graph, automatic backup/restore.
