# Usage

## First run

1. `cd opencode-skill-forge && npm install`
2. `npm run dev` — open http://127.0.0.1:5173
3. Step 1 checks your OpenCode. If it is not connected, connect a provider
   first (`opencode auth login`, or `/connect` inside OpenCode), then
   click **Re-check connection**.

## Fastest path: use a built-in template (no generation)

In **Step 3**, choose **Option B → “Start from a proven template”**. SkillForge
ships with **25 templates** (no AI generation, no API key required), including:

- onboarding: `codebase-exploration`, `write-agents-md`, `readme-starter`, `feature-plan`
- quality: `code-review`, `test-generator`, `bug-triage`, `security-audit`, `fix-build-errors`
- shipping: `pr-description`, `changelog`, `commit-writer`, `api-design`
- maintenance: `dependency-update`, `migration-plan`, `refactor-safely`, `context-compaction`

Pick one, review/edit in **Step 4**, then install. This is the best path when a
provider key is missing/expired or you just want a solid starting point.

## Example: build a "PR reviewer" skill

1. **Step 2** — Global (you will reuse this everywhere).
2. **Step 3** — goal: *"Review pull requests for security issues and missing
   tests. Output findings as file:line with severity and a one-line fix, then
   an approve/request-changes verdict."* Length: Lean. Generate.
3. **Step 4** — read the checks. A good draft shows:
   - description under 200 chars starting with the action ("Review… Use when…")
   - total ~100–200 tokens
   - no errors. Fix any ⛔ item before installing.
4. Click **Install into OpenCode (global)**. Success means OpenCode already
   lists the skill — verify with `opencode api get /api/skill`.
5. Try it in OpenCode: type `@pr-reviewer` in a prompt, or just ask
   "review this PR" and watch the model load the skill by itself.

## Example: tidy a messy project

1. **Step 5** — set the folder to the project, click **Scan folder**.
2. Review the table. High-confidence rows ("stray root doc", "doc in
   source") are pre-selected; medium-confidence rows need your judgment.
3. Click **Apply**. Files move into `docs/`, a manifest lands in
   `docs/.skillforge-manifest-….json`, done. Nothing is deleted.
4. Changed your mind? Paste the manifest path into **Undo** and click
   **Restore files**.

Scanning `/home/minima/Documents/Projects` is a good demo: it finds loose
files sitting next to the projects (markdown notes, PDFs, DOCXs) and
proposes `docs/archive/` homes for them — inside whatever root you choose.

## Token + cross-model cheat-sheet (GPT, Grok, Gemini)

| Part | When it costs | Keep it |
| --- | --- | --- |
| Description | every single step | ≤200 chars, action + `Use when…` trigger |
| SKILL.md body | only when invoked | ≤350 words (Lean), 3–7 numbered steps + Rules |
| `references/*` | only when read | long detail, code samples, checklists |

Clear, explicit steps work best across different models and reduce retries. The
app shows live token estimates and cross-model hints as you edit.

## Providers

SkillForge adds no provider of its own. Any model OpenCode can list
(GPT, Grok, Gemini, Claude, local models) can be picked in Step 1. The
generated SKILL.md is plain Markdown + YAML frontmatter — the format
OpenCode discovers — so nothing is locked to one vendor.
