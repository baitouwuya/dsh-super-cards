/**
 * Spec normalization and the compact call result for the Super Cards Host half.
 *
 * A call is normalized against the registry, the caps, and the row config; every
 * block the card will not render is reported (with a reason) instead of being
 * dropped silently, so the model can correct itself in one retry.
 *
 * This module imports `./shared.js` and `./blocks.js`; it has no side effects.
 */

import {
  CAPS,
  ICONS,
  LOOKS,
  STATUSES,
  TOOL_NAME,
  describeValue,
  isPlainObject,
  put,
  toOptionalText,
} from './shared.js'
import {
  BLOCK_REGISTRY,
  BLOCK_TYPES,
  DOCK_BLOCKS,
  normalizeBlock,
  resolveBlockType,
} from './blocks.js'
import { CONTENT_FIELDS, LAYOUTS, deriveContent } from './content.js'

/**
 * Read the requested placement from recorded call arguments.
 *
 * Unknown values fall back to the configured default placement; `dock` collapses
 * to `answer` when dock boards are disabled for this row.
 *
 * @param {unknown} args model-supplied arguments (object or JSON string).
 * @param {{ defaultPlace?: string, dock?: boolean }} [options] row config.
 * @returns {'answer' | 'process' | 'dock' | 'tail'} placement.
 */
export function readPlace(args, options) {
  const settings = isPlainObject(options) ? options : {}
  const dockEnabled = settings.dock !== false
  const fallback = settings.defaultPlace === 'process' || settings.defaultPlace === 'dock' || settings.defaultPlace === 'tail'
    ? settings.defaultPlace
    : 'answer'
  let value = args
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return fallback === 'dock' && !dockEnabled ? 'answer' : fallback
    }
  }
  if (!value || typeof value !== 'object') return fallback === 'dock' && !dockEnabled ? 'answer' : fallback
  if (value.place === 'process') return 'process'
  if (value.place === 'tail') return 'tail'
  if (value.place === 'dock') return dockEnabled ? 'dock' : 'answer'
  return fallback === 'dock' && !dockEnabled ? 'answer' : fallback
}

/**
 * Validate and normalize a model-supplied UI spec against the registry, caps,
 * and row config.
 *
 * A spec may carry explicit `blocks`, a `content` object that is derived into
 * blocks (auto layout), or both — derived blocks first, explicit blocks after.
 *
 * @param {unknown} input parsed arguments (or their JSON text).
 * @param {{ place?: string, dropped?: object[], types?: string[], maxBlocks?: number }} [options]
 *   normalization settings; `dropped` is an out-array that collects every block
 *   the card will not render, with `{ index, type, reason }`.
 * @returns {{ blocks: Record<string, unknown>[], title?: string, subtitle?: string, icon?: string, status?: string, look?: string }} normalized spec.
 * @throws {Error} with a `render_ui: ` prefix for invalid input.
 */
export function normalizeSpec(input, options) {
  const settings = isPlainObject(options) ? options : {}
  const place = settings.place === 'dock' || settings.place === 'tail'
    ? settings.place
    : settings.place === 'process' ? 'process' : 'answer'
  const dropped = Array.isArray(settings.dropped) ? settings.dropped : null
  const types = Array.isArray(settings.types) && settings.types.length > 0 ? settings.types : BLOCK_TYPES
  const allowed = new Set(types)
  const maxBlocks = typeof settings.maxBlocks === 'number' && settings.maxBlocks > 0
    ? Math.min(CAPS.blocks, Math.floor(settings.maxBlocks))
    : CAPS.blocks
  const recordDrop = (index, type, reason) => {
    if (dropped !== null) dropped.push({ index, type, reason })
  }
  let args = input
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      throw new Error(TOOL_NAME + ': arguments must be a JSON object with a "blocks" array, not a non-JSON string. Send {"blocks":[{"type":"text","text":"..."}]}.')
    }
  }
  if (!isPlainObject(args)) {
    throw new Error(TOOL_NAME + ': arguments must be a JSON object with a "blocks" array; got ' + describeValue(args) + '.')
  }
  const rawBlocks = []
  if (isPlainObject(args.content)) {
    const layout = LAYOUTS.includes(args.layout) ? args.layout : 'auto'
    for (const block of deriveContent(args.content, { types, layout })) rawBlocks.push(block)
  }
  const derivedCount = rawBlocks.length
  if (Array.isArray(args.blocks)) {
    for (const block of args.blocks) rawBlocks.push(block)
  }
  if (rawBlocks.length === 0) {
    if (isPlainObject(args.content)) {
      throw new Error(TOOL_NAME + ': "content" has no usable fields. Name the material with one of: ' + CONTENT_FIELDS.join(', ') + '. Or pass an explicit "blocks" array.')
    }
    throw new Error(TOOL_NAME + ': pass a non-empty "blocks" array (1\u2013' + maxBlocks + ' explicit blocks) or a "content" object that names the material and lets the card pick the controls. Block types: ' + types.join(', ') + '.')
  }
  const blocks = []
  let derived = 0
  for (let index = 0; index < rawBlocks.length; index += 1) {
    const raw = rawBlocks[index]
    if (!isPlainObject(raw)) {
      throw new Error(TOOL_NAME + ': blocks[' + index + '] must be an object with a string "type"; got ' + describeValue(raw) + '. Example: {"type":"text","text":"..."}.')
    }
    if (typeof raw.type !== 'string' || raw.type === '') {
      throw new Error(TOOL_NAME + ': blocks[' + index + '].type must be a non-empty string; got ' + describeValue(raw.type) + '. Use one of: ' + types.join(', ') + '.')
    }
    // A content field name is a common slip for a block type (`{"type":"note"}`);
    // it folds onto the block that renders the same material instead of failing.
    const canonical = resolveBlockType(raw.type)
    const entry = canonical === undefined ? undefined : BLOCK_REGISTRY.get(canonical)
    if (entry === undefined || !allowed.has(canonical)) {
      // Forward compatible and config aware: reported, never fatal.
      recordDrop(index, raw.type, entry === undefined ? 'unknown block type' : 'block type not enabled by config')
      continue
    }
    if (place === 'dock' && entry.dock !== true) {
      recordDrop(index, raw.type, 'not allowed in a dock board')
      continue
    }
    if (blocks.length >= maxBlocks) {
      recordDrop(index, raw.type, 'over the block cap')
      continue
    }
    const normalized = normalizeBlock(raw.type, raw)
    if (normalized === undefined) {
      recordDrop(index, raw.type, 'no usable content')
      continue
    }
    blocks.push(normalized)
    if (index < derivedCount) derived += 1
  }
  if (blocks.length === 0) {
    const dockOnly = dropped !== null && dropped.length > 0 &&
      dropped.every((item) => item.reason === 'not allowed in a dock board')
    if (place === 'dock' && dockOnly) {
      throw new Error(
        TOOL_NAME + ': place "dock" accepts only ' + DOCK_BLOCKS.join(', ') + ' blocks (at most ' + CAPS.dockBlocks + '); none of the submitted blocks qualifies. Use place "answer" for a full card.',
      )
    }
    throw new Error(TOOL_NAME + ': no renderable blocks after normalization; every block was unknown, disabled by config, over the cap, or had no usable content. Use supported block types: ' + types.join(', ') + '.')
  }
  const spec = { blocks: blocks }
  if (derived > 0) spec.auto = true
  put(spec, 'title', toOptionalText(args.title))
  put(spec, 'subtitle', toOptionalText(args.subtitle))
  if (typeof args.icon === 'string' && ICONS.includes(args.icon)) spec.icon = args.icon
  if (typeof args.status === 'string' && STATUSES.includes(args.status)) spec.status = args.status
  if (typeof args.look === 'string' && LOOKS.includes(args.look)) spec.look = args.look
  return spec
}

/**
 * Run `render_ui` validation/normalization and report a compact success value.
 *
 * @param {unknown} args model-supplied arguments.
 * @param {{ types?: string[], maxBlocks?: number, defaultPlace?: string, dock?: boolean }} [options] row config.
 * @returns {{ ok: true, blocks: number, types: string[], place: string, dropped?: object[] }} compact result.
 * @throws {Error} actionable `render_ui: ` error on invalid input.
 */
export function executeRenderUi(args, options) {
  try {
    const settings = isPlainObject(options) ? options : {}
    const dropped = []
    const place = readPlace(args, settings)
    const spec = normalizeSpec(args, {
      place,
      dropped,
      types: settings.types,
      maxBlocks: settings.maxBlocks,
    })
    const result = {
      ok: true,
      blocks: spec.blocks.length,
      types: spec.blocks.map((block) => block.type),
      place,
    }
    if (spec.auto === true) result.auto = true
    if (dropped.length > 0) result.dropped = dropped
    return result
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(TOOL_NAME + ': ')) throw error
    const reason = error instanceof Error && error.message ? error.message : String(error)
    throw new Error(
      TOOL_NAME +
        ': could not read the call arguments (' +
        reason +
        '). Expected a JSON object with a "blocks" array or a "content" object; e.g. {"content":{"summary":"All green","metrics":[{"label":"Pods","value":"12/12"}]}}.',
    )
  }
}
