/**
 * Host half of the Super Cards bundle.
 *
 * Registers two global tools, one short system-prompt section, and — when the
 * row config enables it — the automatic next-step generator:
 *
 * - `render_ui` renders a structured answer as a native UI card. Its
 *   description carries a compact block directory plus one canonical example;
 *   exact block shapes are deferred (progressive disclosure) to
 * - `render_ui_blocks`, which returns the exact shape, field notes, and example
 *   of one block type, or of every type.
 * - The `super-cards/next-steps` generator asks the conversation model for two
 *   to four next-step options after a turn ends and appends one session event
 *   that the Client renders as a turn-tail card (see `lib/next-steps.js`).
 *
 * The row config is read from the patch (`config: {...}`): `blocks` narrows the
 * enabled types, `maxBlocks` the card cap, `dock` toggles dock boards,
 * `defaultPlace` picks the placement when the model omits it, and the
 * `nextSteps*` keys enable the automatic turn-tail next-step generator.
 *
 * The Web client renders the card from the recorded call arguments through the
 * `tool.call.toolview` slot keyed by the same wire tool name; the Host half
 * renders nothing. Every registration lives in a `ctx.effect` and is disposed
 * with the plugin. This entry has no side effects beyond `apply`.
 */

import {
  ACTION_TONES,
  BLOCKS_TOOL_NAME,
  CAPS,
  ICONS,
  MOTION_DEFAULTS,
  MOTION_EFFECTS,
  MOTION_LIMITS,
  MOTION_MEANING,
  PROMPT_SECTION_ORDER,
  STATUSES,
  TOOL_NAME,
  TONES,
  normalizeMotion,
} from './lib/shared.js'
import {
  BLOCKS,
  BLOCK_ALIASES,
  BLOCK_TYPES,
  DOCK_BLOCKS,
  MOTION_LOOKUP,
  blockContractCatalog,
  blockContractText,
  blockDirectoryLines,
  motionContractText,
  normalizeBlock,
  resolveBlockType,
  resolveMaxBlocks,
  resolveTypes,
} from './lib/blocks.js'
import { executeRenderUi, normalizeSpec, readPlace } from './lib/spec.js'
import { CONTENT_FIELDS, CONTENT_LOOKUP, LAYOUTS, contentContractText, deriveContent } from './lib/content.js'
import {
  createBlocksTool,
  createRenderUiTool,
  promptText,
  resolveConfig,
  toolDescription,
} from './lib/tools.js'
import { Config, PLACEMENTS } from './lib/config.js'
import { SERVICE_NAME, createHostService } from './lib/service.js'
import {
  NEXT_STEPS_CAPS,
  NEXT_STEPS_DEFAULTS,
  NEXT_STEPS_EVENT,
  NEXT_STEPS_LIMITS,
  NEXT_STEPS_SOURCE,
  collectTurnText,
  hasNextStepsEvent,
  hasTailCard,
  install as installNextSteps,
  nextStepsEventData,
  nextStepsPrompt,
  nextStepsSkipReason,
  parseNextSteps,
  resolveNextStepsConfig,
  resolveNextStepsRoute,
} from './lib/next-steps.js'

export { Config }

/** Services this Host half needs. */
export const inject = ['tools', 'systemPrompt']

/**
 * Register the tool pair, the prompt section, and the optional next steps.
 *
 * Every registration is an effect, so disabling the row removes the tools and
 * the prompt text together with the plugin.
 *
 * @param {object} ctx Cordis context with `tools`, `systemPrompt`, and `effect`.
 * @param {object} [config] patch row config (plain object; optional).
 * @returns {void}
 */
export function apply(ctx, config) {
  const options = resolveConfig(config)
  ctx.effect(() => ctx.tools.register(createRenderUiTool(options)), 'super-cards: render_ui tool')
  ctx.effect(() => ctx.tools.register(createBlocksTool(options)), 'super-cards: render_ui_blocks tool')
  ctx.effect(() => provideService(ctx), 'super-cards: superCards service')
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'super-cards',
        order: PROMPT_SECTION_ORDER,
        text: promptText(options),
      }),
    'super-cards: prompt section',
  )
  // Automatic next steps are opt-in: install() subscribes to `session/event`
  // only when the row config enables it and returns a no-op disposer otherwise.
  ctx.effect(() => installNextSteps(ctx, config), 'super-cards: next steps')
}

/**
 * Provide the read-only Host service for the plugin lifetime.
 *
 * The service is optional: a Host build without `ctx.provide` keeps the tools
 * working, so a failure here must never take the plugin down.
 *
 * @param {object} ctx Cordis context.
 * @returns {() => void} disposer.
 */
function provideService(ctx) {
  try {
    const dispose = ctx.provide(SERVICE_NAME, createHostService())
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  } catch {
    return () => {}
  }
}

/** Default options, resolved once for the exported test surface. */
const DEFAULTS = resolveConfig()

/**
 * Pure helpers and default artifacts exported only so `node --test` can
 * exercise normalization, caps, and the generated texts without the Host
 * runtime. Not part of the plugin surface.
 */
export const __test = Object.freeze({
  TOOL_NAME,
  BLOCKS_TOOL_NAME,
  BLOCK_TYPES,
  BLOCK_ALIASES,
  DOCK_BLOCKS,
  TONES,
  ICONS,
  STATUSES,
  ACTION_TONES,
  CAPS,
  PROMPT_SECTION_ORDER,
  TOOL_DESCRIPTION: toolDescription(DEFAULTS),
  PROMPT_SECTION_TEXT: promptText(DEFAULTS),
  BLOCKS,
  blockDirectoryLines,
  blockContractText,
  blockContractCatalog,
  MOTION_LOOKUP,
  MOTION_EFFECTS,
  MOTION_DEFAULTS,
  MOTION_LIMITS,
  MOTION_MEANING,
  motionContractText,
  normalizeMotion,
  normalizeBlock,
  normalizeSpec,
  readPlace,
  deriveContent,
  contentContractText,
  CONTENT_FIELDS,
  CONTENT_LOOKUP,
  LAYOUTS,
  Config,
  PLACEMENTS,
  SERVICE_NAME,
  createHostService,
  executeRenderUi,
  resolveConfig,
  resolveTypes,
  resolveMaxBlocks,
  toolDescription,
  promptText,
  createRenderUiTool,
  createBlocksTool,
  NEXT_STEPS_EVENT,
  NEXT_STEPS_SOURCE,
  NEXT_STEPS_LIMITS,
  NEXT_STEPS_DEFAULTS,
  NEXT_STEPS_CAPS,
  resolveNextStepsConfig,
  resolveNextStepsRoute,
  nextStepsSkipReason,
  nextStepsPrompt,
  nextStepsEventData,
  parseNextSteps,
  collectTurnText,
  hasTailCard,
  hasNextStepsEvent,
  installNextSteps,
})
