# SkillForge — OpenCode Skill Studio (OSF)

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-3c873a?logo=node.js&logoColor=white)](https://nodejs.org/)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2-111827)](https://opencode.ai/)
[![Local-first](https://img.shields.io/badge/local--first-127.0.0.1%20only-2563eb)](docs/SAFETY.md)
[![No API keys stored](https://img.shields.io/badge/secrets-none%20stored-16a34a)](docs/SAFETY.md)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](LICENSE)

**SkillForge** is a local web studio for picking, customizing, validating, installing, and tidying reusable [OpenCode](https://opencode.ai/) skills. It uses the **OpenCode already installed on your machine** (your providers, your sign-ins) — **no API keys stored here**, no extra provider SDKs.

> **Templates-first for now:** AI generation is turned off. Choose from 25 built-in templates (no API key needed), edit in the browser, validate, and install.

> Build skills that work across GPT, Grok, Gemini, Claude, and local models: plain Markdown + YAML frontmatter, short trigger descriptions, lean numbered workflows, and detail in `references/` only when needed.

## Why users love it

- **25 built-in templates, no generation required** — pick a proven skill in Step 3 and install it without an API key or model call.
- **One-click install into OpenCode** — writes to the folders OpenCode auto-discovers (global or per-project), with backup and verification.
- **Token-smart by design** — live token estimates, lean mode, and cross-model guidance so skills load fast and invoke reliably.
- **Safe by default** — localhost only, no deletes, path-checked writes, backups before overwrite, doc-move manifests + undo.
- **Docs Tidy** — finds stray docs and moves them into `docs/` with a reversible manifest. Nothing is ever deleted.

## Built-in templates (25)

Start from **Step 3 → Option B** — no AI generation, no key required.

| Area | Templates |
| --- | --- |
| **Onboard & plan** | `codebase-exploration`, `feature-plan`, `readme-starter`, `write-agents-md`, `context-compaction` |
| **Build & ship** | `api-design`, `api-integration`, `pr-description`, `changelog`, `commit-writer` |
| **Quality & safety** | `code-review`, `test-generator`, `bug-triage`, `security-audit`, `performance-review`, `accessibility-review`, `refactor-safely` |
| **Fix & maintain** | `fix-build-errors`, `git-conflict-help`, `dependency-update`, `migration-plan`, `regex-helper` |
| **Docs & knowledge** | `explain-code`, `write-documentation`, `docs-tidy` |

## Quick start

```sh
git clone https://github.com/WilliamMajanja/OSF.git opencode-skill-forge
cd opencode-skill-forge
npm install
npm run dev        # UI: http://127.0.0.1:5173 · API: http://127.0.0.1:5174
```

Production build:

```sh
npm run build
npm start          # serves the built UI + API on http://127.0.0.1:5174
```

## How it works (5 steps)

1. **Connect** — checks `opencode --version` and the live OpenCode service, lists your models and registered skills.
2. **Choose location** — **Global** (`~/.config/opencode/skills/`, every project) or **Project** (`.opencode/skills/`, that project only).
3. **Create** — pick a **built-in template** (no AI generation, no API key needed) or start blank and write your own.
4. **Review & install** — live validation, token-cost meter, ZIP export, then install with backup and OpenCode-side verification.
5. **Tidy documentation** — scan for docs in the wrong place and move them into `docs/` with a manifest and one-click undo.

## Token + cross-model strategy

| Part | When it costs | Keep it |
| --- | --- | --- |
| **Description** | every step | ≤200 chars, action + `Use when…` trigger |
| **`SKILL.md` body** | only when invoked | lean, 3–7 numbered steps + Rules |
| **`references/*`** | only when read | long detail, samples, checklists |

Clear, explicit, model-neutral instructions reduce retries across providers.

## Safety guarantees

- Binds **`127.0.0.1` only** — not reachable from your network.
- **No secrets stored** — model calls go through your local `opencode` CLI.
- **Never deletes files** — overwrites create timestamped backups; doc moves create a manifest and can be undone.
- **Path-checked writes** — drafts cannot escape the chosen target folder.
- **Validation gates** — bad IDs, placeholders, and suspected secrets block install with plain-language fixes.

Read more: [docs/SAFETY.md](docs/SAFETY.md)

## Documentation

- [docs/USAGE.md](docs/USAGE.md) — end-to-end walkthrough and examples
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the UI, API, and OpenCode connect
- [docs/SAFETY.md](docs/SAFETY.md) — guarantees and limits

## Project layout

```text
opencode-skill-forge/
├── README.md                  ← you are here
├── AGENTS.md                  ← instructions for coding agents
├── LICENSE                    ← MIT
├── opencode.jsonc             ← OpenCode config for this project
├── docs/                      ← guides (USAGE, ARCHITECTURE, SAFETY)
├── server/                    ← Express API + skill/docs/install logic
├── src/                       ← React UI (5-step wizard)
├── tests/                     ← unit tests (node:test via tsx)
└── .opencode/skills/          ← dogfood skills for this repo
```

## Requirements

- **Node.js ≥ 22**
- **OpenCode v2** installed and connected to at least one provider
  (`opencode auth login`, or `/connect` inside OpenCode)

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | UI + API with hot reload |
| `npm run build` | Production UI build |
| `npm start` | Serve the production build |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Unit tests (validation, scanning, zip, templates) |

## Contributing

Changes should keep skills **token-cheap, model-neutral, and safe**. After edits, run:

```sh
npm run typecheck && npm test
```

See [AGENTS.md](AGENTS.md) for coding-agent/project rules.

## License

[The Unlicense](LICENSE) — public domain.
