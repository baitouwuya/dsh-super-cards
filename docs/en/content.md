# Auto layout

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

`content` is `render_ui`'s auto-layout input: the model only describes the material to show, and the card picks the controls and decides the order. Derivation rules live in [lib/content.js](../../lib/content.js); the Host and the Client each have an implementation, and tests compare their outputs field by field, so the same `content` produces the same card on replay.

## Field table

| Field | Shape | Derived controls |
| --- | --- | --- |
| `summary` | string or `{text, tone?, title?}` | `callout`, default `info` tone, always first |
| `metrics` | `[{label, value, delta?, hint?, tone?}]` or `{label: value}` | `stats`; falls back to `list` when `stats` is disabled |
| `series` | `{values, labels?, title?, unit?, kind?}` | `sparkline` for a trend; `bars` for short category comparison |
| `breakdown` | `{items, title?, unit?, kind?}` | `pie` when at most 8 slices; `bars` when more or when `bars` is requested |
| `table` | `{columns, rows, align?, caption?}` | `table` |
| `steps` | `[{title, text?, time?, tone?}]` or an array of strings | `timeline`; falls back to an ordered `list` when disabled |
| `items` | array of strings | `list` |
| `facts` | `{key: value}` or `[{key, value}]` | `keyvalue`; two columns when at most 8 items |
| `tags` | array of strings or `[{label, tone?}]` | `badges` |
| `code` | string or `{code, language?, title?}` | `code` |
| `quote` | string or `{text, by?}` | `quote` |
| `links` | `[{label, href, description?}]` | `links` |
| `image` | string or `{src, alt?, caption?, height?, fit?}` | `image` |
| `tree` | `{nodes, title?}` or an array of nodes | `tree` |
| `flow` | `{kind?, title?, direction?, nodes?, edges?, participants?, messages?}` | `diagram` |
| `note` | string or `{text, tone?}` | `callout`, default `warn` tone |
| `sections` | [{heading, ...any content field}] | 2 to 3 sections side by side as `columns`, 4 to 5 sections as `tabs`, more stack under headings |
| `blocks` | `[Block, ...]` | hand-written blocks, appended after the auto blocks |
| `actions` | `[{label, prompt, tone?}]` | `actions`, last among the auto blocks |

`series` decision: with at least 6 `values`, or with no labels, it draws a trend as `sparkline`; with labels and fewer than 6, it draws the short series as `bars`, and stacks them vertically when at most 8. `breakdown` decision: default is `pie` with at most 8 slices; `kind: "bars"` or more slices switches to `bars`. The only difference between `summary` and `note` is the default tone and the reading position; both render as `callout`.

## Layout rules

- Fields enter reading order in written order, with two exceptions: `summary` is always first, and `actions` is always last among the auto blocks.
- Ordinary blocks always stack full-width and never pair up automatically; only `sections` forms side-by-side rows.
- With 2 to 3 `sections`, they are placed side by side as `columns` only when their estimated heights are close (the tallest is at most 2.2 times the shortest); otherwise each stacks under its heading. 4 to 5 sections become `tabs`; more than 5 stack under headings.
- Side-by-side widths follow content: sections with a table, heatmap, kanban, diagram, code, image, HTML, or tree take 2 shares; text or chart sections take 1 share. When the height gap is too large they do not sit side by side, to avoid whitespace under short panes.
- Inside `sections`, layout is `stack` and sections never nest further; `tabs` and `columns` are also not allowed to nest in each other.
- `layout` takes `auto` (default) or `stack`. `stack` gives every block its own row, and `sections` stack under headings too.
- On narrow cards, side-by-side `columns` fold back to a single column.

## Example

```jsonc
{
  "title": "本周发布",
  "subtitle": "10/28 – 11/03 · 3 个服务",
  "icon": "chart",
  "content": {
    "summary": "18 次发布全部完成，其中 2 次回滚已恢复。",
    "metrics": [
      {"label": "发布次数", "value": 18, "delta": "+3", "tone": "success"},
      {"label": "P95 延迟", "value": "212 ms", "delta": "-8%"}
    ],
    "series": {"title": "P95 延迟", "values": [240, 228, 231, 219, 212], "unit": "ms"},
    "breakdown": {"title": "变更来源", "unit": "%", "items": [
      {"label": "自动发布", "value": 62}, {"label": "手动触发", "value": 24}, {"label": "定时任务", "value": 14}
    ]},
    "actions": [{"label": "查看发布日志", "prompt": "查看本周的发布日志", "tone": "primary"}]
  }
}
```

This card produces: a `callout` summary, a `stats` metric grid, a `sparkline` trend, a `pie` breakdown, and `actions` at the end. An "auto layout" marker appears under the title, showing the blocks were derived from `content`.

## When to use content, when to use blocks

- Use `content` when you know the data to show but are unsure whether to use a metric grid or a table, or whether to place things side by side; this also keeps the card consistent across the two implementations.
- Use `blocks` when you need exact controls, order, motion, or the hand-written `columns` `weights` to control width.
- Mixing: blocks derived from `content` come first and `blocks` are appended after. `content`'s `actions` comes last among the auto blocks, but hand-written blocks continue after it.

## dropped report

`render_ui`'s return is `{ok, blocks, types, place}`, with an extra `dropped` array when something was dropped; each entry is `{index, type, reason}`. Common reasons:

- `unknown block type`: the type name is not in the enum;
- `block type not enabled by config`: the type is disabled by the row config's `blocks`;
- `no usable content`: the fields are missing or empty, so normalization cannot render it;
- `over the block cap`: exceeds the per-card cap;
- `not allowed in a dock board`: the board does not accept that type.

Auto layout is subject to the same caps. After seeing `dropped`, the model should fix the corresponding block and call again; the card renders the remaining blocks normally.

## Related

- [Block reference](blocks.md)
- [Getting started](getting-started.md)
- [Four placements](placements.md)