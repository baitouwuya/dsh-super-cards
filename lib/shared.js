/**
 * Shared vocabulary, limits, and value coercion for the Super Cards Host half.
 *
 * These are the primitives every other module uses: the tone/icon/status
 * vocabularies, the contract caps, and the small coercion helpers that keep
 * normalization defensive. This module has no imports and no side effects.
 */

export const TONES = ['neutral', 'brand', 'info', 'success', 'warn', 'error']

/** Card-level leading glyphs. */
export const ICONS = ['sparkle', 'chart', 'check', 'info', 'warning', 'table', 'code', 'list']

/** Wire tool name of the card renderer; the client toolview key is this exact string. */
export const TOOL_NAME = 'render_ui'

/** Wire tool name of the on-demand block contract lookup. */
export const BLOCKS_TOOL_NAME = 'render_ui_blocks'

/** Card-level lifecycle status; omitted means "derive from progress"; `none` is a plain display card. */
export const STATUSES = ['running', 'success', 'warn', 'error', 'none']

/** Optional card look: the same content, three levels of visual density. */
export const LOOKS = ['default', 'compact', 'flat', 'relaxed']

/** Action button emphasis. */
export const ACTION_TONES = ['primary', 'default']

/** Table column alignment. */
export const ALIGNMENTS = ['left', 'center', 'right']

/** Host-side limits from the build contract. Larger input is truncated. */
export const CAPS = Object.freeze({
  blocks: 24,
  tableRows: 50,
  sparklineValues: 120,
  codeChars: 8000,
  textChars: 4000,
  actions: 8,
  dockBlocks: 4,
  htmlChars: 20000,
  pieSlices: 8,
  treeNodes: 200,
  treeDepth: 4,
  heatmapCells: 371,
  diffLines: 400,
  kanbanColumns: 4,
  kanbanCards: 8,
  tabs: 5,
  tabBlocks: 6,
  columns: 3,
  columnBlocks: 6,
  imageChars: 200000,
})

/** Prompt section placement: after the persona, before volatile runtime context. */
export const PROMPT_SECTION_ORDER = 60

/**
 * Optional per-block motion presets.
 *
 * The model never writes CSS: it names one of these effects and the Client maps
 * it to an animation the stylesheet already declares, so a card stays
 * deterministic on replay, themeable through tokens, and silently static when
 * the reader asked for reduced motion.
 */
export const MOTION_EFFECTS = ['pulse', 'flash', 'reveal', 'sweep', 'draw', 'flow', 'bounce', 'shake']

/** One line per effect: what it animates (contract text, docs, and tests). */
export const MOTION_MEANING = Object.freeze({
  pulse: 'the block’s items breathe in place (stat cards, badges, list rows, progress rows)',
  flash: 'the block flashes one highlight ring, for a result that just changed',
  reveal: 'the block wipes in from the left edge',
  sweep: 'progress fills and bar charts grow from zero to their value',
  draw: 'chart and diagram lines stroke themselves on',
  flow: 'diagram edges march along as a dashed flow (use loop: true)',
  bounce: 'the whole block lifts and settles once',
  shake: 'the whole block shakes twice, for a warning',
})

/** Motion defaults: what a block animates like when only `effect` is given. */
export const MOTION_DEFAULTS = Object.freeze({ duration: 1000, delay: 0, loop: false })

/** Motion clamps in milliseconds: [min, max]. */
export const MOTION_LIMITS = Object.freeze({ duration: [200, 6000], delay: [0, 4000] })


/**
 * Whether a value is a plain JSON object (not null, not an array).
 * @param {unknown} value candidate value.
 * @returns {boolean} true for plain objects.
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Human-readable type label used in actionable error messages.
 * @param {unknown} value offending value.
 * @returns {string} short description such as "a string".
 */
export function describeValue(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  const type = typeof value
  if (type === 'undefined') return 'undefined'
  if (type === 'object') return 'an object'
  return 'a ' + type
}

/**
 * Coerce one value to a bounded text field.
 * @param {unknown} value candidate string or number.
 * @param {number} [max] character cap.
 * @returns {string} trimmed text, or '' when unusable.
 */
export function toText(value, max) {
  const limit = typeof max === 'number' ? max : CAPS.textChars
  if (typeof value === 'string') return value.slice(0, limit)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return ''
}

/**
 * Coerce one optional text field, dropping blank values.
 * @param {unknown} value candidate value.
 * @param {number} [max] character cap.
 * @returns {string|undefined} bounded text or undefined.
 */
export function toOptionalText(value, max) {
  const text = toText(value, max)
  return text === '' ? undefined : text
}

/**
 * Coerce one numeric field, accepting finite numbers and numeric strings.
 * @param {unknown} value candidate value.
 * @returns {number|undefined} finite number or undefined.
 */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * Coerce one tone field.
 * @param {unknown} value candidate tone.
 * @returns {string|undefined} a known tone or undefined.
 */
export function toTone(value) {
  return typeof value === 'string' && TONES.includes(value) ? value : undefined
}

/**
 * Normalize one array field, ignoring non-arrays.
 * @param {unknown} value candidate array.
 * @returns {unknown[]} the array or an empty array.
 */
export function toArray(value) {
  return Array.isArray(value) ? value : []
}

/**
 * Copy `value` onto `target[key]` only when it is defined.
 * @param {Record<string, unknown>} target destination object.
 * @param {string} key property name.
 * @param {unknown} value candidate value.
 * @returns {void}
 */
export function put(target, key, value) {
  if (value !== undefined) target[key] = value
}

/**
 * Coerce one motion time field into its clamp range.
 * @param {unknown} value candidate number or numeric string.
 * @param {[number, number]} range min and max in milliseconds.
 * @param {number} fallback value used when absent or unusable.
 * @returns {number} clamped whole milliseconds.
 */
function toMotionTime(value, range, fallback) {
  const number = toNumber(value)
  if (number === undefined) return fallback
  return Math.max(range[0], Math.min(range[1], Math.round(number)))
}

/**
 * Normalize the optional `motion` object of one block.
 *
 * Motion is decorative: an unusable value renders the block statically instead
 * of dropping it, so a typo in an animation never costs the content.
 *
 * @param {unknown} value raw `motion` value from the model.
 * @returns {{ effect: string, duration: number, delay: number, loop: boolean }|undefined}
 *   normalized motion, or undefined when absent/unusable.
 */
export function normalizeMotion(value) {
  if (!isPlainObject(value)) return undefined
  if (typeof value.effect !== 'string' || !MOTION_EFFECTS.includes(value.effect)) return undefined
  return {
    effect: value.effect,
    duration: toMotionTime(value.duration, MOTION_LIMITS.duration, MOTION_DEFAULTS.duration),
    delay: toMotionTime(value.delay, MOTION_LIMITS.delay, MOTION_DEFAULTS.delay),
    loop: value.loop === true,
  }
}

