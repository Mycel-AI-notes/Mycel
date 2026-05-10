<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Mycel" width="128" height="128">
</p>

<h1 align="center">Mycel</h1>

<p align="center"><strong>Local-first Markdown knowledge base.</strong></p>

<!-- Screenshots go here -->
<!--
<p align="center">
  <img src="docs/screenshots/editor.png" alt="Mycel editor" width="800">
</p>
-->


Mycel is a desktop note-taking app built on [Tauri 2](https://tauri.app) + Rust + React. Open any folder, start writing — your notes stay as plain `.md` files on disk, no cloud account required.



> Status: early MVP (v0.1). The editor, file tree, tabs, wikilinks, daily notes and inline databases work today. The bigger items in the roadmap below — proactive AI, sync, the spore graph, image embeds — are still in progress.

## Features today

- **Vault picker with recents.** Pick any folder once; Mycel auto-opens it on next launch and keeps a list of recent vaults you can switch between.
- **File tree.**
  - Create / rename / delete files and folders, nested inside other folders.
  - Drag-and-drop to move files or folders between folders (or back to the vault root).
  - Resizable sidebar — drag the right edge, double-click to reset.
- **Editor.** CodeMirror 6 with Markdown syntax, headings, inline preview decorations, code fences with language highlighting, autocomplete.
- **Wikilinks.** `[[Like this]]` autocomplete + click-to-navigate. Missing targets are created on click.
- **Tabs.**
  - Single-click a file → opens as a *preview* tab (italic). Switching files replaces the preview, so you don't accumulate junk tabs.
  - Save (`Cmd/Ctrl+S`) or double-click the tab → pins it.
- **Quick switcher.** `Cmd/Ctrl+O` — fuzzy search across note titles and paths.
- **Daily notes.** `Cmd/Ctrl+D` — open or create `daily/YYYY-MM-DD.md`.
- **Backlinks panel.** Right-side panel shows what links to the current note.
- **Inline databases.** Notion-style fenced `mycel-db` blocks render tables with typed columns (text, number, date, select, multi-select, checkbox, page link…).
- **Themes.** Light / dark, follows system by default.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+O` | Quick switcher |
| `Cmd/Ctrl+D` | Open today's daily note |
| `Cmd/Ctrl+S` | Save current note (also pins a preview tab) |
| Double-click tab | Pin a preview tab |
| Double-click sidebar resize handle | Reset sidebar width |

## Stack

| Layer | Technology |
|---|---|
| Shell | Tauri 2 |
| Backend | Rust |
| Frontend | React 18 + TypeScript + Vite |
| Editor | CodeMirror 6 |
| State | Zustand (with `persist` for UI prefs & recent vaults) |
| Styling | Tailwind CSS |
| Icons | lucide-react |
| Markdown | pulldown-cmark, gray\_matter (frontmatter) |

## Getting started

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 18+ and npm
- Tauri system dependencies for your OS — see [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Xcode CLT on macOS, build-essential + webkit2gtk on Linux, MSVC + WebView2 on Windows)

### Run in development

```bash
git clone https://github.com/Mycel-AI-notes/Mycel.git
cd Mycel
npm install
npm run tauri dev
```

The first launch shows the vault picker — choose any folder. Mycel will use it as a vault and remember it for next time.

### Build a release binary

```bash
npm run tauri build
```

Bundles end up under `src-tauri/target/release/bundle/` (`.app`, `.dmg`, `.deb`, `.AppImage`, `.msi`, depending on your OS).

### Frontend-only dev (no Tauri)

If you just want to hack on the UI without the Rust shell:

```bash
npm run dev   # Vite on http://localhost:1420
```

File-system commands (`note_read`, `vault_open`, …) won't be available — the vault picker will fail because they need the Tauri runtime.

## How to use it

1. **Pick a vault.** Any folder works. Mycel doesn't move or rename your files; everything stays as plain `.md`.
2. **Create notes.** Use the `+` icons in the sidebar header (root) or hover a folder row to create inside it. Files are stored as `name.md`.
3. **Link notes.** Type `[[` in the editor to autocomplete. Click a rendered wikilink to follow it. If the target doesn't exist, Mycel creates it.
4. **Find notes.** `Cmd/Ctrl+O` for the fuzzy switcher.
5. **Daily journal.** `Cmd/Ctrl+D` opens `daily/YYYY-MM-DD.md`, creating it if needed.
6. **Switch vaults.** The folder icon in the toolbar (top-right) takes you back to the picker. Recent vaults are listed there.

## Vault layout

```
my-vault/
├── .mycel/              # Mycel's working files (add to .gitignore)
│   └── ...
├── daily/
│   └── 2026-05-10.md
├── projects/
│   └── garden.md
└── inbox.md
```

The `.mycel/` folder is reserved for app metadata. Add it to `.gitignore` if you're syncing the vault with Git.

### Note format

Plain Markdown, optional YAML frontmatter:

````markdown
---
title: My note
tags: [ideas, ml]
---

# My note

Supports [[WikiLinks]], #tags, **bold**, `code`, and fenced databases.

```mycel-db
view: table
source: inline
columns:
  - { id: name, name: Name, type: text }
  - { id: done, name: Done, type: checkbox }
rows:
  - { name: Sketch idea, done: true }
  - { name: Wire backend, done: false }
```
````

## Roadmap

Not built yet — what's coming, roughly in priority order:

- **Image support.** Drag-and-drop / paste images into a note. Images stored next to the note (or in a configurable `attachments/` folder) and rendered inline.
- **Spore graph.** Force-directed graph view of notes connected by wikilinks (the "mycelium" the name nods to). Hover a node to preview, click to jump.
- **Tags system.** A first-class tags panel: navigate by tag, show tag counts, autocomplete `#tags` in the editor, filter inline-database views by tag.
- **Proactive AI.** A local assistant that watches what you're writing and surfaces related notes, suggests links, drafts daily-note summaries, and answers questions grounded in your vault. Runs against a local LLM by default.
- **Sync.** Optional end-to-end-encrypted sync between devices, on top of the plain-Markdown files (so Git / iCloud / Syncthing keep working too).
- **New themes.** Beyond the two built-in palettes — a small theme picker with community-contributable themes.

If any of these are blocking you, open an issue and say so — that's the best signal for what to do next.

## Project structure

```
.
├── src/                       # React frontend
│   ├── components/            # UI components (sidebar, editor, database, …)
│   ├── stores/                # Zustand stores (vault, ui, recentVaults)
│   ├── hooks/                 # React hooks
│   └── lib/                   # Editor / database helpers
├── src-tauri/                 # Rust shell
│   ├── src/commands/          # Tauri commands exposed to the frontend
│   └── src/core/              # Vault, parser, file watcher
└── package.json
```

## License

MIT — see [`LICENSE`](./LICENSE).
