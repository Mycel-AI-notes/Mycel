# Contributing to Mycel

Thanks for your interest in contributing! Mycel is a local-first knowledge base, and we welcome contributions of all kinds — bug reports, feature ideas, documentation, and code.

This document explains how to set up a development environment, the conventions we follow, and how to submit changes.

## Table of contents

- [Contributing to Mycel](#contributing-to-mycel)
  - [Table of contents](#table-of-contents)
  - [Code of Conduct](#code-of-conduct)
  - [Ways to contribute](#ways-to-contribute)
  - [Development setup](#development-setup)
    - [Prerequisites](#prerequisites)
    - [Get the code](#get-the-code)
    - [Run the app](#run-the-app)
    - [Build a release binary](#build-a-release-binary)
    - [Optional: semantic search](#optional-semantic-search)
  - [Project layout](#project-layout)
  - [Running locally](#running-locally)
  - [Coding conventions](#coding-conventions)
    - [TypeScript / React](#typescript--react)
    - [Rust](#rust)
    - [Tests](#tests)
  - [Commit messages](#commit-messages)
  - [Pull requests](#pull-requests)
  - [Reporting bugs](#reporting-bugs)
  - [Proposing features](#proposing-features)

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold its terms. Report unacceptable behavior to the maintainers via a GitHub issue or direct contact.

## Contributor License Agreement (CLA)

Before we can merge your first pull request, we ask you to sign the [**Mycel CLA**](../CLA.md). It is short, modelled on the Apache ICLA 2.0, and exists so the Project stays legally clean for everyone — including future open-source releases and any commercial editions.

There are two equivalent ways to sign:

1. **CLA Assistant bot (preferred).** On your first PR the bot posts a comment with a sign-in link. One click, one signature, covers all your future contributions.
2. **Manual statement.** Comment on your PR with `I have read the Mycel CLA v1.0 and I agree to it. — (Your Name, @handle)`.

You retain full copyright in your contribution — the CLA is a license, not an assignment. Read [`CLA.md`](../CLA.md) for the full text.

## Ways to contribute

- **Report a bug** — open an issue using the bug-report template.
- **Suggest a feature** — open an issue using the feature-request template, or start a discussion first if the idea is large.
- **Improve documentation** — typos, clarifications, and new examples in `README.md` or this file are always welcome.
- **Fix a bug or build a feature** — look for issues labelled `good first issue` or `help wanted`.

If you plan a non-trivial change, please open an issue first so we can agree on the approach before you spend time on it.

## Development setup

### Prerequisites

- [Rust](https://rustup.rs) 1.70+
- [Node.js](https://nodejs.org) 18+
- Tauri system dependencies — see the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
- [Ollama](https://ollama.ai) (optional, only required to work on semantic search).

### Get the code

```bash
git clone https://github.com/<your-username>/mycel.git
cd mycel
npm install
```

### Run the app

```bash
npm run tauri dev
```

The first build takes several minutes while Cargo compiles dependencies. Subsequent runs are incremental and much faster.

### Build a release binary

```bash
npm run tauri build
```

### Optional: semantic search

```bash
ollama pull nomic-embed-text
ollama serve
```

Mycel auto-detects Ollama at `http://localhost:11434`. If it is not running, full-text search still works.

## Project layout

```
mycel/
├── src/                 # React + TypeScript frontend
│   ├── components/      # UI components
│   ├── hooks/           # React hooks
│   ├── stores/          # Zustand stores
│   └── types/           # Shared TS types
├── src-tauri/           # Rust backend (Tauri commands, indexing, vectors)
│   └── src/
├── public/              # Static assets
└── package.json
```

## Running locally

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server only (no Tauri shell) — useful for quick UI work. |
| `npm run tauri dev` | Full app with the Rust backend. |
| `npm run build` | Type-check and build the frontend. |
| `npm run tauri build` | Produce a release binary for your platform. |
| `npm run lint` | Run ESLint on `src/`. |
| `cargo test` | Run Rust tests (run from `src-tauri/`). |
| `cargo fmt` | Format Rust code. |
| `cargo clippy` | Lint Rust code. |

Please make sure `npm run lint`, `cargo fmt --check`, and `cargo clippy` pass before opening a PR.

## Coding conventions

### TypeScript / React

- TypeScript strict mode — no `any` unless there is no alternative; document why if you must.
- Function components with hooks; prefer named exports.
- Keep components small and focused; lift shared state into a Zustand store.
- Use Tailwind utility classes for styling; reach for `cn()` (clsx + tailwind-merge) when composing.
- Run ESLint before pushing.

### Rust

- Format with `cargo fmt`.
- Lint with `cargo clippy --all-targets -- -D warnings`.
- Prefer `Result<T, E>` over panics in code paths reachable from user actions.
- Tauri commands live alongside their feature module and should validate input.

### Tests

- Add unit tests for new pure functions and Rust modules.
- Add integration tests for new Tauri commands when feasible.

## Commit messages

We loosely follow [Conventional Commits](https://www.conventionalcommits.org/). The prefix tells reviewers (and the changelog) what the change is:

```
<type>(<optional scope>): <short summary>
```

Common types:

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only
- `refactor` — a code change that neither fixes a bug nor adds a feature
- `perf` — a performance improvement
- `test` — adding or fixing tests
- `chore` — tooling, dependencies, build config

Examples:

```
feat(search): add semantic ranking via LanceDB
fix(editor): preserve cursor position after autosave
docs: clarify Ollama setup in README
```

Keep the subject under 72 characters and write it in the imperative mood ("add", not "added"). Use the body to explain *why* the change is needed when it is not obvious from the diff.

## Pull requests

1. Fork the repo and create a topic branch from `main`:
   ```bash
   git checkout -b feat/my-change
   ```
2. Make your changes in small, logical commits.
3. Run the checks:
   ```bash
   npm run lint
   npm run build
   cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
   ```
4. Push your branch and open a pull request against `main`.
5. Fill in the PR template — link any related issues and describe how you tested.
6. Be ready to iterate on review feedback. Squash fixup commits before merge if asked.

PRs should be focused: one feature or fix per PR. Unrelated cleanups are easier to review separately.

## Reporting bugs

Before opening a bug report, search existing issues to avoid duplicates. A good report includes:

- Mycel version (or commit SHA if running from source)
- OS and version
- Whether Ollama is running, and which embedding model
- Steps to reproduce
- Expected vs. actual behavior
- Logs from the dev console (Cmd/Ctrl+Shift+I) and the terminal running `tauri dev`

Use the **Bug report** issue template — it has fields for all of the above.

## Proposing features

Open an issue with the **Feature request** template and describe:

- The problem you are trying to solve (not just the proposed solution)
- Who benefits and in what scenarios
- Alternatives you considered
- Any rough sketches, mockups, or API ideas

For large features, expect a design discussion before implementation starts.

---

Thanks again for helping make Mycel better!
