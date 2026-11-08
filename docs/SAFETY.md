# Safety

## Guarantees

1. **Localhost only.** The API binds `127.0.0.1`. It is not reachable from
   your network.
2. **No secrets.** SkillForge never asks for, stores, or sends API keys. All
   model calls go through your local `opencode` CLI.
3. **No deletes.** Doc cleanup moves files; installs back up before
   overwriting. The worst case is always "undo", never "gone".
4. **Path-checked writes.** Every write is verified to be inside the target
   root (`assertInside`). A crafted draft cannot escape the skill folder.
5. **Validation gates.** Invalid IDs, placeholders, and suspected secrets
   block installation with a plain-language explanation.

## Limits (read before pointing it at production repos)

- The scanner is heuristic: it proposes, you approve. Medium-confidence
  moves (loose binaries, odd folders) deserve a look.
- `docs/README.md` index links are relative and may need a pass after a
  big move — grep for old paths if a project links docs directly.
- Generation quality depends on your chosen model and goal text; the
  **Review** step exists precisely so a human still judges the draft.
- Keep the dev server on your machine; do not expose port 5174 publicly.
