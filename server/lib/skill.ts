// Pure helpers: skill IDs, token estimates, validation, templates.
// Kept dependency-free so they can be unit-tested with plain Node.

export const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  files: SkillFile[];
  source: "ai" | "template" | "manual";
}

export interface ValidationIssue {
  level: "error" | "warn" | "info";
  message: string;
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return base || "new-skill";
}

/** Rough, model-neutral token estimate (OpenAI/Grok/Gemini all sit near 4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Count numbered list steps (1. 2. …) in markdown. */
export function countNumberedSteps(text: string): number {
  return (text.match(/^\s*\d+\.\s+\S/gm) ?? []).length;
}

/** True when description gives models a clear invocation trigger. */
export function hasTriggerPhrase(description: string): boolean {
  return /\b(use when|when asked|when you need|if asked|for requests? to|invoke when)\b/i.test(
    description,
  );
}

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { frontmatter: fm, body: match[2] ?? "" };
}

export function buildSkillMarkdown(draft: SkillDraft): string {
  const skill = draft.files.find((f) => f.path === "SKILL.md");
  if (skill) return skill.content;
  return `---\nname: ${draft.name}\ndescription: ${draft.description}\n---\n\n${draft.files.map((f) => f.content).join("\n\n")}`;
}

export function validateSkill(draft: SkillDraft): {
  valid: boolean;
  issues: ValidationIssue[];
  tokens: number;
  descriptionTokens: number;
  bodyTokens: number;
} {
  const issues: ValidationIssue[] = [];
  const markdown = buildSkillMarkdown(draft);
  const { frontmatter, body } = parseFrontmatter(markdown);
  const tokens = estimateTokens(markdown);
  const descriptionTokens = estimateTokens(draft.description);

  if (!ID_RE.test(draft.id)) {
    issues.push({
      level: "error",
      message: `Skill ID "${draft.id}" must be lowercase words joined by single hyphens (a-z, 0-9, -), e.g. "git-release".`,
    });
  }
  if (!draft.name.trim()) issues.push({ level: "error", message: "Display name is empty." });
  if (!draft.description.trim()) {
    issues.push({ level: "error", message: "Description is empty — OpenCode uses it to decide when to load the skill." });
  } else if (draft.description.length < 20) {
    issues.push({ level: "warn", message: "Description is very short — say what triggers it, so any model (GPT, Grok, Gemini…) picks it correctly." });
  } else if (draft.description.length > 200) {
    issues.push({
      level: "warn",
      message: `Description is ${draft.description.length} chars. It is sent to the model on every step — keep it under ~200 chars to save tokens.`,
    });
  } else if (!hasTriggerPhrase(draft.description)) {
    issues.push({
      level: "warn",
      message: 'Description has no clear trigger (e.g. "Use when…"). Adding a trigger helps GPT, Grok, and Gemini invoke the skill at the right time.',
    });
  }
  if (frontmatter.description && frontmatter.description !== draft.description) {
    issues.push({
      level: "info",
      message: "Frontmatter description differs from the skill description field. Keep them identical so models see the same trigger.",
    });
  }
  if (!frontmatter.name && !frontmatter.description) {
    issues.push({ level: "warn", message: "No YAML frontmatter found. It is optional, but a clear description helps discovery." });
  }
  if (!/^##\s+/m.test(body)) {
    issues.push({ level: "info", message: "No ## headings in the body. A few short sections help every model follow it without wasted tokens." });
  }
  const stepCount = countNumberedSteps(body);
  if (stepCount === 0 && body.trim().length > 40) {
    issues.push({
      level: "info",
      message: "No numbered steps found. Numbered steps (1., 2., 3.) are easy for GPT, Grok, and Gemini to follow with fewer tokens.",
    });
  } else if (stepCount > 10) {
    issues.push({
      level: "warn",
      message: `${stepCount} numbered steps — more than 10. Merge or move detail into references/ to keep token cost down.`,
    });
  }
  if (!/^##\s+(rules|guardrails|constraints|notes|types|format|checklist)\b/im.test(body) && body.trim().length > 120) {
    issues.push({
      level: "info",
      message: "No Rules/Guardrails section found. A short constraints list reduces mistakes across different models.",
    });
  }
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  if (words > 900) {
    issues.push({
      level: "warn",
      message: `Body is ~${words} words (~${estimateTokens(body)} tokens). Consider moving detail into references/ files that load only when needed.`,
    });
  }
  if (/lorem ipsum|\[TODO\]|FIXME/i.test(markdown)) {
    issues.push({ level: "error", message: "Contains placeholder text (lorem/TODO/FIXME). Replace it before installing." });
  }
  if (/(sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*['"][^'"]{8,}|password\s*[:=]\s*['"][^'"]{4,})/i.test(markdown)) {
    issues.push({ level: "error", message: "Looks like it contains a secret. Remove secrets before installing." });
  }
  if (draft.files.length > 12) {
    issues.push({ level: "warn", message: `${draft.files.length} files — more than 12. Keep the skill folder small and focused.` });
  }
  const valid = !issues.some((i) => i.level === "error");
  return { valid, issues, tokens, descriptionTokens, bodyTokens: estimateTokens(body) };
}

export const TEMPLATES: Array<Omit<SkillDraft, "source"> & { tagline: string }> = [
  {
    id: "code-review",
    name: "Code Review",
    description: "Review code changes for bugs, security issues, and missing tests. Use when asked to review or audit code.",
    tagline: "Catch bugs and missing tests before merge.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Code Review
description: Review code changes for bugs, security issues, and missing tests. Use when asked to review or audit code.
---

## Workflow

1. Read the diff first; do not skim. Note the intent of the change.
2. Check, in order: correctness bugs, security issues (injection, auth, secrets), error handling, then missing tests.
3. Verify claims by reading the code — never guess behavior.
4. Report findings as: file:line, severity (blocker/major/minor), one-line problem, one-line fix.
5. End with a verdict: approve, approve with comments, or request changes, plus the top 3 risks.

## Rules

- Prefer the smallest safe fix over rewrites.
- Do not praise style; flag only real defects.
- If you cannot verify something, say so explicitly.
`,
      },
    ],
  },
  {
    id: "test-generator",
    name: "Test Generator",
    description: "Write and run focused tests for changed code. Use when asked to add tests or improve coverage.",
    tagline: "Add fast, meaningful tests for new behavior.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Test Generator
description: Write and run focused tests for changed code. Use when asked to add tests or improve coverage.
---

## Workflow

1. Find the project's existing test setup and conventions. Copy them.
2. List the behaviors the change should guarantee. Test those, not implementation details.
3. Cover: happy path, the main failure path, and one edge case.
4. Run only the new/affected tests first, then the full suite if quick.
5. Report: tests added, results, and any behavior you could not cover.

## Rules

- One behavior per test. No duplicated setup — extract a helper.
- Tests must fail without the fix and pass with it.
- Never weaken an existing test to make it pass; report the conflict.
`,
      },
    ],
  },
  {
    id: "bug-triage",
    name: "Bug Triage",
    description: "Reproduce, isolate, and explain a bug with evidence. Use when asked to debug or investigate a failure.",
    tagline: "Reproduce first; fix with evidence.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Bug Triage
description: Reproduce, isolate, and explain a bug with evidence. Use when asked to debug or investigate a failure.
---

## Workflow

1. Restate the symptom and capture the exact error, input, and environment.
2. Reproduce it with the smallest possible case. If it does not reproduce, say what changed.
3. Bisect: vary one thing at a time (input, version, config) until it breaks.
4. State the root cause as a chain: input -> faulty step -> wrong output.
5. Propose the smallest fix, then a regression test that would have caught it.

## Rules

- Evidence over intuition: quote commands, outputs, and file:line.
- Do not patch symptoms. If the fix is unclear, stop and ask with your findings.
`,
      },
    ],
  },
  {
    id: "docs-tidy",
    name: "Docs Tidy",
    description: "Find documentation in wrong places and move it into a tidy docs/ folder. Use when asked to clean up docs or organize a repo.",
    tagline: "Put every doc where it belongs — no deletes.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Docs Tidy
description: Find documentation in wrong places and move it into a tidy docs/ folder. Use when asked to clean up docs or organize a repo.
---

## Workflow

1. Scan for *.md (and loose *.docx/*.pdf) outside docs/, .opencode/, and the repo root's recognized files.
2. Propose a destination for each file and the reason. Default: docs/<name>.md, or docs/archive/ for old reports.
3. Show the full plan and wait for approval. Never delete a file — move it.
4. Apply moves, write a manifest (docs/.skillforge-manifest-<date>.json), and add a short docs/README.md index.
5. Verify no links break: grep for the old path and fix references.

## Rules

- Skip node_modules, .git, dist, build, and hidden folders.
- Keep README.md / AGENTS.md at the repo root — they belong there.
- If two files would collide, keep both: prefix with the parent folder name.
`,
      },
    ],
  },
  {
    id: "commit-writer",
    name: "Commit Writer",
    description: "Write clear, conventional commit messages and summaries. Use when asked to commit or summarize changes.",
    tagline: "Commits a human can understand in 5 seconds.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Commit Writer
description: Write clear, conventional commit messages and summaries. Use when asked to commit or summarize changes.
---

## Workflow

1. Read the diff. One commit = one logical change. Split if it mixes concerns.
2. Write the subject as: type(scope): what changed (imperative, under 72 chars).
3. Add a body only when the why is not obvious: problem, fix, risk.
4. Never commit secrets, generated files, or unrelated drive-by edits.
5. Show the user the message and staged files before committing.

## Types

feat, fix, docs, refactor, test, chore. Pick the type that matches the change, not the largest one.
`,
      },
    ],
  },
  {
    id: "security-audit",
    name: "Security Audit",
    description: "Audit code for common vulnerabilities and unsafe patterns. Use when asked to check security or harden an app.",
    tagline: "Find injection, auth, and secret issues fast.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Security Audit
description: Audit code for common vulnerabilities and unsafe patterns. Use when asked to check security or harden an app.
---

## Workflow

1. Map the trust boundaries: user input, auth, external calls, file access, secrets.
2. Check each boundary: injection, broken access control, exposed secrets, unsafe deserialization, SSRF, path traversal.
3. For each finding: location, exploit scenario in one sentence, and the minimal fix.
4. Rank by exploitability, not by how scary the name sounds.
5. Do not attempt exploits beyond reading code and config.

## Rules

- Never print or copy secrets into reports — reference names only.
- Distinguish confirmed issues from "would be safer" hardening.
`,
      },
    ],
  },
  {
    id: "refactor-safely",
    name: "Refactor Safely",
    description: "Refactor code in small verifiable steps without changing behavior. Use when asked to clean up or improve code structure.",
    tagline: "Improve structure without breaking behavior.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Refactor Safely
description: Refactor code in small verifiable steps without changing behavior. Use when asked to clean up or improve code structure.
---

## Workflow

1. State the exact problem (duplication, coupling, dead code) with file:line evidence.
2. Run the existing tests first — record the baseline.
3. Change one thing at a time. Re-run tests after each step.
4. Keep public behavior and APIs identical unless the user approves a change.
5. Summarize: what moved, what stayed, test results.

## Rules

- If tests fail, stop and fix the refactor — do not "fix" the tests to match.
- No drive-by feature changes in a refactor step.
`,
      },
    ],
  },
  {
    id: "api-design",
    name: "API Design",
    description: "Design simple, consistent HTTP APIs and document them. Use when asked to create or change an API endpoint.",
    tagline: "Small, consistent APIs anyone can call.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: API Design
description: Design simple, consistent HTTP APIs and document them. Use when asked to create or change an API endpoint.
---

## Workflow

1. List the verbs the API must support and one example call per verb.
2. Choose consistent naming, status codes, and error shape before coding.
3. Add input validation at the boundary; reject bad input with a clear error.
4. Document: request, response, errors, and one runnable example.
5. Test the happy path and the main failure path.

## Rules

- Prefer boring, predictable conventions over clever ones.
- Version only when a breaking change is unavoidable.
- Never expose internal error details in responses.
`,
      },
    ],
  },
  {
    id: "pr-description",
    name: "PR Description",
    description: "Write a clear pull request title and description from code changes. Use when asked to open, draft, or summarize a PR.",
    tagline: "Explain the change, risk, and testing in one pass.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: PR Description
description: Write a clear pull request title and description from code changes. Use when asked to open, draft, or summarize a PR.
---

## Workflow

1. Read the full diff and recent commit messages. Identify the single goal of the change.
2. Write a short title (imperative, specific) and a summary: what changed and why.
3. List key changes as bullets, grouped by area. Call out behavior changes explicitly.
4. Add a "Testing" section: what you ran, and what reviewers should verify.
5. Note risks, migrations, screenshots, or follow-up work only when relevant.

## Rules

- Do not invent changes not present in the diff.
- Keep it scannable: bullets over paragraphs.
- Mention breaking changes and rollout steps first if they exist.
`,
      },
    ],
  },
  {
    id: "changelog",
    name: "Changelog",
    description: "Draft release notes or changelog entries from recent changes. Use when asked to write a changelog or release notes.",
    tagline: "Turn commits into user-facing release notes.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Changelog
description: Draft release notes or changelog entries from recent changes. Use when asked to write a changelog or release notes.
---

## Workflow

1. Gather the changes in scope (commits, merged PRs, or diff range). Ignore noise like merge commits.
2. Group entries by impact: Added, Changed, Fixed, Removed, Security (use only groups that apply).
3. Write each entry for the reader: what changed and who it affects, in plain language.
4. Add upgrade notes for breaking changes, config changes, or migrations.
5. Keep version/date placeholders explicit if the version is not provided.

## Rules

- Do not guess changes — base every entry on evidence in the diff or commits.
- Prefer user impact over internal refactor detail.
- Keep entries short; one line per change when possible.
`,
      },
    ],
  },
  {
    id: "explain-code",
    name: "Explain Code",
    description: "Explain how code works in clear, accurate terms. Use when asked to explain a file, function, or codebase behavior.",
    tagline: "Understand unfamiliar code without guessing.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Explain Code
description: Explain how code works in clear, accurate terms. Use when asked to explain a file, function, or codebase behavior.
---

## Workflow

1. Read the relevant code first (entry point, key functions, callers/callees as needed).
2. State the purpose in one sentence: what problem it solves.
3. Walk through the main flow step by step, naming important inputs, outputs, and side effects.
4. Point out important edge cases, assumptions, or failure modes you can verify in code.
5. If something is unclear, say what you checked and what remains unknown.

## Rules

- Ground every claim in code you read; cite file:line for key behavior.
- Match the user's level: simple language unless they ask for deep detail.
- Do not suggest refactors unless asked.
`,
      },
    ],
  },
  {
    id: "write-documentation",
    name: "Write Documentation",
    description: "Write or update clear documentation for code, features, or workflows. Use when asked to document or improve docs.",
    tagline: "Docs that help the next person succeed.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Write Documentation
description: Write or update clear documentation for code, features, or workflows. Use when asked to document or improve docs.
---

## Workflow

1. Identify the audience and task: who will read this, and what they need to do.
2. Read the code or current behavior so the docs match reality.
3. Structure the doc: purpose, prerequisites, steps or API details, and a small example.
4. Use concrete names, commands, and expected results. Keep paragraphs short.
5. Verify examples and paths against the repo; fix anything outdated.

## Rules

- Prefer accuracy over completeness; do not document guesses.
- Put one idea per section and use headings/bullets for scanning.
- Follow the project's existing doc style and placement rules.
`,
      },
    ],
  },
  {
    id: "performance-review",
    name: "Performance Review",
    description: "Find likely performance bottlenecks and suggest safe fixes. Use when asked to speed up code or review performance.",
    tagline: "Focus on measured or provable slow paths.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Performance Review
description: Find likely performance bottlenecks and suggest safe fixes. Use when asked to speed up code or review performance.
---

## Workflow

1. Identify the hot path: what runs often, on large input, or on the user-critical path.
2. Read the code for common issues: repeated work, N+1 queries/calls, unnecessary allocations, blocking I/O, missing indexes/caching hints.
3. For each issue, explain why it is costly and where (file:line). Estimate impact only when evidence supports it.
4. Propose the smallest safe fix and how to verify it (benchmark, profile, or before/after metric).
5. Separate confirmed bottlenecks from speculative optimizations.

## Rules

- Do not trade correctness or readability for tiny gains.
- Prefer measurement over intuition; say when profiling is needed.
- Avoid premature micro-optimizations outside the hot path.
`,
      },
    ],
  },
  {
    id: "dependency-update",
    name: "Dependency Update",
    description: "Plan safe dependency updates and assess risk. Use when asked to update, upgrade, or audit project dependencies.",
    tagline: "Upgrade dependencies with a clear risk plan.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Dependency Update
description: Plan safe dependency updates and assess risk. Use when asked to update, upgrade, or audit project dependencies.
---

## Workflow

1. Identify the package manager and current dependency files/lockfile. List what is outdated or requested.
2. Check release notes/changelogs for breaking changes, deprecations, and security fixes.
3. Group updates: low-risk patch/minor first, then major upgrades one at a time.
4. Propose the update steps, required code/config changes, and tests to run after each step.
5. Call out rollback steps if an update fails (lockfile revert, pinned version).

## Rules

- Never update blindly; prefer evidence from changelogs and compatibility notes.
- Keep unrelated dependency changes out of the same step.
- Do not weaken tests or ignore security advisories without stating the risk.
`,
      },
    ],
  },
  {
    id: "context-compaction",
    name: "Context Compaction",
    description: "Summarize and compact context, prompts, or outputs to save tokens. Use when asked to compress context or shorten prompts.",
    tagline: "Keep only what matters to reduce token use.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Context Compaction
description: Summarize and compact context, prompts, or outputs to save tokens. Use when asked to compress context or shorten prompts.
---

## Workflow

1. Identify the goal and the minimum facts needed to achieve it (inputs, constraints, decisions, open questions).
2. Remove filler, repetition, and details that do not affect the outcome. Keep file paths, IDs, errors, and exact requirements.
3. Rewrite as short bullets or a tight summary: current state, what changed, what is needed next.
4. Preserve important evidence (commands, errors, diffs) but trim long logs to the relevant lines.
5. Confirm nothing critical was dropped; if unsure, mark it as "verify" instead of guessing.

## Rules

- Never invent facts. If information is missing, say so briefly.
- Prefer concrete nouns and verbs over explanations.
- Keep code/commands verbatim only when they are needed to act.
`,
      },
    ],
  },
  {
    id: "codebase-exploration",
    name: "Codebase Exploration",
    description: "Map and explain an unfamiliar codebase quickly. Use when asked to explore, understand, or onboard to a project.",
    tagline: "Get oriented in a new repo fast.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Codebase Exploration
description: Map and explain an unfamiliar codebase quickly. Use when asked to explore, understand, or onboard to a project.
---

## Workflow

1. Read top-level docs and config (README, AGENTS, package/build files) to learn purpose, stack, and how to run tests.
2. Identify the main entry points, key folders, and where core logic lives. Note naming and structure patterns.
3. Trace one representative flow end to end (request -> handler -> data -> response, or similar).
4. Summarize: what the project does, how it is organized, how to run/check it, and where to start for common tasks.
5. List unknowns or risky areas that need verification before changing.

## Rules

- Base the map on files you actually read; cite paths.
- Prefer a practical overview over exhaustive detail.
- Do not make changes unless the user asked for them.
`,
      },
    ],
  },
  {
    id: "feature-plan",
    name: "Feature Plan",
    description: "Break a feature into small, safe implementation steps. Use when asked to plan or scope a feature.",
    tagline: "Turn an idea into a clear, testable plan.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Feature Plan
description: Break a feature into small, safe implementation steps. Use when asked to plan or scope a feature.
---

## Workflow

1. Restate the goal, users, and done criteria. Ask only if a missing fact blocks the plan.
2. Inspect the relevant code and patterns so the plan fits the existing architecture.
3. Break the work into small steps: data/model, logic, interface/API, tests, and docs if needed.
4. For each step, note files likely to change, risks, and how to verify it works.
5. Order steps so each can be checked independently; flag dependencies and rollout concerns.

## Rules

- Keep steps concrete and small; avoid vague "implement feature" tasks.
- Prefer existing patterns over new abstractions.
- Call out unknowns and assumptions explicitly.
`,
      },
    ],
  },
  {
    id: "fix-build-errors",
    name: "Fix Build Errors",
    description: "Diagnose and fix build, lint, or type errors systematically. Use when asked to fix errors or get a project building.",
    tagline: "Get back to green with minimal changes.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Fix Build Errors
description: Diagnose and fix build, lint, or type errors systematically. Use when asked to fix errors or get a project building.
---

## Workflow

1. Run the failing command and capture the full error output. Start with the first/root error.
2. Read the reported file:line and surrounding code; confirm the cause before editing.
3. Apply the smallest fix that resolves the root cause (not just the symptom).
4. Re-run the same command. Repeat until the original error set is gone.
5. Report: errors fixed, files changed, and any remaining issues or risks.

## Rules

- Fix root causes first; downstream errors often disappear.
- Do not disable checks or weaken types unless the user explicitly approves.
- Keep unrelated refactors out of the fix.
`,
      },
    ],
  },
  {
    id: "accessibility-review",
    name: "Accessibility Review",
    description: "Review UI and markup for accessibility issues and fixes. Use when asked to check accessibility or a11y.",
    tagline: "Make interfaces usable for everyone.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Accessibility Review
description: Review UI and markup for accessibility issues and fixes. Use when asked to check accessibility or a11y.
---

## Workflow

1. Identify the UI surface (components, pages, flows) and how users interact with it (keyboard, screen reader, touch).
2. Check common issues: labels/roles, focus order, keyboard access, contrast cues in code, alt text, form errors, and ARIA misuse.
3. For each issue, give location, impact on users, and a concrete fix.
4. Prefer native HTML semantics before adding ARIA. Keep behavior consistent with visual UI.
5. Suggest a quick verification step (keyboard walkthrough, relevant test, or lint rule) when possible.

## Rules

- Report user impact, not just rule names.
- Do not claim compliance without testing; state what was reviewed.
- Avoid ARIA when a native element solves it.
`,
      },
    ],
  },
  {
    id: "write-agents-md",
    name: "Write AGENTS.md",
    description: "Create or improve AGENTS.md instructions for a project. Use when asked to set up agent or project instructions.",
    tagline: "Help coding agents work well in your repo.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Write AGENTS.md
description: Create or improve AGENTS.md instructions for a project. Use when asked to set up agent or project instructions.
---

## Workflow

1. Read the repo's structure, stack, scripts, and existing conventions (README, configs, tests, code style).
2. Draft AGENTS.md with: project purpose, layout, key commands (build/test/lint/run), and coding rules that matter.
3. Add safety or workflow constraints specific to the repo (e.g., do not touch generated files, required checks).
4. Keep instructions short, concrete, and verifiable. Prefer examples/commands over vague advice.
5. Place the file where agents expect it (repo root as AGENTS.md) and mention it in docs if helpful.

## Rules

- Only document what is true for this repo; do not copy generic boilerplate blindly.
- Put must-follow rules first; keep nice-to-have notes brief.
- Do not include secrets, tokens, or private URLs.
`,
      },
    ],
  },
  {
    id: "git-conflict-help",
    name: "Git Conflict Help",
    description: "Resolve merge conflicts safely and explain the choices. Use when asked to fix merge or rebase conflicts.",
    tagline: "Resolve conflicts without losing work.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Git Conflict Help
description: Resolve merge conflicts safely and explain the choices. Use when asked to fix merge or rebase conflicts.
---

## Workflow

1. List conflicted files and understand the intent of both sides (current branch vs incoming change).
2. For each conflict, choose the correct resolution: keep one side, combine both, or rewrite to preserve both intents.
3. Remove all conflict markers and ensure the result compiles/makes sense in context.
4. Run relevant tests or checks for the affected area.
5. Summarize what was kept/changed per file so the user can review before continuing merge/rebase.

## Rules

- Never drop changes silently; explain non-obvious choices.
- Preserve behavior and tests unless the user approves a semantic change.
- If intent is unclear, ask before guessing.
`,
      },
    ],
  },
  {
    id: "readme-starter",
    name: "README Starter",
    description: "Draft or improve a project README for new users. Use when asked to write, create, or update a README.",
    tagline: "Help new users run and understand the project.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: README Starter
description: Draft or improve a project README for new users. Use when asked to write, create, or update a README.
---

## Workflow

1. Read the project to confirm what it does, requirements, and real run/build/test commands.
2. Write a clear README: what it is, quick start, requirements, common commands, and where to find more docs.
3. Add a short project layout or key concepts section only if it helps new users.
4. Use copy-pasteable commands and expected outcomes where useful.
5. Verify links, paths, and commands against the current repo.

## Rules

- Accuracy beats marketing; do not promise features that are not implemented.
- Keep the quick start near the top.
- Match the project's existing tone and doc structure.
`,
      },
    ],
  },
  {
    id: "regex-helper",
    name: "Regex Helper",
    description: "Write, explain, and test regular expressions safely. Use when asked to create, fix, or understand a regex.",
    tagline: "Correct regexes with clear examples.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Regex Helper
description: Write, explain, and test regular expressions safely. Use when asked to create, fix, or understand a regex.
---

## Workflow

1. Clarify the exact match goal: what must match, what must not, and the language/engine (JS, PCRE, Python, etc.).
2. Write the simplest regex that meets the goal. Prefer readable patterns over clever tricks.
3. Explain the pattern briefly and list 2-3 matching and 2-3 non-matching examples.
4. Check edge cases (empty strings, multiline, Unicode, escaping) relevant to the use case.
5. If used in code, show the safe integration (escaping, flags, and input handling).

## Rules

- State the regex flavor/flags; behavior differs across engines.
- Watch for catastrophic backtracking on untrusted input; prefer simple patterns.
- Do not overmatch; be explicit about boundaries and intent.
`,
      },
    ],
  },
  {
    id: "api-integration",
    name: "API Integration",
    description: "Plan and implement a safe external API integration. Use when asked to integrate with, call, or connect an API.",
    tagline: "Integrate APIs with clear errors and safety checks.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: API Integration
description: Plan and implement a safe external API integration. Use when asked to integrate with, call, or connect an API.
---

## Workflow

1. Confirm the API contract needed: endpoint, auth method, request/response shape, and failure modes.
2. Design the integration boundary: config/secrets handling, timeouts, retries (if appropriate), and error mapping.
3. Implement with input validation and safe parsing of responses; handle non-2xx and malformed data.
4. Add or update tests for the happy path and key failures (timeout, 401/403, 4xx/5xx, bad payload).
5. Document required config/env vars and an example call, without exposing secrets.

## Rules

- Never hardcode or log secrets/tokens.
- Make failures explicit and actionable for callers.
- Follow the project's existing HTTP/client patterns.
`,
      },
    ],
  },
  {
    id: "migration-plan",
    name: "Migration Plan",
    description: "Plan a safe code, data, or schema migration. Use when asked to migrate, upgrade a schema, or move between systems.",
    tagline: "Change systems safely with rollback in mind.",
    files: [
      {
        path: "SKILL.md",
        content: `---
name: Migration Plan
description: Plan a safe code, data, or schema migration. Use when asked to migrate, upgrade a schema, or move between systems.
---

## Workflow

1. Define the current state, target state, and what must not break (data integrity, uptime, compatibility).
2. Inventory affected code, data, configs, and consumers. Identify the riskiest step.
3. Design the migration in phases: prepare, migrate, verify, and clean up. Prefer reversible steps.
4. Specify verification (checks, queries, tests) and a rollback plan for each phase.
5. Call out sequencing, backups, and coordination needed before execution.

## Rules

- Do not run destructive steps without explicit approval and a rollback path.
- Preserve data; treat irreversible changes as high risk.
- Keep the plan concrete: commands/checks, owners/inputs, and success criteria.
`,
      },
    ],
  },
];
