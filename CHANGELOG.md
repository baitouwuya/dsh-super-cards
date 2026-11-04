# Changelog

## 0.12.2 — 2026-11-05

First public release. Requires DeepSeek Harness `0.2.2-rc.1` (cordis `4.1.0`) or newer.

### Added

- `render_ui` Host tool and the matching Web card row: 29 block types, rendered inline in the
  conversation from the recorded tool arguments.
- `content` auto layout next to explicit `blocks`, with arrangement (sections to columns/tabs),
  asymmetric-split heuristics, and the `render_ui_blocks` on-demand contract lookup.
- Four placements: `answer`, `process`, `dock` (board above the composer), `tail` (Turn footer).
- Schemastery-backed configuration (volatile fields) rendered on the plugin page and in a
  dedicated Settings tab, plus the `cordis.patch.yml` row form.
- Optional auto next-step card generation on `turn/end` (`nextSteps`, off by default).
- Mermaid fence auto-conversion, subagent progress card, card copy-to-Markdown, close/reopen.
- `superCards` Client service for extension blocks and placements.
- Host/Client parity tests, a documentation guard, and measured performance numbers
  (see `docs/internals`).

### Notes

- Earlier `0.1`–`0.12` versions were development builds installed by path inside a private
  profile and were never published to npm.
- `@deepseek-ai/schemastery` is a runtime dependency; `npm run sync:vendor` can restore an
  offline copy from the installed app bundle.
