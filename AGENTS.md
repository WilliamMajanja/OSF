# AGENTS.md — opencode-skill-forge

Instructions for any coding agent working in this repo.

## Layout

- `server/` — Express API (TypeScript/ESM). Core logic in `server/lib/`:
  `skill.ts` (pure validation/templates), `opencode.ts` (CLI wrapper),
  `docsScan.ts` (doc placement rules), `install.ts` (install/zip/move/undo).
- `src/` — React UI. `App.tsx` is the 5-step wizard; `api.ts` is the fetch
  client; `styles.css` is hand-rolled (no framework).
- `tests/` — `node:test` suites run via `tsx --test`. Keep pure helpers
  dependency-free so they stay testable.

## Rules

1. **Never store credentials.** SkillForge must only call the user's own
   `opencode` CLI. Do not add API key fields, env secrets, or provider SDKs.
2. **Never delete user files.** New file writes must be path-checked with
   `assertInside` (see `server/lib/install.ts`). Overwrites back up first;
   doc moves write a manifest and support undo.
3. **Keep generated skills token-cheap and model-neutral.** New templates must
   follow: short trigger description (≤200 chars), ≤7 numbered steps, plain
   language, no vendor-specific jargon, long detail in `references/`.
4. **Documentation placement.** Guides go in `docs/`; root keeps only
   `README.md`, `AGENTS.md`, `LICENSE`-style files. If you add a doc, add it
   to the `docs/README.md` index too.
5. **UI copy must be idiot-proof.** Plain language, state what happens on
   click, explain errors with the fix. No jargon without a one-line explainer.
6. After changes run `npm run typecheck` and `npm test`.
