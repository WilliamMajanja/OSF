// Thin wrapper around the user's real `opencode` CLI.
// Reuses their background service, providers, and auth — no API keys stored here.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface OpenCodeModel {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
  type?: string;
  enabled?: boolean;
}

export interface OpenCodeSkill {
  id: string;
  name: string;
  description?: string;
  autoinvoke?: boolean;
  path: string;
}

async function api<T>(method: "get" | "post", path: string, data?: unknown, timeout = 120_000): Promise<T> {
  const args = ["api", method, path];
  if (method === "post") args.push("--data", JSON.stringify(data ?? {}));
  let stdout = "";
  try {
    const result = await run("opencode", args, {
      timeout,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });
    stdout = result.stdout.trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = (e.stdout || e.stderr || e.message || "opencode command failed").trim();
    throw new Error(`OpenCode said: ${detail.slice(0, 1200)}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`OpenCode returned something unexpected. Try running "opencode api get /api/info" in a terminal to see the raw output.`);
  }
}

export async function getVersion(): Promise<string | null> {
  try {
    const result = await run("opencode", ["--version"], { timeout: 15_000 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getInfo(): Promise<unknown> {
  return api("get", "/api/info", undefined, 30_000);
}

export async function listModels(): Promise<OpenCodeModel[]> {
  const body = (await api("get", "/api/model", undefined, 60_000)) as { data?: OpenCodeModel[] };
  return Array.isArray(body.data) ? body.data.filter((m) => m.type === "chat" || !m.type) : [];
}

export async function listSkills(): Promise<OpenCodeSkill[]> {
  const body = (await api("get", "/api/skill", undefined, 60_000)) as { data?: OpenCodeSkill[] };
  return Array.isArray(body.data) ? body.data : [];
}

export interface TextGeneration {
  text: string;
}

export async function generateText(
  prompt: string,
  model?: { providerID: string; modelID: string } | null,
): Promise<TextGeneration> {
  const body: Record<string, unknown> = { prompt };
  // OpenCode's Model.Ref shape is { id, providerID } (id = the model's ID).
  if (model) body.model = { id: model.modelID, providerID: model.providerID };
  const res = (await api("post", "/api/experimental/generate/text", body, 180_000)) as {
    data?: { text?: string };
  };
  const text = res?.data?.text;
  if (!text) throw new Error("The model replied with no text. Try another model or a shorter prompt.");
  return { text };
}

export function generationPrompt(goal: string, suggestedId: string | null, budget: "lean" | "standard" | "detailed"): string {
  const limits = { lean: 350, standard: 700, detailed: 1400 }[budget];
  return [
    "You are writing one reusable OpenCode skill file (SKILL.md). The file will be loaded by coding agents running different models (OpenAI GPT, xAI Grok, Google Gemini, Claude, local models), so instructions must be plain, explicit, and model-neutral.",
    "",
    `Task to skill-ify: ${goal}`,
    suggestedId ? `Suggested skill ID: ${suggestedId}` : "Choose a short kebab-case skill ID.",
    "",
    "Output rules (follow all of them):",
    `- Output ONLY valid JSON, no markdown fences, no commentary. Shape: {"id": string, "name": string, "description": string, "files": [{"path": "SKILL.md", "content": string}]}`,
    `- id: lowercase kebab-case, 1-64 chars, e.g. "git-release".`,
    `- description: one sentence, max 200 characters. State what it does AND include a trigger with "Use when..." (this text is shown on every step; keep it tight and specific).`,
    "- files must include SKILL.md. content starts with YAML frontmatter: name and description matching the JSON fields exactly.",
    `- Body: max ${limits} words. Use 3-7 numbered steps, then a short "## Rules" section. Short imperative sentences. No preamble, no closing summary, no filler.`,
    "- Cross-model clarity: use concrete verbs, explicit inputs/outputs, and file:line or path examples when helpful. Say what to do, not which vendor-specific tool name to call, unless the tool is clearly named by the user. Avoid vague pronouns; each step should stand on its own.",
    "- Token efficiency: prefer lists over paragraphs, avoid restating the goal, and put long checklists/details in files as references/<name>.md and reference that file by path.",
    "- Never include secrets, API keys, or guessed URLs. Never claim a command works if unsure — phrase it as a step to verify.",
    "- No placeholders like TODO, FIXME, or lorem ipsum.",
  ].join("\n");
}
