---
name: SkillForge
description: Generate and install new OpenCode skills with SkillForge. Use when asked to create a skill, skill factory, or tidy documentation.
---

## Workflow

1. Open SkillForge (`npm run dev` in the `opencode-skill-forge` folder, or `npm start` for the built app).
2. Step 1: confirm OpenCode is connected and pick the generation model.
3. Steps 2–3: choose global vs project location, then generate from a goal, a template, or blank.
4. Step 4: review the token meter and validation, then Install. Verify with `opencode api get /api/skill` or by typing `@<skill-id>` in OpenCode.
5. Step 5 (optional): scan any project for stray documentation and apply moves with the undo manifest.

## Rules

- Keep new skills lean: trigger-style description under 200 chars, numbered steps, `references/` for long detail.
- Never install over an existing skill without the backup/replace flow.
- Documentation belongs in `docs/`; root keeps README/AGENTS-style files only.
