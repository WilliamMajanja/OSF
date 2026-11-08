import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  Copy,
  Download,
  FileSearch,
  FlaskConical,
  Loader2,
  Plug,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { api, estimateTokens, slugify, type DocFinding, type SkillDraft, type StatusResponse, type Template, type ValidationResult } from "./api";

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_TITLES: Record<Step, string> = {
  1: "Connect to OpenCode",
  2: "Choose where the skill lives",
  3: "Create the skill",
  4: "Review & install",
  5: "Tidy stray documentation",
};

const DEFAULT_PROJECT = "/home/minima/Documents/Projects/opencode-skill-forge";

export function App() {
  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [scope, setScope] = useState<"global" | "project">("global");
  const [project, setProject] = useState(DEFAULT_PROJECT);

  const [templates, setTemplates] = useState<Template[]>([]);

  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [editingFile, setEditingFile] = useState(0);
  const [overwrite, setOverwrite] = useState(false);
  const [existsInfo, setExistsInfo] = useState<{ target: string | null; exists: boolean; note: string } | null>(null);
  const [installResult, setInstallResult] = useState<{ target: string; backup: string | null; verified: boolean } | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scanRoot, setScanRoot] = useState(DEFAULT_PROJECT);
  const [findings, setFindings] = useState<DocFinding[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanBusy, setScanBusy] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [manifestPath, setManifestPath] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    setStatusBusy(true);
    setStatusError(null);
    try {
      setStatus(await api.status());
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Status check failed.");
    } finally {
      setStatusBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    api.templates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
  }, [refreshStatus]);

  // Live validation (debounced) while editing.
  useEffect(() => {
    if (!draft) return;
    const timer = window.setTimeout(() => {
      api.validateDraft(draft).then(setValidation).catch(() => setValidation(null));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draft]);

  // "Already exists?" check.
  useEffect(() => {
    if (!draft) return;
    api.installCheck(scope, project, draft.id).then(setExistsInfo).catch(() => setExistsInfo(null));
  }, [draft?.id, scope, project]);

  const connected = !!status?.version && !status?.infoError;

  const canInstall = !!draft && !!validation?.valid && !installBusy && (!scope || scope === "global" || project.trim().length > 1);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function patchDraft(patch: Partial<SkillDraft>) {
    setInstallResult(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function patchFile(index: number, content: string) {
    setInstallResult(null);
    setDraft((d) => {
      if (!d) return d;
      const files = d.files.map((f, i) => (i === index ? { ...f, content } : f));
      return { ...d, files };
    });
  }

  const goTo = (s: Step) => { setStep(s); window.scrollTo({ top: 0, behavior: "smooth" }); setError(null); };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Wrench size={20} /></div>
          <div>
            <strong>SkillForge</strong>
            <span>Generate, review, and install OpenCode skills — safely.</span>
          </div>
        </div>
        <div className={`pill ${connected ? "ok" : "warn"}`}>
          {statusBusy ? <Loader2 size={14} className="spin" /> : connected ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {statusBusy ? "Checking…" : connected ? `OpenCode ${status?.version ?? ""} connected` : "OpenCode not reached yet"}
        </div>
      </header>

      <nav className="steps" aria-label="Progress">
        {([1, 2, 3, 4, 5] as Step[]).map((s) => (
          <button key={s} className={`step ${s === step ? "active" : ""} ${s < step ? "done" : ""}`} onClick={() => goTo(s)}>
            <span className="step-n">{s < step ? "✓" : s}</span>
            <span>{STEP_TITLES[s]}</span>
          </button>
        ))}
      </nav>

      {error && (
        <div className="card error" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Something needs your attention.</strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      {notice && (
        <div className="card success" role="status">
          <CheckCircle2 size={18} />
          <p>{notice}</p>
        </div>
      )}

      {step === 1 && (
        <section className="card">
          <h2><Plug size={18} /> Step 1 · Connect to OpenCode</h2>
          <p className="muted">
            SkillForge talks to the exact OpenCode already installed on this machine — same providers, same sign-ins. Nothing is stored here.
            Templates work without AI generation. A connection helps verify installs.
          </p>
          {statusError && <p className="bad">Could not check OpenCode: {statusError}</p>}
          {status && !statusError && (
            <div className="grid">
              <div className="stat"><span>OpenCode version</span><strong>{status.version ?? "not found"}</strong></div>
              <div className="stat"><span>Models available</span><strong>{status.models.length}</strong></div>
              <div className="stat"><span>Skills OpenCode sees</span><strong>{status.skills.length}</strong></div>
              <div className="stat"><span>Global skills folder</span><strong className="mono small">{status.globalSkillsRoot}</strong></div>
            </div>
          )}
          {status?.infoError && <p className="bad">OpenCode service: {status.infoError}</p>}
          {status?.modelsError && <p className="bad">Models: {status.modelsError}</p>}
          {status?.skillsError && <p className="bad">Skills: {status.skillsError}</p>}

          <div className="actions">
            <button className="btn secondary" onClick={() => void refreshStatus()} disabled={statusBusy}>
              {statusBusy ? <Loader2 size={16} className="spin" /> : null} Re-check connection
            </button>
            <button className="btn primary" onClick={() => goTo(2)}>
              Continue <ArrowDown size={16} />
            </button>
          </div>
          {!connected && !statusBusy && (
            <p className="hint">
              Tip: open a terminal and run <code>opencode --version</code>. If it’s not connected, you can still pick a template, edit it, and export a ZIP — install verification works best when OpenCode is reachable.
            </p>
          )}
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h2>Step 2 · Choose where the skill lives</h2>
          <div className="radio-cards">
            <button className={`radio-card ${scope === "global" ? "on" : ""}`} onClick={() => setScope("global")}>
              <strong>🌍 All projects (Global)</strong>
              <span>Saved to your personal skills folder. Every project can use it. Best for skills you reuse everywhere.</span>
              <code className="mono small">{status?.globalSkillsRoot ?? "~/.config/opencode/skills"}</code>
            </button>
            <button className={`radio-card ${scope === "project" ? "on" : ""}`} onClick={() => setScope("project")}>
              <strong>📁 One project only</strong>
              <span>Saved inside the project as <code>.opencode/skills/</code>. Only that project sees it. Best for project-specific rules.</span>
            </button>
          </div>
          {scope === "project" && (
            <label className="field">
              <span>Project folder path</span>
              <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="/path/to/your-project" spellCheck={false} />
              <small className="hint">Copy the path from your file manager. The skill will go into <code>&lt;path&gt;/.opencode/skills/&lt;id&gt;/SKILL.md</code>.</small>
            </label>
          )}
          <div className="actions">
            <button className="btn secondary" onClick={() => goTo(1)}>Back</button>
            <button className="btn primary" onClick={() => goTo(3)} disabled={scope === "project" && project.trim().length < 2}>
              Continue <ArrowDown size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="card">
          <h2>Step 3 · Pick a template</h2>
          <p className="muted">
            Choose a built-in template (no AI generation, no API key needed). You can edit everything in Step 4 before installing.
          </p>

          <div className="subcard">
            <h3>Built-in templates</h3>
            <div className="templates">
              {templates.map((t) => (
                <article key={t.id} className="template">
                  <strong>{t.name}</strong>
                  <span>{t.tagline}</span>
                  <code className="mono small">{t.id}</code>
                  <button
                    className="btn primary"
                    onClick={() => { setDraft({ ...t, source: "template" }); setInstallResult(null); setNotice(`Template "${t.name}" loaded. Edit it in Step 4.`); goTo(4); }}
                  >
                    Use this template
                  </button>
                </article>
              ))}
              {templates.length === 0 && <p className="muted">Templates are loading…</p>}
            </div>
          </div>

          <div className="subcard">
            <h3>Write it yourself</h3>
            <p className="muted">Start from a blank skill and write in Step 4.</p>
            <button className="btn secondary" onClick={() => { setDraft({ id: slugify("my-skill"), name: "My Skill", description: "", files: [{ path: "SKILL.md", content: "---\nname: My Skill\ndescription: \n---\n\n## Workflow\n\n1. \n\n## Rules\n\n- \n" }], source: "manual" }); goTo(4); }}>
              Start blank
            </button>
          </div>

          <div className="actions">
            <button className="btn secondary" onClick={() => goTo(2)}>Back</button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="card">
          <h2><FlaskConical size={18} /> Step 4 · Review &amp; install</h2>
          {!draft ? (
            <>
              <p className="muted">No draft yet. Go back to Step 3 and generate one, pick a template, or start blank.</p>
              <div className="actions"><button className="btn primary" onClick={() => goTo(3)}>Go to Step 3</button></div>
            </>
          ) : (
            <>
              <div className="grid two">
                <label className="field">
                  <span>Skill ID (lowercase, hyphens)</span>
                  <input value={draft.id} onChange={(e) => patchDraft({ id: slugify(e.target.value) })} spellCheck={false} />
                  <small className="hint">This becomes the folder name and the <code>@skill</code> name. No spaces, no capitals.</small>
                </label>
                <label className="field">
                  <span>Display name</span>
                  <input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} />
                </label>
              </div>

              <label className="field">
                <span>Description — what it does + when to use it (shown to the model on every step)</span>
                <input value={draft.description} onChange={(e) => patchDraft({ description: e.target.value })} placeholder="e.g. Review code changes for bugs and missing tests. Use when asked to review a PR." />
                <small className="hint">
                  {draft.description.length} characters · ~{estimateTokens(draft.description)} tokens every step · ideal: 60–200 chars. Include “Use when…” so GPT, Grok, and Gemini load it at the right time.
                </small>
              </label>

              {draft.files.length > 1 && (
                <div className="tabs">
                  {draft.files.map((f, i) => (
                    <button key={f.path} className={editingFile === i ? "on" : ""} onClick={() => setEditingFile(i)}>{f.path}</button>
                  ))}
                </div>
              )}
              <label className="field">
                <span>File: {draft.files[editingFile]?.path ?? "SKILL.md"} (Markdown, model-neutral)</span>
                <textarea
                  className="code"
                  rows={16}
                  value={draft.files[editingFile]?.content ?? ""}
                  onChange={(e) => patchFile(editingFile, e.target.value)}
                  spellCheck={false}
                />
                <small className="hint">
                  ~{draft.files[editingFile] ? estimateTokens(draft.files[editingFile].content) : 0} tokens in this file. The body only loads when the skill is invoked — long detail belongs in a references/ file.
                </small>
              </label>

              <div className={`validate ${validation?.valid ? "ok" : "bad-box"}`}>
                <strong>{validation ? (validation.valid ? "✅ Ready to install" : "⚠️ Fix these before installing") : "Checking…"}</strong>
                {validation && (
                  <p className="muted">
                    Total ~{validation.tokens} tokens · description ~{validation.descriptionTokens} (every step) · body ~{validation.bodyTokens} (only when used).
                  </p>
                )}
                <ul>
                  {(validation?.issues ?? []).map((issue, i) => (
                    <li key={i} className={issue.level}><span>{issue.level === "error" ? "⛔" : issue.level === "warn" ? "⚠️" : "ℹ️"}</span> {issue.message}</li>
                  ))}
                </ul>
              </div>

              {existsInfo?.exists && (
                <label className="check">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  <span>
                    A skill with this ID already exists at <code className="mono small">{existsInfo.target}</code>.
                    Tick to replace it — a timestamped backup is saved first, so nothing is lost.
                  </span>
                </label>
              )}

              <div className="install-box">
                <p>
                  <strong>What happens when you click Install:</strong>{" "}
                  {scope === "global" ? "writes to your global skills folder" : `writes to ${project}/.opencode/skills/${draft.id}/`},
                  then asks OpenCode to confirm it can see the new skill. OpenCode picks it up automatically — no restart, no config edit.
                </p>
                <div className="actions">
                  <button
                    className="btn secondary"
                    onClick={() => void run(async () => { await api.exportZip(draft); setNotice("Zip downloaded. Unzip it into any skills folder, or share it with a teammate."); })}
                  >
                    <Download size={16} /> Download ZIP
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => void run(async () => { await navigator.clipboard.writeText(draft.files[editingFile]?.content ?? ""); setNotice("Copied to clipboard."); })}
                  >
                    <Copy size={16} /> Copy file
                  </button>
                  <button
                    className="btn primary big"
                    disabled={!canInstall || (existsInfo?.exists && !overwrite)}
                    onClick={() => void run(async () => {
                      setInstallBusy(true);
                      try {
                        const res = await api.install({ draft, scope, project, overwrite });
                        setInstallResult(res);
                        setNotice(
                          res.verified
                            ? `Installed and confirmed! OpenCode now lists "${draft.id}". Try @${draft.id} in any OpenCode session.`
                            : `Installed to ${res.target}. OpenCode's watcher may need a few seconds — run "opencode api get /api/skill" to double-check.`,
                        );
                        void refreshStatus();
                      } finally {
                        setInstallBusy(false);
                      }
                    })}
                  >
                    {installBusy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                    Install into OpenCode ({scope === "global" ? "global" : "project"})
                  </button>
                </div>
                {installResult?.backup && <p className="hint">Backup saved at: <code className="mono small">{installResult.backup}</code></p>}
                <p className="hint">Try it: in OpenCode, type <code>@{draft.id}</code> in your prompt, or just ask for the task and the model should load it by itself.</p>
              </div>
            </>
          )}
          <div className="actions">
            <button className="btn secondary" onClick={() => goTo(3)}>Back</button>
            <button className="btn secondary" onClick={() => goTo(5)}>Tidy documentation →</button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="card">
          <h2><FileSearch size={18} /> Step 5 · Tidy stray documentation</h2>
          <p className="muted">
            Scans a project for docs in the wrong place (loose <code>.md</code> files in source folders, stray files at the root, loose PDFs/DOCXs) and proposes a tidy home under <code>docs/</code>.
            <strong> It never deletes anything</strong> — it only moves, writes a manifest, and can undo every move.
          </p>

          <div className="grid two">
            <label className="field">
              <span>Folder to scan</span>
              <input value={scanRoot} onChange={(e) => setScanRoot(e.target.value)} spellCheck={false} />
              <small className="hint">Tip: scan <code>{DEFAULT_PROJECT}</code> for this app, or <code>/home/minima/Documents/Projects</code> to see stray files sitting next to all your projects.</small>
            </label>
            <div className="field">
              <span>Actions</span>
              <div className="actions">
                <button
                  className="btn primary"
                  disabled={scanBusy}
                  onClick={() => void run(async () => {
                    setScanBusy(true);
                    setScanDone(false);
                    try {
                      const res = await api.scanDocs(scanRoot);
                      setFindings(res.findings);
                      setScanRoot(res.root);
                      setSelected(new Set(res.findings.filter((f) => f.confidence === "high").map((f) => f.rel)));
                      setScanDone(true);
                      setNotice(res.findings.length === 0 ? "No stray documentation found. Everything is in its proper place. 🎉" : `Found ${res.findings.length} file(s) in the wrong place. High-confidence ones are pre-selected — review, then Apply.`);
                    } finally {
                      setScanBusy(false);
                    }
                  })}
                >
                  {scanBusy ? <Loader2 size={16} className="spin" /> : <FileSearch size={16} />} Scan folder
                </button>
              </div>
            </div>
          </div>

          {scanDone && findings.length > 0 && (
            <>
              <div className="actions">
                <button className="btn secondary" onClick={() => setSelected(new Set(findings.map((f) => f.rel)))}>Select all</button>
                <button className="btn secondary" onClick={() => setSelected(new Set())}>Select none</button>
                <button className="btn secondary" onClick={() => setSelected(new Set(findings.filter((f) => f.confidence === "high").map((f) => f.rel)))}>Safe only (high confidence)</button>
                <span className="hint">{selected.size} of {findings.length} selected</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th></th><th>File</th><th>Problem</th><th>Proposed home</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    {findings.map((f) => (
                      <tr key={f.path}>
                        <td><input type="checkbox" checked={selected.has(f.rel)} onChange={(e) => setSelected((s) => { const next = new Set(s); if (e.target.checked) next.add(f.rel); else next.delete(f.rel); return next; })} aria-label={`Select ${f.rel}`} /></td>
                        <td className="mono small">{f.rel}</td>
                        <td>{f.issue}</td>
                        <td className="mono small">{f.proposed}</td>
                        <td>{f.reason} <em>({f.confidence} confidence)</em></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="install-box">
                <p><strong>What happens on Apply:</strong> each selected file moves to its proposed home (collisions get a <code>-2</code> suffix, never overwritten), a manifest is written to <code>docs/.skillforge-manifest-…json</code>, and a <code>docs/README.md</code> index is created if missing. Zero deletions.</p>
                <div className="actions">
                  <button
                    className="btn primary"
                    disabled={selected.size === 0}
                    onClick={() => void run(async () => {
                      const moves = findings.filter((f) => selected.has(f.rel)).map((f) => ({ from: f.rel, to: f.proposed }));
                      const res = await api.applyDocs(scanRoot, moves);
                      setManifestPath(joinPath(scanRoot, `docs/.skillforge-manifest-${res.manifest.createdAt.replace(/[:.]/g, "-")}.json`));
                      setNotice(`Moved ${res.moved} file(s). Manifest saved — undo is one click below.`);
                      setFindings([]);
                      setSelected(new Set());
                      setScanDone(false);
                    })}
                  >
                    Apply {selected.size} move(s)
                  </button>
                </div>
              </div>
            </>
          )}

          {manifestPath && (
            <div className="subcard">
              <h3><RotateCcw size={16} /> Undo the last cleanup</h3>
              <p className="hint">Manifest: <code className="mono small">{manifestPath}</code></p>
              <div className="actions">
                <button
                  className="btn secondary"
                  disabled={undoBusy || !manifestPath}
                  onClick={() => void run(async () => {
                    setUndoBusy(true);
                    try {
                      const res = await api.undoDocs(manifestPath);
                      setNotice(`Restored ${res.restored} file(s) to their original places.`);
                      setManifestPath("");
                    } finally {
                      setUndoBusy(false);
                    }
                  })}
                >
                  {undoBusy ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />} Restore files
                </button>
              </div>
            </div>
          )}

          <div className="actions">
            <button className="btn secondary" onClick={() => goTo(4)}>Back to install</button>
          </div>
        </section>
      )}

      <footer className="foot">
        <p>
          <strong>Safety guarantees:</strong> SkillForge only writes inside the folders you pick · it never deletes files ·
          it backs up before overwriting and writes a manifest before moving docs · every step can be undone.
        </p>
        <p className="muted">
          Token strategy (works the same on GPT, Grok, Gemini): a short trigger description that loads on every step + a lean,
          numbered body that only loads when the skill is used + long detail in <code>references/</code> files read on demand.
        </p>
      </footer>
    </div>
  );
}

function joinPath(a: string, b: string): string {
  return a.endsWith("/") ? `${a}${b}` : `${a}/${b}`;
}
