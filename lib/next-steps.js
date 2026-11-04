/**
 * Host-side automatic next-step suggestions.
 *
 * After an agent turn ends, the Host asks the conversation model for two to
 * four concrete options the user could pick next and appends one
 * `super-cards/next-steps` session event. The Client half renders that event as
 * a turn-tail card, so the model no longer has to call `render_ui` with
 * `place: "tail"` to end a turn with a next-step card.
 *
 * The generator is opt-in: only an explicit `nextSteps: true` row config turns
 * it on, so a bare row never spends an auxiliary model call or appends a card
 * the user did not ask for.
 *
 * The work is split so almost everything is pure and unit-testable:
 *
 * - `resolveNextStepsConfig` normalizes the row config.
 * - `collectTurnText`, `hasTailCard`, and `hasNextStepsEvent` read one turn out
 *   of a session event log.
 * - `nextStepsSkipReason` decides whether a turn is worth a request.
 * - `nextStepsPrompt` builds the auxiliary request.
 * - `parseNextSteps` turns model output into the event payload, defensively.
 * - `install` is the only function that touches `ctx`/`session`: it subscribes
 *   to `session/event`, owns one in-flight request per session, and appends the
 *   result without ever throwing into the session log.
 *
 * This module imports `./shared.js` only and has no side effects at import
 * time.
 */

import { TOOL_NAME, isPlainObject } from './shared.js'

/** Session event type the Client renders as the turn-tail next-step card. */
export const NEXT_STEPS_EVENT = 'super-cards/next-steps'

/** Message source kind stamped on the auxiliary LLM request. */
export const NEXT_STEPS_SOURCE = 'super-cards-next-steps'

/** Accepted ranges ([min, max]) for the numeric row config knobs. */
export const NEXT_STEPS_LIMITS = Object.freeze({
  max: Object.freeze([1, 4]),
  timeoutMs: Object.freeze([1000, 60000]),
  minChars: Object.freeze([0, 2000]),
})

/** Defaults applied when the row config omits a knob. */
export const NEXT_STEPS_DEFAULTS = Object.freeze({
  enabled: false,
  max: 3,
  timeoutMs: 15000,
  minChars: 200,
})

/** Output caps: one compact card, one bounded auxiliary request. */
export const NEXT_STEPS_CAPS = Object.freeze({
  options: 4,
  labelChars: 40,
  promptChars: 400,
  textChars: 160,
  summaryChars: 240,
  inputChars: 6000,
  maxTokens: 800,
})

/**
 * Clamp one integer config value into its accepted range.
 * @param {unknown} value candidate number.
 * @param {[number, number]} range min and max, inclusive.
 * @param {number} fallback value used when the candidate is not a finite number.
 * @returns {number} rounded, clamped integer.
 */
function clampInteger(value, range, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(range[0], Math.min(range[1], Math.round(number)))
}

/**
 * Whether a value is a non-empty string.
 * @param {unknown} value candidate value.
 * @returns {boolean} true for a non-empty string.
 */
function isText(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * Collapse one model-facing text field onto a single bounded line.
 * @param {unknown} value candidate value.
 * @param {number} max character cap.
 * @returns {string} trimmed text, or '' when unusable.
 */
function clampText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/**
 * Resolve the row config into next-step generator options.
 *
 * The resolver is defensive because the loader also calls `apply()` for rows
 * patched without validation: junk falls back to the defaults and every number
 * is clamped. Next steps are opt-in, so `enabled` is true only for an explicit
 * boolean `nextSteps: true`. A provider/model override is honored only as a
 * complete pair; otherwise the route comes from the session's request header.
 *
 * @param {unknown} config raw patch row config.
 * @returns {{ enabled: boolean, max: number, timeoutMs: number, minChars: number, provider: string|undefined, model: string|undefined }} resolved options.
 */
export function resolveNextStepsConfig(config) {
  const input = isPlainObject(config) ? config : {}
  const provider = isText(input.nextStepsProvider) ? input.nextStepsProvider : undefined
  const model = isText(input.nextStepsModel) ? input.nextStepsModel : undefined
  const paired = provider !== undefined && model !== undefined
  return {
    // Opt-in only: an absent or non-boolean value stays off, and only an
    // explicit `nextSteps: true` turns the generator on.
    enabled: input.nextSteps === true,
    max: clampInteger(input.nextStepsMax, NEXT_STEPS_LIMITS.max, NEXT_STEPS_DEFAULTS.max),
    timeoutMs: clampInteger(input.nextStepsTimeoutMs, NEXT_STEPS_LIMITS.timeoutMs, NEXT_STEPS_DEFAULTS.timeoutMs),
    minChars: clampInteger(input.nextStepsMinChars, NEXT_STEPS_LIMITS.minChars, NEXT_STEPS_DEFAULTS.minChars),
    provider: paired ? provider : undefined,
    model: paired ? model : undefined,
  }
}

/**
 * Pick the LLM route for one generation.
 *
 * A configured provider/model pair wins; otherwise the route is the one the
 * session logged for its last request. No route means the turn is skipped, never
 * guessed.
 *
 * @param {{ provider?: string, model?: string }} options resolved options.
 * @param {object} session live session exposing `requestHeader()`.
 * @returns {{ provider: string, model: string }|undefined} route, or undefined.
 */
export function resolveNextStepsRoute(options, session) {
  const input = isPlainObject(options) ? options : {}
  if (isText(input.provider) && isText(input.model)) {
    return { provider: input.provider, model: input.model }
  }
  try {
    const header = typeof session?.requestHeader === 'function' ? session.requestHeader() : undefined
    const config = header?.config
    if (isText(config?.provider) && isText(config?.model)) {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    // An unreadable header is simply no route; the turn is skipped.
  }
  return undefined
}

/**
 * Collect the assistant's visible text for one turn.
 *
 * Every `assistant/message` of the turn contributes its text blocks, in event
 * order; reasoning and tool calls are not part of the reply the user read.
 *
 * @param {Array<{ type?: string, data?: object }>} events session event log.
 * @param {number} turn completed turn number.
 * @returns {string} the turn's assistant text, joined and trimmed.
 */
export function collectTurnText(events, turn) {
  const parts = []
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'assistant/message') continue
    if (event?.data?.turn !== turn) continue
    const content = event.data.message?.content
    if (!Array.isArray(content)) continue
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    if (text.trim() !== '') parts.push(text)
  }
  return parts.join('\n\n').trim()
}

/**
 * Whether a tool argument string carries the tail placement.
 * @param {unknown} raw recorded `tool/call` arguments.
 * @returns {boolean} true when the arguments ask for `place: "tail"`.
 */
function hasTailPlace(raw) {
  if (typeof raw !== 'string') {
    return isPlainObject(raw) && raw.place === 'tail'
  }
  try {
    const value = JSON.parse(raw)
    if (isPlainObject(value) && value.place === 'tail') return true
  } catch {
    // Not JSON: fall through to the textual check for the raw argument string.
  }
  return /"place"\s*:\s*"tail"/.test(raw)
}

/**
 * Whether the turn already rendered its own tail card.
 *
 * The model may still call `render_ui` with `place: "tail"`; the host must not
 * append a second, competing next-step card under the same turn. Any recorded
 * `render_ui` tool call carrying the tail placement counts.
 *
 * @param {Array<{ type?: string, data?: object }>} events session event log.
 * @param {number} turn completed turn number.
 * @returns {boolean} true when the turn already ended with a tail card.
 */
export function hasTailCard(events, turn) {
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== 'tool/call') continue
    if (event?.data?.turn !== turn) continue
    if (event.data.name !== TOOL_NAME) continue
    if (hasTailPlace(event.data.arguments)) return true
  }
  return false
}

/**
 * Whether the turn already carries a generated next-step event.
 *
 * This reads the log rather than only in-memory state so a reload, replay, or a
 * second registration can never append twice for one turn.
 *
 * @param {Array<{ type?: string, data?: object }>} events session event log.
 * @param {number} turn completed turn number.
 * @returns {boolean} true when the event already exists.
 */
export function hasNextStepsEvent(events, turn) {
  return (Array.isArray(events) ? events : []).some(
    (event) => event?.type === NEXT_STEPS_EVENT && event?.data?.turn === turn,
  )
}

/**
 * Decide whether one turn should generate next steps.
 *
 * The order is deliberate: cheap static conditions first, then the log facts.
 * A non-null result is the documented reason for skipping, which also keeps the
 * decision unit-testable without a session.
 *
 * @param {{ enabled?: boolean, llm?: object, route?: object, text?: string, tail?: boolean, recorded?: boolean, minChars?: number }} input decision facts.
 * @returns {string|null} a human-readable skip reason, or null when generation should run.
 */
export function nextStepsSkipReason(input) {
  const value = isPlainObject(input) ? input : {}
  if (value.enabled !== true) return 'next steps are disabled by configuration'
  if (typeof value.llm?.stream !== 'function') return 'the llm service is not available'
  if (!isPlainObject(value.route) || !isText(value.route.provider) || !isText(value.route.model)) {
    return 'no model route is available'
  }
  if (value.nested === true) return 'the session is a delegated child session'
  if (value.recorded === true) return 'the turn already has a next-step card'
  if (value.tail === true) return 'the turn already ended with a tail card'
  const minChars = clampInteger(value.minChars, NEXT_STEPS_LIMITS.minChars, NEXT_STEPS_DEFAULTS.minChars)
  if (typeof value.text !== 'string' || value.text.length < minChars) {
    return 'the assistant reply is shorter than nextStepsMinChars'
  }
  return null
}

/**
 * Frame one assistant reply as the auxiliary next-step request.
 *
 * The model sees the reply only; the output contract is one JSON object with an
 * optional one-to-two-sentence summary of the turn, a short question, and two to
 * `max` labeled options, written in the reply's language. Long replies are
 * excerpted so one huge answer cannot make the auxiliary request unbounded.
 *
 * @param {string} turnText the turn's assistant text.
 * @param {number} [max] maximum options; clamped to 1..4.
 * @returns {{ system: string, messages: Array<object> }} the auxiliary request.
 */
export function nextStepsPrompt(turnText, max) {
  const limit = clampInteger(max, NEXT_STEPS_LIMITS.max, NEXT_STEPS_DEFAULTS.max)
  const raw = typeof turnText === 'string' ? turnText : ''
  const reply = raw.length <= NEXT_STEPS_CAPS.inputChars
    ? raw
    : raw.slice(0, NEXT_STEPS_CAPS.inputChars) + '\n\n[truncated]'
  const system = [
    'You generate the next-step suggestions shown under an assistant reply.',
    'Return only one JSON object, with no Markdown, code fence, or explanation:',
    '{"summary":"<one or two sentences summarizing what this turn did and where things stand; omit when there is nothing to summarize>","text":"<one short question that invites the next move>","options":[{"label":"<2-5 words>","prompt":"<the exact user message to send>"}]}',
    'Write in the language of the reply.',
    'The summary is optional: one or two sentences, at most ' + NEXT_STEPS_CAPS.summaryChars + ' characters, that recap what this turn accomplished and the current state; do not restate long passages of the reply.',
    'Provide 2 to ' + limit + ' distinct, concrete options for what the user could do next; put the most likely next move first.',
    'A label is at most ' + NEXT_STEPS_CAPS.labelChars + ' characters; a prompt is at most ' + NEXT_STEPS_CAPS.promptChars + ' characters and must make sense on its own as the user\'s next message.',
    'The text is at most ' + NEXT_STEPS_CAPS.textChars + ' characters.',
  ].join('\n')
  return {
    system,
    messages: [{
      id: createMessageId(),
      role: 'user',
      content: [{ type: 'text', text: 'Assistant reply:\n\n' + (reply === '' ? '(empty reply)' : reply) }],
      source: { kind: NEXT_STEPS_SOURCE },
    }],
  }
}

/**
 * Create one locally unique message id without importing a crypto module.
 * @returns {string} a message id usable for one auxiliary request.
 */
function createMessageId() {
  return 'super-cards-next-steps-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

/**
 * Find one JSON value embedded in model output, tolerating prose around it.
 *
 * The documented output is an object, but a bare JSON array of options is
 * accepted too; an object that carries `options` wins over a partial slice of
 * an array.
 *
 * @param {string} text candidate text.
 * @returns {unknown} parsed JSON value, or undefined.
 */
function findJson(text) {
  const values = []
  const object = sliceJson(text, '{', '}')
  if (object !== undefined) values.push(object)
  const array = sliceJson(text, '[', ']')
  if (array !== undefined) values.push(array)
  const withOptions = values.find((value) => isPlainObject(value) && Array.isArray(value.options))
  if (withOptions !== undefined) return withOptions
  const list = values.find((value) => Array.isArray(value))
  if (list !== undefined) return list
  return values[0]
}

/**
 * Parse the JSON value between one pair of delimiters.
 * @param {string} text candidate text.
 * @param {string} open opening delimiter.
 * @param {string} close closing delimiter.
 * @returns {unknown} parsed JSON value, or undefined.
 */
function sliceJson(text, open, close) {
  const start = text.indexOf(open)
  if (start < 0) return undefined
  const end = text.lastIndexOf(close)
  if (end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Normalize one suggested option.
 *
 * A label is required and clamped; a prompt falls back to the label so a bare
 * label is still a clickable option. Non-objects and blank labels are dropped.
 *
 * @param {unknown} item one `options` entry from the model.
 * @returns {{ label: string, prompt: string }|undefined} normalized option.
 */
function normalizeOption(item) {
  if (typeof item === 'string') {
    const label = clampText(item, NEXT_STEPS_CAPS.labelChars)
    return label === '' ? undefined : { label, prompt: label }
  }
  if (!isPlainObject(item)) return undefined
  const label = clampText(item.label, NEXT_STEPS_CAPS.labelChars)
  if (label === '') return undefined
  const prompt = clampText(item.prompt, NEXT_STEPS_CAPS.promptChars) || label
  return { label, prompt }
}

/**
 * Parse model output into a usable next-step suggestion set.
 *
 * Defensive by design: code fences and prose around the JSON are tolerated, the
 * optional summary and the question are clamped, labels and prompts are clamped,
 * unusable and duplicate options are dropped, and at most `max` options are
 * kept. An unusable summary (non-string, blank, or over the cap) is omitted
 * rather than failing the card. Returns null when nothing usable remains, so
 * the caller appends no event at all.
 *
 * @param {unknown} raw raw model output.
 * @param {number} [max] maximum options; clamped to 1..4.
 * @returns {{ summary?: string, text: string, options: Array<{ label: string, prompt: string }> }|null} parsed suggestions.
 */
export function parseNextSteps(raw, max) {
  if (typeof raw !== 'string') return null
  const limit = clampInteger(max, NEXT_STEPS_LIMITS.max, NEXT_STEPS_DEFAULTS.max)
  const fence = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  const body = (fence === null ? raw : fence[1]).trim()
  const parsed = findJson(body)
  if (parsed === null || parsed === undefined) return null
  const bag = Array.isArray(parsed) ? { options: parsed } : parsed
  if (!isPlainObject(bag)) return null
  const summary = clampText(bag.summary, NEXT_STEPS_CAPS.summaryChars)
  const text = clampText(bag.text ?? bag.question, NEXT_STEPS_CAPS.textChars)
  const options = []
  const seen = new Set()
  for (const candidate of Array.isArray(bag.options) ? bag.options : []) {
    if (options.length >= limit) break
    const option = normalizeOption(candidate)
    if (option === undefined) continue
    const key = option.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    options.push(option)
  }
  if (options.length === 0) return null
  const result = { text, options }
  // Optional by contract: the Client renders the question alone when absent.
  if (summary !== '') result.summary = summary
  return result
}

/**
 * Build the session event payload for one parsed suggestion set.
 *
 * `summary` is optional and backward compatible: it is present only when a
 * usable summary was generated, so an older Client that ignores it still
 * renders the card from `text` and `options` alone.
 *
 * @param {number} turn completed turn number, used by the Client to place the card.
 * @param {{ summary?: string, text: string, options: Array<{ label: string, prompt: string }> }} parsed parsed suggestions.
 * @param {number} [at] epoch milliseconds; defaults to the current time.
 * @returns {{ turn: number, summary?: string, text: string, options: Array<{ label: string, prompt: string }>, at: number }} event data.
 */
export function nextStepsEventData(turn, parsed, at) {
  const value = isPlainObject(parsed) ? parsed : {}
  const summary = clampText(value.summary, NEXT_STEPS_CAPS.summaryChars)
  const data = { turn }
  if (summary !== '') data.summary = summary
  data.text = typeof value.text === 'string' ? value.text : ''
  data.options = Array.isArray(value.options)
    ? value.options.map((option) => ({ label: option.label, prompt: option.prompt }))
    : []
  data.at = typeof at === 'number' ? at : Date.now()
  return data
}

/**
 * Read the `llm` service without letting a missing service throw.
 * @param {object} ctx Cordis context.
 * @returns {object|undefined} the llm service when it can stream.
 */
function getLlm(ctx) {
  try {
    const llm = typeof ctx?.get === 'function' ? ctx.get('llm') : undefined
    return typeof llm?.stream === 'function' ? llm : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the timer functions, allowing a test to supply deterministic ones.
 * @param {object} [env] optional timer overrides.
 * @returns {{ setTimeout: Function, clearTimeout: Function }} timer functions.
 */
function resolveTimers(env) {
  const source = isPlainObject(env) ? env : {}
  return {
    setTimeout: typeof source.setTimeout === 'function' ? source.setTimeout : setTimeout,
    clearTimeout: typeof source.clearTimeout === 'function' ? source.clearTimeout : clearTimeout,
  }
}

/**
 * Stable map key for one session.
 * @param {object} session live session.
 * @returns {string|object} the session id, or the session object itself.
 */
function sessionKey(session) {
  return typeof session?.id === 'string' ? session.id : session
}

/**
 * Record one turn as finished for this plugin lifetime.
 * @param {object} state install state.
 * @param {object} session live session.
 * @param {number} turn completed turn number.
 * @returns {void}
 */
function markDone(state, session, turn) {
  const key = sessionKey(session)
  let turns = state.done.get(key)
  if (turns === undefined) {
    turns = new Set()
    state.done.set(key, turns)
  }
  turns.add(turn)
}

/**
 * Whether one turn already produced next steps in this plugin lifetime.
 * @param {object} state install state.
 * @param {object} session live session.
 * @param {number} turn completed turn number.
 * @returns {boolean} true when the turn is finished.
 */
function isDone(state, session, turn) {
  const turns = state.done.get(sessionKey(session))
  return turns !== undefined && turns.has(turn)
}

/**
 * Abort and clear one in-flight generation.
 * @param {object} state install state.
 * @param {{ controller: AbortController, timer?: unknown }} record in-flight record.
 * @returns {void}
 */
function stopRecord(state, record) {
  try {
    if (record.timer !== undefined) state.timers.clearTimeout(record.timer)
  } catch {
    // A broken timer must never prevent the abort below.
  }
  record.timer = undefined
  try {
    if (record.controller.signal.aborted !== true) {
      record.controller.abort(new Error('super-cards: next steps superseded'))
    }
  } catch {
    // Aborting is best effort; the generation also checks disposal itself.
  }
}

/**
 * Abort every in-flight generation (plugin disposal).
 * @param {object} state install state.
 * @returns {void}
 */
function cancelAll(state) {
  for (const record of state.inFlight.values()) stopRecord(state, record)
  state.inFlight.clear()
}

/**
 * Abort the in-flight generation of one session (a new turn started).
 * @param {object} state install state.
 * @param {object} session live session.
 * @returns {void}
 */
function cancelSession(state, session) {
  const key = sessionKey(session)
  const record = state.inFlight.get(key)
  if (record === undefined) return
  state.inFlight.delete(key)
  stopRecord(state, record)
}

/**
 * Ask the model and append one next-step event.
 * @param {object} state install state.
 * @param {{ controller: AbortController, session: object, turn: number }} record in-flight record.
 * @param {{ system: string, messages: Array<object> }} prompt auxiliary request.
 * @param {object} llm llm service.
 * @param {{ provider: string, model: string }} route resolved route.
 * @returns {Promise<void>} resolves after the event was appended or the attempt ended.
 */
async function runNextSteps(state, record, prompt, llm, route) {
  if (state.disposed || record.controller.signal.aborted) return
  let output
  try {
    output = await requestCompletion(state, record, prompt, llm, route)
  } catch {
    // Provider failures, aborts, and timeouts are expected outcomes, not errors.
    return
  }
  if (output === undefined) return
  if (state.disposed || record.controller.signal.aborted) return
  const parsed = parseNextSteps(output, state.options.max)
  if (parsed === null) return
  let events
  try {
    events = record.session.snapshotEvents()
  } catch {
    return
  }
  if (hasNextStepsEvent(events, record.turn)) {
    markDone(state, record.session, record.turn)
    return
  }
  try {
    record.session.append(NEXT_STEPS_EVENT, nextStepsEventData(record.turn, parsed))
  } catch {
    return
  }
  markDone(state, record.session, record.turn)
}

/**
 * Stream one completion and return its text.
 * @param {object} state install state.
 * @param {{ controller: AbortController, session: object }} record in-flight record.
 * @param {{ system: string, messages: Array<object> }} prompt auxiliary request.
 * @param {object} llm llm service.
 * @param {{ provider: string, model: string }} route resolved route.
 * @returns {Promise<string|undefined>} generated text, or undefined when aborted or unfinished.
 */
async function requestCompletion(state, record, prompt, llm, route) {
  const chunks = llm.stream({
    provider: route.provider,
    model: route.model,
    messages: prompt.messages,
    system: prompt.system,
    maxTokens: NEXT_STEPS_CAPS.maxTokens,
    sessionId: record.session.id,
    signal: record.controller.signal,
  })
  let output = ''
  let finish
  for await (const chunk of chunks) {
    if (state.disposed || record.controller.signal.aborted) return undefined
    if (!isPlainObject(chunk)) continue
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      output += chunk.text
      continue
    }
    if (chunk.type === 'finish') {
      finish = chunk.reason
      break
    }
  }
  if (state.disposed || record.controller.signal.aborted) return undefined
  if (finish !== undefined && finish?.kind !== 'stop') return undefined
  return output
}

/**
 * Run one scheduled generation, then clear its state.
 * @param {object} state install state.
 * @param {object} record in-flight record.
 * @param {{ system: string, messages: Array<object> }} prompt auxiliary request.
 * @param {object} llm llm service.
 * @param {{ provider: string, model: string }} route resolved route.
 * @returns {void}
 */
function startRun(state, record, prompt, llm, route) {
  const finish = () => {
    try {
      if (record.timer !== undefined) state.timers.clearTimeout(record.timer)
      record.timer = undefined
      const key = sessionKey(record.session)
      if (state.inFlight.get(key) === record) state.inFlight.delete(key)
    } catch {
      // Bookkeeping must never surface as an unhandled rejection.
    }
  }
  Promise.resolve()
    .then(() => runNextSteps(state, record, prompt, llm, route))
    .catch(() => undefined)
    .then(finish, finish)
}

/**
 * Decide, then start, generation for one completed turn.
 *
 * Cheap static and log-based checks come first, so a skipped turn never reaches
 * the provider. The in-flight guard keeps one generation per session and the
 * done set keeps one event per turn.
 *
 * @param {object} state install state.
 * @param {object} ctx Cordis context.
 * @param {object} session live session.
 * @param {number} turn completed turn number.
 * @returns {void}
 */
function schedule(state, ctx, session, turn) {
  // Disabled (the default) is the cheapest possible answer: return before the
  // event-log scans below, so a long session pays nothing per completed turn.
  if (state.options.enabled !== true) return
  const key = sessionKey(session)
  if (state.inFlight.has(key)) return
  if (typeof session?.append !== 'function' || typeof session?.snapshotEvents !== 'function') return
  if (isDone(state, session, turn)) return
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return
  }
  const text = collectTurnText(events, turn)
  const llm = getLlm(ctx)
  const route = resolveNextStepsRoute(state.options, session)
  const reason = nextStepsSkipReason({
    enabled: state.options.enabled,
    nested: isDelegatedSession(session),
    llm,
    route,
    text,
    tail: hasTailCard(events, turn),
    recorded: hasNextStepsEvent(events, turn),
    minChars: state.options.minChars,
  })
  if (reason !== null) return
  const prompt = nextStepsPrompt(text, state.options.max)
  const controller = new AbortController()
  const record = { turn, session, controller, timer: undefined }
  state.inFlight.set(key, record)
  let timer
  try {
    timer = state.timers.setTimeout(() => {
      try {
        controller.abort(new Error('super-cards: next steps timed out'))
      } catch {
        // Aborting is best effort.
      }
    }, state.options.timeoutMs)
  } catch {
    // Without a timeout we must not start an unbounded request.
    state.inFlight.delete(key)
    return
  }
  if (typeof timer?.unref === 'function') timer.unref()
  record.timer = timer
  startRun(state, record, prompt, llm, route)
}

/**
 * Whether one session is a delegated child (a subagent, not the person's own
 * conversation). Child sessions end their own turns constantly while working,
 * so a next-step card there is both useless and a wasted model call.
 *
 * @param {object} session live session.
 * @returns {boolean} true for a subagent child session.
 */
function isDelegatedSession(session) {
  const header = session && typeof session === 'object' ? session.header : undefined
  if (!isPlainObject(header)) return false
  if (header.origin === 'subagent') return true
  if (typeof header.parentSession === 'string' && header.parentSession !== '') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Handle one `session/event` notification without ever throwing.
 *
 * `turn/start` supersedes any generation still running for that session;
 * `turn/end` schedules a new one. Every other event is ignored.
 *
 * @param {object} state install state.
 * @param {object} ctx Cordis context.
 * @param {object} session live session.
 * @param {object} event session event envelope.
 * @returns {void}
 */
function handleSessionEvent(state, ctx, session, event) {
  try {
    if (state.disposed) return
    if (typeof event?.type !== 'string') return
    if (event.type === 'turn/start') {
      cancelSession(state, session)
      return
    }
    if (event.type !== 'turn/end') return
    const turn = event.data?.turn
    if (!Number.isInteger(turn)) return
    schedule(state, ctx, session, turn)
  } catch {
    // A listener failure must never break the session log append that called it.
  }
}

/**
 * Install the automatic next-step generator for the plugin lifetime.
 *
 * Registers one `session/event` listener when the feature is enabled and returns
 * a disposer that aborts every in-flight request and unsubscribes. When the
 * feature is disabled the returned disposer is a no-op, so `apply()` keeps a
 * stable effect shape.
 *
 * @param {object} ctx Cordis context with `on` (and `get('llm')` when available).
 * @param {unknown} config raw patch row config.
 * @param {{ setTimeout?: Function, clearTimeout?: Function }} [env] optional timer overrides (test seam).
 * @returns {() => void} disposer that aborts work and unsubscribes.
 */
export function install(ctx, config, env) {
  const options = resolveNextStepsConfig(config)
  if (!options.enabled) return () => {}
  const state = {
    disposed: false,
    options,
    timers: resolveTimers(env),
    inFlight: new Map(),
    done: new Map(),
  }
  let unsubscribe
  try {
    if (typeof ctx?.on !== 'function') return () => {}
    unsubscribe = ctx.on('session/event', (session, event) => {
      handleSessionEvent(state, ctx, session, event)
    })
  } catch {
    return () => {}
  }
  return () => {
    if (state.disposed) return
    state.disposed = true
    cancelAll(state)
    try {
      if (typeof unsubscribe === 'function') unsubscribe()
    } catch {
      // Unsubscribing is best effort; the disposed flag already stops new work.
    }
  }
}