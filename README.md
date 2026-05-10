# Mycel

**Local-first knowledge base with built-in semantic search.**

Mycel is a desktop note-taking app built on [Tauri 2](https://tauri.app) + Rust + React. It works out of the box — no plugins, no cloud accounts, no configuration. Your notes stay as plain Markdown files on your disk.

## Why Mycel?

- **Zero friction.** Open a folder, start writing. No setup wizard that takes 30 minutes.
- **Semantic search that actually works.** Ask in natural language, get ranked results by meaning — not just keyword matches.
- **Local AI, fully private.** Embeddings run via [Ollama](https://ollama.ai) on your machine. Nothing leaves your device.
- **Markdown as the source of truth.** Files are standard `.md` — open them in any editor, sync with Git, do whatever you want.
- **Native performance.** Tauri + Rust core means <1s cold start and no lag on vaults with 10 000+ notes.

## Features (MVP)

- File tree with create / rename / delete / drag-and-drop
- CodeMirror 6 editor with live Markdown preview and WikiLink support
- Quick switcher (`Cmd+O`) — fuzzy search over file names
- Full-text search (`Cmd+Shift+F`) — powered by [Tantivy](https://github.com/quickwit-oss/tantivy)
- **Semantic search** (`Cmd+K`) — vector search via [LanceDB](https://lancedb.github.io/lancedb/) + Ollama embeddings
- Graph view — visual map of WikiLink connections
- Backlinks panel
- Daily notes (`Cmd+D`)
- Light / dark theme (follows system)

## Stack

| Layer | Technology |
|---|---|
| Shell | Tauri 2.x |
| Backend | Rust |
| Frontend | React 18 + TypeScript |
| Editor | CodeMirror 6 |
| State | Zustand |
| Styling | Tailwind CSS + shadcn/ui |
| Full-text index | Tantivy |
| Vector DB | LanceDB |
| Embeddings | Ollama (`nomic-embed-text`) |
| Graph | Sigma.js |

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs) 1.70+
- [Node.js](https://nodejs.org) 18+
- Tauri system dependencies — see [Tauri docs](https://tauri.app/start/prerequisites/)
- [Ollama](https://ollama.ai) (optional, for semantic search)

### Run in development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

### Semantic search setup

Install Ollama and pull the embedding model:

```bash
ollama pull nomic-embed-text
```

Mycel will auto-detect Ollama at `http://localhost:11434`. If Ollama is not running, full-text search still works normally.

## Vault structure

Mycel uses any folder as a vault. It creates a `.mycel/` directory for its index — add it to `.gitignore`:

```
my-vault/
├── .mycel/          # Mycel index (add to .gitignore)
│   ├── config.json
│   ├── index/       # Tantivy index
│   └── vectors/     # LanceDB vectors
├── daily/
│   └── 2026-05-10.md
└── my-note.md
```

## Note format

Standard Markdown with YAML frontmatter:

```markdown
---
title: My note
tags: [ideas, ml]
---

# My note

Supports [[WikiLinks]], #tags, **bold**, `code`, and more.
```

## License

MIT
