# Block reference

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

`render_ui` supports 29 block types. The model can write `blocks` to specify each one individually, or use `content` to let the card pick blocks automatically. This page gives quick reference by scenario and the minimal JSON for each block; the exact field shapes are returned by `render_ui_blocks` on demand, and the full registry lives in [lib/blocks.js](../../lib/blocks.js).

## Choose a block by scenario

| Scenario | Recommended blocks |
| --- | --- |
| Comparing two plans or two columns of information | `table`, `columns`, `tabs` |
| Key metrics | `stats` |
| Share of a whole | `pie` |
| Trend changes | `sparkline` |
| Ranking or short category comparison | `bars` |
| Steps and history | `timeline` |
| Hierarchy, directory, decision paths | `tree` |
| State-flow boards | `kanban` |
| Code and diffs | `code`, `diff` |
| Flow diagrams and UML | `diagram` |
| Images | `image` |
| Custom animation or small demo | `html` |
| Real-time counters and message streams | `live`, effective only in the board |
| Next-step buttons | `actions` |

## Text and labels

- `text` paragraph: `{"type":"text","text":"全部 **健康**。"}`. `text` is required; supports `**粗体**` and inline code, and a newline is a line break.
- `heading` sub-heading: `{"type":"heading","text":"服务","level":2}`. `level` takes 1, 2, or 3.
- `callout` notice box: `{"type":"callout","tone":"info","text":"14:00 开始灰度。"}`. `tone` and `title` are optional.
- `quote` pull-quote: `{"type":"quote","text":"Ship small.","by":"发布说明"}`. `by` is optional.
- `badges` tags: `{"type":"badges","items":[{"label":"stable","tone":"success"}]}`. Each tag has `label` and optional `tone`.
- `divider` horizontal rule: `{"type":"divider"}`, no fields.

## Metrics and numbers

- `stats` metric grid: `{"type":"stats","items":[{"label":"Pod","value":"12/12","tone":"success"}]}`. `value` can be a number or short string; `delta`, `hint`, and `tone` are optional.

  The column count comes from the item count so the last row is never a single lonely tile (six items read 3+3); on a narrow card it folds to two columns or one, and an odd count lets the last tile take the whole row.- `keyvalue` spec sheet: `{"type":"keyvalue","items":[{"key":"区域","value":"eu-west-1"}]}`. The block picks its own shape: up to six short facts tile (two columns, three across, 3+2, or a 2x2), while a value over 28 characters, a key over 16, or more than six facts turns it into a label/value row sheet — a sentence is never wrapped inside a half-width tile, and an odd count leaves no hole. `columns` takes 1 (one fact per line) or 2 (force the tile grid).
- `progress` progress bars: `{"type":"progress","items":[{"label":"迁移","value":0.72}]}`. `value` is between 0 and 1; 1 renders a checkmark.
- `bars` bar chart: `{"type":"bars","items":[{"label":"api","value":42},{"label":"web","value":18}]}`. `direction: "vertical"` makes a column chart, suitable for a small set of categories.
- `sparkline` trend line: `{"type":"sparkline","values":[212,199,187,190],"unit":"ms"}`. `labels` count must match `values`.
- `pie` pie/donut chart: `{"type":"pie","items":[{"label":"api","value":62},{"label":"web","value":38}]}`. Default is donut; `donut: false` makes solid.
- `heatmap` heatmap: `{"type":"heatmap","columns":14,"items":[{"label":"周一","value":3}]}`. `max` can fix the intensity scale. The foot line names what the run covers and adds up to (first and last label, e.g. `10/21 – 11/03 · 37次`) on the left, with the color key on the right; each cell keeps its full label in `title`.

## Tables and boards

- `table` data table: `{"type":"table","columns":["服务","状态"],"rows":[["api","healthy"]]}`. `align` is per-column, `caption` is a line below the table.
- `diff` code diff: `{"type":"diff","lines":[{"kind":"del","text":"retries: 3,"},{"kind":"add","text":"retries: 5,"}]}`. `kind` takes `add`, `del`, or `ctx`. It renders with the host `DiffBlock` — accent bars, copy, wrap, collapse — which means turning the line list back into the before/after texts it wants; the local renderer serves shells without it.
- `kanban` board: `{"type":"kanban","columns":[{"title":"待办","cards":[{"title":"限流"}]}]}`. Cards can carry `text`, `badges`, and `tone`. Lanes sit side by side on a wide card (scrolling when there are many) and stack one per row once the container is 600px or narrower.

## Structure and relations

- `list` list: `{"type":"list","ordered":true,"items":["构建","测试"]}`. `ordered` controls ordered vs unordered.
  On a wide card a list of at least six items, none longer than 220 characters, flows into columns (never narrower than 21rem each, and back to one column inside a narrow cell) instead of leaving the right side empty.
- `tree` hierarchy: `{"type":"tree","nodes":[{"label":"src","children":[{"label":"client.js"}]}]}`. Nodes can carry `note`, `badge`, and `tone`.
- `diagram` diagram: `{"type":"diagram","kind":"flowchart","nodes":[{"id":"a","label":"请求"},{"id":"b","label":"部署"}],"edges":[{"from":"a","to":"b"}]}`. `kind` takes `flowchart`, `state`, `sequence`, `class`, or `er`; one card holds one diagram.
- `timeline` timeline: `{"type":"timeline","items":[{"title":"构建","time":"14:02"}]}`. `text`, `time`, and `tone` are optional.
- `links` links: `{"type":"links","items":[{"label":"Runbook","href":"https://example.com/runbook"}]}`. Only `http`, `https`, and `mailto` render as links.

## Containers and layout

- `columns` side-by-side panes: `{"type":"columns","items":[{"blocks":[{"type":"text","text":"左"}]},{"blocks":[{"type":"text","text":"右"}]}]}`. At most 3 panes; `weights` gives each pane 1 to 3 shares of width.
- `tabs` tabbed panes: `{"type":"tabs","items":[{"label":"概览","blocks":[{"type":"text","text":"..."}]}]}`. At most 5 pages; pages cannot nest `tabs` or `columns`. The row is the host's own `SegmentedTabs` — arrow keys, sliding indicator — and a matching local row when the probe finds nothing.

## Interaction and dynamics

- `actions` buttons: `{"type":"actions","items":[{"label":"查看日志","prompt":"查看日志","tone":"primary"}]}`. A click only fills `prompt` into the input box; it does not auto-send.
- `controls` controls: `{"type":"controls","items":[{"kind":"button","label":"深色","action":{"kind":"setting","setting":"theme","value":"dark"}}]}`. `kind:"setting"` segmented controls write DSH settings directly; buttons can apply settings or submit a prompt.
- `live` live content: `{"type":"live","field":"messages","limit":5}`. `field` takes `messages`, `tools`, or `last-message`; effective only in a board (`place: "dock"`).

## Rich media

- `code` code block: `{"type":"code","language":"bash","code":"dsh deploy --prod"}`. `language` and `title` are optional; inline marks are not parsed inside code. When the host seeds `@deepseek-ai/dsh-client-ui-primitives`, the block is colored by the host's own shiki instance — the same `--shiki-*` palette as the transcript's code blocks, with languages loaded lazily — and falls back to plain text when the probe finds nothing.
- `image` image: `{"type":"image","src":"https://example.com/chart.png","alt":"延迟趋势"}`. `src` accepts only `https`, `http`, or `data:image/*`. The picture is shown whole, at the card width, in its own aspect ratio: nothing is cropped, nothing is letterboxed into a fixed frame, and no space is left empty beside it. A portrait screenshot makes a tall figure — let it be tall instead of shrinking it into a thumbnail; `height` and `fit` are retired and an old spec that carries them still renders.
- `html` custom visual: `{"type":"html","height":160,"html":"<div class='orb'></div>"}`. Rendered in a sandboxed iframe, with no network or same-origin access; source limit is 20000 characters, `height` is 120 to 800.

Every block can additionally carry a `motion` object; details in [Advanced capabilities](advanced.md).

## Caps

Caps come from `CAPS` in [lib/shared.js](../../lib/shared.js); anything beyond is truncated or dropped, and dropped items are reported in the result's `dropped` array.

| Item | Cap |
| --- | --- |
| Blocks per card | 24 |
| Table rows | 50 |
| Text fields | 4000 characters |
| Code blocks | 8000 characters |
| Sparkline values | 120 |
| Actions buttons | 8 |
| Pie slices | 8 |
| Tree nodes | 200 nodes, 4 levels |
| Heatmap cells | 371 |
| Diff lines | 400 |
| Kanban | 4 columns, 8 cards per column |
| Tabs | 5 pages, 6 blocks per page |
| Columns | 3 panes, 6 blocks per pane |
| Kanban block | 4 |
| Diagram | 24 nodes, 48 edges, 8 participants, 24 messages |
| Embedded image data URI | 200000 characters |
| Image height | 80 to 640 |
| HTML source | 20000 characters |
| HTML height | 120 to 800 |
| Live count | 1 to 10 |
| Controls items | 8, 6 options per group |

## Content field names and alias folding

Field names from `content` (`note`, `summary`, `metrics`, `series`, `breakdown`, `steps`, `items`, `tags`, `facts`, `flow`, `notice`, `bullets`) are not block types and are not in the tool enum. If you write one as a block's `type` by mistake, the normalization on both halves folds it to the block that renders the same content:

- `note` folds to `callout` and adds the `warn` tone;
- `summary` and `notice` fold to `callout` and add the `info` tone;
- `metrics` folds to `stats`, `series` to `sparkline`, `breakdown` to `pie`;
- `steps` folds to `timeline`, `items` and `bullets` to `list`;
- `facts` folds to `keyvalue`, `tags` to `badges`, `flow` to `diagram`.

Folding only renames; it does not reshape the data. When the data does not satisfy the target block's requirements it is still dropped as "no usable content".

## Related

- [content auto layout](content.md)
- [Advanced capabilities](advanced.md)
- [Troubleshooting](troubleshooting.md)