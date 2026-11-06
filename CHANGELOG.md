# Changelog

## 0.14.0 — 2026-11-06

### Changed

- The `tabs` row is the shell's own `SegmentedTabs` when the frozen module table exports it:
  the host owns the sliding indicator, the roving tabindex and the arrow keys, so switching
  tabs in a card works like switching them anywhere else in the app. The card keeps the pane —
  a pane is just more blocks — and the frame that used to wrap it is gone, so the pane's blocks
  line up with the rest of the card. Shells without the module get a local row with the same
  markup and the same look.
- The host control is a grid of equal segments, which squeezes long labels into an ellipsis in
  a narrow card, so under a 520px container the row becomes a wrapping flex line: every label
  stays whole, the selected tab carries the fill itself (the indicator only tracks equal
  segments), and the local row follows the same rule.
- A settings row takes the host `SegmentedControl`'s geometry — the tinted
  `interactive-bg-hover` tray, the raised indicator on the theme's soft elevation, the same
  28px height and the same metrics — but not the component: that control is a tab/tabpanel
  pair and a setting has no panel, so `controls` keeps a `group` of pressed toggles. The tray
  was nearly invisible against a white card before, and the selected segment now reads as a
  raised pill in both themes.
- A `diff` is the host `DiffBlock`. The block's line list is turned back into the before/after
  texts that component wants — a removed line only exists in the old text, an added line only
  in the new one, and a context line sits on both — and its own engine regenerates the hunks.
  That buys the tinted rows with accent bars, the copy-diff button, the wrap toggle and the
  collapse row for long patches; the `+n/−n` summary moves into the banner next to the language
  name, and the block keeps the host's code typography so it follows the app's code-font-size
  setting. A shell that predates the primitives package still renders the local patch view.

## 0.13.0 — 2026-11-06

### Changed

- A `keyvalue` / `facts` block now picks its shape from its own content instead of always
  splitting into two columns. Up to six short facts stay a tile grid (two side by side,
  three across, five and six as 3+2 and 3+3); a sentence-long value (over 28 characters), a
  long key (over 16), or a seventh fact turns the sheet into label/value rows — one column sized to the
  longest key (`fit-content(34%)`), one column for the value — so text no longer wraps inside
  a half-width tile and an odd count leaves no empty cell beside the last fact.
- A tile grid may spend the card's width (`min(100%, 84ch)`) instead of stopping at the
  62-character reading measure, and a row sheet gets `--dsh-sc-measure-wide: 76ch` because
  its first column is labels. Under 600px the row sheet stacks (key above value) rather than
  squeezing two columns.
- The Host and the Client make the same call (`kvLayout`), so the derived blocks and the
  height estimate used for section balancing agree, and `columns` is a request again — set it
  to 1 for one fact per line, leave it out for the automatic shape.
- A `bars` label column hugs its longest label (`fit-content(30%)`) instead of taking a fixed
  32%, so three-letter service names no longer push the bar half a card to the right.
- The `timeline` rail runs from one dot into the next item (`bottom: -6px`, 12% ink), so the
  steps read as one line instead of a row of loose bullets.
- A narrow card no longer clips a `kanban`: under a 600px container the lanes stack one per
  row instead of leaving the second lane half outside a horizontal scroll region nobody
  discovers. The lane's 190px basis is a height once the flex direction flips, so the
  container query also resets it.
- A `heatmap` foot line names what the run covers and totals it (`10/21 – 11/03 · 37次`) on
  the left of the legend, so fourteen anonymous cells stop being decorative; units join the
  way they read — `7 ms`, but `7次` and `7%`.
- A `progress` caption that only repeats the percentage the row already prints (`caption:
  "62%"` beside `value: 0.62`) is dropped; a caption that adds something stays.
- `code` blocks are syntax-highlighted by the host itself. The Web shell seeds
  `@deepseek-ai/dsh-client-ui-primitives` into its module table, so the Client half now
  probes it (inside a `try`/`catch`, no `dsh.client.external`, no bundled highlighter) and
  renders the host's own shiki tokens inline under the same `--shiki-*` variables the
  transcript uses; languages load lazily and the plain text shows until they arrive. The
  plugin keeps its own frame, title, language label and wrap toggle. A shell that predates
  the primitives package renders exactly as before.

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
