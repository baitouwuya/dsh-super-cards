# Internals

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

In one sentence: **the Host describes and normalizes, the Client renders and extends, each half has its own single block registry, and consistency tests run between the two halves.** Design details are in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## The two halves

| Half | Files | Responsibility |
| --- | --- | --- |
| Host | [index.js](../../index.js) and the lib directory | Registers `render_ui`, `render_ui_blocks`, the prompt section, the read-only services, and optional automatic next steps |
| Client | [client.js](../../client.js) | Matches call events, rebuilds cards, registers block renderers and placements, and provides the extension service |

Host module split:

- [lib/shared.js](../../lib/shared.js): vocabularies (tone, icon, status, look), the `CAPS` caps, and value helpers.
- [lib/blocks.js](../../lib/blocks.js): the registry for 29 block types, normalization, directory and contract text, and the alias table.
- [lib/content.js](../../lib/content.js): the `content` auto-layout engine.
- [lib/spec.js](../../lib/spec.js): `readPlace`, `normalizeSpec`, and `executeRenderUi`.
- [lib/tools.js](../../lib/tools.js): tool descriptions, the prompt, both tool definitions, and config resolution.
- [lib/config.js](../../lib/config.js): the Schemastery config schema and validation.
- [lib/service.js](../../lib/service.js): the read-only `superCards` service.
- [lib/next-steps.js](../../lib/next-steps.js): the turn-end automatic next-step generator.

## Call chain

```text
Model calls render_ui
      │  arguments are the UI spec
      ▼
Host validates + normalizes (caps, aliases, board whitelist)
      │  returns {ok, blocks, types, place}
      ▼
Session log records tool/call and its arguments
      │
      ▼
Client row definition matches the event and rebuilds the card from the recorded arguments
```

Every spec a card needs comes from the tool-call arguments recorded in the session log; the plugin keeps no extra state.

## The session log is the truth

- The Client reads `block.argsRaw` in the `start` stage and `block.call.argsRaw` in the `result` stage; both are the raw arguments of that call.
- Cards therefore survive replay, resume, and fork, and render in the same shape.
- Tool errors render as a small error card; an error boundary backs up the render component, so a conversation row is never blanked.
- When `tools.render_ui` is called inside a `run_code` script, the log has no top-level `tool/call`, only PTC dispatch events (`tool/ptc-dispatch-start`, `tool/ptc-dispatch`). The row definition matches all three events, one call produces exactly one row, and settlement events only refresh arguments without adding cards.
- The card itself appends no new session events; the only plugin record is `plugin:super-cards/next-steps`, written only when automatic next steps are explicitly enabled. It goes through the Host's `appendPluginRecord` so it carries `ignorable: true`: an unknown type without that marker makes the Host refuse the whole log. The Client also reads the pre-0.16 `super-cards/next-steps` name.

## Progressive disclosure

| Layer | Carrier | Content |
| --- | --- | --- |
| Always present | `render_ui` description | Purpose, when to use and when not to, rules, the block directory (name plus one-line purpose), and one example |
| On demand | `render_ui_blocks` | Exact fields, descriptions, and examples for one block or all blocks; passing `motion` or `content` as `type` returns the matching vocabulary |
| Correction | `dropped` in the `render_ui` result | Index, type, and reason for every dropped block |

Adding a block type only extends the registry and the on-demand contract; it never makes the always-present description longer.

## Cross-half consistency

- Host and Client each have a block registry; order, board whitelist, alias table, and caps must be equal. The consistency cases in `test/client.test.mjs` compare them item by item, and changing one side without the other fails tests directly.
- `content` auto layout uses the same rules in both implementations: the same `content` derives blocks that match field by field.
- Adding a block type requires both places: the Host registry for normalization and contract, the Client registry for the renderer. If only one side is added, the Host reports that type in `dropped` and the Client shows a placeholder for the type without a renderer.

## Measured performance

Data comes from the measurements recorded in [README.md](../../README.md).

| Metric | Typical 6-block card | Fully loaded 24-block card |
| --- | --- | --- |
| Argument JSON | about 660 bytes | about 10 KB |
| Normalization plus layout | 0.004 ms | 0.03 ms |
| Element tree build | 0.017 ms | 0.15 ms |
| DOM nodes | about 70 | about 650 |

- A full-frame re-render of 100 typical cards costs about 1.3 ms of JS; 30 fully loaded cards cost about 3.4 ms.
- Browser side: 120 cards is about 16k nodes and a first paint of about 150 to 200 ms; 300 cards is about 40k nodes and a first paint of about 190 to 230 ms, with scrolling holding 60 fps.
- The three session selectors share one index per snapshot (`WeakMap`): at 400 turns and 2400 nodes, each session event drops from about 21 ms to 0.06 to 0.25 ms, and the curve is linear.
- Card content caches its normalized result keyed by the recorded argument string, so a parent re-render no longer reparses the same card.
- `html` frames load lazily, `live` never polls; the only timer is the running subagent progress card, which refreshes relative time once per second and stops when it ends.
- Automatic next steps are off by default; when off, the scheduler returns before scanning the log, so a long session costs nothing per turn.
- `content-visibility: auto` is deliberately not applied to cards: the first paint would be about 40% faster, but scroll height would shrink from 124k pixels to 44k pixels, making scrolling and "jump to a turn" jitter in long sessions.

## The superCards service

Host and Client both provide a Cordis service named `superCards`, with different purposes.

The Host face is read-only and is reached via `ctx.get('superCards')`:

```js
const ui = ctx.get('superCards')
ui.blocks.list()          // all block types
ui.blocks.dock()          // board whitelist
ui.blocks.has('table')    // whether a type is known
ui.blocks.get('table')    // {type, purpose, dock}
ui.blocks.contract('table') // exact contract text
ui.placements.list()      // the four placements
ui.motion.list()          // motion presets
```

The Client face is mutable, is reached via `ctx.get('superCards')`, and lets other Client plugins extend renderers:

```js
const ui = ctx.get('superCards')
const dispose = ui.blocks.register({
  type: 'meter',
  dock: true,
  normalize(raw) { /* → block or null */ },
  render(block, key, ctx) { /* → React element */ },
})
ui.blocks.replace('table', { render: myTableRenderer })
ui.placements.register('sidebar', { groupTree: 'turn' })
```

`register` and `replace` return a disposer that restores the previous implementation; cards subscribe to registry changes and re-render in place. The service is provided inside `ctx.effect` and disappears when the plugin unloads.

## Related

- [Configuration](configuration.md)
- [Advanced capabilities](advanced.md)
- [Troubleshooting](troubleshooting.md)