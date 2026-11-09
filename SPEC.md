# Super Cards — build contract (single source of truth)

A DSH (DeepSeek Harness) bundle that lets the model answer with **native UI cards instead of
Markdown**, in the spirit of ChatGPT's Intelligent UI / generative UI.

- Package: `dsh-super-cards` (private, `type: module`)
- Bundle row id: `super-cards`
- Wire tool name: **`render_ui`** (exact; the client toolview key is this string)
- DSH version target: 0.2.2-rc.1 (verified on the installed desktop build: every slot
  registration, both tools and the Config projection are live), Web client, React 18, no
  build step (hand-written JS)
- Workspace: `/Users/baitouwuya/dsh-super-cards`
- Host half: `index.js` (ESM, `export function apply(ctx)` + `export const inject`)
- Client half: `client.js` (plain JS, `window.__ModuleLoader__.load({ id, factory })`)

## How it works (must not change)

1. Host registers a global tool `render_ui`. The model calls it with a JSON **UI spec**
   (title/subtitle/blocks) instead of writing long Markdown.
2. Host also registers a `systemPrompt` section that tells the model when to prefer the tool
   and to not repeat the card content as Markdown.
3. The session log records the tool call, so on resume/replay the card is reconstructed from
   the recorded arguments. No plugin-owned state, no extra session event types, no DOM hacks.
4. Client renders the card **inline**: it registers a Chat row
   Definition through `ctx.uiConversation.events.register({ kind:'super-cards',
   target:'chat', match:{ 'tool/call': ..., 'tool/ptc-dispatch-start': ..., 'tool/ptc-dispatch': ... } })`,
   which matches the three recorded shapes that can carry one `render_ui` call: a direct
   `tool/call`, and the PTC dispatch pair recorded when the model calls the tool from inside
   a `run_code` script (start event, then the settled event carrying the final arguments —
   same call identity `subCallId`, so the row is created once and refreshed in place).
   Every shape builds the node anchored at its own `seq` with
   `groupTree: 'turn'` — the position outside the folded process disclosure — so the card
   is interleaved with the assistant text exactly where the model placed the call (text
   before → card → text after). The recorded `place` argument selects the position:
   `answer` (default) uses `groupTree: 'turn'` (always visible, part of the answer);
   `process` uses `groupTree: 'process'` (rendered inside the work-details disclosure and
   hidden again when the user collapses it); `dock` also uses `'process'` but its row
   renders nothing — the card is instead rendered by a `conversation.input.dock` entry
   (id `super-cards-dock`) pinned above the composer, sized to the composer card, and
   re-rendered on every Chat update so `live` blocks listen to later messages. A dock board
   is a live-only, compact, collapsible surface: one header line (title, count, disclosure),
   a body limited to four glanceable blocks (progress/stats/badges/live/callout/text/heading/
   list; long-form blocks are dropped), and it is scoped to its own Turn — once that Turn
   closes the board retires and a `conversation.chat.turnTail` entry (id
   `super-cards-board-card`) hands the same content back as a normal card under the
   answer, unless the model already emitted an answer card for that Turn. `tail` is the fourth
   placement: a normal card, but mounted by a second `conversation.chat.turnTail` entry (id
   `super-cards-tail-card`, order 32) that reads every `super-cards` node of the Turn whose
   recorded `place` is `tail` and renders them, in call order, under the reply and before the
   Turn's own action row. Its rows still occupy `groupTree: 'turn'` (they anchor the Turn like
   any answer card) but the inline row renders nothing, and a tail card never counts as an
   answer card when the retired dock board decides whether to convert. That is how a
   "next step" card ends the Turn: one short question plus an `actions` block of two or three
   options, one of them `tone: 'primary'`. The node is rendered by a `conversation.chat.node`
   registration keyed `super-cards`. The `tool.call.toolview` entry keyed `render_ui`
   renders nothing while the inline row is installed (single presentation, identical whether
   the process disclosure is open or closed); it falls back to the full card only when the
   Chat-row definition could not be registered.

## UI spec (model-facing JSON)

```jsonc
{
  "version": 1,                       // optional, ignored
  "title": "string?",                 // card title
  "subtitle": "string?",              // one line under the title
  "icon": "sparkle|chart|check|info|warning|table|code|list",  // optional leading glyph
  "status": "running|success|warn|error",  // optional; omit to derive it
  "blocks": [ Block, ... ],           // explicit blocks, 1..24
  "content": { ... },                 // OR auto layout: name the material, the card picks the blocks
  "layout": "auto|stack",             // arrangement of a `content` spec
  "look": "default|compact|flat|relaxed"  // optional; auto-picked from the card's shape when omitted
}
```

A call must carry `blocks`, `content`, or both. With both, the derived blocks come first and
the explicit blocks follow (the escape hatch for exact control inside an auto-laid-out card).

`Tone = "neutral" | "brand" | "info" | "success" | "warn" | "error"`.

Every `text`-bearing string may use two inline marks only: `**bold**` and `` `code` ``.
Newlines in `text` are line breaks. No HTML, no Markdown headings/tables inside strings.

| `type` | shape | notes |
|---|---|---|
| `text` | `{type:"text", text, muted?:boolean}` | paragraph; inline marks allowed |
| `heading` | `{type:"heading", text, level?:1\|2\|3}` | section heading |
| `callout` | `{type:"callout", tone?, title?, text}` | tinted notice box |
| `stats` | `{type:"stats", items:[{label, value:string\|number, hint?, delta?, tone?}]}` | metric grid; the renderer picks a base column count (1–5) so the last row is never one lonely tile — 6 items read 3+3 — and container queries fold it back on a narrow card (last tile takes the row when the count is odd) |
| `table` | `{type:"table", columns:string[], rows:(string\|number\|null)[][], align?:("left"\|"center"\|"right")[], caption?}` | first column often a label |
| `keyvalue` | `{type:"keyvalue", items:[{key, value}], columns?:1\|2}` | spec sheet; the renderer picks the shape from the facts — up to six short facts tile (2, 3, 3+2/3+3, or 2x2), anything longer (a value over 28 characters, a key over 16, or more than six facts) becomes a label/value row sheet, so a sentence never wraps inside a half-width tile and an odd count leaves no hole; `columns:1` forces one tile per line |
| `list` | `{type:"list", ordered?:boolean, items:string[]}` | bullets / numbered |
| `badges` | `{type:"badges", items:[{label, tone?}]}` | compact tags |
| `progress` | `{type:"progress", items:[{label, value:number, caption?, tone?}]}` | `value` is 0..1; a `caption` that only repeats the printed percentage is dropped |
| `bars` | `{type:"bars", title?, items:[{label, value:number, tone?}], direction?, max?, unit?}` | horizontal bar chart; `direction:"vertical"` draws columns |
| `sparkline` | `{type:"sparkline", title?, values:number[], labels?:string[], unit?, tone?}` | inline SVG line+area |
| `pie` | `{type:"pie", title?, items:[{label, value:number, tone?}], unit?, donut?:boolean}` | donut by default, filled pie with `donut:false`; ≤8 slices, values are shares of their own total |
| `tree` | `{type:"tree", title?, nodes:[{label, note?, badge?, tone?, children?}]}` | bounded hierarchy (4 levels) |
| `heatmap` | `{type:"heatmap", title?, columns?, items:[{label?, value:number, tone?}], unit?, max?}` | intensity grid, row-major; the foot line names the range (first and last label) and the total, and joins a Latin unit with a space ("7 ms") but a CJK or `%` unit directly ("7次", "7%") |
| `diff` | `{type:"diff", title?, path?, language?, lines:[{kind:"add"\|"del"\|"ctx", text}]}` | host `DiffBlock` patch view (local tints without it) |
| `kanban` | `{type:"kanban", title?, columns:[{title, tone?, cards:[{title, text?, badges?, tone?}]}]}` | board, horizontal scroll; under a 600px container the lanes stack one per row instead of scrolling out of view |
| `tabs` | `{type:"tabs", title?, items:[{label, blocks:[Block,...]}]}` | host `SegmentedTabs` row over one visible pane |
| `columns` | `{type:"columns", title?, items:[{label?, blocks:[Block,...]}], weights?:number[]}` | 2–3 block groups side by side; `weights` gives each column 1–3 fr shares (one integer per column, default equal, a mismatched list is ignored). The grid auto-fits and a container query folds a weighted grid back to one column under 560px. A column may not nest a tab or another column |
| `code` | `{type:"code", code, language?, title?}` | monospace block, own scroll; highlighted with the host's own shiki tokens when the shell seeds `dsh-client-ui-primitives`, plain text otherwise |
| `quote` | `{type:"quote", text, by?}` | pull quote |
| `timeline` | `{type:"timeline", items:[{title, text?, time?, tone?}]}` | steps / history |
| `links` | `{type:"links", items:[{label, href, description?}]}` | href must be http(s)/mailto |
| `actions` | `{type:"actions", items:[{label, prompt, tone?: "primary"\|"default"}]}` | button → puts `prompt` into the composer draft |
| `divider` | `{type:"divider"}` | hairline |
| `controls` | `{type:"controls", title?, items:[...]}` | interactive: `setting` segments bound to `theme`/`locale` (allow-list, written through the client service and synced to DSH settings) and `button` items whose action applies a setting or hands a prompt to the agent (`send:true` submits) |
| `diagram` | `{type:"diagram", kind:"flowchart"\|"sequence"\|"class"\|"state"\|"er", title?, direction?:"LR"\|"TB", nodes?, edges?, participants?, messages?}` | flowchart / UML diagram rendered as SVG. Graph kinds use `nodes:[{id,label,shape?,tone?,detail?,fields?,methods?}]` + `edges:[{from,to,label?,style?,arrow?}]`; `sequence` uses `participants:[{id,label,tone?}]` + `messages:[{from,to,label?,style?}]`; class/er put `fields`/`methods` compartments on nodes. Unknown endpoints are pruned; caps are 24 nodes / 48 edges / 8 participants / 24 messages. Recommended presentation: one diagram per card (a second diagram gets its own card next to its own prose) |
| `image` | `{type:"image", src, alt?, caption?, height?:number, fit?:"cover"\|"contain"}` | inline image. `src` must be `http(s)` or `data:image/*` (png/jpeg/webp/gif/avif/svg+xml; javascript:, file:, and blob: are dropped); data URIs are capped at `CAPS.imageChars` (200000). The picture is shown whole at the card width in its own aspect ratio — no crop, no letterbox, no fixed frame height; `height` and `fit` are accepted from old specs and ignored. The image is lazy, sends `referrerPolicy="no-referrer"`, and falls back to a notice tile on error; a remote source links to the original. It is the only block that may load a remote resource — removing `image` from the row config forbids it. Not dock-safe. |
| `html` | `{type:"html", html, title?, caption?, height?}` | one self-contained HTML/CSS/SVG fragment (or a full document), rendered in a sandboxed frame: `sandbox="allow-scripts"` without `allow-same-origin` (opaque origin: no app, storage, or cookies) plus a CSP that blocks every network origin (`default-src 'none'`, `connect-src 'none'`, `form-action 'none'`). `height` 120–800 (default 240); `html` capped at 20000 chars. Theme tokens are read from the host at render time and defined in the frame's `:root`; fonts match the host; the frame gets a reduced-motion rule; the card offers a preview/source toggle. Not dock-safe, not folded. |

### `content` (auto layout)

Instead of naming blocks, a call may name the material and let the card choose the controls
and the arrangement. Exact fields are served on demand by `render_ui_blocks` with
`type: "content"`; the derivation is deterministic and lives in `lib/content.js` (Host) and
`deriveContent` (Client), which the parity test pins to the same output.

| field | shape | derived block |
|---|---|---|
| `summary` | `string` \| `{text, tone?, title?}` | `callout` (always first) |
| `note` | `string` \| `{text, tone?, title?}` | `callout` (warn by default) |
| `metrics` | `[{label, value, delta?, hint?, tone?}]` \| `{label: value}` | `stats` |
| `series` | `{values, labels?, title?, unit?, kind?:"trend"\|"compare"}` \| `number[]` | `sparkline` for a trend (6+ points or no labels), `bars` columns otherwise |
| `breakdown` | `{items:[{label, value, tone?}], title?, unit?, kind?:"pie"\|"bars"}` | `pie` up to 8 slices, `bars` beyond |
| `table` | `{columns, rows, align?, caption?}` | `table` |
| `steps` | `[{title, text?, time?, tone?}]` \| `string[]` | `timeline` |
| `items` | `string[]` | `list` |
| `facts` | `{key: value}` \| `[{key, value}]` | `keyvalue`; short sheets tile, long ones read as rows |
| `tags` | `string[]` \| `[{label, tone?}]` | `badges` |
| `code` | `string` \| `{code, language?, title?}` | `code` |
| `quote` | `string` \| `{text, by?}` | `quote` |
| `links` | `[{label, href, description?}]` | `links` |
| `image` | `string` \| `{src, alt?, caption?, height?, fit?}` | `image` |
| `tree` | `{nodes, title?}` | `tree` |
| `flow` | diagram fields (`kind`, `nodes`, `edges`, …) | `diagram` |
| `sections` | `[{heading, ...any content field}]` | 2–3 sections → `columns`, 4–5 → `tabs`, more → `heading` + stacked blocks |
| `blocks` | `[Block, ...]` | explicit blocks appended after the derived ones |
| `actions` | `[{label, prompt, tone?}]` | `actions` (always last) |

Layout: field order is the reading order, except `summary` first and `actions` last.
`layout: "auto"` (default) lays 2–3 `sections` side by side and 4–5 as tabs; ordinary blocks
always stack, because auto-pairing unrelated blocks read as two disconnected panels.
`layout: "stack"` keeps every block on its own row. A derived card is marked with a small "auto"
chip in its header; capabilities the row config disables simply produce fewer blocks. The
derived blocks obey every cap below, and blocks over the card cap are reported in `dropped`.

A section row is only formed when the sections have comparable heights (tallest ≤ 2.2× the
shortest); otherwise they stack under their own headings, because a tall column beside a short
one leaves a hole. Section shares are **not forced equal**: a section that carries a wide block (table, diagram,
image, code, kanban, tree, tabs) takes two shares (`[2, 1]`, `[1, 2]`, or `[1, 2, 1]` for
three); a chart or text section stays at one. Charts scale with their frame, so a chart section
does not widen. Pass `blocks` with a `columns` block to set `weights` explicitly.

**Look (density).** `look` chooses one of four densities — `default`, `compact`, `flat`,
`relaxed` — and the Client applies it as `dsh-sc-card--<look>`; an unknown value is ignored. When
the model omits it the Client derives one from the normalized blocks: ≥6 blocks, ≥24 items or a
≥10-row table → `compact`; data-only blocks (no text/list/callout/quote) → `flat`; ≤2 blocks that
include prose → `relaxed`; anything else → `default`. An explicit value always wins.

**Header actions.** A card header keeps its actions in a `head-actions` cluster pinned to the
top-right corner (`position:absolute`), so they never shift the title baseline:
`copy` (every card with blocks) and `close` (only a dismissible card). Copy serializes the card
to Markdown (`cardToMarkdown`): title as `##`, subtitle italic, callout as quote, stats/keyvalue
as bullet pairs, table as a pipe table, pie/bars/sparkline as lists, diagram as a ```mermaid
fence, diff as a ```diff fence, tabs/columns/tree/kanban with their structure, and
`actions`/`controls`/`live` omitted as UI scaffolding. Feedback is a check glyph plus an
`aria-live` status line; there is no timer, so it resets on pointer leave or blur.

**Tail cards are transient.** The Turn tail shows the cards of the *latest* Turn only: once a
later Turn exists in the conversation, `selectTailCards` returns nothing for the earlier Turn, so
a next-step card never lingers after the user has moved on. The retired-board card (order 31) is
exempt — it hands back information and stays.

**Long-session cost is O(nodes), not O(Turns × nodes).** A Turn footer is mounted per Turn, and
each mounted footer runs its own snapshot selector on every store commit. The Client therefore
keeps one WeakMap-keyed per-snapshot index (`snapshotIndexOf`) that a single pass fills with
per-Turn tail cards, the generated next-step payload, the dock card per Turn, the "has an answer
card" set, the latest Turn, and the `live` facts — and the three selectors (`selectTailCards`,
`selectBoardConversion`, `selectDockCard`) answer from it in O(1) each. The stored order length and
last key are re-checked on a cache hit so an appended-to snapshot is reindexed; the entry dies with
the snapshot object. Without it, 400 Turns / 2400 nodes cost ~21 ms per session event; with it,
0.06–0.25 ms. Card bodies are cached the same way: `RenderUiCard` memoizes on the recorded argument
string, so a parent re-render does not re-parse and re-normalize an unchanged card.

**Automatic next-step cards.** `nextSteps` defaults to **off** (opt-in: `true` enables it) and
applies to the person's own session only: a session whose header marks it as a delegated child (`origin:
'subagent'`, a `parentSession`, or `delegationDepth > 0`) is skipped before any model call, because
child sessions close turns constantly while working. When off, `schedule` returns before any
`snapshotEvents()` scan, so a long session pays nothing per completed turn.
When on, it turns the Turn tail into a generated surface.
On `turn/end` the Host collects the Turn's user question and final assistant text from
`session.snapshotEvents()`, skips the Turn when the reply is shorter than `nextStepsMinChars`, the
Turn already logged a `render_ui` call with `"place":"tail"`, an event already exists for that
Turn, no route is resolvable (`session.requestHeader()?.config`, else the paired
`nextStepsProvider`/`nextStepsModel`), or no `llm` service is present — then sends one small
`ctx.get('llm').stream()` request (system prompt demands strict JSON, `maxTokens` capped) and
appends `super-cards/next-steps` with `{ turn, summary?, text, options: [{label, prompt}], at }`
(`summary` is the one-or-two-sentence recap the card opens with, clamped to 240 characters). One
in-flight generation per session; `turn/start`, the timeout, and plugin disposal abort it; the
listener never throws and never appends twice for a Turn. Model output is parsed defensively
(code fences stripped, prose tolerated, labels clamped to 40 and prompts to 400 characters, 1–4
options, `null` when nothing usable). The event carries `data.turn` because it is appended after
`turn/end`: the location index reads that payload coordinate, which is what binds the card to its
Turn. The Client matches it into the `super-cards-next` chat node (row renders nothing inline) and
the Turn tail renders it as `{ look: 'relaxed', blocks: [text, actions] }` with the first option
primary. A model-authored `tail` card in the same Turn suppresses the generated one.

**Headless header.** A card with no title, subtitle, icon, or state renders the actions cluster
without a header bar: the `head--float` modifier drops the bottom rule, padding and margin and
keeps only the 22px band the buttons occupy, so the title-less card (a next-step card, a bare
table) reads as one continuous surface — and the `compact` look's own header padding is
overridden in the same rule. A card that does have a title keeps the full header with its
hairline.

**Dismissal.** A card is dismissible only when it is not a plain display card: its resolved
status is not `none`, or it carries an interactive/dynamic block (`controls`, `actions`,
`live`). A dismissible card renders a close button in the header cluster (a headless card still
gets a minimal header row); a static read-only card renders no close button at all. Closing rests
the card as a one-line dashed bar (closed state, `closed` i18n copy) whose line reopens it; the
dock board always keeps its close/reopen pair and rests as `Board closed`. The state is
component-local, so a page reload restores the expanded card.

**Completed folding.** A card whose resolved status is `success` and whose glanceable item
count (item arrays, table rows, or blocks) reaches 3 renders as one checked line —
`✓ title · N items completed` — with the body behind a disclosure button; a manual click
wins. Running cards never fold.

**Status.** `status` is optional and defaults to a display card: `none` means the card has
no lifecycle state — no status pill, no accent tint, no completion folding — which is the
right default for reference content (architecture notes, specs, comparisons). Passing any
other value opts the card into the state machine: `running` / `success` / `warn` / `error`.
When omitted, the client derives it only from real work: a card with no `progress` block is
`none`; otherwise every `progress` bar at 100% means `success`, anything else is `running`.
Explicit `status:"none"` keeps a progress-bearing card a display card (e.g. disk usage).
The state paints the card accent, the header dot and its label (running pulses subtly,
reduced-motion aware), and the dock header icon; a dock board handed back at the Turn tail
renders as `neutral` when it never completed, so a retired board does not pretend to be
running. Display cards and `neutral` cards render the header without a state pill.

Unknown block types must be handled forward-compatibly, never crash: the Host reports
them in `dropped`, and the Client keeps a named placeholder for a wire type it cannot
render (see the Client half section).

Content field names are accepted as block types, because a model sometimes names a
`content` field where a block `type` belongs. Both halves fold the alias onto the block
that renders the same material — `note`/`summary`/`notice` → `callout` (`note` defaults to
`warn`, the others to `info`), `metrics` → `stats`, `series` → `sparkline`, `breakdown` →
`pie`, `steps` → `timeline`, `items`/`bullets` → `list`, `tags` → `badges`, `facts` →
`keyvalue`, `flow` → `diagram` — before normalization, so the wire enum stays canonical and
a registered type always wins over its alias. An alias only corrects the name: the payload
is normalized as the canonical type would be, so a shape that does not fit is still
reported as `no usable content`.
Host caps: ≤24 blocks, ≤50 table rows, ≤120 sparkline values, ≤8000 chars per code block,
≤4000 chars per text field, ≤8 actions. Host truncates instead of rejecting where sensible.

### `motion` (optional, on any block)

```jsonc
"motion": {
  "effect": "pulse|flash|reveal|sweep|draw|flow|bounce|shake",  // required; anything else renders the block statically
  "duration": 1000,   // 200..6000 ms, default 1000
  "delay": 0,         // 0..4000 ms, default 0
  "loop": false       // default false; use it for pulse and flow
}
```

The model never writes CSS: `effect` names a preset whose keyframes live in the Client
stylesheet. `sweep` needs `progress`/`bars`, `draw`/`flow` need `diagram`/`sparkline`; a
mismatched preset animates nothing and still renders the block. An unknown or unusable
`motion` is dropped alone (never the block, never the card) and appears in no `dropped[]`
entry, because it is decoration rather than content. The `render_ui_blocks` tool accepts
`type:"motion"` and returns the full vocabulary; the `render_ui` block-item schema exposes
the same `effect` enum so the model can see it without a lookup. Both halves carry the
same list, defaults, and clamps (parity test).

### Canonical example (used by tests and the tool description)

```json
{
  "title": "Deploy summary",
  "subtitle": "production · just now",
  "icon": "check",
  "blocks": [
    {"type":"callout","tone":"success","title":"Rollout complete","text":"All 3 services are healthy."},
    {"type":"stats","items":[
      {"label":"Version","value":"v2.14.0"},
      {"label":"Pods ready","value":"12/12","tone":"success"},
      {"label":"P95 latency","value":"212 ms","delta":"-8%","tone":"success"}
    ]},
    {"type":"table","columns":["Service","Status","CPU"],"rows":[["api","healthy","41%"],["worker","healthy","63%"]],"align":["left","left","right"]},
    {"type":"actions","items":[{"label":"查看日志","prompt":"查看这次部署的日志","tone":"primary"}]}
  ]
}
```

## Host half (`index.js` + `lib/`) — owned by host-dev

The entry stays thin and the behavior lives in focused modules:

| Module | Responsibility |
| --- | --- |
| `index.js` | `apply(ctx, config)`: register the two tools and the prompt section inside effects |
| `lib/shared.js` | tone/icon/status vocabularies, `CAPS`, motion presets and `normalizeMotion`, value coercion |
| `lib/blocks.js` | block normalizers, the `BLOCKS` registry, directory/contract text, config resolvers |
| `lib/spec.js` | `readPlace`, `normalizeSpec` (drops/caps/dock), `executeRenderUi` |
| `lib/tools.js` | descriptions, prompt text, tool factories, `resolveConfig` |
| `lib/config.js` | Schemastery `Config` (all editable fields `volatile`) + placement vocabulary |
| `lib/service.js` | read-only Host `superCards` service (blocks/placements/motion introspection) |

- `export const inject = ['tools', 'systemPrompt']`
- `export function apply(ctx, config)`: register everything inside `ctx.effect(...)`; no
  module-level side effects, no imports from Harness packages (`ctx` is the only API surface;
  `./lib` imports are the only imports).
- `config` (all optional): `blocks` narrows the enabled block types, `maxBlocks` caps the card
  size, `dock` toggles dock boards, `defaultPlace` picks the placement when the model omits it.
  `lib/config.js` exports a Standard Schema V1 `Config` (no schema-library dependency) so the
  Loader validates the row at activation and reports unknown keys or out-of-range values; every
  value is resolved, defaulted, and clamped again inside `apply`.
- The Host provides the read-only `superCards` service
  (`{ version, blocks: { list, dock, has, get, contract }, placements: { list, has } }`) for
  tooling and for Host plugins that pair with a Client block registration.
- Progressive disclosure is a contract, not a suggestion:
  - `render_ui` carries the compact block directory (names + one-word purposes) and the
    canonical example; it must **not** carry the exact per-block shapes.
  - `render_ui_blocks` (`{ type?: string | string[] }`) returns shape, field notes, and
    example for one type, a list of types, or every type. Its enum also accepts the keyword
    `"motion"`, which returns the optional motion vocabulary (effects, clamps, defaults);
    the full catalog points at that keyword instead of inlining it.
- `render_ui` tool definition:
  - `name: 'render_ui'`
  - `description`: model-facing English instructions — when to use it (structured answer:
    comparison, metrics, dashboard, steps, table, chart, decision with options; answers that
    would otherwise be a long Markdown table/list/code dump), when NOT to (short prose,
    casual chat, content needing long Markdown prose), and a compact block reference table
    plus the canonical example above. State explicitly: do not repeat the card content in
    Markdown afterwards; keep any prose to one short sentence of commentary.
  - `parameters`: strict-ish JSON Schema using only `type`, `properties`, `required`,
    `additionalProperties`, `items`, `enum`, `description`, `title`, `default`, `examples`.
    Top level `{type:'object', properties:{version?,title?,subtitle?,icon?,status?,place?,blocks?,content?,layout?}, required:[], additionalProperties:false}`;
    `blocks.items` is `{type:'object', properties:{type:{type:'string', enum:[the 28 registry types]}, motion:{...optional preset...}}, required:['type'], additionalProperties:true}`;
    `content` describes the auto-layout fields above, `layout` is an `auto|stack` enum.
  - `execute(args, exec)`: validate + normalize (see caps), never render UI here; return a
    small JSON value such as `{ ok: true, blocks: 4, types: ['callout','stats','table','actions'], place:'answer' }`.
    When a submitted block cannot be rendered (unknown type, no usable content, over a cap,
    or not allowed in a dock board), add `dropped: [{ index, type, reason }]`; omit the key
    entirely when nothing was dropped. On invalid input `throw new Error('render_ui: ...')`
    with an actionable sentence so the model can retry.
  - `output`: `{ schema, render(args, value) }`; the schema allows the optional `dropped`
    array, and `render` returns one short text block —
    `[Rendered UI card (N blocks). [K blocks dropped - see "dropped".] Do not repeat its content in Markdown.]`.
  - `presentCall(args)`: `{ card:'generic', title:'Super Cards', kind:'other' }`.
- Prompt section: `ctx.systemPrompt.section({ name:'super-cards', order:60, text })`.
  Short (~10–14 lines), English, decision guidance only — the tool description owns the block
  reference, so the section must not restate it: when the answer is structured call `render_ui`
  and let the card be the answer; keep explanation in prose around the card; `place`/`status`
  semantics; drops are reported back so the model can fix them.
- Everything must be defensive: a malformed tool call must produce a readable error, never
  crash the agent loop.

### Block registries (one per half, parity-tested)

Every block type is one entry in the Host `BLOCKS` table (`lib/blocks.js`):
`{ type, purpose, shape, note, fields?, example, dock, normalize }`. The wire enum, the
description directory, the on-demand contract catalog, the dock-safe subset, and the
normalization dispatch are all derived from it. The Client keeps the mirror registry
`BLOCK_IMPL` (`{ dock, normalize, render }`) with one component function per type.

Adding a block type touches one Host entry plus one Client entry. A cross-half parity test
asserts that the block order, the dock subset, and the caps agree; docs and tool text are
generated, never retyped.

`DOCK_BLOCKS` (the blocks a compact board may carry) is derived from the registry and
enforced on the Host: a dock call containing long-form blocks drops them, reports them in
`dropped`, and fails with an actionable error only when nothing dock-safe remains. The
client keeps the same allow-list as defense in depth.

The Client exposes the registry as the `superCards` Cordis service
(`blocks.list/get/has/register/replace`, `placements.*`, `subscribe`) so another Client
plugin can add a block type or replace a renderer without editing this package.

### Caps

`CAPS = { blocks: 24, tableRows: 50, sparklineValues: 120, codeChars: 8000,
textChars: 4000, actions: 8, dockBlocks: 4, htmlChars: 20000, pieSlices: 8,
treeNodes: 200, treeDepth: 4, heatmapCells: 371, diffLines: 400, kanbanColumns: 4,
kanbanCards: 8, tabs: 5, tabBlocks: 6, columns: 3, columnBlocks: 6,
imageChars: 200000 }`. The client
mirrors the same numbers and the parity test fails when either half drifts.

## Client half (`client.js`) — owned by client-dev

**Team progress card.** A third Chat row (`kind: 'super-cards-team'`, target `chat`)
matches durable `team/member` and `team/task` events (function-form match, keyed by `teamId`),
merges members/tasks by id, and anchors one card at the first matching event with
`groupTree: 'turn'`. Derived status: all tasks `completed` → `success`; a `failed`/`cancelled`
task with no `in_progress` → `warn` (single) or `error` (several); otherwise `running`; with no
tasks, `running` while any member phase is `provisioning`/`active`, else `success`. The renderer
reuses `RenderUiCard` with `stats` (subagents, tasks done/total) and a `progress` row per task
(completed 1, in_progress 0.5, pending/failed 0, at most 12 rows). Completion folding is the
existing behaviour, so a finished team card rests as one checked line. No model call is
involved and replay rebuilds the same card from the log.

**Diagram sizing.** All geometry is computed from the block (no DOM measurement), and it is
kept dense on purpose: 28px node boxes, 26px participant headers, 16px compartment lines,
20px message rows, LR columns 56px apart, TB rows 30px apart. The chart renders at its natural
size and is never stretched to the card width (stretching a tall chart is what made it
thousands of pixels high); a wide chart may shrink at most 15%, then the figure scrolls
horizontally, and a chart taller than 520px scrolls vertically inside the figure. Edge labels
carry an opaque background chip so they stay readable where a gap is tight.

**Diagram presentation.** A `diagram` block renders a chart with a source toggle: one
toolbar button (locale keys `diagram.source` / `diagram.chart`, `aria-pressed`) switches to a
`<pre>` holding `block.source` when present (auto-converted cards keep the original fence) or
a mermaid reconstruction from the block (`diagramToMermaid`). The model-facing prompt forbids
mermaid fences: diagrams go through `render_ui`'s `diagram` block, so no source block and card
are shown twice.

Auto-conversion (fallback): a second Chat row (`kind: 'super-cards-auto'`, target `chat`)
matches `assistant/message`, collects the message's `text` blocks, extracts fenced blocks whose
info string is `mermaid` or `mmd`, and renders one card per fence anchored at the message `seq`
with `groupTree: 'turn'`. The parser covers `flowchart`/`graph`, `sequenceDiagram`,
`classDiagram`, and `stateDiagram(-v2)`; parsed results run through the same diagram
normalization, and an unparsable fence degrades to a `code` block card titled
"diagram source (auto-converted)" so nothing is lost. The raw fenced block stays visible in
Markdown (rendering is not interceptable); the auto card is additive. Static auto cards carry
no close button (see Dismissal).

The inline surface must survive a cold page load: the plugin declares
`uiConversation` in its `inject` list and registers the Chat row definition through
`ctx.inject(['uiConversation'], …)`, never through a one-shot `ctx.get`. A one-shot
lookup is skipped when the Conversation package activates later, and then replay has
no row definition, so every historical card disappears while the live session works.

Unknown wire block types are never dropped silently: the Client keeps a
`{ type: '__unsupported', missingType }` placeholder for a well-typed block whose type
has no renderer, renders it as one muted notice naming the type (locale keys
`block.missing` / `block.missingHint`), and swaps it for the real renderer as soon as
one is registered through the `superCards` service. Content-field aliases resolve before
this check, so `{"type":"note"}` draws a `callout` instead of a placeholder.

Module wiring (copy the proven pattern from `/Users/baitouwuya/dsh-compaction-pixel-bar/client.js`):

```js
window.__ModuleLoader__.load({
  id: 'dsh-super-cards',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    // ... components, extractor, styles, locale dicts, apply ...
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
```

The only module this file requires beyond `react` is an optional probe of
`@deepseek-ai/dsh-client-ui-primitives`, the Web shell's own component library. The shell
seeds it into its frozen module table, so the loader resolves it before it looks at any
package: a plugin factory reads the same instance the application renders with, without a
copy and without a `dsh.client.external` declaration. It is not a documented contract and
older shells do not seed it, so the probe is wrapped in `try`/`catch` and every consumer
falls back to the plugin's own renderer — the `code` block takes the host's
`useCodeHighlighter` tokens, plain text when they are not there, and the `tabs` row is the
host's `SegmentedTabs` or a matching local segmented row.

- `const inject = ['slots', 'locale']`
- `apply(ctx)`: t = makeTranslator(ctx) (locale service via `ctx.get('locale')`, local zh/en
  dictionary fallback — same pattern as the reference plugin); install one `<style>` tag with
  `ctx.effect` (id `dsh-super-cards`, removed on dispose); then
  `ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name:'tool.call.toolview', key:'render_ui', locale: NS }, RenderUiRow)), 'superCards.toolview')`
  wrapped in try/catch that logs once (never throws out of apply).
- `RenderUiRow` props of interest: `{ phase: 'preparing'|'start'|'result', block, toolName, inputActions, sessionId }`.
  Read the spec **only** from recorded call material:
  - `start`: `JSON.parse(block.argsRaw)` (string).
  - `result`: `JSON.parse(block.call.argsRaw)`; `block.call` may be `null` (window truncation).
  - `preparing`: `block.argsRaw` does not exist; render a skeleton card (shimmer lines).
  - When `phase==='result'` and `block.isError`, render a small error card using the text in
    `block.content` (join text blocks) — this is the tool error message, not a UI spec.
  - An args string that cannot become a card renders a warn notice that names the failure:
    `reason:'empty'` (no arguments at all — a call rejected before dispatch reaches the row
    with `arguments: {}`, for example when `render_ui` is not directly callable in this preset),
    `reason:'parse'` (invalid JSON; the parser message rides along as `detail`), and
    `reason:'shape'` (parsed, but nothing renderable). Never a blanket "invalid spec".
  - Never throw. Wrap the card in a class ErrorBoundary whose fallback is a minimal card with
    localized "UI 渲染失败" copy (the app must not blank the slot).
- Rendering rules:
  - The view replaces the whole tool row: render the card container yourself
    (rounded surface, `--dsw-alias-bg-layer-1`, 1px `--dsw-alias-border-l1`, radius ~14px,
    padding 14–18px, max-width 100%, `margin-block: 4px`), not a collapsible tool header.
  - **Only** `--dsw-alias-*` theme tokens for color/spacing-adjacent colors; no hard-coded
    hex for surfaces/text/borders. Tone accents may use
    `--dsw-alias-state-{success,warn,error,info}/brand` tokens with `color-mix` only if the
    fallback works. No global CSS: every class starts with `dsh-sc-`.
  - Typography inherits host: no font-family override except `code`/`sparkline` monospace.
    Sizes: title 17px/700, subtitle 12.5px secondary, body 14px/1.6, table 13px, code 12.5px;
    section headings 18px/700 (level 1, with a brand bar) and 16px/700 (level 2).
  - Prose-shaped blocks (`text`, `list`, a `keyvalue` row sheet) keep one reading measure —
    `--dsh-sc-measure: 62ch` (~31 CJK characters a line), and a row sheet gets
    `--dsh-sc-measure-wide: 76ch` because its first column is labels — while blocks that
    scale with their frame (`table`, charts, `columns`, a `keyvalue` tile grid at
    `min(100%, 84ch)`) take the card width.
  - A `keyvalue` block is one of two shapes (`kvLayout`). Up to six short facts tile —
    key over value, two or three across, three facts fill the row, four make a 2x2, five and
    six read 3+2 and 3+3 — which spends a wide card's width without turning the sheet into a
    form. A long value (over 28 characters), a long key (over 16), or a seventh fact switches
    to a row sheet:
    `display:grid` with `fit-content(34%) minmax(0, 1fr)`, the items flattened with
    `display:contents`, so every label shares one column and every value gets the line
    width. Under 600px the sheet stacks (key above value) instead of squeezing two
    columns.
  - A `list` with at least 6 items whose longest item is at most 220 characters may flow
    into columns: `display:grid` with `repeat(auto-fit, minmax(min(100%, 21rem), 1fr))`,
    so a wide card spends the spare width on more columns instead of one ragged line and
    a hole beside it, and a list inside a narrow `columns` cell still stacks. Ordered
    lists flow too — a grid keeps DOM order left to right. Items of a longer list stay
    stacked (a paragraph in a bullet wants one column).
  - Tables: full width, sticky-free, first row is `<th scope="col">`, numeric-looking cells
    right-aligned when `align` says so; horizontal scroll inside the card for wide tables.
  - Bar chart / sparkline: hand-written SVG (no chart library, no external requests), theme
    `currentColor`/tokens, `role="img"` with an `aria-label` summarizing, sparkline uses
    `preserveAspectRatio="none"` inside a fixed-height box. Vertical bars are plain DOM
    columns with inline heights (no SVG needed), labelled with their value and category.
  - `sparkline` is interactive without leaving the card: pointer move (or focus + arrow keys)
    selects the nearest sample and draws a hairline guide, a dot and a value bubble; the same
    text is mirrored into an `aria-live` region, `Escape`/leave clears it. The chart stays a
    plain SVG, so an untouched card is pixel-identical to a static one and replay is stable.
  - Pie: hand-written SVG ring built from `stroke-dasharray` segments sharing one circle;
    `donut:false` widens the stroke to a filled disc. The legend carries label, value and
    share; slices with a tone use the state colour, untinted slices use a neutral ramp of
    `--dsw-alias-label-primary` mixed into `--dsw-alias-bg-layer-1`, so both themes read.
  - `progress`: `role="progressbar"` with `aria-valuenow/min/max`; clamp 0..1.
  - `actions`: real `<button type="button">`; on click call `props.inputActions.setDraft(prompt)`
    when it is a function, show a transient localized "已放入输入框，按 Enter 发送" hint; if
    unavailable, try `navigator.clipboard.writeText(prompt)` and show "已复制". Never auto-send.
  - `links`: `<a href>` with `target="_blank" rel="noreferrer noopener"`, only http/https/mailto
    hrefs rendered as links; other hrefs rendered as plain text.
  - Inline formatting: parse `**bold**` and `` `code` `` into React nodes (no HTML injection).
  - Accessibility: headings use `<h3/h4/h5>`, card root `aria-label` from title, `aria-hidden`
    on decorative glyphs, focus-visible outline on buttons/links using the brand token.
  - Long cards: keep DOM small; no timers, no JS animation loop, no per-row state beyond the
    actions' transient hint (one `useState` in the actions block).
  - Motion (CSS only, in the single stylesheet): a card enters once (`opacity`/`transform`,
    ≤260ms) and its blocks stagger in reading order (24ms steps, capped at 8); a status change
    transitions tokens and pops the chip; a running dot uses an opacity breathe plus one
    expanding ring; a progress fill animates `width` (≤460ms); the disclosure chevron is one
    glyph rotated 180° rather than swapped; a swapped diagram view cross-fades. Animate only
    `transform`, `opacity`, and token colors, except the 6px progress fill's `width`. The
    `prefers-reduced-motion: reduce` block must be the last block in the sheet and neutralize
    every animation and transition declared above it.
  - Agent motion (`motion` on a block) wraps exactly that block in one
    `dsh-sc-motion-wrap` grid child carrying `dsh-sc-motion--<effect>`, `data-block`, and
    the three timing custom properties; the stylesheet owns every keyframe (`pulse`,
    `flash`, `reveal`, `sweep`, `draw`, `flow`, `bounce`, `shake`). Effects that act on a part
    of the block target it by class (`progress-fill`, `bar-fill`, `diagram-edge`,
    `spark-line`); SVG paths carry `pathLength="100"` so one keyframe covers any edge length.
    A block without motion must render exactly as before (no wrapper). Reduced motion
    neutralizes the envelope and all its descendants. The wrapper is layout-neutral: it takes
    the same grid slot, and a wrapped `live` block keeps its half-row span.
  - Sandboxed HTML (`html` block): the only point where model-authored HTML enters the page.
    The frame is `sandbox="allow-scripts"` with **no** `allow-same-origin` (opaque origin: no
    parent DOM, storage, cookies, popups, or top navigation), and its `srcdoc` carries a CSP
    with `default-src 'none'`, `style-src 'unsafe-inline'`, `script-src 'unsafe-inline'`,
    `img-src data: blob:`, `font-src data:`, `media-src data: blob:`, `connect-src 'none'`,
    `form-action 'none'`, `base-uri 'none'`. A fragment is wrapped in a document; a full
    document gets the head injected after its `<head>`/`<html>`. Theme tokens are read once
    from the host document (`getComputedStyle`) at render time and written into the frame's
    `:root` (a DOM-less load yields none); the frame document gets the host font stack, a
    transparent background, and a `prefers-reduced-motion` rule. The card has a fixed,
    host-clamped height and a preview/source toggle. `test/client.test.mjs` asserts there is
    exactly one `srcDoc:` in the module and that its sandbox is exactly `allow-scripts`.
- Locale dictionary (internal, zh + en) for the few plugin strings only; card content comes
  from the model and is already localized. NS = `'superCards'`.
- Export `exports.__test = { extractSpec, normalizeSpec, renderBlockFactory? }` with pure
  helpers so `node --test` can exercise the extractor without a DOM.

## Tests (each owner writes their own file)

`node --test test/*.test.mjs` must pass from `/Users/baitouwuya/dsh-super-cards`.

- host-dev → `test/host.test.mjs`: import `index.js`, fake ctx (records `tools.register`,
  `systemPrompt.section`, effects), assert tool name/schema/execute normalization/caps/errors,
  output.render text, prompt section registration + disposal, the registry-derived directory
  and contract catalog, progressive disclosure (exact shapes deferred), and row config
  (allow-list, cap, dock toggle, default placement, junk fallback), the Standard Schema
  `Config` validation, and the read-only Host service.
- client-dev → `test/client.test.mjs`: stub `globalThis.window.__ModuleLoader__` to capture
  `{id, factory}`, provide a fake `require('react')` (createElement/useState/useEffect/
  useMemo/Component stub), run factory, assert `apply` registers key `render_ui` inside
  `tool.call.toolview`, and unit-test `extractSpec` for start/result/error/preparing blocks and
  `normalizeSpec` caps/unknown-block skipping, the `superCards` service (register/replace
  disposable, subscription), placement fallbacks, and the cross-host parity contract.

## File ownership (do not edit another owner's files)

| Path | Owner |
|---|---|
| `SPEC.md`, `package.json`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `README.md` | Lead |
| `index.js`, `test/host.test.mjs` | host-dev |
| `client.js`, `test/client.test.mjs` | client-dev |

If the contract is wrong or a file must change, message the Lead — do not edit `SPEC.md`.