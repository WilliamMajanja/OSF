// SkillForge API server. Localhost only. No auth, no external calls except
// the user's own `opencode` CLI (which uses their providers/credentials).

import express from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TEMPLATES, estimateTokens, slugify, validateSkill, type SkillDraft } from "./lib/skill.js";
import { scanDocs } from "./lib/docsScan.js";
import {
  applyDocMoves,
  coerceDraft,
  exists,
  extractDraftJson,
  globalSkillsRoot,
  installSkill,
  undoDocMoves,
  zipStored,
  type InstallScope,
} from "./lib/install.js";
import {
  generateText,
  generationPrompt,
  getInfo,
  getVersion,
  listModels,
  listSkills,
} from "./lib/opencode.js";

const app = express();
const PORT = Number(process.env.PORT ?? 5174);
const HOST = "127.0.0.1";

app.use(express.json({ limit: "2mb" }));

function fail(res: express.Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function readDraft(body: unknown): { draft: SkillDraft } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Nothing to work with — the request body was empty." };
  const b = body as Record<string, unknown>;
  const raw = b.draft ?? b;
  const coerced = coerceDraft(raw, slugify(typeof b.goal === "string" ? b.goal : "new-skill"));
  if (!coerced) return { error: "Could not read a skill from that input. Check the JSON shape: {id, name, description, files:[{path, content}]}." };
  return {
    draft: {
      id: slugify(coerced.id),
      name: coerced.name,
      description: coerced.description,
      files: coerced.files,
      source: (b.source as SkillDraft["source"]) ?? "manual",
    },
  };
}

// ---- status ---------------------------------------------------------------

app.get("/api/status", async (_req, res) => {
  const [version, info, models, skills] = await Promise.allSettled([
    getVersion(),
    getInfo(),
    listModels(),
    listSkills(),
  ]);
  res.json({
    version: version.status === "fulfilled" ? version.value : null,
    info: info.status === "fulfilled" ? info.value : null,
    infoError: info.status === "rejected" ? messageOf(info.reason) : null,
    models: models.status === "fulfilled" ? models.value : [],
    modelsError: models.status === "rejected" ? messageOf(models.reason) : null,
    skills: skills.status === "fulfilled" ? skills.value : [],
    skillsError: skills.status === "rejected" ? messageOf(skills.reason) : null,
    globalSkillsRoot: globalSkillsRoot(),
  });
});

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// ---- templates ---------------------------------------------------------------

app.get("/api/templates", (_req, res) => {
  res.json({ templates: TEMPLATES });
});

// ---- generate ---------------------------------------------------------------

app.post("/api/generate", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (goal.length < 12) {
    fail(res, 400, "Describe the skill in at least one short sentence (12+ characters) — e.g. \"Review pull requests for security issues and missing tests\".");
    return;
  }
  const budget = body.budget === "detailed" || body.budget === "standard" ? body.budget : "lean";
  const model =
    body.model && typeof body.model === "object" && "providerID" in body.model && "modelID" in body.model
      ? { providerID: String((body.model as Record<string, unknown>).providerID), modelID: String((body.model as Record<string, unknown>).modelID) }
      : null;
  const suggestedId = typeof body.suggestedId === "string" && body.suggestedId.trim() ? slugify(body.suggestedId) : null;

  try {
    const { text } = await generateText(generationPrompt(goal, suggestedId, budget), model);
    const parsed = extractDraftJson(text);
    const coerced = coerceDraft(parsed, slugify(goal));
    if (!coerced) {
      fail(res, 502, `The model did not return the expected JSON. It replied: ${text.slice(0, 300)}… Try a shorter goal or another model.`);
      return;
    }
    const draft: SkillDraft = { ...coerced, id: slugify(coerced.id), source: "ai" };
    const validation = validateSkill(draft);
    res.json({ draft, validation, raw: text.slice(0, 2000) });
  } catch (err) {
    fail(res, 502, `Generation failed. ${messageOf(err)} If it mentions an expired key or 401, pick a different model in Step 1 (the default provider's key may have expired) or re-sign in with /connect in OpenCode.`);
  }
});

// ---- validate ---------------------------------------------------------------

app.post("/api/validate", (req, res) => {
  const result = readDraft(req.body ?? {});
  if ("error" in result) {
    fail(res, 400, result.error);
    return;
  }
  res.json(validateSkill(result.draft));
});

// ---- install ----------------------------------------------------------------

app.get("/api/install/check", async (req, res) => {
  const scope = (req.query.scope as InstallScope) ?? "global";
  const project = typeof req.query.project === "string" ? req.query.project : undefined;
  const id = slugify(String(req.query.id ?? ""));
  const root = scope === "global" ? globalSkillsRoot() : project ? join(resolve(project), ".opencode", "skills") : null;
  const target = root ? join(root, id, "SKILL.md") : null;
  res.json({
    scope,
    target,
    exists: target ? await exists(target) : false,
    note: target
      ? `OpenCode auto-discovers ${target}. No config edit needed — the skill appears after install.`
      : "Choose a project folder first, then we can check.",
  });
});

app.post("/api/install", async (req, res) => {
  const result = readDraft(req.body ?? {});
  if ("error" in result) {
    fail(res, 400, result.error);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const scope = (body.scope as InstallScope) === "project" ? "project" : "global";
  const project = typeof body.project === "string" ? body.project : undefined;
  const overwrite = body.overwrite === true;
  const validation = validateSkill(result.draft);
  if (!validation.valid) {
    fail(res, 400, `Fix the blocking problems first: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join(" ")}`);
    return;
  }
  try {
    const installed = await installSkill(result.draft, scope, project, overwrite);
    // Verify OpenCode now lists the skill (best-effort — watcher may lag a second).
    let verified = false;
    let skillsAfter: Array<{ id: string }> = [];
    try {
      skillsAfter = await listSkills();
      verified = skillsAfter.some((s) => s.id === result.draft.id);
    } catch {
      /* best-effort */
    }
    res.json({ ...installed, verified, skillCount: skillsAfter.length, validation });
  } catch (err) {
    fail(res, 400, messageOf(err));
  }
});

// ---- export zip ---------------------------------------------------------------

app.post("/api/export", (req, res) => {
  const result = readDraft(req.body ?? {});
  if ("error" in result) {
    fail(res, 400, result.error);
    return;
  }
  const zip = zipStored(result.draft.files);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${result.draft.id}-skill.zip"`);
  res.send(zip);
});

// ---- docs cleanup -------------------------------------------------------------

app.get("/api/docs/scan", async (req, res) => {
  const root = typeof req.query.root === "string" ? req.query.root.trim() : process.cwd();
  const abs = resolve(root);
  if (!existsSync(abs)) {
    fail(res, 400, `That folder does not exist: ${abs}. Check the path (copy it from your file manager).`);
    return;
  }
  try {
    const findings = await scanDocs(abs);
    res.json({ root: abs, findings, count: findings.length });
  } catch (err) {
    fail(res, 500, `Scan failed: ${messageOf(err)}`);
  }
});

app.post("/api/docs/apply", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const root = typeof body.root === "string" ? body.root.trim() : "";
  const moves = Array.isArray(body.moves) ? body.moves : [];
  if (!root) {
    fail(res, 400, "Missing the scan root folder.");
    return;
  }
  const cleanMoves = moves
    .filter((m): m is { from: string; to: string } => !!m && typeof m === "object" && typeof (m as { from?: unknown }).from === "string" && typeof (m as { to?: unknown }).to === "string")
    .map((m) => ({ from: String(m.from), to: String(m.to) }));
  if (cleanMoves.length === 0) {
    fail(res, 400, "Select at least one file to move first.");
    return;
  }
  try {
    const manifest = await applyDocMoves(root, cleanMoves);
    res.json({ manifest, moved: manifest.moves.length });
  } catch (err) {
    fail(res, 400, messageOf(err));
  }
});

app.post("/api/docs/undo", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const manifest = typeof body.manifest === "string" ? body.manifest.trim() : "";
  if (!manifest) {
    fail(res, 400, "Paste the manifest path (it ends with .skillforge-manifest-....json) to undo.");
    return;
  }
  try {
    const restored = await undoDocMoves(manifest);
    res.json({ restored });
  } catch (err) {
    fail(res, 400, `Undo failed: ${messageOf(err)}`);
  }
});

// ---- estimates ----------------------------------------------------------------

app.post("/api/estimate", (req, res) => {
  const text = typeof (req.body as Record<string, unknown>)?.text === "string" ? String((req.body as Record<string, unknown>).text) : "";
  res.json({ tokens: estimateTokens(text) });
});

// ---- serve the built UI in production -----------------------------------------

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(here, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

app.listen(PORT, HOST, () => {
  console.log(`SkillForge API listening on http://${HOST}:${PORT}`);
});
