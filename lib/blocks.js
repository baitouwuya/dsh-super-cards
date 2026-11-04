/**
 * Block registry: the single source of truth for every renderable block type.
 *
 * One entry carries the wire name, the compact directory copy, the exact
 * contract (shape, notes, example), the normalizer, and dock safety. The tool
 * enum, the description directory, the `render_ui_blocks` contract, the
 * dock-safe subset, and the normalization dispatch all derive from this table,
 * so adding a block type touches one entry here plus its client renderer.
 *
 * This module imports only `./shared.js`; it has no side effects.
 */

import {
  ACTION_TONES,
  ALIGNMENTS,
  BLOCKS_TOOL_NAME,
  CAPS,
  ICONS,
  MOTION_DEFAULTS,
  MOTION_EFFECTS,
  MOTION_LIMITS,
  MOTION_MEANING,
  TONES,
  describeValue,
  isPlainObject,
  normalizeMotion,
  put,
  toArray,
  toNumber,
  toOptionalText,
  toText,
  toTone,
} from './shared.js'

// --- normalizers -----------------------------------------------------------
// Each normalizer takes one raw block and returns the normalized block, or
// undefined when nothing renderable remains. They never throw.

/**
 * Normalize one `text` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeText(block) {
  const text = toOptionalText(block.text)
  if (text === undefined) return undefined
  const out = { type: 'text', text }
  if (typeof block.muted === 'boolean') out.muted = block.muted
  return out
}

/**
 * Normalize one `heading` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeHeading(block) {
  const text = toOptionalText(block.text)
  if (text === undefined) return undefined
  const level = block.level === 2 || block.level === 3 ? block.level : 1
  return { type: 'heading', text, level }
}

/**
 * Normalize one `callout` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeCallout(block) {
  const text = toOptionalText(block.text)
  if (text === undefined) return undefined
  const out = { type: 'callout', text }
  put(out, 'tone', toTone(block.tone))
  put(out, 'title', toOptionalText(block.title))
  return out
}

/**
 * Normalize one `stats` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeStats(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    if (label === undefined) continue
    const numeric = toNumber(raw.value)
    const text = toOptionalText(raw.value)
    const value = numeric !== undefined ? numeric : text
    if (value === undefined) continue
    const item = { label, value }
    put(item, 'hint', toOptionalText(raw.hint))
    put(item, 'delta', toOptionalText(raw.delta))
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  return items.length > 0 ? { type: 'stats', items } : undefined
}

/**
 * Normalize one table cell to string, number, or null.
 * @param {unknown} cell raw cell.
 * @returns {string|number|null} normalized cell.
 */
function normalizeTableCell(cell) {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  const text = toText(cell)
  return text === '' ? null : text
}

/**
 * Normalize one `table` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeTable(block) {
  const columns = []
  for (const rawColumn of toArray(block.columns)) {
    const column = toText(rawColumn).trim()
    if (column !== '') columns.push(column)
  }
  if (columns.length === 0) return undefined
  const width = columns.length
  const rows = []
  for (const rawRow of toArray(block.rows)) {
    if (!Array.isArray(rawRow)) continue
    const row = []
    for (let index = 0; index < width; index += 1) row.push(normalizeTableCell(rawRow[index]))
    rows.push(row)
    if (rows.length >= CAPS.tableRows) break
  }
  const out = { type: 'table', columns, rows }
  const rawAlign = toArray(block.align)
  if (rawAlign.length > 0) {
    const align = []
    for (let index = 0; index < width; index += 1) {
      const candidate = rawAlign[index]
      align.push(typeof candidate === 'string' && ALIGNMENTS.includes(candidate) ? candidate : 'left')
    }
    out.align = align
  }
  put(out, 'caption', toOptionalText(block.caption))
  return out
}

/**
 * Normalize one `keyvalue` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeKeyvalue(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const key = toOptionalText(raw.key)
    if (key === undefined) continue
    items.push({ key, value: toText(raw.value) })
  }
  if (items.length === 0) return undefined
  const out = { type: 'keyvalue', items }
  if (block.columns === 2) out.columns = 2
  else if (block.columns === 1) out.columns = 1
  return out
}

/**
 * Normalize one `list` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeList(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    const text = toOptionalText(raw)
    if (text !== undefined) items.push(text)
  }
  if (items.length === 0) return undefined
  const out = { type: 'list', items }
  if (typeof block.ordered === 'boolean') out.ordered = block.ordered
  return out
}

/**
 * Normalize one `badges` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeBadges(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    if (label === undefined) continue
    const item = { label }
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  return items.length > 0 ? { type: 'badges', items } : undefined
}

/**
 * Normalize one `progress` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeProgress(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    const value = toNumber(raw.value)
    if (label === undefined || value === undefined) continue
    const item = { label, value: Math.min(1, Math.max(0, value)) }
    put(item, 'caption', toOptionalText(raw.caption))
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  return items.length > 0 ? { type: 'progress', items } : undefined
}

/**
 * Normalize one `bars` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeBars(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    const value = toNumber(raw.value)
    if (label === undefined || value === undefined) continue
    const item = { label, value }
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  if (items.length === 0) return undefined
  const out = { type: 'bars', items }
  put(out, 'title', toOptionalText(block.title))
  const max = toNumber(block.max)
  if (max !== undefined && max > 0) out.max = max
  put(out, 'unit', toOptionalText(block.unit))
  // Columns for a short series, rows for ranked lists: same data, one block.
  if (block.direction === 'vertical') out.direction = 'vertical'
  return out
}

/**
 * Normalize one `pie` block: slices of one whole, largest first is the model's
 * choice (the renderer keeps the given order and never re-sorts).
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizePie(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    const value = toNumber(raw.value)
    if (label === undefined || value === undefined || value < 0) continue
    const item = { label, value }
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
    if (items.length >= CAPS.pieSlices) break
  }
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (items.length === 0 || total <= 0) return undefined
  const out = { type: 'pie', items }
  put(out, 'title', toOptionalText(block.title))
  put(out, 'unit', toOptionalText(block.unit))
  if (block.donut === false) out.donut = false
  return out
}

/**
 * Normalize one `sparkline` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeSparkline(block) {
  const values = []
  for (const raw of toArray(block.values)) {
    const value = toNumber(raw)
    if (value === undefined) continue
    values.push(value)
    if (values.length >= CAPS.sparklineValues) break
  }
  if (values.length === 0) return undefined
  const out = { type: 'sparkline', values }
  const rawLabels = toArray(block.labels)
  if (rawLabels.length === values.length) {
    const labels = []
    for (const raw of rawLabels) labels.push(toText(raw))
    out.labels = labels
  }
  put(out, 'title', toOptionalText(block.title))
  put(out, 'unit', toOptionalText(block.unit))
  put(out, 'tone', toTone(block.tone))
  return out
}

/**
 * Normalize one `code` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeCode(block) {
  if (typeof block.code !== 'string' || block.code === '') return undefined
  const out = { type: 'code', code: block.code.slice(0, CAPS.codeChars) }
  put(out, 'language', toOptionalText(block.language, 80))
  put(out, 'title', toOptionalText(block.title))
  return out
}

/**
 * Normalize one `quote` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeQuote(block) {
  const text = toOptionalText(block.text)
  if (text === undefined) return undefined
  const out = { type: 'quote', text }
  put(out, 'by', toOptionalText(block.by))
  return out
}

/**
 * Normalize one `timeline` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeTimeline(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const title = toOptionalText(raw.title)
    if (title === undefined) continue
    const item = { title }
    put(item, 'text', toOptionalText(raw.text))
    put(item, 'time', toOptionalText(raw.time))
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  return items.length > 0 ? { type: 'timeline', items } : undefined
}

/**
 * Normalize one `links` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeLinks(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    const href = toOptionalText(raw.href)
    if (label === undefined || href === undefined) continue
    const item = { label, href }
    put(item, 'description', toOptionalText(raw.description))
    items.push(item)
  }
  return items.length > 0 ? { type: 'links', items } : undefined
}

/**
 * Normalize one `actions` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeActions(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label)
    const prompt = toOptionalText(raw.prompt)
    if (label === undefined || prompt === undefined) continue
    const item = { label, prompt }
    if (typeof raw.tone === 'string' && ACTION_TONES.includes(raw.tone)) item.tone = raw.tone
    items.push(item)
    if (items.length >= CAPS.actions) break
  }
  return items.length > 0 ? { type: 'actions', items } : undefined
}

/**
 * Normalize one block of a known type.
 * @param {string} type block type (already known to be supported).
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeLive(block) {
  const field = block.field === 'tools' || block.field === 'last-message' ? block.field : 'messages'
  const rawLimit = block.limit
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(10, Math.trunc(rawLimit)))
    : 3
  const out = { type: 'live', field, limit }
  put(out, 'label', toOptionalText(block.label))
  return out
}

function normalizeControls(block) {
  const items = []
  const source = Array.isArray(block.items) ? block.items.slice(0, 8) : []
  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.kind === 'setting') {
      const setting = raw.setting === 'theme' || raw.setting === 'locale' ? raw.setting : undefined
      if (setting === undefined) continue
      const options = []
      for (const option of Array.isArray(raw.options) ? raw.options.slice(0, 6) : []) {
        if (!option || typeof option !== 'object') continue
        if (typeof option.value !== 'string' || option.value === '') continue
        options.push({ value: option.value, label: toOptionalText(option.label) })
      }
      if (options.length === 0) continue
      items.push({ kind: 'setting', setting, label: toOptionalText(raw.label), options })
      continue
    }
    if (raw.kind !== 'button') continue
    const label = toOptionalText(raw.label)
    const action = raw.action && typeof raw.action === 'object' ? raw.action : null
    if (label === undefined || action === null) continue
    if (action.kind === 'setting') {
      const setting = action.setting === 'theme' || action.setting === 'locale' ? action.setting : undefined
      if (setting === undefined || typeof action.value !== 'string' || action.value === '') continue
      items.push({ kind: 'button', label, action: { kind: 'setting', setting, value: action.value } })
      continue
    }
    if (action.kind !== 'prompt') continue
    const prompt = toOptionalText(action.prompt)
    if (prompt === undefined) continue
    items.push({ kind: 'button', label, action: { kind: 'prompt', prompt, send: action.send === true } })
  }
  if (items.length === 0) return undefined
  const out = { type: 'controls', items }
  put(out, 'title', toOptionalText(block.title))
  return out
}

/** Diagram kinds the renderer understands; anything else falls back to a flowchart. */
const DIAGRAM_KINDS = ['flowchart', 'sequence', 'class', 'state', 'er']

/** Node shapes a graph diagram may request. */
const DIAGRAM_SHAPES = ['box', 'round', 'diamond', 'circle', 'cylinder', 'note']

/** Edge line styles and arrow ends. */
const DIAGRAM_EDGE_STYLES = ['solid', 'dashed']
const DIAGRAM_ARROWS = ['end', 'both', 'none']

/** Message styles a sequence diagram may request. */
const DIAGRAM_MESSAGE_STYLES = ['sync', 'return', 'async']

/** Diagram caps; mirrored by the Client renderer. */
const DIAGRAM_CAPS = Object.freeze({
  nodes: 24,
  edges: 48,
  participants: 8,
  messages: 24,
  fields: 12,
  label: 60,
  detail: 80,
})

/**
 * Normalize the `diagram` block: a small structured graph model for flowcharts,
 * state machines, sequence diagrams, class diagrams, and ER diagrams.
 *
 * Endpoints are resolved by id, so a bad edge is dropped instead of breaking the
 * whole block. A diagram with no drawable content is unusable and dropped.
 *
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized diagram or undefined.
 */
function normalizeDiagram(block) {
  const kind = DIAGRAM_KINDS.includes(block.kind) ? block.kind : 'flowchart'
  const out = { type: 'diagram', kind, direction: block.direction === 'TB' ? 'TB' : 'LR' }
  put(out, 'title', toOptionalText(block.title, DIAGRAM_CAPS.detail))
  const ids = new Set()
  const nodes = []
  for (const raw of toArray(block.nodes).slice(0, DIAGRAM_CAPS.nodes)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label, DIAGRAM_CAPS.label)
    if (label === undefined) continue
    let id = toOptionalText(raw.id, 40) || 'n' + nodes.length
    if (ids.has(id)) id = id + '_' + nodes.length
    ids.add(id)
    const node = { id, label }
    if (DIAGRAM_SHAPES.includes(raw.shape)) node.shape = raw.shape
    put(node, 'tone', toTone(raw.tone))
    put(node, 'detail', toOptionalText(raw.detail, DIAGRAM_CAPS.detail))
    const fields = []
    for (const line of toArray(raw.fields).slice(0, DIAGRAM_CAPS.fields)) {
      const text = toOptionalText(line, 48)
      if (text !== undefined) fields.push(text)
    }
    const methods = []
    for (const line of toArray(raw.methods).slice(0, DIAGRAM_CAPS.fields)) {
      const text = toOptionalText(line, 48)
      if (text !== undefined) methods.push(text)
    }
    if (fields.length > 0) node.fields = fields
    if (methods.length > 0) node.methods = methods
    nodes.push(node)
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = []
  for (const raw of toArray(block.edges).slice(0, DIAGRAM_CAPS.edges)) {
    if (!isPlainObject(raw)) continue
    const from = toOptionalText(raw.from, 40)
    const to = toOptionalText(raw.to, 40)
    if (from === undefined || to === undefined) continue
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue
    const edge = { from, to }
    put(edge, 'label', toOptionalText(raw.label, 40))
    if (DIAGRAM_EDGE_STYLES.includes(raw.style)) edge.style = raw.style
    if (DIAGRAM_ARROWS.includes(raw.arrow)) edge.arrow = raw.arrow
    edges.push(edge)
  }
  const participants = []
  const participantIds = new Set()
  for (const raw of toArray(block.participants).slice(0, DIAGRAM_CAPS.participants)) {
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label, DIAGRAM_CAPS.label)
    if (label === undefined) continue
    let id = toOptionalText(raw.id, 40) || 'p' + participants.length
    if (participantIds.has(id)) id = id + '_' + participants.length
    participantIds.add(id)
    const participant = { id, label }
    put(participant, 'tone', toTone(raw.tone))
    participants.push(participant)
  }
  const messages = []
  for (const raw of toArray(block.messages).slice(0, DIAGRAM_CAPS.messages)) {
    if (!isPlainObject(raw)) continue
    const from = toOptionalText(raw.from, 40)
    const to = toOptionalText(raw.to, 40)
    if (from === undefined || to === undefined) continue
    if (!participantIds.has(from) || !participantIds.has(to)) continue
    const message = { from, to }
    put(message, 'label', toOptionalText(raw.label, DIAGRAM_CAPS.label))
    message.style = DIAGRAM_MESSAGE_STYLES.includes(raw.style) ? raw.style : 'sync'
    messages.push(message)
  }
  if (kind === 'sequence') {
    if (participants.length === 0 || messages.length === 0) return undefined
    out.participants = participants
    out.messages = messages
    return out
  }
  if (nodes.length === 0) return undefined
  out.nodes = nodes
  if (edges.length > 0) out.edges = edges
  return out
}

/**
 * Normalize one `divider` block; a divider has no content of its own.
 * @returns {{ type: string }} the divider.
 */
function normalizeDivider() {
  return { type: 'divider' }
}

/** Bounds for the sandboxed `html` card's frame. */
const HTML_CAPS = Object.freeze({ heightMin: 120, heightMax: 800, heightDefault: 240 })

/**
 * Normalize one `html` block: a self-contained HTML/CSS/SVG fragment (or a full
 * document) rendered in a sandboxed frame. The source is the card, so it is kept
 * verbatim up to the transport cap; the frame height is clamped.
 *
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeHtml(block) {
  const html = typeof block.html === 'string' ? block.html.slice(0, CAPS.htmlChars) : ''
  if (html.trim() === '') return undefined
  const out = { type: 'html', html }
  put(out, 'title', toOptionalText(block.title))
  put(out, 'caption', toOptionalText(block.caption))
  const height = toNumber(block.height)
  out.height = height === undefined
    ? HTML_CAPS.heightDefault
    : Math.max(HTML_CAPS.heightMin, Math.min(HTML_CAPS.heightMax, Math.round(height)))
  return out
}


/**
 * Normalize one `tree` block: a hierarchy of labels with an optional note,
 * badge and tone, flattened to the depth cap so a card can never explode.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeTree(block) {
  let count = 0
  const walk = (list, depth) => {
    const out = []
    for (const raw of toArray(list)) {
      if (count >= CAPS.treeNodes) break
      if (!isPlainObject(raw)) continue
      const label = toOptionalText(raw.label)
      if (label === undefined) continue
      count += 1
      const node = { label }
      put(node, 'note', toOptionalText(raw.note, 200))
      put(node, 'badge', toOptionalText(raw.badge, 40))
      put(node, 'tone', toTone(raw.tone))
      if (depth < CAPS.treeDepth) {
        const children = walk(raw.children, depth + 1)
        if (children.length > 0) node.children = children
      }
      out.push(node)
    }
    return out
  }
  const nodes = walk(block.nodes, 0)
  if (nodes.length === 0) return undefined
  const out = { type: 'tree', nodes }
  put(out, 'title', toOptionalText(block.title))
  return out
}

/**
 * Normalize one `heatmap` block: labelled values laid out row-major, with an
 * optional explicit maximum so intensities are comparable across cards.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeHeatmap(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (items.length >= CAPS.heatmapCells) break
    if (!isPlainObject(raw)) continue
    const value = toNumber(raw.value)
    if (value === undefined) continue
    const item = { value: Math.max(0, value) }
    put(item, 'label', toOptionalText(raw.label, 40))
    put(item, 'tone', toTone(raw.tone))
    items.push(item)
  }
  if (items.length === 0) return undefined
  const out = { type: 'heatmap', items }
  put(out, 'title', toOptionalText(block.title))
  put(out, 'unit', toOptionalText(block.unit, 40))
  const columns = toNumber(block.columns)
  if (columns !== undefined && columns >= 1) out.columns = Math.min(53, Math.trunc(columns))
  const max = toNumber(block.max)
  if (max !== undefined && max > 0) out.max = max
  return out
}

/** Diff line kinds: the model names one per line. */
const DIFF_KINDS = ['add', 'del', 'ctx']

/**
 * Normalize one `diff` block: a patch-shaped list of lines. Unknown kinds fall
 * back to context so a typo never loses the surrounding lines.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeDiff(block) {
  const lines = []
  for (const raw of toArray(block.lines)) {
    if (lines.length >= CAPS.diffLines) break
    if (!isPlainObject(raw) || typeof raw.text !== 'string') continue
    const kind = DIFF_KINDS.indexOf(raw.kind) === -1 ? 'ctx' : raw.kind
    lines.push({ kind, text: raw.text.slice(0, CAPS.textChars) })
  }
  if (lines.length === 0) return undefined
  const out = { type: 'diff', lines }
  put(out, 'title', toOptionalText(block.title))
  put(out, 'path', toOptionalText(block.path, 240))
  put(out, 'language', toOptionalText(block.language, 40))
  return out
}

/**
 * Normalize one `kanban` block: a small board of columns and cards.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeKanban(block) {
  const columns = []
  for (const raw of toArray(block.columns)) {
    if (columns.length >= CAPS.kanbanColumns) break
    if (!isPlainObject(raw)) continue
    const title = toOptionalText(raw.title)
    if (title === undefined) continue
    const cards = []
    for (const cardRaw of toArray(raw.cards)) {
      if (cards.length >= CAPS.kanbanCards) break
      if (!isPlainObject(cardRaw)) continue
      const cardTitle = toOptionalText(cardRaw.title)
      if (cardTitle === undefined) continue
      const card = { title: cardTitle }
      put(card, 'text', toOptionalText(cardRaw.text, 600))
      const badges = []
      for (const badgeRaw of toArray(cardRaw.badges)) {
        const badge = toOptionalText(badgeRaw, 40)
        if (badge !== undefined) badges.push(badge)
        if (badges.length >= 4) break
      }
      if (badges.length > 0) card.badges = badges
      put(card, 'tone', toTone(cardRaw.tone))
      cards.push(card)
    }
    const column = { title, cards }
    put(column, 'tone', toTone(raw.tone))
    columns.push(column)
  }
  if (columns.length === 0) return undefined
  const out = { type: 'kanban', columns }
  put(out, 'title', toOptionalText(block.title))
  return out
}

/** Container types a container may not nest: one level only, so depth stays bounded. */
const NO_NEST = new Set(['tabs', 'columns'])

/**
 * Normalize one `tabs` block: a small set of panes, each carrying regular
 * blocks. Nesting is one level deep (a tab cannot contain another tab).
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeTabs(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (items.length >= CAPS.tabs) break
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label, 60)
    if (label === undefined) continue
    const inner = []
    for (const innerRaw of toArray(raw.blocks)) {
      if (inner.length >= CAPS.tabBlocks) break
      if (!isPlainObject(innerRaw)) continue
      const type = typeof innerRaw.type === 'string' ? innerRaw.type : ''
      const canonical = resolveBlockType(type)
      if (canonical === undefined || NO_NEST.has(canonical)) continue
      const normalized = normalizeBlock(type, innerRaw)
      if (normalized !== undefined) inner.push(normalized)
    }
    if (inner.length === 0) continue
    items.push({ label, blocks: inner })
  }
  if (items.length === 0) return undefined
  const out = { type: 'tabs', items }
  put(out, 'title', toOptionalText(block.title))
  return out
}

/**
 * Normalize one `columns` block: two or three groups of regular blocks rendered
 * side by side. Nesting is one level deep (no tab or column inside a column).
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeColumns(block) {
  const items = []
  for (const raw of toArray(block.items)) {
    if (items.length >= CAPS.columns) break
    if (!isPlainObject(raw)) continue
    const label = toOptionalText(raw.label, 60)
    const inner = []
    for (const innerRaw of toArray(raw.blocks)) {
      if (inner.length >= CAPS.columnBlocks) break
      if (!isPlainObject(innerRaw)) continue
      const type = typeof innerRaw.type === 'string' ? innerRaw.type : ''
      const canonical = resolveBlockType(type)
      if (canonical === undefined || NO_NEST.has(canonical)) continue
      const normalized = normalizeBlock(type, innerRaw)
      if (normalized !== undefined) inner.push(normalized)
    }
    if (inner.length === 0) continue
    const column = { blocks: inner }
    put(column, 'label', label)
    items.push(column)
  }
  if (items.length === 0) return undefined
  const out = { type: 'columns', items }
  // Optional shares: one weight per column, 1–3. A mismatch is ignored, so a
  // stale weight list never drops the content.
  const rawWeights = toArray(block.weights)
  if (rawWeights.length === items.length) {
    const weights = []
    for (const raw of rawWeights) {
      const value = toNumber(raw)
      weights.push(value === undefined ? 1 : Math.max(1, Math.min(3, Math.round(value))))
    }
    out.weights = weights
  }
  put(out, 'title', toOptionalText(block.title))
  return out
}

/**
 * Accept one image source: an http(s) URL or an inline `data:image/*` URI.
 * Rejects every other scheme, so a spec can never smuggle a javascript:, file:,
 * or blob: URL into an `<img src>`.
 * @param {unknown} value raw source.
 * @returns {string|undefined} the source, or undefined when unusable.
 */
function imageSource(value) {
  if (typeof value !== 'string') return undefined
  const src = value.trim()
  if (src === '' || src.length > CAPS.imageChars) return undefined
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/iu.test(src)) return src
  if (/^data:image\/svg\+xml,[^\s]+$/iu.test(src)) return src
  if (/^https?:\/\/[^\s]+$/iu.test(src)) return src
  return undefined
}

/**
 * Normalize one `image` block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
function normalizeImage(block) {
  const src = imageSource(block.src)
  if (src === undefined) return undefined
  const out = { type: 'image', src }
  const alt = toOptionalText(block.alt, 300)
  const caption = toOptionalText(block.caption, 300)
  put(out, 'alt', alt === undefined ? caption : alt)
  put(out, 'caption', caption)
  const height = toNumber(block.height)
  out.height = height === undefined
    ? 240
    : Math.max(80, Math.min(640, Math.round(height)))
  if (block.fit === 'cover') out.fit = 'cover'
  return out
}

// --- registry --------------------------------------------------------------

/**
 * One entry per block type. `purpose` is the compact directory copy that makes
 * each type discoverable from the tool description; `shape`/`note`/`fields`/
 * `example` are the exact contract returned on demand by `render_ui_blocks`.
 * `dock` marks blocks a compact dock board may carry.
 */
export const BLOCKS = [
  {
    type: 'text',
    purpose: 'paragraph',
    shape: '{text, muted?}',
    note: 'paragraph; inline marks allowed.',
    example: { type: 'text', text: 'All **three** services are healthy.' },
    dock: true,
    normalize: normalizeText,
  },
  {
    type: 'heading',
    purpose: 'section title',
    shape: '{text, level?: 1|2|3}',
    note: 'section heading.',
    example: { type: 'heading', text: 'Services', level: 2 },
    dock: true,
    normalize: normalizeHeading,
  },
  {
    type: 'callout',
    purpose: 'tinted notice',
    shape: '{tone?, title?, text}',
    note: 'tinted notice box.',
    example: { type: 'callout', tone: 'info', title: 'Note', text: 'Rolling out at 14:00.' },
    dock: true,
    normalize: normalizeCallout,
  },
  {
    type: 'stats',
    purpose: 'metric grid',
    shape: '{items: [{label, value: string|number, hint?, delta?, tone?}]}',
    note: 'metric grid.',
    fields: ['value accepts a number or a short string such as "212 ms".'],
    example: { type: 'stats', items: [{ label: 'Pods ready', value: '12/12', tone: 'success' }, { label: 'P95', value: '212 ms', delta: '-8%' }] },
    dock: true,
    normalize: normalizeStats,
  },
  {
    type: 'table',
    purpose: 'data table',
    shape: '{columns: string[], rows: (string|number|null)[][], align?: (left|center|right)[], caption?}',
    note: 'data table.',
    fields: [
      'rows are padded or truncated to the column count; at most ' + CAPS.tableRows + ' rows.',
      'align is per column; caption is one line under the table.',
    ],
    example: { type: 'table', columns: ['Service', 'Status', 'CPU'], rows: [['api', 'healthy', '41%'], ['worker', 'healthy', '63%']], align: ['left', 'left', 'right'] },
    dock: false,
    normalize: normalizeTable,
  },
  {
    type: 'keyvalue',
    purpose: 'spec sheet',
    shape: '{items: [{key, value}], columns?: 1|2}',
    note: 'key-value spec sheet.',
    example: { type: 'keyvalue', items: [{ key: 'Region', value: 'eu-west-1' }, { key: 'Runtime', value: 'Node 22' }], columns: 2 },
    dock: false,
    normalize: normalizeKeyvalue,
  },
  {
    type: 'list',
    purpose: 'bullets',
    shape: '{ordered?: boolean, items: string[]}',
    note: 'bullets or a numbered list.',
    example: { type: 'list', ordered: true, items: ['Build', 'Test', 'Deploy'] },
    dock: true,
    normalize: normalizeList,
  },
  {
    type: 'badges',
    purpose: 'tags',
    shape: '{items: [{label, tone?}]}',
    note: 'compact tags.',
    example: { type: 'badges', items: [{ label: 'stable', tone: 'success' }, { label: 'canary', tone: 'warn' }] },
    dock: true,
    normalize: normalizeBadges,
  },
  {
    type: 'progress',
    purpose: 'progress bars',
    shape: '{items: [{label, value: number (0..1), caption?, tone?}]}',
    note: 'progress bars.',
    fields: ['value is clamped to 0..1; 1 renders a check mark.'],
    example: { type: 'progress', items: [{ label: 'Migrated', value: 0.72, caption: '18/25' }] },
    dock: true,
    normalize: normalizeProgress,
  },
  {
    type: 'bars',
    purpose: 'bar chart',
    shape: '{title?, items: [{label, value: number, tone?}], direction?, max?, unit?}',
    note: 'bar chart: horizontal rows by default, vertical columns with direction "vertical".',
    fields: ['`direction` is "vertical" for columns (short series) or omitted for horizontal rows (ranked lists).'],
    example: { type: 'bars', title: 'Requests', items: [{ label: 'api', value: 42 }, { label: 'web', value: 18 }], unit: 'k' },
    dock: false,
    normalize: normalizeBars,
  },
  {
    type: 'sparkline',
    purpose: 'trend line',
    shape: '{title?, values: number[], labels?: string[], unit?, tone?}',
    note: 'inline trend line.',
    fields: ['at most ' + CAPS.sparklineValues + ' values; labels, when given, align to values.'],
    example: { type: 'sparkline', title: 'Latency', values: [212, 199, 187, 190], unit: 'ms', tone: 'brand' },
    dock: false,
    normalize: normalizeSparkline,
  },
  {
    type: 'pie',
    purpose: 'pie chart',
    shape: '{title?, items: [{label, value: number, tone?}], unit?, donut?}',
    note: 'donut chart with a legend; `donut: false` fills the centre into a pie.',
    fields: [
      'values are shares of their own total; at most ' + CAPS.pieSlices + ' slices.',
      'tones colour slices; untinted slices fall back to a neutral ramp.',
    ],
    example: { type: 'pie', title: 'Traffic', items: [{ label: 'api', value: 62 }, { label: 'web', value: 27, tone: 'brand' }, { label: 'jobs', value: 11 }], unit: '%' },
    dock: false,
    normalize: normalizePie,
  },
  {
    type: 'code',
    purpose: 'source block',
    shape: '{code, language?, title?}',
    note: 'monospace block with its own scroll.',
    fields: ['at most ' + CAPS.codeChars + ' characters; no inline marks inside code.'],
    example: { type: 'code', language: 'bash', title: 'Deploy', code: 'dsh deploy --prod' },
    dock: false,
    normalize: normalizeCode,
  },
  {
    type: 'quote',
    purpose: 'pull quote',
    shape: '{text, by?}',
    note: 'pull quote with optional attribution.',
    example: { type: 'quote', text: 'Ship small, ship often.', by: 'Release notes' },
    dock: false,
    normalize: normalizeQuote,
  },
  {
    type: 'timeline',
    purpose: 'steps',
    shape: '{items: [{title, text?, time?, tone?}]}',
    note: 'steps or history.',
    example: { type: 'timeline', items: [{ title: 'Build', text: 'green', time: '14:02' }, { title: 'Deploy', text: 'running', time: '14:05' }] },
    dock: false,
    normalize: normalizeTimeline,
  },
  {
    type: 'links',
    purpose: 'links',
    shape: '{items: [{label, href, description?}]}',
    note: 'links; href must be http(s) or mailto.',
    fields: ['other schemes (javascript:, data:) are dropped; the card never renders them.'],
    example: { type: 'links', items: [{ label: 'Runbook', href: 'https://example.com/runbook', description: 'On-call steps' }] },
    dock: false,
    normalize: normalizeLinks,
  },
  {
    type: 'actions',
    purpose: 'next-step buttons',
    shape: '{items: [{label, prompt, tone?: primary|default}]}',
    note: 'buttons that put `prompt` into the composer draft.',
    fields: [
      'the prompt is placed in the composer, never sent automatically.',
      'at most ' + CAPS.actions + ' buttons.',
    ],
    example: { type: 'actions', items: [{ label: '查看日志', prompt: '查看这次部署的日志', tone: 'primary' }] },
    dock: false,
    normalize: normalizeActions,
  },
  {
    type: 'divider',
    purpose: 'hairline',
    shape: '{}',
    note: 'hairline separator.',
    example: { type: 'divider' },
    dock: false,
    normalize: normalizeDivider,
  },
  {
    type: 'live',
    purpose: 'live counters',
    shape: '{field: "messages"|"tools"|"last-message", label?, limit?}',
    note: 'live counter or message feed.',
    fields: ['only meaningful in a dock card, where it refreshes as the conversation continues.'],
    example: { type: 'live', field: 'messages', label: 'messages', limit: 5 },
    dock: true,
    normalize: normalizeLive,
  },
  {
    type: 'controls',
    purpose: 'settings',
    shape: '{title?, items: [{kind:"setting", setting:"theme"|"locale", label?, options:[{value, label}]}, {kind:"button", label, action:{kind:"setting", setting, value} | {kind:"prompt", prompt, send?}}]}',
    note: 'interactive controls.',
    fields: [
      'a setting control writes the bound DSH setting (theme/locale) and stays in sync.',
      'a prompt button fills the composer; send:true submits it through normal tool approvals.',
      'at most 8 items and 6 options per setting.',
    ],
    example: { type: 'controls', title: '偏好', items: [{ kind: 'setting', setting: 'theme', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }] }] },
    dock: false,
    normalize: normalizeControls,
  },
  {
    type: 'diagram',
    purpose: 'flowchart / UML diagram',
    shape: '{kind: "flowchart"|"sequence"|"class"|"state"|"er", title?, direction?: "TB"|"LR", nodes?, edges?, participants?, messages?}',
    note: 'flowchart or UML diagram rendered as SVG.',
    fields: [
      'flowchart/state: nodes [{id, label, shape?, tone?, detail?}] plus edges [{from, to, label?, style?, arrow?}]; direction defaults to LR.',
      'sequence: participants [{id, label, tone?}] plus messages [{from, to, label?, style?: sync|return|async}].',
      'class/er: nodes also carry fields and methods arrays, one string per compartment line.',
      'caps: ' + DIAGRAM_CAPS.nodes + ' nodes, ' + DIAGRAM_CAPS.edges + ' edges, ' + DIAGRAM_CAPS.participants + ' participants, ' + DIAGRAM_CAPS.messages + ' messages; edges with unknown endpoints are dropped.',
      'put one diagram per card: a second diagram belongs in a second card.',
      'a diagram card toggles between the chart and its source; do not emit ```mermaid fences, use this block instead.',
    ],
    example: {
      type: 'diagram',
      kind: 'flowchart',
      title: 'Deploy flow',
      nodes: [{ id: 'req', label: 'Request' }, { id: 'build', label: 'Build' }, { id: 'ok', label: 'Deploy', shape: 'round', tone: 'success' }],
      edges: [{ from: 'req', to: 'build' }, { from: 'build', to: 'ok', label: 'green' }],
    },
    dock: false,
    normalize: normalizeDiagram,
  },
  {
    type: 'tree',
    purpose: 'hierarchy tree',
    shape: '{title?, nodes: [{label, note?, badge?, tone?, children?: [...]}]}',
    note: 'indented tree for file layouts, taxonomies, or decision paths.',
    fields: [
      'nested `children` at most ' + CAPS.treeDepth + ' levels deep; up to ' + CAPS.treeNodes + ' nodes total.',
      'note is one secondary line; badge is a short trailing tag.',
    ],
    example: { type: 'tree', title: 'Repo', nodes: [{ label: 'src', children: [{ label: 'client.js', badge: '6.9k' }, { label: 'index.js' }] }] },
    dock: false,
    normalize: normalizeTree,
  },
  {
    type: 'heatmap',
    purpose: 'activity heatmap',
    shape: '{title?, columns?, items: [{label?, value, tone?}], unit?, max?}',
    note: 'grid of intensity cells (contribution calendar, load by hour).',
    fields: [
      'items are laid out row-major; `columns` (1–53) fixes the row width, default fills the card.',
      '`max` fixes the intensity scale; without it the largest value is the strongest cell.',
      'at most ' + CAPS.heatmapCells + ' cells.',
    ],
    example: { type: 'heatmap', title: 'Deploys', columns: 14, unit: ' deploys', items: [{ label: '10/21', value: 3 }, { label: '10/22', value: 0 }] },
    dock: false,
    normalize: normalizeHeatmap,
  },
  {
    type: 'diff',
    purpose: 'code diff',
    shape: '{title?, path?, language?, lines: [{kind: "add"|"del"|"ctx", text}]}',
    note: 'patch view with added and removed lines; no syntax highlighting.',
    fields: ['at most ' + CAPS.diffLines + ' lines; an unknown kind renders as context.'],
    example: { type: 'diff', title: 'Retry policy', path: 'src/config.js', lines: [{ kind: 'ctx', text: 'retries: 3,' }, { kind: 'del', text: 'timeout: 30,' }, { kind: 'add', text: 'timeout: 45,' }] },
    dock: false,
    normalize: normalizeDiff,
  },
  {
    type: 'kanban',
    purpose: 'kanban board',
    shape: '{title?, columns: [{title, tone?, cards: [{title, text?, badges?, tone?}]}]}',
    note: 'board of columns and cards for status overviews.',
    fields: ['at most ' + CAPS.kanbanColumns + ' columns and ' + CAPS.kanbanCards + ' cards per column; badges are short strings (max 4).'],
    example: { type: 'kanban', title: 'Sprint', columns: [{ title: 'Todo', cards: [{ title: 'Rate limit', badges: ['P1'] }] }, { title: 'Done', cards: [{ title: 'Retry', tone: 'success' }] }] },
    dock: false,
    normalize: normalizeKanban,
  },
  {
    type: 'tabs',
    purpose: 'tabbed panes',
    shape: '{title?, items: [{label, blocks: [Block, ...]}]}',
    note: 'a tab bar with one visible pane; the reader switches locally.',
    fields: [
      'at most ' + CAPS.tabs + ' tabs, ' + CAPS.tabBlocks + ' blocks per tab; a tab may not contain another tab or a column.',
      'use it to keep several views in one card instead of stacking them; pick the first tab as the most important view.',
    ],
    example: { type: 'tabs', title: 'Services', items: [{ label: 'API', blocks: [{ type: 'stats', items: [{ label: 'p95', value: '212 ms' }] }] }, { label: 'Worker', blocks: [{ type: 'stats', items: [{ label: 'queue', value: 12 }] }] }] },
    dock: false,
    normalize: normalizeTabs,
  },
  {
    type: 'columns',
    purpose: 'side-by-side columns',
    shape: '{title?, items: [{label?, blocks: [Block, ...]}], weights?: number[]}',
    note: 'block groups side by side; collapses to one column on a narrow card.',
    fields: [
      'at most ' + CAPS.columns + ' columns, ' + CAPS.columnBlocks + ' blocks per column; a column may not contain a tab or another column.',
      'use it to shorten a card: paired short blocks read faster than a stack of full-width rows.',
      'omit `label` unless the column needs its own caption.',
      '`weights` gives each column 1–3 shares (integers, one per column; defaults to equal). Keep charts, tables and diagrams on 2 and text on 1 instead of splitting every row in half — an unequal row is often both prettier and denser.',
    ],
    example: { type: 'columns', weights: [2, 1], items: [{ label: '趋势', blocks: [{ type: 'sparkline', values: [240, 228, 231, 219] }] }, { label: '说明', blocks: [{ type: 'list', items: ['延迟连续 3 天下降'] }] }] },
    dock: false,
    normalize: normalizeColumns,
  },
  {
    type: 'image',
    purpose: 'inline image',
    shape: '{src, alt?, caption?, height?: 80..640, fit?: "cover"|"contain"}',
    note: 'inline image from an https URL or a data: URI; the only block that may load a remote resource.',
    fields: [
      'src must be http(s) or data:image/*; every other scheme is dropped (no javascript:, file:, blob:).',
      'inline data URIs are capped at ' + CAPS.imageChars + ' characters; a workspace file has no URL the card can read, so inline it or host it.',
      'height defaults to 240 and is clamped to 80–640; fit "cover" crops to the frame, "contain" letterboxes.',
      'the frame sends no referrer, loads lazily, and falls back to a notice tile when the image fails.',
      'a remote src is the reader’s browser fetching that host: remove `image` from the row config to forbid the type entirely.',
    ],
    example: { type: 'image', src: 'https://images.example.com/chart.png', alt: 'P95 over 8 days', caption: 'Latency trend', height: 220 },
    dock: false,
    normalize: normalizeImage,
  },
  {
    type: 'html',
    purpose: 'sandboxed HTML/CSS/SVG visual',
    shape: '{html, title?, caption?, height?: ' + HTML_CAPS.heightMin + '..' + HTML_CAPS.heightMax + '}',
    note: 'arbitrary self-contained HTML, CSS and SVG (plus JS) rendered in a sandboxed frame: no network, no access to the app, theme tokens available as CSS variables.',
    fields: [
      'html: one self-contained fragment (up to ' + CAPS.htmlChars + ' chars); a full <!doctype html> document is accepted too.',
      'height: frame height in px, ' + HTML_CAPS.heightMin + '–' + HTML_CAPS.heightMax + ' (default ' + HTML_CAPS.heightDefault + ').',
      'sandbox: scripts run, but the frame cannot reach the network (no fetch, no remote img/script/font), storage, cookies, popups, top navigation, or the app itself.',
      'theme: --dsw-alias-bg-base, -bg-layer-1, -bg-layer-2, -bg-overlay, -border-l1, -border-l2, -brand-primary, -label-primary, -label-secondary, -state-success-primary, -state-warn-primary, -state-error-primary, -state-idle-primary are defined inside the frame.',
      'reduced motion: the frame neutralizes CSS animations and transitions when the reader asked for less motion.',
      'prefer native blocks for ordinary content; use `html` when the visual itself is the answer (a custom animation, a mini demo, a bespoke SVG).',
    ],
    example: {
      type: 'html',
      title: 'Breathe',
      height: 160,
      html: '<div style="height:160px;display:flex;align-items:center;justify-content:center">'
        + '<div style="width:48px;height:48px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:b 1.6s ease-in-out infinite"></div>'
        + '</div><style>@keyframes b{50%{transform:scale(1.25);opacity:.6}}</style>',
    },
    dock: false,
    normalize: normalizeHtml,
  },
]

/** Every block type in documentation order: the wire enum. */
export const BLOCK_TYPES = BLOCKS.map((block) => block.type)

/** Registry lookup by wire type; the only normalization dispatch table. */
export const BLOCK_REGISTRY = new Map(BLOCKS.map((block) => [block.type, block]))

/**
 * Wire-type aliases: a content field name written as a block `type`.
 *
 * The tool description advertises the auto-layout `content` fields (`note`,
 * `summary`, `metrics`, …), so a model now and then puts one of those names in
 * an explicit block. The material is right and only the name is wrong, so the
 * alias folds it onto the physical block that renders the same thing; `tone`
 * supplies the field's own default when the block carries none. A type a plugin
 * registered wins over its alias, because the direct lookup runs first.
 *
 * @type {Map<string, { type: string, tone?: string }>}
 */
export const BLOCK_ALIASES = new Map([
  ['note', { type: 'callout', tone: 'warn' }],
  ['summary', { type: 'callout', tone: 'info' }],
  ['notice', { type: 'callout', tone: 'info' }],
  ['metrics', { type: 'stats' }],
  ['series', { type: 'sparkline' }],
  ['breakdown', { type: 'pie' }],
  ['items', { type: 'list' }],
  ['bullets', { type: 'list' }],
  ['steps', { type: 'timeline' }],
  ['facts', { type: 'keyvalue' }],
  ['tags', { type: 'badges' }],
  ['flow', { type: 'diagram' }],
])

/**
 * Resolve a wire block type to the registered type that renders it, following
 * an alias when the name is a content field rather than a block type.
 *
 * @param {unknown} type wire block type.
 * @returns {string|undefined} canonical type, or undefined when nothing renders it.
 */
export function resolveBlockType(type) {
  if (typeof type !== 'string') return undefined
  if (BLOCK_REGISTRY.has(type)) return type
  const alias = BLOCK_ALIASES.get(type)
  return alias === undefined ? undefined : alias.type
}

/** Block types a compact dock board may carry: the board is a glance, not a report. */
export const DOCK_BLOCKS = BLOCKS.filter((block) => block.dock === true).map((block) => block.type)

/**
 * Resolve a config-supplied allow-list into a documentation-ordered type list.
 *
 * An absent list means every type; an empty or fully unknown list also falls
 * back to every type so a typo cannot disable the tool.
 *
 * @param {unknown} allowedBlocks config value, usually an array of type names.
 * @returns {string[]} enabled types in documentation order.
 */
export function resolveTypes(allowedBlocks) {
  if (!Array.isArray(allowedBlocks)) return BLOCK_TYPES
  const requested = new Set()
  for (const type of allowedBlocks) {
    if (typeof type === 'string' && BLOCK_REGISTRY.has(type)) requested.add(type)
  }
  const types = BLOCK_TYPES.filter((type) => requested.has(type))
  return types.length > 0 ? types : BLOCK_TYPES
}

/**
 * Resolve the config-supplied block cap.
 *
 * @param {unknown} value config value.
 * @returns {number} a whole number between 1 and `CAPS.blocks`.
 */
export function resolveMaxBlocks(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CAPS.blocks
  return Math.max(1, Math.min(CAPS.blocks, Math.floor(value)))
}

/**
 * Normalize one block through the registry, following a content-field alias.
 * @param {string} type wire block type.
 * @param {Record<string, unknown>} block raw block.
 * @returns {Record<string, unknown>|undefined} normalized block or undefined.
 */
export function normalizeBlock(type, block) {
  const alias = typeof type === 'string' ? BLOCK_ALIASES.get(type) : undefined
  const entry = BLOCK_REGISTRY.get(alias === undefined ? type : alias.type)
  if (entry === undefined) return undefined
  const source = alias !== undefined && alias.tone !== undefined && block.tone === undefined
    ? Object.assign({}, block, { tone: alias.tone })
    : block
  const normalized = entry.normalize(source)
  if (normalized === undefined) return undefined
  const motion = normalizeMotion(block.motion)
  return motion === undefined ? normalized : Object.assign({}, normalized, { motion })
}

// --- model-facing text -----------------------------------------------------
// Progressive disclosure: the tool description carries a compact directory of
// type names and purposes; exact shapes, notes, and examples are returned on
// demand by the `render_ui_blocks` tool.

/** Directory layout: which block types share a line, in reading order. */
const DIRECTORY_GROUPS = [
  ['text', 'heading', 'callout', 'stats', 'table', 'keyvalue', 'list'],
  ['badges', 'progress', 'bars', 'sparkline', 'code', 'quote', 'timeline'],
  ['links', 'actions', 'divider', 'live', 'controls'],
]

/**
 * Build the compact block directory for the tool description.
 * @param {Iterable<string>} types block types to include (config may narrow them).
 * @returns {string[]} one line per directory group.
 */
export function blockDirectoryLines(types) {
  const allowed = new Set(types)
  const lines = []
  const grouped = new Set()
  const describe = (type) => '`' + type + '` ' + BLOCK_REGISTRY.get(type).purpose
  for (const group of DIRECTORY_GROUPS) {
    const parts = group.filter((type) => {
      if (!allowed.has(type)) return false
      grouped.add(type)
      return true
    })
    if (parts.length > 0) lines.push('- ' + parts.map(describe).join(' · '))
  }
  // Types registered after the documentation groups were written still surface:
  // the directory is generated, so a new block type needs no second list.
  const extras = types.filter((type) => allowed.has(type) && !grouped.has(type))
  if (extras.length > 0) lines.push('- ' + extras.map(describe).join(' · '))
  return lines
}

/**
 * Build the exact contract of one block type.
 * @param {string} type wire block type.
 * @returns {string|null} contract text, or null for an unknown type.
 */
export function blockContractText(type) {
  const entry = BLOCK_REGISTRY.get(type)
  if (entry === undefined) return null
  const lines = ['`' + entry.type + '` ' + entry.shape + ' — ' + entry.note]
  if (Array.isArray(entry.fields)) {
    for (const field of entry.fields) lines.push('  - ' + field)
  }
  lines.push('  - example: ' + JSON.stringify(entry.example))
  return lines.join('\n')
}

/**
 * Build the contract of every requested block type.
 * @param {Iterable<string>} types block types in documentation order.
 * @returns {string} contract text, one blank line between types.
 */
export function blockContractCatalog(types) {
  const parts = []
  for (const type of types) {
    const text = blockContractText(type)
    if (text !== null) parts.push(text)
  }
  parts.push('Any block may also carry an optional `motion` object; call `' + BLOCKS_TOOL_NAME + '` with type "' + MOTION_LOOKUP + '" for the animation vocabulary.')
  return parts.join('\n\n')
}

/** The `render_ui_blocks` keyword that returns the motion vocabulary. */
export const MOTION_LOOKUP = 'motion'

/**
 * Contract text for the optional `motion` object on any block.
 *
 * Animation stays declarative on purpose: the model names a preset, the Client
 * owns the CSS, so a card cannot inject a stylesheet, cannot leave a global
 * effect behind, and replays identically from the session log.
 *
 * @returns {string} contract text, one effect per line.
 */
export function motionContractText() {
  const lines = [
    '`motion` (optional, on any block) — one preset animation of that block’s own content. These names are the whole vocabulary; never write CSS.',
    '  - shape: { "effect": ' + MOTION_EFFECTS.map((effect) => '"' + effect + '"').join(' | ') + ', "duration"?: 200–' + MOTION_LIMITS.duration[1] + ' ms, "delay"?: 0–' + MOTION_LIMITS.delay[1] + ' ms, "loop"?: boolean }',
  ]
  for (const effect of MOTION_EFFECTS) lines.push('  - `' + effect + '`: ' + MOTION_MEANING[effect])
  lines.push('  - defaults: duration ' + MOTION_DEFAULTS.duration + ' ms, delay ' + MOTION_DEFAULTS.delay + ' ms, loop false; use `loop: true` for `pulse` and `flow`, not for text')
  lines.push('  - fit: `sweep` needs `progress` or `bars`, `draw`/`flow` need `diagram` or `sparkline`; on another block the effect does nothing')
  lines.push('  - example: {"type":"progress","items":[{"label":"构建","value":0.6}],"motion":{"effect":"sweep","duration":1200}}')
  lines.push('  - motion is decoration: an unknown effect renders the block statically instead of dropping it, and reduced-motion readers always see it still')
  return lines.join('\n')
}
