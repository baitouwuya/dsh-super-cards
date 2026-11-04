/**
 * Model-facing tool definitions and prompt section for the Super Cards Host half.
 *
 * Progressive disclosure lives here: the `render_ui` description carries a
 * compact block directory (name + purpose) and the canonical example, while the
 * exact shapes, field notes, and examples are served on demand by the
 * `render_ui_blocks` lookup tool. The system-prompt section is decision guidance
 * only and never restates the block reference.
 *
 * This module imports `./shared.js`, `./blocks.js`, and `./spec.js`; it has no
 * side effects.
 */

import {
  BLOCKS_TOOL_NAME,
  CAPS,
  ICONS,
  LOOKS,
  MOTION_DEFAULTS,
  MOTION_EFFECTS,
  MOTION_LIMITS,
  PROMPT_SECTION_ORDER,
  TOOL_NAME,
  TONES,
  isPlainObject,
} from './shared.js'
import {
  BLOCKS,
  BLOCK_TYPES,
  DOCK_BLOCKS,
  MOTION_LOOKUP,
  blockContractCatalog,
  blockDirectoryLines,
  motionContractText,
  resolveMaxBlocks,
  resolveTypes,
} from './blocks.js'
import { CONTENT_FIELDS, CONTENT_LOOKUP, contentContractText } from './content.js'
import { executeRenderUi } from './spec.js'

/** The canonical example, embedded verbatim in the tool description. */
const CANONICAL_EXAMPLE = '{"title":"Deploy summary","subtitle":"production · just now","icon":"check","blocks":[{"type":"callout","tone":"success","title":"Rollout complete","text":"All 3 services are healthy."},{"type":"stats","items":[{"label":"Version","value":"v2.14.0"},{"label":"Pods ready","value":"12/12","tone":"success"},{"label":"P95 latency","value":"212 ms","delta":"-8%","tone":"success"}]},{"type":"table","columns":["Service","Status","CPU"],"rows":[["api","healthy","41%"],["worker","healthy","63%"]],"align":["left","left","right"]},{"type":"actions","items":[{"label":"查看日志","prompt":"查看这次部署的日志","tone":"primary"}]}]}'

/**
 * Resolve the row config into the normalization/tool options.
 *
 * The returned object is the single options shape every Host module receives;
 * unknown keys are ignored and every value is clamped.
 *
 * @param {unknown} config the patch row config (plain object, optional).
 * @returns {{ types: string[], maxBlocks: number, dock: boolean, defaultPlace: 'answer' | 'process' | 'dock' | 'tail' }} resolved options.
 */
export function resolveConfig(config) {
  const input = isPlainObject(config) ? config : {}
  const defaultPlace = input.defaultPlace === 'process' || input.defaultPlace === 'dock' || input.defaultPlace === 'tail'
    ? input.defaultPlace
    : 'answer'
  return {
    types: resolveTypes(input.blocks),
    maxBlocks: resolveMaxBlocks(input.maxBlocks),
    dock: input.dock !== false,
    defaultPlace,
  }
}

/**
 * Build the full model-facing description of `render_ui`.
 *
 * The description stays compact: purpose, decisions, rules, the block directory,
 * and one canonical example. Exact block contracts are deferred to
 * `render_ui_blocks`.
 *
 * @param {{ types: string[], maxBlocks: number, dock: boolean, defaultPlace: string }} options resolved options.
 * @returns {string} tool description.
 */
export function toolDescription(options) {
  const types = options.types
  const allowed = new Set(types)
  const dockTypes = DOCK_BLOCKS.filter((type) => allowed.has(type))
  const lines = [
    'Render a structured answer as a native UI card in the conversation instead of Markdown.',
    '',
    'When to use: the answer is structured — a comparison, a metrics summary or dashboard, a table, a chart or trend, a step-by-step flow, a spec sheet, key-value facts, a decision with options, or any answer that would otherwise be a long Markdown table, list, or code dump. The card IS the answer.',
    'When not to use: short prose answers, casual chat, or explanations that genuinely need several paragraphs of Markdown prose.',
    '',
    'Rules:',
    '- Do NOT repeat the card content in Markdown afterwards. Keep any accompanying prose to one short sentence of commentary, or none.',
    '- The card renders INLINE at the exact point you call the tool: a short lead-in before the call and follow-up text after it are welcome, and the card sits between them in the answer.',
    '- Put each diagram in its own card: for a second diagram, call the tool again so every diagram is a separate card next to its own explanation.',
    '- Do not emit ```mermaid or other diagram source blocks: call `render_ui` with a `diagram` block instead. A diagram card shows the chart and can switch to its source with one button.',
    '- Choose `place`: `"answer"` (default) makes the card part of the final answer; `"process"` shows a progress card during the work, which folds away with the process details; `"dock"` is a compact board above the composer for progress/status only; `"tail"` places the card at the very end of the completed turn, after the reply and before the turn action row — use it for a next-step card (a question plus two or three `actions` options) so the user can answer with one click.',
    '- Call it more than once in one answer when the answer has distinct parts; each call places its own card in order.',
    '- Write all card text in the user\\u2019s language. Normally one card per answer.',
    '- Inside text fields only `**bold**` and `code` inline marks are rendered; newlines are line breaks; no HTML or Markdown headings/tables inside strings.',
    '- Two input modes: `content` names the material and the card picks the controls and the arrangement; `blocks` gives exact control. Prefer `content` when you know the data but not the layout, `blocks` when each view matters. Both may be combined (derived blocks first, explicit blocks after).',
    '- Fast path: {"title":"Deploy summary","content":{"summary":"All 3 services are healthy.","metrics":[{"label":"Pods ready","value":"12/12","tone":"success"},{"label":"P95 latency","value":"212 ms","delta":"-8%"}],"series":{"title":"Latency","values":[262,244,231,219,212],"unit":"ms"},"actions":[{"label":"查看日志","prompt":"查看这次部署的日志"}]}} — content fields: ' + CONTENT_FIELDS.join(', ') + '; exact shapes: call `' + BLOCKS_TOOL_NAME + '` with type "' + CONTENT_LOOKUP + '".',
    '- Pick the fitting block when you write `blocks`: `table` for comparisons, `stats` for key metrics, `bars` for rankings (`direction: "vertical"` for columns over a short series), `pie` for shares of one whole, `sparkline` for a trend, `timeline` for steps or history, `columns` to put short blocks side by side, `actions` for suggested next prompts.',
    '- A block may carry `motion` to animate itself: one of ' + MOTION_EFFECTS.join(', ') + ' (e.g. `sweep` on a progress bar, `flow` on a diagram). Call `' + BLOCKS_TOOL_NAME + '` with type "' + MOTION_LOOKUP + '" for the exact vocabulary; use it only when the movement carries meaning, never as decoration.',
    '- For a custom visual that no block covers (your own animation, a mini demo, a bespoke SVG), use the `html` block: one self-contained HTML/CSS/SVG fragment (≤' + CAPS.htmlChars + ' chars) rendered in a sandboxed frame with no network and no access to the app; the theme tokens are available there as CSS variables. Prefer native blocks for ordinary content.',
    '- Set `status` only when the card tracks real work; omit it for a plain display card (progress bars at 100% complete themselves).',
    '- If the result reports dropped blocks, fix them and call again: the card renders without them.',
    '',
    'Block directory (' + types.length + ' types; exact shapes, field notes and examples: call `' + BLOCKS_TOOL_NAME + '`):',
    ...blockDirectoryLines(types),
  ]
  if (dockTypes.length > 0 && options.dock) {
    lines.push('', 'Dock boards render only ' + dockTypes.join(', ') + ' blocks, at most ' + CAPS.dockBlocks + '.')
  } else if (!options.dock) {
    lines.push('', 'Dock boards are disabled for this profile: use place "answer" or "process".')
  }
  lines.push(
    '',
    'Tone: ' + TONES.join(' | ') + '. Icon: ' + ICONS.join(' | ') + '. Look: ' + LOOKS.join(' | ') + '.',
    'Limits: 1\\u2013' + options.maxBlocks + ' blocks, ' + CAPS.tableRows + ' table rows, ' + CAPS.sparklineValues + ' sparkline points, ' + CAPS.codeChars + ' code characters, ' + CAPS.textChars + ' characters per text field, ' + CAPS.actions + ' actions; oversized input is truncated.',
    '',
    'Canonical example:',
    CANONICAL_EXAMPLE,
  )
  return lines.join('\n')
}

/**
 * Build the short system-prompt section.
 *
 * Decision guidance only: when to answer with a card, when not to, how placement
 * and status work, and that drops are reported back. The block reference is not
 * duplicated here.
 *
 * @param {{ dock: boolean }} options resolved options.
 * @returns {string} prompt section text.
 */
export function promptText(options) {
  return [
    'The `' + TOOL_NAME + '` tool renders the answer as a native UI card instead of Markdown; the card is the answer, so do not repeat its content in Markdown afterwards.',
    '',
    'Use it when the answer is structured: a comparison, a metrics summary, a table, a chart, a step-by-step flow, a spec sheet, code, or a decision with options. Answer short prose, chat, and explanations in Markdown instead.',
    'A card carries structured content, not prose: keep explanation and reasoning in Markdown around the card, and never wrap a prose answer in card text blocks.',
    '',
    'The card renders inline exactly where you call it: write the lead-in, call the tool, then continue the answer after it.',
    options.dock
      ? 'Choose `place`: `"answer"` (default) is inline in the answer; `"process"` folds away with the work details; `"dock"` is a compact board above the composer for progress or status only; `"tail"` is a card at the end of the completed turn, after the reply — use it for a next-step card with `actions` options.'
      : 'Choose `place`: `"answer"` (default) is inline in the answer; `"process"` folds away with the work details; `"tail"` is a card at the end of the completed turn, after the reply — use it for a next-step card with `actions` options; dock boards are disabled for this profile.',
    ...(options.types.includes('diagram')
      ? [
        'One diagram per card: give a second diagram its own card, next to the prose that explains it.',
        'Do not write ```mermaid blocks: call `render_ui` with a `diagram` block; the card toggles between the chart and its source.',
      ]
      : []),
    'Omitting `status` is normal: a card with nothing to complete is a plain display card. Progress bars at 100% complete themselves; set `"success"`/`"warn"`/`"error"` only when the card tracks real work, or `"none"` to keep a progress card informational.',
    'Write all card text in the user\\u2019s language; inside text fields only `**bold**` and `code` are rendered, and newlines are line breaks.',
    'Keep the card compact (at most ' + options.maxBlocks + ' blocks): tables, charts, and code are truncated at their caps.',
    'Block fields: call `' + BLOCKS_TOOL_NAME + '` for the exact shape and example of any block type before authoring an unfamiliar one.',
    'A block may carry `motion` (named presets, e.g. `sweep` on progress or `flow` on a diagram) when movement carries meaning; for a custom visual no block covers, use `html` — your own self-contained HTML/CSS/SVG in a sandboxed frame. Call `' + BLOCKS_TOOL_NAME + '` for both vocabularies.',
    'Two input modes: pass `content` (summary, metrics, series, breakdown, table, steps, items, facts, tags, code, quote, links, tree, flow, note, sections, actions) and the card picks the controls and the arrangement; pass `blocks` for exact control. Prefer `content` when you know the data but not the layout; both may be combined.',
    'Content field reference: call `' + BLOCKS_TOOL_NAME + '` with type "' + CONTENT_LOOKUP + '".',
    'The tool result reports the block count and any dropped blocks: if something was dropped, fix it and call again.',
    'If a card is not the right fit, answer in Markdown prose without calling the tool.',
  ].join('\n')
}

/**
 * Build the model-facing `render_ui` tool definition.
 * @param {ReturnType<typeof resolveConfig>} options resolved options.
 * @returns {object} ToolDefinition registered with `ctx.tools.register`.
 */
export function createRenderUiTool(options) {
  return {
    // Literal on purpose: this exact wire name is the client toolview key and
    // is asserted by the cross-file manifest contract test.
    name: 'render_ui',
    description: toolDescription(options),
    parameters: {
      type: 'object',
      properties: {
        version: {
          type: 'integer',
          description: 'Optional spec version. Always 1; accepted and ignored.',
        },
        title: {
          type: 'string',
          description: 'Card title, short, in the user\\u2019s language.',
        },
        subtitle: {
          type: 'string',
          description: 'One short line under the title.',
        },
        icon: {
          type: 'string',
          enum: ICONS,
          description: 'Optional leading glyph for the card.',
        },
        status: {
          type: 'string',
          enum: ['running', 'success', 'warn', 'error', 'none'],
          description: 'Card lifecycle state. Omit to auto-detect: progress bars at 100% complete the card by themselves, and a card with nothing to complete stays a plain display card. Set "success" when the work is done, "warn"/"error" for a partial or failed result, and "none" to force a plain display card (no status pill, no completion folding) even when it contains progress bars.',
        },
        look: {
          type: 'string',
          enum: LOOKS,
          description: 'Visual density of the whole card. Omit it and the card picks one from its shape: long/many-block cards compress to "compact", data-only cards drop their panel chrome to "flat", a two-block conclusion gets "relaxed"; mixed content stays "default". Set it explicitly to override: "default" | "compact" | "flat" | "relaxed".',
        },
        place: {
          type: 'string',
          enum: options.dock ? ['answer', 'process', 'dock', 'tail'] : ['answer', 'process', 'tail'],
          description: 'Where the card lives: "answer" (default) is part of the final answer; "process" is a live progress card that collapses away with the work details; "dock" is a compact collapsible board above the composer shown while the work runs and retires when the turn ends — use it for progress/status only (progress, stats, badges, live; at most 4 blocks) and emit an answer card if the result must stay; "tail" puts the card at the very end of the completed turn, after the reply and before the turn action row — the right place for a next-step card: one short question in "text" plus an "actions" block whose items are the options.',
        },
        content: {
          type: 'object',
          description: 'Auto layout: name the material and the card picks the blocks and their arrangement. Fields: ' + CONTENT_FIELDS.join(', ') + '. Shapes: call `' + BLOCKS_TOOL_NAME + '` with type "' + CONTENT_LOOKUP + '". Combine with "blocks" to append explicit blocks; unknown fields are ignored.',
          additionalProperties: true,
          properties: {
            summary: { type: ['string', 'object'], description: 'string | {text, tone?, title?} — tinted notice that opens the card.' },
            note: { type: ['string', 'object'], description: 'string | {text, tone?, title?} — warning or info notice near the end.' },
            metrics: { type: ['array', 'object'], description: '[{label, value, delta?, hint?, tone?}] | {label: value} — metric grid.' },
            series: { type: ['array', 'object'], description: '{values: number[], labels?, title?, unit?, kind?: "trend"|"compare"} — trend line, or columns for a short labeled comparison.' },
            breakdown: { type: ['array', 'object'], description: '{items: [{label, value, tone?}], title?, unit?, kind?: "pie"|"bars"} — shares of one whole.' },
            table: { type: 'object', description: '{columns: string[], rows, align?, caption?} — data table.' },
            steps: { type: 'array', description: '[{title, text?, time?, tone?}] | string[] — timeline of steps or history.' },
            items: { type: 'array', description: 'string[] — bullets.' },
            facts: { type: ['array', 'object'], description: '{key: value} | [{key, value}] — spec sheet.' },
            tags: { type: 'array', description: 'string[] | [{label, tone?}] — badges.' },
            code: { type: ['string', 'object'], description: '{code, language?, title?} — source block.' },
            quote: { type: ['string', 'object'], description: '{text, by?} — pull quote.' },
            links: { type: 'array', description: '[{label, href, description?}] — link tiles; href must be http(s) or mailto.' },
            image: { type: ['string', 'object'], description: '{src, alt?, caption?, height?, fit?} — inline image from an https URL or a data: URI.' },
            tree: { type: ['array', 'object'], description: '{nodes: [{label, note?, badge?, tone?, children?}], title?} — hierarchy tree.' },
            flow: { type: 'object', description: '{kind?, title?, direction?, nodes?, edges?, participants?, messages?} — flowchart, state, sequence or class diagram.' },
            sections: { type: 'array', description: '[{heading, ...any content field}] — 2–3 sections render side by side, 4–5 as tabs, more under their own headings.' },
            blocks: { type: 'array', description: 'Explicit blocks appended after the derived ones: the escape hatch for exact control inside a content spec.' },
            actions: { type: 'array', description: '[{label, prompt, tone?}] — next-step buttons; always laid out last.' },
          },
        },
        layout: {
          type: 'string',
          enum: ['auto', 'stack'],
          description: 'Arrangement of a "content" spec: "auto" (default) lays 2–3 sections side by side and 4–5 as tabs, while ordinary blocks stack; "stack" keeps every block on its own row. Ignored with "blocks" only.',
        },
        blocks: {
          type: 'array',
          description: 'Ordered card content: 1\\u2013' + options.maxBlocks + ' blocks. Every entry is an object with a required "type" and that type\\u2019s fields; unknown types are reported in `dropped`.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: options.types,
                description: 'Block type; call `' + BLOCKS_TOOL_NAME + '` for its exact fields.',
              },
              motion: {
                type: 'object',
                description: 'Optional animation of this one block. The model names a preset; the Client owns the CSS. Unknown effects render the block statically.',
                properties: {
                  effect: {
                    type: 'string',
                    enum: MOTION_EFFECTS,
                    description: 'pulse: items breathe · flash: one highlight ring · reveal: wipe in · sweep: progress/bar grows from zero · draw: lines stroke on · flow: diagram edges march · bounce: block lifts · shake: block shakes.',
                  },
                  duration: {
                    type: 'integer',
                    description: 'Milliseconds, ' + MOTION_LIMITS.duration[0] + '–' + MOTION_LIMITS.duration[1] + '. Default ' + MOTION_DEFAULTS.duration + '.',
                  },
                  delay: {
                    type: 'integer',
                    description: 'Milliseconds before it starts, ' + MOTION_LIMITS.delay[0] + '–' + MOTION_LIMITS.delay[1] + '. Default ' + MOTION_DEFAULTS.delay + '.',
                  },
                  loop: {
                    type: 'boolean',
                    description: 'Repeat forever. Use it for `pulse` and `flow`, not for one-shot effects. Default false.',
                  },
                },
                required: ['effect'],
                additionalProperties: false,
              },
            },
            required: ['type'],
            additionalProperties: true,
          },
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          blocks: { type: 'integer' },
          types: { type: 'array', items: { type: 'string' } },
          place: { type: 'string', enum: ['answer', 'process', 'dock', 'tail'] },
          auto: { type: 'boolean', description: 'True when at least one block was derived from "content" (auto layout).' },
          dropped: {
            type: 'array',
            description: 'Blocks the card did not render, with the reason: unknown type, unusable content, over a cap, disabled by config, or not allowed in a dock board.',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                type: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['index', 'type', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['ok', 'blocks', 'types', 'place'],
        additionalProperties: false,
      },
      /**
       * Model-facing confirmation. Deliberately short: the card is the
       * user-facing answer and the model must not restate it.
       * @param {unknown} _args recorded call arguments.
       * @param {unknown} value execute result.
       * @returns {Array<{type: 'text', text: string}>} one text content block.
       */
      render(_args, value) {
        try {
          const count = isPlainObject(value) && typeof value.blocks === 'number' ? value.blocks : 0
          const droppedCount = isPlainObject(value) && Array.isArray(value.dropped) ? value.dropped.length : 0
          const drops = droppedCount > 0
            ? ' ' + droppedCount + (droppedCount === 1 ? ' block' : ' blocks') + ' dropped - see "dropped".'
            : ''
          return [{ type: 'text', text: 'Rendered UI card (' + count + ' blocks).' + drops + ' Do not repeat its content in Markdown.' }]
        } catch {
          return [{ type: 'text', text: 'Rendered UI card. Do not repeat its content in Markdown.' }]
        }
      },
    },
    /**
     * Presentation hint for tool-call rows that do not use the card view.
     * @returns {{card: 'generic', title: string, kind: 'other'}} generic card hint.
     */
    presentCall() {
      return { card: 'generic', title: 'Super Cards', kind: 'other' }
    },
    async execute(args) {
      return executeRenderUi(args, options)
    },
  }
}

/**
 * Build the on-demand block contract lookup tool.
 *
 * This is the progressive-disclosure half of the tool pair: the renderer's
 * description stays compact, and a call to this tool returns the exact shape,
 * field notes, and example for one block type (or every type).
 *
 * @param {{ types: string[] }} options resolved options.
 * @returns {object} ToolDefinition registered with `ctx.tools.register`.
 */
export function createBlocksTool(options) {
  const types = options.types
  // `motion` is not a block type; it is the keyword that returns the animation
  // vocabulary, so it joins the enum without joining the directory.
  const lookupTypes = types.concat([MOTION_LOOKUP, CONTENT_LOOKUP])
  return {
    name: BLOCKS_TOOL_NAME,
    description: 'Return the exact field contract of `' + TOOL_NAME + '`: pass one block type or an array of types, or omit "type" for every block type. Pass "' + MOTION_LOOKUP + '" for the optional motion vocabulary, or "' + CONTENT_LOOKUP + '" for the auto-layout content fields. Call it before authoring a block or a content spec whose fields are not obvious.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          description: 'One block type, "' + MOTION_LOOKUP + '", or "' + CONTENT_LOOKUP + '", or an array of them; omit for all block types.',
          oneOf: [
            { type: 'string', enum: lookupTypes },
            { type: 'array', items: { type: 'string', enum: lookupTypes } },
          ],
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          types: { type: 'array', items: { type: 'string' } },
          text: { type: 'string' },
        },
        required: ['ok', 'types', 'text'],
        additionalProperties: false,
      },
      /**
       * The contract text is the payload the model reads.
       * @param {unknown} _args recorded call arguments.
       * @param {unknown} value execute result.
       * @returns {Array<{type: 'text', text: string}>} one text content block.
       */
      render(_args, value) {
        const text = isPlainObject(value) && typeof value.text === 'string' && value.text !== ''
          ? value.text
          : 'No block contract available.'
        return [{ type: 'text', text }]
      },
    },
    presentCall() {
      return { card: 'generic', title: 'Block contract', kind: 'other' }
    },
    async execute(args) {
      const input = isPlainObject(args) ? args : {}
      const requested = []
      if (typeof input.type === 'string' && input.type !== '') {
        requested.push(input.type)
      } else if (Array.isArray(input.type)) {
        for (const item of input.type) {
          if (typeof item === 'string' && item !== '') requested.push(item)
        }
      }
      if (requested.length === 0) {
        return { ok: true, types: types, text: blockContractCatalog(types) }
      }
      const unknown = requested.filter((type) => type !== MOTION_LOOKUP && type !== CONTENT_LOOKUP && !types.includes(type))
      if (unknown.length > 0) {
        throw new Error(BLOCKS_TOOL_NAME + ': unknown block type' + (unknown.length > 1 ? 's ' : ' ') + unknown.join(', ') + '. Available types: ' + types.join(', ') + ', ' + MOTION_LOOKUP + ', ' + CONTENT_LOOKUP + '.')
      }
      // Blocks in documentation order regardless of request order; the motion
      // vocabulary is appended after them when it was asked for.
      const selected = types.filter((type) => requested.includes(type))
      const parts = []
      if (selected.length > 0) parts.push(blockContractCatalog(selected))
      if (requested.includes(MOTION_LOOKUP)) parts.push(motionContractText())
      if (requested.includes(CONTENT_LOOKUP)) parts.push(contentContractText())
      return {
        ok: true,
        types: selected.concat([MOTION_LOOKUP, CONTENT_LOOKUP].filter((key) => requested.includes(key))),
        text: parts.join('\n\n'),
      }
    },
  }
}

/** Prompt section key and ordering for the Host registration. */
export { PROMPT_SECTION_ORDER, TOOL_NAME, BLOCKS_TOOL_NAME }
