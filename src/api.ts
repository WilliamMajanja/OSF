// Tiny typed fetch wrapper with human-friendly errors.

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

export interface StatusResponse {
  version: string | null;
  info: unknown;
  infoError: string | null;
  models: OpenCodeModel[];
  modelsError: string | null;
  skills: OpenCodeSkill[];
  skillsError: string | null;
  globalSkillsRoot: string;
}

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

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  tokens: number;
  descriptionTokens: number;
  bodyTokens: number;
}

export interface Template extends Omit<SkillDraft, "source"> {
  tagline: string;
}

export interface DocFinding {
  path: string;
  rel: string;
  issue: string;
  proposed: string;
  reason: string;
  confidence: "high" | "medium";
}

export interface DocMove {
  from: string;
  to: string;
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `Request failed (${res.status}). Is the SkillForge server running?` };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new Error("Cannot reach the SkillForge server. Start it with: npm run dev (in the opencode-skill-forge folder).");
  }
  const body = (await parse(res)) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status}).`);
  return body as T;
}

export const api = {
  status: () => request<StatusResponse>("/api/status"),
  templates: () => request<{ templates: Template[] }>("/api/templates"),
  validateDraft: (draft: SkillDraft) => request<ValidationResult>("/api/validate", { method: "POST", body: JSON.stringify({ draft }) }),
  installCheck: (scope: "global" | "project", project: string, id: string) =>
    request<{ target: string | null; exists: boolean; note: string }>(
      `/api/install/check?scope=${scope}&project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`,
    ),
  install: (payload: { draft: SkillDraft; scope: "global" | "project"; project: string; overwrite: boolean }) =>
    request<{ target: string; backup: string | null; verified: boolean; skillCount: number }>(
      "/api/install",
      { method: "POST", body: JSON.stringify(payload) },
    ),
  scanDocs: (root: string) =>
    request<{ root: string; findings: DocFinding[]; count: number }>(`/api/docs/scan?root=${encodeURIComponent(root)}`),
  applyDocs: (root: string, moves: DocMove[]) =>
    request<{ moved: number; manifest: { createdAt: string; root: string; moves: DocMove[] } }>("/api/docs/apply", {
      method: "POST",
      body: JSON.stringify({ root, moves }),
    }),
  undoDocs: (manifest: string) =>
    request<{ restored: number }>("/api/docs/undo", { method: "POST", body: JSON.stringify({ manifest }) }),
  exportZip: async (draft: SkillDraft): Promise<void> => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    });
    if (!res.ok) {
      const body = (await parse(res)) as { error?: string };
      throw new Error(body.error ?? "Export failed.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.id}-skill.zip`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
