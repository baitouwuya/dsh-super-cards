Add `dsh-super-cards`.

- Repo: https://github.com/baitouwuya/dsh-super-cards
- npm: `dsh-super-cards@0.12.2` (published; `repository` points back at the listed repo)
- Category: `ui` — the plugin renders native answer cards in the conversation (29 block types, four placements), with a settings form.
- `package.json` declares both `dsh.bundle.patch` and `dsh.client` (web); root has `cordis.patch.yml`.
- No build step, no runtime deps beyond `@deepseek-ai/schemastery` (installed by npm).
- 242 offline tests; CI green on `main`; repo has the `dsh-plugin` topic and `screenshots.json` (4 images under `docs/assets/`).
- Entry validated locally with `validateEntries(readEntries('data/plugins'))` from `scripts/lib/entries.mjs` → `problems: []`.
