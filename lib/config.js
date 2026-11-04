/**
 * Row config: a Schemastery schema whose editable fields are volatile.
 *
 * Two consumers read this module, and they need different things from it:
 *
 * - The DSH settings projection treats `Config` as a Schemastery schema. Every
 *   field is `.volatile()` and carries a `.description()`, so the Web UI can
 *   render a form and write only those paths. Without volatile fields the whole
 *   entry is skipped as "unsupported".
 * - The Cordis fiber validates the raw row config through
 *   `Config['~standard'].validate()` and hands the result to
 *   `apply(ctx, config)`. Every Host module reads that snapshot
 *   (`maxBlocks`, `defaultPlace`, `nextSteps`, ...), so the face below projects
 *   volatile references back to plain JSON values. Otherwise each value would
 *   arrive as a `Volatile` box and `resolveConfig()` would silently fall back to
 *   the defaults.
 *
 * The face also rejects undeclared keys, so a typo in a patch fails loudly
 * instead of being ignored, and reports vendor "super-cards" instead of
 * "schemastery". The DSH loader reads that vendor to decide how a config edit is
 * applied: a genuine Schemastery schema with volatile fields is committed
 * in place, while any other Standard Schema takes the ordinary update path. This
 * plugin builds its tools from the config inside `apply()`, so an ordinary
 * update (a remount) is exactly how a settings edit must take effect.
 *
 * `apply(ctx, config)` still resolves defaults and clamps values defensively,
 * because it is also called for rows patched without validation.
 */

import z from '@deepseek-ai/schemastery'
import { CAPS, isPlainObject } from './shared.js'
import { BLOCK_TYPES } from './blocks.js'
import { NEXT_STEPS_DEFAULTS, NEXT_STEPS_LIMITS } from './next-steps.js'

/** Placements the Host accepts; mirrors the client placement registry. */
export const PLACEMENTS = ['answer', 'process', 'dock', 'tail']

/**
 * The row config schema.
 *
 * Names are the ones `lib/tools.js` and `lib/next-steps.js` read; defaults
 * mirror what those modules apply defensively. `blocks` intentionally has no
 * default: absent means "every block type is enabled".
 */
export const Config = z.object({
  blocks: z
    .array(z.union(BLOCK_TYPES))
    .description('Block types the card renderer may use. Leave empty to allow every type.')
    .volatile(),
  maxBlocks: z
    .number()
    .min(1)
    .max(CAPS.blocks)
    .step(1)
    .default(CAPS.blocks)
    .description('Maximum number of blocks rendered in one card (1–' + CAPS.blocks + ').')
    .volatile(),
  dock: z
    .boolean()
    .default(true)
    .description('Allow dock boards: the compact board pinned above the composer while a turn runs.')
    .volatile(),
  defaultPlace: z
    .union(PLACEMENTS)
    .default('answer')
    .description('Placement used when the model omits `place` in a card request.')
    .volatile(),
  nextSteps: z
    .boolean()
    .default(NEXT_STEPS_DEFAULTS.enabled)
    .description('Automatically generate a next-step card (a short summary, a question, and action options) at the end of each turn.')
    .volatile(),
  nextStepsMax: z
    .number()
    .min(NEXT_STEPS_LIMITS.max[0])
    .max(NEXT_STEPS_LIMITS.max[1])
    .step(1)
    .default(NEXT_STEPS_DEFAULTS.max)
    .description('Maximum next-step options on the generated card (' + NEXT_STEPS_LIMITS.max[0] + '–' + NEXT_STEPS_LIMITS.max[1] + ').')
    .volatile(),
  nextStepsTimeoutMs: z
    .number()
    .min(NEXT_STEPS_LIMITS.timeoutMs[0])
    .max(NEXT_STEPS_LIMITS.timeoutMs[1])
    .step(1)
    .default(NEXT_STEPS_DEFAULTS.timeoutMs)
    .description('Timeout for the next-step model call in milliseconds (' + NEXT_STEPS_LIMITS.timeoutMs[0] + '–' + NEXT_STEPS_LIMITS.timeoutMs[1] + ').')
    .volatile(),
  nextStepsMinChars: z
    .number()
    .min(NEXT_STEPS_LIMITS.minChars[0])
    .max(NEXT_STEPS_LIMITS.minChars[1])
    .step(1)
    .default(NEXT_STEPS_DEFAULTS.minChars)
    .description('Skip the next-step card when the assistant reply is shorter than this many characters (' + NEXT_STEPS_LIMITS.minChars[0] + '–' + NEXT_STEPS_LIMITS.minChars[1] + ').')
    .volatile(),
  nextStepsProvider: z
    .string()
    .description('Optional LLM provider for next-step generation. Pair it with nextStepsModel; leave both empty to reuse the session route.')
    .volatile(),
  nextStepsModel: z
    .string()
    .description('Optional LLM model for next-step generation. Pair it with nextStepsProvider; leave both empty to reuse the session route.')
    .volatile(),
})

/** Cosmokit's cross-copy volatile reference marker. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Whether a parsed value is a volatile config reference.
 * @param {unknown} value candidate value.
 * @returns {boolean} true for a cosmokit volatile reference.
 */
function isVolatileRef(value) {
  return typeof value === 'object' && value !== null && typeof value.get === 'function' && VOLATILE_WRITE in value
}

/**
 * Project a parsed config onto plain JSON values, unwrapping volatile refs.
 * @param {unknown} value parsed config value.
 * @returns {unknown} plain value with the same shape.
 */
function toPlain(value) {
  if (isVolatileRef(value)) return toPlain(value.get())
  if (Array.isArray(value)) return value.map(toPlain)
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]))
  }
  return value
}

/**
 * Build one issue per config key the schema does not declare.
 * @param {unknown} input raw config.
 * @returns {Array<{ message: string, path: string[] }>} unknown-key issues.
 */
function unknownKeyIssues(input) {
  if (!isPlainObject(input)) return []
  return Object.keys(input)
    .filter((key) => !Object.hasOwn(Config.dict, key))
    .map((key) => ({ message: 'unknown config key "' + key + '"', path: [key] }))
}

/**
 * Validate one raw row config into the plain object `apply()` receives.
 *
 * @param {unknown} input raw config (undefined when the row has none).
 * @returns {{ value: unknown } | { issues: object[] }} plain config or issues.
 */
function validate(input) {
  const unknown = unknownKeyIssues(input)
  if (unknown.length > 0) return { issues: unknown }
  try {
    const [value] = z.resolve(input, Config, {}, true)
    return { value: toPlain(value) }
  } catch (error) {
    if (z.ValidationError.is(error)) {
      const path = Array.isArray(error.options?.path) ? error.options.path : undefined
      return { issues: [path === undefined ? { message: error.message } : { message: error.message, path }] }
    }
    throw error
  }
}

// The plain Standard Schema face consumed by the Cordis fiber. Vendor is
// deliberately not "schemastery": the loader then treats a config edit as an
// ordinary value change and remounts the row, which is how this plugin picks up
// a new tool set (its options are read once in `apply()`).
Object.defineProperty(Config, '~standard', {
  value: Object.freeze({
    version: 1,
    vendor: 'super-cards',
    validate,
  }),
})