// Documentation placement scanner.
// Pure classification + filesystem scan. Never deletes; only proposes moves.

import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";

export interface DocFinding {
  /** absolute path of the file */
  path: string;
  /** path relative to scan root, posix-style */
  rel: string;
  issue: string;
  /** proposed relative destination, posix-style */
  proposed: string;
  reason: string;
  confidence: "high" | "medium";
}

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".venv",
  "__pycache__",
]);

const RECOGNIZED_ROOT = /^(README|AGENTS|CLAUDE|CONTRIBUTING|LICENSE|LICENCE|CHANGELOG|CODE_OF_CONDUCT|SECURITY|TROUBLESHOOTING|ARCHITECTURE|INSTALL|UPGRADE|RELEASES?|VERSION)(\..*)?$/i;

const SOURCE_DIRS = new Set([
  "src",
  "app",
  "components",
  "pages",
  "lib",
  "server",
  "client",
  "internal",
  "pkg",
  "cmd",
]);

const DOC_EXT = /\.(md|markdown|txt|docx|pdf|odt|rtf)$/i;
const BINARY_DOC_EXT = /\.(docx|pdf|odt|rtf)$/i;

function posix(p: string): string {
  return p.split(sep).join("/");
}

function isIgnored(rel: string): boolean {
  const parts = rel.split("/");
  return parts.some((part) => part.startsWith(".") || IGNORE_DIRS.has(part));
}

function uniqueTarget(target: string, taken: Set<string>): string {
  if (!taken.has(target)) return target;
  const dot = target.lastIndexOf(".");
  const stem = dot >= 0 ? target.slice(0, dot) : target;
  const ext = dot >= 0 ? target.slice(dot) : "";
  let i = 2;
  while (taken.has(`${stem}-${i}${ext}`)) i += 1;
  return `${stem}-${i}${ext}`;
}

/** Classify one relative path. Returns undefined when the file is fine where it is. */
export function classifyPath(
  relPosix: string,
  taken: Set<string>,
): Omit<DocFinding, "path" | "rel"> | undefined {
  const parts = relPosix.split("/");
  const file = parts[parts.length - 1] ?? "";
  if (!DOC_EXT.test(file)) return undefined;

  // Already inside a docs folder, or beside config for tools (.opencode, .github).
  if (parts.includes("docs") || parts[0] === ".opencode" || parts[0] === ".github") return undefined;

  const atRoot = parts.length === 1;
  const stem = file.replace(/\.[^.]+$/, "");

  if (BINARY_DOC_EXT.test(file)) {
    const target = uniqueTarget(`docs/archive/${file}`, taken);
    taken.add(target);
    return {
      issue: "loose-binary-doc",
      proposed: target,
      reason: `Binary document "${file}" at the repo root usually belongs in docs/archive/.`,
      confidence: "medium",
    };
  }

  if (atRoot) {
    if (RECOGNIZED_ROOT.test(file) || RECOGNIZED_ROOT.test(stem)) return undefined;
    const target = uniqueTarget(`docs/${file}`, taken);
    taken.add(target);
    return {
      issue: "stray-root-doc",
      proposed: target,
      reason: `"${file}" at the root is not a standard file (README/AGENTS/LICENSE…). It reads better under docs/.`,
      confidence: "high",
    };
  }

  const parent = parts[parts.length - 2] ?? "";
  if (RECOGNIZED_ROOT.test(file) && parent && !SOURCE_DIRS.has(parent)) return undefined; // README in a package root is fine

  if (SOURCE_DIRS.has(parts[0] ?? "")) {
    const clean = file.replace(/\s+/g, "-");
    const target = uniqueTarget(`docs/${parts[0]}-${clean}`, taken);
    taken.add(target);
    return {
      issue: "doc-in-source",
      proposed: target,
      reason: `Documentation inside source folder "${parts[0]}/" gets lost. Move it to docs/ keeping the folder prefix.`,
      confidence: "high",
    };
  }

  const clean = file.replace(/\s+/g, "-");
  const target = uniqueTarget(`docs/${parent}-${clean}`, taken);
  taken.add(target);
  return {
    issue: "misplaced-doc",
    proposed: target,
    reason: `Documentation in "${parent}/" sits away from the other docs. Move it to docs/ with the folder prefix.`,
    confidence: "medium",
  };
}

export async function scanDocs(root: string, maxFiles = 8000): Promise<DocFinding[]> {
  const findings: DocFinding[] = [];
  const taken = new Set<string>();
  let count = 0;

  async function walk(dir: string): Promise<void> {
    if (count > maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder — skip quietly
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      const rel = posix(relative(root, abs));
      if (isIgnored(rel)) continue;
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        count += 1;
        if (!DOC_EXT.test(entry.name) && !/\.(md|txt)$/i.test(entry.name)) continue;
        try {
          const info = await stat(abs);
          if (info.size > 5 * 1024 * 1024) continue;
        } catch {
          continue;
        }
        const result = classifyPath(rel, taken);
        if (result) findings.push({ path: abs, rel, ...result });
      }
    }
  }

  await walk(root);
  return findings.sort((a, b) => a.rel.localeCompare(b.rel));
}

export function dirOf(relPosix: string): string {
  const dir = dirname(relPosix);
  return dir === "." ? "" : dir;
}
