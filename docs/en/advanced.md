# Advanced capabilities

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

This page covers capabilities the model must explicitly choose: sandboxed HTML, motion presets, embedded images, interactive controls, visual density, and the copy and close buttons in the card's top-right corner. Implementations live in [lib/blocks.js](../../lib/blocks.js) and [client.js](../../client.js).

## html cards

When the visual itself is the answer (custom animation, a small demo, hand-drawn SVG) rather than ordinary content, use an `html` block to hand over a self-contained piece of HTML, CSS, SVG, or even inline JS:

```jsonc
{"type":"html","title":"呼吸","height":180,
 "html":"<style>@keyframes b{50%{transform:scale(1.2)}}</style><div class='orb'></div>"}
```

It does not inline into the card DOM; it renders in a sandboxed iframe:

| Boundary | Approach |
| --- | --- |
| Origin | `sandbox="allow-scripts"` with no `allow-same-origin`; the iframe has an opaque origin |
| Host access | Cannot read the parent page DOM, cookies, or storage, and cannot pop windows or navigate the top frame |
| Network | CSP sets `default-src 'none'`, `connect-src 'none'`, and `form-action 'none'`; external scripts, fonts, and requests are all blocked |
| Allowed resources | Inline style and script, `data:` and `blob:` images, `data:` fonts and media |
| JS | Can run CSS animations, Web Animations, canvas, and inline scripts, but has no network or same-origin access |
| Theme | At render time the host reads `--dsw-alias-*` once and writes it into the iframe's `:root`; inside, the same CSS variable names are usable directly |
| Size | `height` takes 120 to 800, default 240; overflow scrolls inside the iframe |
| Size limit | Source is capped at 20000 characters; the Host truncates beyond that |
| Inspection | The card's top-right corner can switch between preview and source; the source is exactly what runs |
| Motion | The iframe document carries its own `prefers-reduced-motion` rules that disable CSS animations and transitions |

`html` is the only arbitrary-content entry point, so it never enters the board, never participates in `motion` presets, and is never collapsed.

## Motion presets

The model writes no CSS for any block; it only adds an optional `motion` object to a block and picks one of 8 fixed presets:

| Preset | What moves | Typical use |
| --- | --- | --- |
| `pulse` | Items inside the block breathe gently | Emphasize a metric that is changing |
| `flash` | The whole block's outline flashes once | A conclusion that was just updated |
| `reveal` | The whole block wipes in from left to right | Progressive disclosure of an explanation |
| `sweep` | Progress bars and column charts grow from 0 to the current value | Show progress |
| `draw` | Chart and diagram lines are stroked in | Sequence diagrams, trend lines being drawn |
| `flow` | Dashes on diagram edges flow | Express direction and transfer |
| `bounce` | The whole block bounces up once | Emphasize a result |
| `shake` | The whole block shakes left and right twice | Warning |

```jsonc
{"type":"progress","items":[{"label":"构建","value":0.6}],
 "motion":{"effect":"sweep","duration":1200,"delay":0,"loop":false}}
```

- `duration` takes 200 to 6000 milliseconds, default 1000; `delay` takes 0 to 4000 milliseconds, default 0; `loop` defaults to `false`.
- `sweep` needs `progress` or `bars`; `draw` and `flow` need `diagram` or `sparkline`; when a preset does not match the block, nothing moves and the content displays normally.
- An unknown preset renders statically: no content loss, no error.
- With the system's "reduce motion" enabled, all `animation` and `transition` are neutralized, leaving only instant state switches.

## Embedded images

The `image` block accepts only two sources:

- An `https` or `http` address: the browser loads it directly, the card sends no Referer, the `<img>` is lazy-loaded, and a click opens the original image.
- A `data:image/*` inline URI: fully offline and stable across refresh and replay, suitable for small images or SVG.

```jsonc
{"type":"image","src":"https://example.com/chart.png","alt":"P95 延迟","caption":"最近 8 天","height":260,"fit":"contain"}
```

- Any other `src` scheme is dropped, including `javascript:`, `file:`, and `blob:`.
- A `data:` URI is capped at 200000 characters; `height` defaults to 240 and is clamped to 80 to 640; `fit` takes `cover` or `contain`.
- A load failure shows a placeholder hint and does not break the card.
- This is the only block in the plugin that can make a network request; if you want no external requests at all, remove `image` from the row config's `blocks`.

## Controls and live

`controls` provides two kinds of controls, settings and buttons:

- A `kind: "setting"` segmented control binds `theme` (light, dark, system) or `locale`; a click writes DSH settings immediately, and the selected state follows the current value.
- A `kind: "button"` with `action.kind: "setting"` applies a setting value directly; `action.kind: "prompt"` puts the prompt into the input box, and only `send: true` sends it to the assistant directly.
- At most 8 items, each settings group at most 6 options; unsupported environments show "this action is not supported in the current environment".
- Operations that need tools and approval (editing files, running commands) are left to the assistant; the card itself never exceeds its authority.

`live` takes effect only in a board (`place: "dock"`) and refreshes automatically with the session: `field` takes `messages`, `tools`, or `last-message`; `limit` takes 1 to 10, default 3.

## look density

`look` controls the card's overall visual density; structure stays the same, only font size, spacing, and borders change:

| Value | Effect |
| --- | --- |
| `default` | Standard density |
| `compact` | Tighter, suited to long reports |
| `flat` | Removes panel borders, leaving only separators |
| `relaxed` | Larger type and more whitespace |

When `look` is omitted it is chosen from the card's shape: `compact` for 6 or more blocks, 24 or more data rows, or tables of 10 rows or more; `flat` for pure data blocks (metrics, tables, charts, with no prose); `relaxed` for at most 2 blocks containing prose; `default` otherwise.

## Copy Markdown and close

Card actions are collected in the top-right corner as two small buttons side by side; they do not participate in title layout.

- Copy: serializes the whole card to Markdown and puts it on the clipboard. The title becomes an H2, callouts become blockquotes, metrics and tables become tables, charts become mermaid fences, and lists, trees, tabs, and columns expand level by level; purely interactive scaffolds such as `actions`, `controls`, and `live` are not exported. Pure display cards also have a copy button, which turns into a green check on success.
- Close: appears only on "closable" cards, meaning cards with a lifecycle status (running, success, warn, error) or containing `controls`, `actions`, or `live`. Pure static display cards have no close button. Closing collapses the card into a dashed narrow strip "collapsed"; clicking the strip reopens it, and the expanded state only lasts within the current page, restoring expanded after a refresh.
- The board always has a close button; once closed it becomes a single line "board closed", and a click reopens it.

## Related

- [Block reference](blocks.md)
- [Four placements](placements.md)
- [Internals](internals.md)