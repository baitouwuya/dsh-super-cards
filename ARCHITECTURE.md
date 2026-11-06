# Architecture — Super Cards

Six properties, one per section below, each mapped to the file and mechanism that
carries it. The one-line summary: **the Host describes and normalizes, the Client
renders and extends, and every list of block types lives in exactly one registry
per half with a parity test between them.**

```
        model call
            │
            ▼
  render_ui (Host tool) ──normalize──▶ spec ──session log──▶ Client chat row ──▶ card
            │                                                        ▲
            └── render_ui_blocks (Host tool, on demand) ──contracts─┘   (blocks registry)
```

## 1. Progressive disclosure

The always-on context is deliberately small; detail is fetched when needed.

| Tier | Where | Carries |
| --- | --- | --- |
| 1. Directory | `render_ui` description (`lib/tools.js`) | purpose, when/when-not, rules, block names + one-word purposes, canonical example |
| 2. Exact contract | `render_ui_blocks` tool (`lib/tools.js`) | shape, field notes, example for one type or every type; the auto-layout `content` vocabulary under `type:"content"` |
| 3. Corrections | `render_ui` result `dropped[]` | per-block reason: unknown, no content, over cap, disabled by config, not dock-safe |

The same idea governs the UI: a card folds to one checked line when it completes,
collapses to one dashed line when closed, and the dock board is a glance that
retires into a turn-tail card.

Adding a block type does **not** grow the description: it grows the registry and
the on-demand catalog only.

## 2. Structured

- One registry per half: `lib/blocks.js` `BLOCKS` (Host) and `client.js`
  `BLOCK_IMPL` (Client). Each entry carries everything that type needs:
  Host `{ type, purpose, shape, note, fields?, example, dock, normalize }`,
  Client `{ dock, normalize, render }`.
- One alias table per half (`BLOCK_ALIASES`, mirrored, pinned by a parity test):
  a `content` field name written as a block `type` is folded onto the block that
  renders the same material before normalization, so the wire enum never grows
  and a model slip still draws a card.
- Everything derived: wire enum, description directory, contract catalog,
  dock-safe subset, normalization dispatch, client render dispatch. No second
  list to drift.
- Contracts are data: `render_ui` parameters and output schema are generated from
  the same options; `dropped[]` is part of the declared output schema.
- One type can cover a family: `diagram` carries `kind` (flowchart / state / sequence /
  class / er) and the Client dispatches to a deterministic SVG layout, so the model
  learns one block shape instead of five. Each diagram gets its own card: the tool
  description, the prompt rule, and the on-demand contract all say "one diagram per
  card", so two diagrams never share a card and each stays next to its own prose.
- The session log is the only source of truth: the client rebuilds the card from
  the recorded `tool/call` arguments and keeps no plugin state.
- Two ways to fill a card, one card: `blocks` names the controls exactly, while
  `content` names the material and `lib/content.js` derives the controls and the
  arrangement (metric grid, table, trend line, donut, timeline, paired `columns`,
  section `tabs`, actions last). Deriving is pure and deterministic, so the same
  call arguments always produce the same card; both halves implement the same rules
  and the parity test compares their derived blocks field by field. Arrangement stays
  intentional: ordinary blocks stack (auto-pairing read as two disconnected panels), and
  only `sections` become a row — a section carrying a table, diagram, image, code or
  kanban takes two shares, a chart or text section one. The weights are part of the
  derived spec, so a replay reproduces the same asymmetry, and a narrow card folds it
  back to one column.

## 3. Componentized

Host: `index.js` is a thin entry; behavior lives in focused modules —

```
index.js        apply(ctx, config): two tools + service + prompt section
lib/shared.js   vocabularies (tone/icon/status), CAPS, coercion helpers
lib/blocks.js   block normalizers + registry + contract/directory text
lib/content.js  auto layout: `content` fields -> blocks, arrangement, contract text
lib/spec.js     readPlace, normalizeSpec, executeRenderUi (drops, caps, dock)
lib/tools.js    descriptions, prompt text, tool factories, config resolution
lib/config.js   Schemastery Config (volatile fields -> the settings form) + placements
lib/service.js  read-only Host superCards service
lib/next-steps.js  turn-end auto generator: prompt, defensive JSON parse,
                   one LLM call per turn, `super-cards/next-steps` event
```

Client: one function per block (`normalize<Type>Block` / `render<Type>Block`)
registered in `BLOCK_IMPL`, placements in `PLACEMENTS`, and the card shell
(header, status, close, blocks grid, folded/closed lines, dock, turn-tail)
composed from small components.

Adding a block type: one Host registry entry + one Client registry entry. Adding
a placement: one `PLACEMENTS` entry (Host validates it, Client renders it). Four are built in —
`answer` (inline), `process` (inside the work details), `dock` (the board above the composer)
and `tail` (the Turn footer, after the reply and before the action row).

### Auto next-steps (Host -> log -> Client)

Two ways to end a Turn with a next-step card: the model writes it (`render_ui` with
`place: "tail"`, no extra cost), or the Host generates it after the Turn closes. The generated
path mirrors `@deepseek-ai/dsh-session-title`: a `session/event` listener sees `turn/end`, the
Host reads that Turn's user question and final answer out of `session.snapshotEvents()`, resolves
the route from `session.requestHeader()?.config` (or the paired `nextStepsProvider` /
`nextStepsModel` override), makes one small `ctx.get('llm').stream()` request that must answer
JSON, and appends `super-cards/next-steps`.

The event carries `data.turn`, which is exactly how the conversation location index resolves a
payload coordinate — the event is appended *after* `turn/end`, so without that field it would
belong to no Turn. The Client matches the event into a `super-cards-next` chat node whose row
renders nothing inline; the Turn tail reads the node back (falling back to `node.data.turn` while
the location index is unresolved) and renders it through the same `TurnTailCards` stack as a
model-authored `tail` card. Generation is opt-in (`nextSteps: true`); the default row installs no
listener at all.

The tail stack is transient by design: the Turn footer's selector returns nothing when any Turn
newer than the one being rendered exists, so a next-step card never lingers once the person has
moved on. The retired-board entry (`super-cards-board-card`, order 31) is exempt because it hands
back information rather than prompting. The generated card also carries an optional `summary` —
one or two sentences of recap before the question — clamped to 240 characters on both sides.
Suppression is deliberate: a model-authored tail card for the same Turn wins, and the generator
itself skips Turns that already have one, are shorter than `nextStepsMinChars`, already produced
an event, have no route, or have no `llm` service.

### Long sessions: the cost model

The transcript is not virtualized by the host, so every card is a live DOM subtree, and every
Turn footer owns a snapshot selector that runs on each store commit. The plugin therefore fixes
its own costs instead of assuming a short session:

- One `WeakMap`-keyed per-snapshot index (`snapshotIndexOf`) serves all three selectors
  (`selectTailCards`, `selectBoardConversion`, `selectDockCard`) from a single node pass: per
  Turn they read O(1) facts instead of rescanning the transcript. Measured: 400 Turns / 2400
  nodes went from ~21 ms to 0.06–0.25 ms per session event, and the curve is linear rather than
  Turns × nodes. The index is validated against the snapshot's order length and last key and
  dies with the snapshot object.
- `RenderUiCard` memoizes the extracted spec on the recorded argument *string*: rows hand in a
  fresh `{ argsRaw }` object on every render, so object-keyed memoization never hit.
- Card blocks are built on demand (no background work), `html` frames are `loading="lazy"`, and
  the only interval in the plugin is the running team card's one-second relative-time tick.
- Deliberately not used: `content-visibility: auto` on cards. It cuts first paint but replaces
  real card heights with estimates, which distorts the transcript scroll height (measured 124k
  px -> 44k px for 120 cards) and breaks scroll anchoring, the turn rail, and "jump to Turn".

### Configuration surfaces (Client -> Host settings)

The Host `Config` is a Schemastery schema whose editable fields are all `.volatile()`; the settings
service projects exactly that sub-tree into a form (`volatileForm` in
`packages/settings/settings/src/schema.ts`), so a non-Schemastery or non-volatile Config would be
invisible to the UI. Its `~standard` face validates with Schemastery and then unwraps the volatile
boxes, because `apply()` reads a plain JSON snapshot; the face also reports a plugin-owned `vendor`
so a config write takes the ordinary reload path (a row re-mounts and re-registers its tools)
instead of being treated as an in-place volatile commit that nothing would reread.

The Client half renders that form twice, each through its own slot: `plugins.bundle.config`
(keyed by the package name) puts the four basic knobs on the plugin's page, and
`settings.plugins.tab` (id `super-cards`) adds a full tab under Settings -> Built-in plugins. Both
share one pure field table and one form component; the plugin page receives an owner-supplied
`form`, the settings tab resolves the same values through the optional `configForms` client
service (`describe()` -> namespace discovery, `getSnapshot`/`subscribe`, `mutate(ops, revision)`)
and degrades to a muted line when that service is absent.

### Live team card (Client)

The subagent progress card matches all four team events (`team/member`, `team/task`,
`team/message/queued`, `team/message/delivered`), keeps a bounded six-entry activity trail, and
renders relative times ("12 秒前") that refresh through exactly one `setInterval` inside the row —
started only while the card is still running, cleared by the effect cleanup, and stopped once the
completed run folds to its one-line summary. That single timer is the plugin's only deliberate
exception to the "cards are inert" rule: time text only, no network, no storage.

### Auto-conversion (Client)

Diagrams are authored as `render_ui` `diagram` blocks; the model-facing prompt forbids mermaid
fences so nothing is shown twice. A diagram card carries a source toggle: it renders the chart
by default and switches to a `<pre>` built from `block.source` (auto-converted cards keep the
exact fence) or a deterministic mermaid reconstruction (`diagramToMermaid`).

Team activity is another automatic card: the `super-cards-team` row matches durable
`team/member` and `team/task` events, merges them by id, derives running/success/warn/error,
and reuses the same card renderer and completion folding — so a subagent's work shows up as a
progress card without a model call and finishes itself when the task board is done.

Auto-conversion remains as a fallback: the `super-cards-auto` Chat row matches
`assistant/message`, extracts mermaid/`mmd` fences, parses the subset it supports, and reuses
the same diagram normalization and card renderer. Parsing is a pure function of the message
text, so replay draws the same card; an unparsable fence falls back to a code-block card instead
of disappearing. The raw fenced block stays visible because Markdown rendering is not
interceptable from a plugin. Because the result is a plain display card, it has no close button.

### Diagram layout (Client)

Diagram geometry is computed from the block itself and kept dense (28px nodes, 30px TB rows,
56px LR columns); the chart renders at natural size and scrolls instead of being stretched to
the card width. No DOM measurement, so a
replayed card draws identically.

- **flowchart / state**: longest-path layering (relaxation over edges, so cycles are
  stable); LR by default, TB on request; nodes clamp to 120–260 × 44, layer gap 72,
  cross gap 24; cubic-bezier edges between box borders, edge labels on a background
  rect, self-loops to the right, back edges bowing below the graph. `state` defaults
  to round nodes.
- **sequence**: participant headers, dashed lifelines, messages at a 34px pitch with
  labels above the arrow, self-messages looping right, `return`/`async` dashed.
- **class / er**: header + fields + methods compartments with hairline separators;
  column-major two-column grid; relations draw border-to-border with labels.
- Text width is estimated (CJK ≈ 1em, other ≈ 0.58em) and over-long labels truncate
  with an ellipsis, keeping the full string in a `<title>`.

## 4. Pluggable

The Client provides a Cordis service so other Client plugins extend the renderer
without editing this package:

```js
const ui = ctx.get('superCards')
const dispose = ui.blocks.register({
  type: 'meter',                 // new wire type, also enabled on the Host
  dock: true,
  normalize(raw) { /* → block or null */ },
  render(block, key, ctx) { /* → React element */ },
})
ui.blocks.replace('table', { render: myTableRenderer })  // swap a renderer
ui.placements.register('sidebar', { groupTree: 'turn' })
```

`register` / `replace` return disposers that restore the previous entry; cards
subscribe to the registry and re-render on replacement. The service is provided
inside `ctx.effect`, so it disappears with the plugin.

A card that carries a type the Client cannot render shows a placeholder notice
naming the type (and how to register a renderer) instead of leaving a silent gap;
registering a renderer replaces it in place, disposing restores it. That closes the
cross-half pairing gap without touching the session format.

The Host provides the same service name read-only
(`blocks.list/dock/has/get/contract`, `placements.list/has`), so tooling can inspect
the live registry. A block type added at runtime on one half is only complete when the
other half knows it too: a Host plugin that registers a type must be paired with a
Client plugin that registers a renderer (and vice versa); the parity test covers the
types shipped in this package.

On the Host, the row config is the extension point (`blocks`, `maxBlocks`, `dock`,
`defaultPlace`), validated by a dependency-free Standard Schema at activation.

## 5. Replaceable

- Any block renderer can be replaced at runtime through the service.
- The whole bundle can be disabled, removed, or replaced by another bundle: it
  owns no global state, no session events, no DOM outside its slots, and its
  registrations are all effects.
- Look and copy are replaceable without code: theme tokens (`--dsw-alias-*`),
  two locale dictionaries, and the plugin icon.
- The tool names are constants in `lib/shared.js`; a fork can rename them and
  the parity test keeps the Client keyed to the same wire name.

## 6. Aligned with DSH

| DSH mechanism | How this plugin uses it |
| --- | --- |
| Cordis effects | every tool, prompt section, slot, stylesheet, and service is registered inside `ctx.effect` and disposed with the plugin |
| Cordis services | Client `superCards` via `ctx.provide`, consumed with `ctx.get` |
| Slots | `tool.call.toolview`, `conversation.chat.node`, `conversation.input.dock`, `conversation.chat.turnTail`, each injected and keyed |
| Chat rows | `ctx.uiConversation.events.register` matching every shape that can carry one `render_ui` call — `tool/call` and the PTC dispatch pair (`tool/ptc-dispatch-start` / `tool/ptc-dispatch`) a `run_code` script produces — installed through `ctx.inject(['uiConversation'], …)` so a cold page load never misses the service; paging/turn placement owned by the Conversation layer |
| Session log | cards are a pure function of recorded call arguments |
| Config | `export const Config` is a dependency-free Standard Schema (validated at activation) plus a defensive `apply(ctx, config)` resolver |
| Theme / locale | only `--dsw-alias-*` tokens; text through `ctx.locale` |
| No client imports | `require('react')` plus one optional probe of the seeded `@deepseek-ai/dsh-client-ui-primitives`; host imports only its own `./lib` modules |
| Host UI reuse | the Web shell's frozen module table seeds `dsh-client-ui-primitives` (310 exports: icons, `CodeBlock`, `DiffBlock`, `MarkdownText`, `Button`, menus, form controls, `useClipboardCopy`, `useCodeHighlighter`…). The loader resolves it before any package, so a plugin factory reads the same instance the app renders with — no copy, no `dsh.client.external`, no version drift. It is not a documented contract and older shells do not seed it, so the probe is forgiving and every consumer falls back to the plugin's own renderer: today the `code` block takes the host's syntax tokens when they exist, and plain text otherwise |

## 7. Motion

Motion is a property of the component, not a layer on top of it: the card enters once, its
blocks stagger, and after that every animation is bound to the value that changed.

- **Enter once.** The entrance animation lives on `.dsh-sc-card` itself. React keeps the DOM
  node across slot updates, so a status change, a live counter, or a new message never replays
  the entrance; a new card does. Replayed history mounts its cards as the transcript renders
  them, so a page reload animates each card exactly once.
- **Stagger, not cascade.** `.dsh-sc-blocks > :nth-child(n)` adds 24ms steps up to eight
  blocks. It is CSS-only (no index plumbing, no JS timers), and because the block nodes are
  keyed, appending a block animates only the new one.
- **Value-bound motion.** A progress fill animates `width` (the one deliberate exception to
  transform-only motion; the track is 6px tall), the status chip cross-fades its tokens and
  pops once when it changes, a running dot breathes while a ring expands, and the disclosure
  chevron is a single glyph rotated 180° — the same element, one transition.
- **One stylesheet, one switch.** All of it is inside `CSS`, which is also the only place a
  color is named (tokens), and the `prefers-reduced-motion: reduce` block is deliberately the
  last thing in the sheet: the entrance, stagger, ring, pop, fill, and chevron transitions are
  all neutralized, in case anyone declares a new animation above it later.

### 7.1 Agent-authored motion

The model can ask any block to animate itself, but it names a preset instead of writing CSS:

- **One field, one envelope.** `motion: {effect, duration, delay, loop}` normalizes on both
  halves (identical clamps, parity-tested) and survives the session log, so a rebuilt card
  animates identically. The Client wraps exactly that block in `dsh-sc-motion-wrap` — a normal
  grid child that carries `dsh-sc-motion--<effect>`, `data-block`, and three timing variables.
  Layout is untouched; a wrapped `live` block keeps its half-row span.
- **The stylesheet stays the author.** Eight presets (`pulse`, `flash`, `reveal`, `sweep`,
  `draw`, `flow`, `bounce`, `shake`) map to eight keyframes. Nothing the model sends reaches
  `style` beyond numbers and enum strings, so there is no CSS injection, no external URL, no
  position/overlay escape, and no second styling system to theme.
- **Content-aware targeting.** Presets that need a part of a block target it by class
  (`progress-fill`, `bar-fill`, `diagram-edge`, `spark-line`), so `sweep` and `draw` work on
  every block that has one and animate nothing on a block that does not. Diagram, sparkline,
  and message paths carry `pathLength="100"`, which makes one keyframe draw any edge and keeps
  `flow` dashes proportional; without `loop` the edges return to the style they were authored
  with, since a dashed edge has meaning in these diagrams.
- **Decoration, not content.** An unknown effect renders the block statically instead of
  dropping it, and `prefers-reduced-motion` neutralizes the envelope and every animated
  descendant.

## 8. Arbitrary content: the `html` block

Presets cover the common answer shapes; sometimes the visual *is* the answer (a custom
animation, a mini demo, a bespoke SVG). The `html` block is the one escape hatch, and it is
an iframe, not inline markup:

- **Isolation by origin, not by sanitizer.** The frame is `sandbox="allow-scripts"` with no
  `allow-same-origin`, so it runs in an opaque origin: it cannot read the parent DOM, cookies,
  storage, or navigate the app. Sanitizers are a moving target; origin isolation is enforced
  by the browser.
- **No network, so replay stays honest.** A CSP meta inside the frame allows inline style and
  script but sets `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, and
  `img-src data: blob:`. A card cannot phone home, pull a remote font, or render differently
  when the network comes back.
- **The theme crosses the boundary as values.** A sandboxed document does not inherit CSS
  variables, so the Client reads the live `--dsw-alias-*` values from the host once at render
  time and writes them into the frame's `:root`; agent CSS can then use the same tokens. The
  frame gets the host font stack and a transparent background to sit inside the card.
- **Bounded and inspectable.** The source is capped at 20000 chars, the frame height is
  host-clamped (120–800px), and the card carries a preview/source toggle so the reader can
  see exactly what runs. It is deliberately not dock-safe, not folded, and not a target for
  `motion` presets: it is content, not a native block.
- **The one network exception is a native block, not the frame.** When an answer really is
  a picture, the `image` block renders it: `src` is restricted to `http(s)` or `data:image/*`
  (no javascript:/file:/blob:), data URIs are capped, the `<img>` is lazy, sends no referrer,
  and shows a fallback tile on error. Nothing fetches on its own — the spec names the source —
  and a profile that wants zero outbound requests just leaves `image` out of `config.blocks`.
- **One door.** The security test asserts the module contains exactly one `srcDoc:` and that
  its sandbox is exactly `allow-scripts`; there is no second path for model HTML to reach the
  page.

## Invariants enforced by tests

- Host and Client agree on the wire block set, the dock subset, and the caps
  (`test/client.test.mjs` parity test).
- The Host enum, description directory, and contract catalog derive from the
  registry (`test/host.test.mjs`).
- Auto layout is one algorithm in two implementations: for the same `content`, Host
  `deriveContent` and Client `deriveContent` return identical raw blocks, and the
  normalized specs match (`test/client.test.mjs`, "content parity" case).
- Unknown config, unknown blocks, and hostile arguments never lose the whole
  call silently: they are reported or throw one actionable `render_ui: ` error.
- The manifest test asserts the package ships the modules it imports, that the
  Host declares a Standard Schema `Config`, and that both halves advertise the same
  wire name.
- Host modules stay isolated: every file imports only its own `./lib` siblings, uses
  no console, timers, or network, and `apply` registers only through `ctx.effect`.
- No wire block type can vanish silently: the Host reports it in `dropped[]` to the
  model, and the Client renders a named placeholder for a type it cannot render.
- The motion contract is testable from the stylesheet text: the entrance lives on the card,
  blocks stagger, the reduced-motion block comes last and neutralizes every animation and
  transition, and the chevron rotates instead of changing path
  (`test/client.test.mjs`, "motion:" cases).
- The only model-HTML entry point is a sandboxed iframe: exactly one `srcDoc:` in the client,
  its sandbox is `allow-scripts` without same-origin, and the frame document carries the
  network-blocking CSP (test/client.test.mjs, inert-module test plus html cases).
- Agent motion has one vocabulary on both halves: the effect list, defaults, and clamps are
  equal in `lib/shared.js` and `client.js`, the block schema and the `render_ui_blocks`
  keyword both expose it, and only a block that carries `motion` gets an envelope
  (`test/host.test.mjs` + `test/client.test.mjs`, "agent motion:" cases).
- A card never depends on *how* the model reached the Tool: the inline row matches a direct
  `tool/call` and both PTC dispatch shapes a `run_code` script records, under the same
  identity (`callId` / `subCallId`), so a nested call yields exactly one answer row and the
  settled dispatch only refreshes it (`test/client.test.mjs`, PTC row case).
