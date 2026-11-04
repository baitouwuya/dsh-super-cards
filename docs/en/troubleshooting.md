# Troubleshooting

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

A card is a pure function of the session log; most problems come from the client module not loading, configuration not taking effect, or content dropped during normalization. Below is the check order by symptom.

## Historical cards missing after restart

Cards are rebuilt from the call arguments in the session log, so the data is not lost. If a block of historical cards disappears after a cold start, the client module usually activated before the Conversation service and the row definition was never registered.

- Refresh the page once so the Client half reloads; historical cards render again from the log.
- If they still do not appear, check whether the `tool.call.toolview` slot in Cordis Inspector has an occupant for `render_ui`, and whether the Loader still has a `super-cards` row.
- When the row is disabled or the plugin is removed, the cards naturally stop showing; re-enabling and refreshing the page restores them.

## The model says the call succeeded but no card appears

First confirm how this call happened:

- When the model calls `tools.render_ui` inside a `run_code` script, the session log has no top-level `tool/call`, only `tool/ptc-dispatch-start` and `tool/ptc-dispatch`. The row definition matches all three events, one call produces exactly one row, and settlement events only refresh arguments without adding cards.
- Searching the application's bundled `app.asar` for `render_ui` and getting 0 hits does not mean there is no renderer: the renderer is a local plugin and was never inside the application bundle. To tell whether it is loaded, look at the occupant list of `tool.call.toolview`.
- When card rendering fails, the error boundary shows a fallback card "UI render failed" instead of blanking the conversation row; report the console error together with a screenshot to locate it.
- When the tool call returns an error, that row shows a small error card; the error text is the reason starting with `render_ui:`.

## Blocks dropped or type unknown

`render_ui`'s return carries a `dropped` array; each entry is `{index, type, reason}`. Act by reason:

- `unknown block type`: the type name is not one of the 29 canonical types. Use `render_ui_blocks` to look up the correct name and fields.
- `no usable content`: fields are missing or empty and normalization cannot render it; fill in the required fields.
- `block type not enabled by config`: the type is disabled by the row config's `blocks`; add it back to the list to use it.
- `over the block cap`: exceeds the per-card cap; split it into several cards.
- `not allowed in a dock board`: the board only accepts whitelisted blocks; switch to `answer` or change the block.

A common mistake is writing a `content` field name as a block type, for example `{"type":"note"}`. Normalization on both halves folds it to the block that renders the same content, changing only the name and not the data shape; when the data does not match the target block's fields it is still dropped. There are only 29 canonical types, and names such as `note`, `summary`, and `metrics` are not in the tool enum.

## Configuration does not apply

- After saving configuration the row remounts once and the tools and prompt are registered again; the change should take effect on the next call.
- The Plugins page shows only the four basic settings; option count, timeout, minimum length, generation route, and enabled block types are in the full form on the Settings page.
- When hand-writing YAML, an undeclared key makes validation fail and reports the key name; out-of-range numbers are clamped to the boundary and invalid values fall back to defaults.
- Writing `blocks` as an empty array or omitting it both mean "all enabled", not "all disabled"; to disable a type, list the remaining types.
- `nextSteps` only accepts an explicit `true`; `false`, omission, or a string all leave it off.
- Without the `configForms` client service the settings page shows only a single notice line; in that case edit through the Plugins page or hand-written YAML.

## Automatic next steps produce no card

Check the skip conditions one by one:

- Whether `nextSteps: true` is explicitly configured. Off by default; if not written, nothing is generated.
- Whether the answer is shorter than `nextStepsMinChars`; short answers are skipped.
- Whether the turn already has a model-written `tail` card; if so, nothing is generated.
- Whether the turn already generated the event; this reads the log, and replay does not append again.
- Whether the model route cannot be resolved, or the current environment has no usable `llm` service.
- Whether the current session is a subagent session (`origin` is `subagent`, a `parentSession` exists, or `delegationDepth > 0`).
- Whether it timed out: raise `nextStepsTimeoutMs` and retry, and check whether the session log has a `super-cards/next-steps` event.
- A model-written `tail` card and a generated card are mutually exclusive; after the user starts the next turn the previous turn's card stops showing, and this is expected behavior.

## html card is blank

- The iframe CSP forbids all external requests: remote fonts, scripts, and images cannot load. Use inline CSS, inline SVG, or `data:` URIs instead.
- Use the source view in the card's top-right corner to confirm the HTML that actually runs is what you expect; the Host truncates source at 20000 characters.
- `height` is clamped to 120 to 800 and overflow scrolls inside the iframe; a very small height may show only blank space.
- `html` does not enter the board and is dropped when placed in a `place: "dock"` card.
- With the system's "reduce motion" enabled, CSS animations and transitions inside the iframe are disabled, which is expected behavior.

## Styling issues

- Colors and borders use only `--dsw-alias-*` theme tokens, so light and dark themes switch automatically; no hard-coded theme colors exist in the card.
- When the card narrows, `columns` folds back to a single column, and wide tables scroll horizontally inside the card rather than at page level.
- Density is determined by `look` or the card's shape; pass `look` explicitly when you want it tighter or looser.
- With the system's "reduce motion" enabled, entrance, breathing, progress, and chart animations are all disabled, leaving only instant state switches.
- Pure static display cards have no close button, by design; only cards with a lifecycle status or containing `controls`, `actions`, or `live` are closable.
- If styles do not apply at all, first confirm the Client half is loaded: refresh the page and check that the `super-cards` row is enabled.

## Related

- [Getting started](getting-started.md)
- [Configuration](configuration.md)
- [Advanced capabilities](advanced.md)