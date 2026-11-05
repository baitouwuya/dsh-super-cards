# Changelog

## 0.12.4 — 2026-11-05

### Changed

- `stats` rows are balanced: the renderer picks a base column count from the item count, so six
  metrics read 3+3 instead of 5+1, and a container query folds the row back on narrow cards
  (two columns, then one); an odd count lets the last tile take the whole row rather than sit in
  a half-empty one.
- A stat value is a datum, not prose: `word-break: keep-all` keeps "1503 通过" from splitting
  into "通/过" when a tile is tight, and the value/delta line wraps between them instead of
  squeezing the number.

## 0.12.3 — 2026-11-05

### Changed

- `list` blocks now use the width of a wide card: six or more items (none longer than 220
  characters) flow into as many columns as fit, at least 21rem each, instead of one ragged
  62-character line with a hole beside it. A list inside a narrow `columns` cell still
  stacks, and ordered lists flow too (grid keeps DOM order left to right).
- The reading measure is one token now (`--dsh-sc-measure: 62ch`) shared by `text`,
  `keyvalue` and `list`, so the cap is documented in one place.

### Fixed

- A call that never became a card used to show one blanket "UI 规格无效" notice, even when the
  call had no arguments at all (a `render_ui` call rejected before dispatch in a preset where
  only `run_code` is callable). The notice now names the cause — empty arguments, invalid JSON
  (with the parser message underneath), or a spec with no renderable blocks.

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
