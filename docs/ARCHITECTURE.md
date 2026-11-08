# Architecture

```text
Browser (React, Vite dev :5173 / built UI :5174)
        │  fetch /api/*  (localhost only)
        ▼
Express API (server/index.ts, :5174)
        ├── lib/opencode.ts    → spawns `opencode api …` CLI
        │                        (reuses the user's service, auth, providers)
        ├── lib/skill.ts       → pure validation, token estimates, templates
        ├── lib/docsScan.ts    → doc-placement classification rules
        └── lib/install.ts     → install w/ backup, ZIP writer, move + undo
```

## Why the CLI wrapper (not a provider SDK)

Calling `opencode api get /api/model` etc. means:

- zero credentials stored or handled by SkillForge;
- whatever the user connected (OpenAI, xAI, Google, local…) just works;
- the same background service the TUI uses, so skill lists are truthful.

Generation uses `POST /api/experimental/generate/text` — a stateless
one-shot. The drafting model gets a prompt only: no tools, no filesystem,
no session. The reply is coerced and validated *before* anything is
written to disk.

## Install flow

```text
draft → validate (blocking errors stop here)
      → check target (SKILL.md exists? → require explicit replace)
      → backup existing folder (timestamped)
      → write files (path-checked inside the skill dir)
      → verify: GET /api/skill contains the ID
```

Global skills land in `~/.config/opencode/skills/<id>/SKILL.md`; project
skills in `<project>/.opencode/skills/<id>/SKILL.md`. Both are
auto-discovered by OpenCode — no config edits, no restarts.

## Docs tidy flow

`scanDocs` walks a root ignoring `node_modules`, `.git`, `dist`, hidden
dirs, and symlinks. `classifyPath` is a pure function (unit-tested) that
maps a relative path to a finding: stray root doc, doc-in-source, loose
binary doc, or misplaced doc — each with a proposed `docs/…` home, a
reason, and a confidence. `applyDocMoves` renames (never copies+deletes in
a way that loses data), collision-suffixes (`-2`), and writes the manifest
plus a `docs/README.md` index. `undoDocMoves` reverses it in order.
