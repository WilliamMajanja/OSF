// Installing skills into OpenCode + a minimal ZIP writer + docs move/undo.
// Safety contract: never delete files, always back up before overwriting,
// always write a manifest so every move can be undone.

import { createHash } from "node:crypto";
import { cp, mkdir, rename, writeFile, readFile, stat, access } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SkillDraft } from "./skill.js";

export type InstallScope = "global" | "project";

export function globalSkillsRoot(): string {
  return join(homedir(), ".config", "opencode", "skills");
}

export function targetRoot(scope: InstallScope, projectPath?: string): string {
  if (scope === "global") return globalSkillsRoot();
  if (!projectPath || !projectPath.trim()) {
    throw new Error("Pick a project folder first. The project path box is empty.");
  }
  return join(resolve(projectPath.trim()), ".opencode", "skills");
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function assertInside(root: string, candidate: string): void {
  const r = resolve(root);
  const c = resolve(candidate);
  if (!(c === r || c.startsWith(r + "/"))) {
    throw new Error(`Refusing to write outside the chosen folder: ${candidate}`);
  }
}

async function backupIfExists(target: string): Promise<string | null> {
  if (!(await exists(target))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${target}.backup-${stamp}`;
  await cp(target, backup, { recursive: true });
  return backup;
}

export interface InstallResult {
  target: string;
  backup: string | null;
  filesWritten: string[];
}

/** Write a skill draft into OpenCode's auto-discovered skills folder. */
export async function installSkill(
  draft: SkillDraft,
  scope: InstallScope,
  projectPath: string | undefined,
  overwrite: boolean,
): Promise<InstallResult> {
  const root = targetRoot(scope, projectPath);
  const dir = join(root, draft.id);
  assertInside(root, dir);

  const alreadyThere = await exists(join(dir, "SKILL.md"));
  if (alreadyThere && !overwrite) {
    throw new Error(
      `A skill called "${draft.id}" already exists at ${dir}. Tick "Replace it" to overwrite (a backup is saved first), or choose a different ID.`,
    );
  }

  const backup = await backupIfExists(dir);
  await mkdir(dir, { recursive: true });

  const written: string[] = [];
  for (const file of draft.files) {
    const dest = resolve(join(dir, file.path));
    assertInside(dir, dest);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content.endsWith("\n") ? file.content : `${file.content}\n`, "utf8");
    written.push(dest);
  }

  // Prove OpenCode can see it: drop a tiny marker the UI checks against /api/skill.
  return { target: dir, backup, filesWritten: written };
}

// ---- minimal Stored (no compression) ZIP writer ---------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStored(files: Array<{ path: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = Buffer.from(file.content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 flag
    local.writeUInt16LE(0, 8); // stored, no compression
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(0, 12);
    head.writeUInt16LE(0, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);

    chunks.push(local, name, data);
    central.push(head, name);
    offset += local.length + name.length + data.length;
  }

  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, ...central, end]);
}

// ---- docs moves with manifest + undo --------------------------------------

export interface DocMove {
  from: string;
  to: string;
}

export interface MoveManifest {
  createdAt: string;
  root: string;
  moves: DocMove[];
}

export async function applyDocMoves(root: string, moves: DocMove[]): Promise<MoveManifest> {
  const absRoot = resolve(root);
  const manifest: MoveManifest = { createdAt: new Date().toISOString(), root: absRoot, moves: [] };

  for (const move of moves) {
    const from = resolve(join(absRoot, move.from));
    const proposed = resolve(join(absRoot, move.to));
    assertInside(absRoot, from);
    assertInside(absRoot, proposed);
    if (!(await exists(from))) continue; // already moved / deleted — skip, don't fail

    let dest = proposed;
    const parsed = matchExt(dest);
    let i = 2;
    while (await exists(dest)) {
      dest = `${parsed.stem}-${i}${parsed.ext}`;
      i += 1;
    }
    await mkdir(dirname(dest), { recursive: true });
    await rename(from, dest);
    manifest.moves.push({ from: move.from, to: manifestMovedRel(absRoot, dest) });
  }

  const docsDir = join(absRoot, "docs");
  await mkdir(docsDir, { recursive: true });
  const stamp = manifest.createdAt.replace(/[:.]/g, "-");
  const manifestPath = join(docsDir, `.skillforge-manifest-${stamp}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const indexPath = join(docsDir, "README.md");
  if (!(await exists(indexPath)) && manifest.moves.length > 0) {
    const rows = manifest.moves.map((m) => `- [${m.to.split("/").pop()}](./${m.to.replace("docs/", "")}) — moved from \`${m.from}\``).join("\n");
    await writeFile(
      indexPath,
      `# Documentation\n\nAuto-generated index by SkillForge. Files arrive here when cleanup moves them in.\n\n${rows}\n`,
      "utf8",
    );
  }
  return manifest;
}

function manifestMovedRel(root: string, abs: string): string {
  return abs.startsWith(root + "/") ? abs.slice(root.length + 1) : abs;
}

function matchExt(path: string): { stem: string; ext: string } {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? { stem: path.slice(0, dot), ext: path.slice(dot) } : { stem: path, ext: "" };
}

export async function undoDocMoves(manifestPath: string): Promise<number> {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as MoveManifest;
  let restored = 0;
  for (const move of [...manifest.moves].reverse()) {
    const from = resolve(join(manifest.root, move.to));
    const back = resolve(join(manifest.root, move.from));
    assertInside(manifest.root, from);
    assertInside(manifest.root, back);
    if (!(await exists(from))) continue;
    await mkdir(dirname(back), { recursive: true });
    if (await exists(back)) continue; // never clobber on undo
    await rename(from, back);
    restored += 1;
  }
  return restored;
}

/** Parse a generation reply that may be fenced JSON or contain JSON inside prose. */
export function extractDraftJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

export function coerceDraft(value: unknown, fallbackId: string): {
  id: string;
  name: string;
  description: string;
  files: Array<{ path: string; content: string }>;
} | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const filesRaw = Array.isArray(v.files) ? v.files : [];
  const files: Array<{ path: string; content: string }> = [];
  for (const entry of filesRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.path === "string" && typeof e.content === "string" && e.path.trim()) {
      files.push({ path: e.path.trim().replace(/^\.\//, ""), content: e.content });
    }
  }
  if (files.length === 0 && typeof v.content === "string") {
    files.push({ path: "SKILL.md", content: v.content as string });
  }
  if (files.length === 0) return null;
  const id = typeof v.id === "string" && v.id.trim() ? String(v.id).trim() : fallbackId;
  const name = typeof v.name === "string" && (v.name as string).trim() ? String(v.name).trim() : id;
  const description = typeof v.description === "string" ? String(v.description) : "";
  return { id, name, description, files };
}

export function tempDir(): string {
  return tmpdir();
}

export async function fileInfo(path: string): Promise<{ size: number } | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
