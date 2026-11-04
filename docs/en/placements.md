# Four placements

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

`render_ui`'s `place` decides where the card hangs in the session. The four values map to four entries in the Client half's `PLACEMENTS` registry; an unknown value falls back to `answer`. The default can be changed with the row config's `defaultPlace`.

## answer

- The default placement, part of the answer prose: the card is inserted where the model called it, a lead-in paragraph may precede it, and the prose may continue after it.
- The card stays visible after "Process" is collapsed, because it sits in the `turn` group tree rather than inside the process.
- One answer may call it several times and inserts several cards in call order.

## process

- A display card that belongs to the execution process and collapses together with "Process": once the process is collapsed it is no longer visible.
- Suited to information that serves the process only, such as temporary stats during a run or phase progress.
- The tool row itself does not repeat the card content inside the process; the presentation is the same when "Process" is expanded or collapsed.

## dock

The board is pinned above the input box and matches its width; it is a compact status area for the duration of the run.

- By default it is a single collapsible status bar: title, item count, expand chevron; expanded, it shows compact content with a height cap.
- The board is bound to its own turn and closes when the turn ends; once closed it becomes a single line "board closed", and a click reopens it.
- If the model does not output another answer card in that turn, the plugin turns the board content back into an ordinary card at the end of the turn; see below.
- The board only renders blocks from a whitelist, at most 4:
  `text`, `heading`, `callout`, `stats`, `list`, `badges`, `progress`, `live`.
  Other types are dropped and reported as `not allowed in a dock board`; beyond 4 blocks only the first 4 render; if none of the blocks
  qualify, the tool errors and suggests switching to `answer`.
- `live` blocks take effect only in the board: they follow the session and refresh message count, tool-call count, or the latest message stream automatically, without another model call.

## tail

A closing card always lands at the end of the turn: after the answer prose and before the bottom action row (the copy/retry row), so it is the last thing the user reads.

- The typical shape is one question plus one `actions` block: 2 to 3 options, with `"tone":"primary"` on the first as the main button.
- At most 4 `tail` cards show per turn, stacked in call order; earlier ones stay in the session log but are not shown.
- It is a **transient** hint: once the user starts the next conversation turn, the previous turn's `tail` card is no longer shown.
- A `tail` card does not take space in the answer prose, and it never counts as "the model already output an answer card" to block the board's closing conversion.
- Automatically generated next-step cards also render in the `tail` position; when the model wrote its own `tail` card, the model's wins and nothing is generated.

```jsonc
{
  "place": "tail",
  "look": "relaxed",
  "blocks": [
    {"type": "text", "text": "要我跑一遍测试套件来支撑这次静态审查吗？"},
    {"type": "actions", "items": [
      {"label": "跑测试", "prompt": "跑一遍这个仓库的测试套件。", "tone": "primary"},
      {"label": "先不用", "prompt": "先不用了。"}
    ]}
  ]
}
```

## Recycled dock card

The board closes and is reclaimed when the turn ends, but the information is not lost: if the turn has no `answer` card of the model's own, the plugin converts the board content into an ordinary card placed below the answer.

- The recycled card is **long-lived** and does not disappear with the next turn, because it hands the board information back to the reader.
- Board status inside the recycled card no longer shows "in progress"; it renders in its finished state.
- This is the only exception to the `tail` transient rule: the recycled card keeps the content it had.
- Internally, the turn tail has two slot entries: the recycled card first, the `tail` card stack after it.

## Choosing a placement

| Need | Placement |
| --- | --- |
| Final answer, comparison, spec | `answer` |
| Intermediate results that explain the execution process | `process` |
| Runtime progress and status at a glance | `dock` |
| Closing question and next-step buttons | `tail` |

## Related

- [Getting started](getting-started.md)
- [Automatic next steps](next-steps.md)
- [Advanced capabilities](advanced.md)