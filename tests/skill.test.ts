import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TEMPLATES, countNumberedSteps, estimateTokens, hasTriggerPhrase, slugify, validateSkill, type SkillDraft } from "../server/lib/skill.js";
import { classifyPath, scanDocs } from "../server/lib/docsScan.js";
import { coerceDraft, extractDraftJson, zipStored, assertInside } from "../server/lib/install.js";

const goodDraft: SkillDraft = {
  id: "git-release",
  name: "Git Release",
  description: "Prepare release notes and version bumps. Use when asked to cut a release.",
  source: "manual",
  files: [
    {
      path: "SKILL.md",
      content:
        "---\nname: Git Release\ndescription: Prepare release notes and version bumps. Use when asked to cut a release.\n---\n\n## Workflow\n\n1. Read the policy.\n2. Propose the version bump.\n",
    },
  ],
};

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("My Cool Skill!"), "my-cool-skill");
  });
  it("caps at 64 chars and falls back", () => {
    assert.equal(slugify(""), "new-skill");
    assert.ok(slugify("a".repeat(100)).length <= 64);
  });
});

describe("validateSkill", () => {
  it("accepts a well-formed skill", () => {
    const result = validateSkill(goodDraft);
    assert.equal(result.valid, true);
    assert.ok(result.tokens > 0);
  });
  it("rejects bad IDs and placeholders", () => {
    const bad = { ...goodDraft, id: "Bad ID", files: [{ path: "SKILL.md", content: "---\nname: x\n---\nTODO fix this" }] };
    assert.equal(validateSkill(bad).valid, false);
  });
  it("warns on long descriptions (token cost)", () => {
    const long = { ...goodDraft, description: "Do something very long. ".repeat(20) + "Use when asked." };
    const result = validateSkill(long);
    assert.equal(result.valid, true);
    assert.ok(result.issues.some((i) => i.level === "warn" && /chars|token/i.test(i.message)));
  });
  it("warns when description lacks a trigger phrase", () => {
    const noTrigger = { ...goodDraft, description: "Prepare release notes and version bumps." };
    const result = validateSkill(noTrigger);
    assert.equal(result.valid, true);
    assert.ok(result.issues.some((i) => i.level === "warn" && /trigger/i.test(i.message)));
  });
  it("counts numbered steps and flags too many", () => {
    assert.equal(countNumberedSteps("1. A\n2. B\n10. C"), 3);
    assert.equal(hasTriggerPhrase("Review code. Use when asked to review."), true);
    const many = {
      ...goodDraft,
      files: [{
        path: "SKILL.md",
        content: `---\nname: X\ndescription: ${goodDraft.description}\n---\n\n## Workflow\n\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. Step`).join("\n")}\n`,
      }],
    };
    const result = validateSkill(many);
    assert.ok(result.issues.some((i) => i.level === "warn" && /numbered steps/i.test(i.message)));
  });
});

describe("templates", () => {
  it("all templates are valid and lean", () => {
    assert.ok(TEMPLATES.length >= 6);
    for (const t of TEMPLATES) {
      const result = validateSkill({ ...t, source: "template" });
      assert.equal(result.valid, true, `${t.id}: ${result.issues.map((i) => i.message).join("; ")}`);
      assert.ok(t.description.length <= 200, `${t.id} description too long`);
    }
  });
});

describe("classifyPath", () => {
  it("leaves standard root docs alone", () => {
    const taken = new Set<string>();
    assert.equal(classifyPath("README.md", taken), undefined);
    assert.equal(classifyPath("AGENTS.md", taken), undefined);
    assert.equal(classifyPath("LICENSE", taken), undefined);
    assert.equal(classifyPath("docs/guide.md", taken), undefined);
    assert.equal(classifyPath("packages/core/README.md", taken), undefined);
  });
  it("flags stray root docs into docs/", () => {
    const taken = new Set<string>();
    const finding = classifyPath("random-notes.md", taken);
    assert.equal(finding?.issue, "stray-root-doc");
    assert.equal(finding?.proposed, "docs/random-notes.md");
    assert.equal(finding?.confidence, "high");
  });
  it("flags docs inside source folders", () => {
    const taken = new Set<string>();
    const finding = classifyPath("src/notes.md", taken);
    assert.equal(finding?.issue, "doc-in-source");
    assert.equal(finding?.proposed, "docs/src-notes.md");
  });
  it("flags loose binaries into docs/archive", () => {
    const taken = new Set<string>();
    const finding = classifyPath("Report Final.docx", taken);
    assert.equal(finding?.issue, "loose-binary-doc");
    assert.equal(finding?.proposed, "docs/archive/Report Final.docx");
  });
  it("de-collides targets with -2 suffix", () => {
    const taken = new Set(["docs/notes.md"]);
    const finding = classifyPath("notes.md", taken);
    assert.equal(finding?.proposed, "docs/notes-2.md");
  });
});

describe("scanDocs", () => {
  it("finds stray docs in this repo but not its own docs/", async () => {
    const findings = await scanDocs(new URL("..", import.meta.url).pathname);
    const rels = findings.map((f) => f.rel);
    assert.ok(!rels.some((r) => r.startsWith("docs/")), "own docs/ should not be flagged");
    assert.ok(!rels.includes("README.md"));
    assert.ok(!rels.includes("AGENTS.md"));
  });
});

describe("draft coercion", () => {
  it("extracts JSON from fenced/prose-wrapped replies", () => {
    const parsed = extractDraftJson('```json\n{"id":"x","files":[{"path":"SKILL.md","content":"hi"}]}\n```');
    const draft = coerceDraft(parsed, "fallback");
    assert.equal(draft?.id, "x");
    assert.equal(draft?.files.length, 1);
  });
  it("returns null for garbage", () => {
    assert.equal(extractDraftJson("hello world"), null);
  });
});

describe("zipStored", () => {
  it("produces a non-empty zip buffer with local header magic", () => {
    const zip = zipStored([{ path: "SKILL.md", content: "# hi\n" }]);
    assert.ok(zip.length > 50);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
  });
});

describe("estimateTokens + assertInside", () => {
  it("estimates tokens at ~4 chars each", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("a".repeat(400)), 100);
  });
  it("rejects writes outside the root", () => {
    assert.throws(() => assertInside("/tmp/root", "/etc/passwd"));
    assert.doesNotThrow(() => assertInside("/tmp/root", "/tmp/root/a/b.md"));
  });
});
