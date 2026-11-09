/**
 * Auto layout: turn a content spec into concrete card blocks.
 *
 * A model that knows *what* to show but not *which control* fits can pass a
 * `content` object instead of a `blocks` array. This module picks the block
 * type per content field (metric grid, table, sparkline, columns, timeline,
 * tabs, …) and arranges the result: summary first, actions last, ordinary blocks
 * stacked, and 2–3 sections laid out side by side (4–5 as tabs).
 *
 * The Client half mirrors these decisions line for line, because a card is
 * rebuilt from the recorded call arguments rather than from a Host-side
 * artifact. The parity test pins the two implementations to the same output
 * for the same content.
 *
 * This module imports only `./shared.js`; it has no side effects.
 */

import {
  CAPS,
  isPlainObject,
  put,
  toArray,
  toNumber,
  toOptionalText,
  toText,
  toTone,
} from './shared.js'

/** The `render_ui_blocks` keyword that returns the content contract. */
export const CONTENT_LOOKUP = 'content'

/** Content fields the derivation understands, in documentation order. */
export const CONTENT_FIELDS = [
  'summary',
  'metrics',
  'series',
  'breakdown',
  'table',
  'steps',
  'items',
  'facts',
  'tags',
  'code',
  'quote',
  'links',
  'image',
  'tree',
  'flow',
  'note',
  'sections',
  'blocks',
  'actions',
]

/**
 * Blocks that genuinely need the wider share inside a section row: a table,
 * diagram or code column loses its meaning when squeezed, while a chart scales
 * with its frame and reads fine at half width. So a section that carries one of
 * these takes two shares; a chart or text section stays at one.
 */
const WIDE_TYPES = new Set([
  'table',
  'heatmap',
  'kanban',
  'diagram',
  'code',
  'image',
  'html',
  'tree',
  'tabs',
])

/**
 * Rough rendered height of a block, in px. Only used to decide whether two
 * sections can share a row: splitting a tall section against a short one leaves
 * a hole under the short side, which reads worse than a full-width stack.
 */
const BLOCK_HEIGHT = {
  text: 44,
  heading: 28,
  callout: 64,
  stats: 92,
  table: 0, // row-counted below
  keyvalue: 0,
  list: 0,
  badges: 34,
  progress: 0,
  bars: 0,
  sparkline: 118,
  pie: 176,
  code: 0,
  quote: 64,
  timeline: 0,
  links: 0,
  actions: 40,
  divider: 1,
  live: 60,
  controls: 84,
  diagram: 176,
  tree: 0,
  heatmap: 96,
  diff: 120,
  kanban: 132,
  tabs: 148,
  columns: 140,
  image: 0,
  html: 200,
}

/** Row height of one table/diff/code line, in px. */
const LINE_HEIGHT = 26

/** Facts a tile grid still holds; past this the sheet becomes rows. */
const KV_TILE_MAX_ITEMS = 6
/** Longest key a tile still holds on one line without squeezing its value. */
const KV_TILE_MAX_KEY = 16
/** Longest value a tile still holds before it reads as a sentence. */
const KV_TILE_MAX_VALUE = 28

/**
 * Choose how a `keyvalue` block lays its facts out.
 *
 * Mirrors `kvLayout` in the Client half: up to four short facts are a tile
 * grid, anything longer is a label/value row sheet. The Host only needs the
 * shape to estimate a height; the Client makes the same call to render it.
 *
 * @param {Array<{ key: string, value: unknown }>} items normalized items.
 * @param {1|2|undefined} columns the block's explicit column request.
 * @returns {{ layout: 'tiles'|'rows', cols: number }} chosen layout.
 */
function kvLayout(items, columns) {
  const list = Array.isArray(items) ? items : []
  if (columns === 1) return { layout: 'tiles', cols: 1 }
  if (list.length > KV_TILE_MAX_ITEMS) return { layout: 'rows', cols: 2 }
  let longestKey = 0
  let longestValue = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const keyLength = typeof item.key === 'string' ? item.key.length : 0
    const valueLength = item.value === undefined || item.value === null ? 0 : String(item.value).length
    if (keyLength > longestKey) longestKey = keyLength
    if (valueLength > longestValue) longestValue = valueLength
  }
  if (longestKey > KV_TILE_MAX_KEY || longestValue > KV_TILE_MAX_VALUE) return { layout: 'rows', cols: 2 }
  const cols = list.length === 4 ? 2 : list.length >= 5 ? 3 : Math.max(1, list.length)
  return { layout: 'tiles', cols }
}

/**
 * Estimate one `keyvalue` block's height from the layout it will use.
 * @param {Record<string, unknown>} block raw block.
 * @returns {number} estimated px.
 */
function factHeight(block) {
  const items = toArray(block.items).length
  const layout = kvLayout(toArray(block.items), block.columns)
  return layout.layout === 'rows' ? items * 27 : Math.ceil(items / Math.max(1, layout.cols)) * 38
}

/**
 * Estimate the rendered height of one raw block.
 * @param {Record<string, unknown>} block raw block.
 * @returns {number} estimated px.
 */
function blockHeight(block) {
  const type = typeof block.type === 'string' ? block.type : ''
  switch (type) {
    case 'table': return 34 + toArray(block.rows).length * LINE_HEIGHT
    case 'keyvalue': return factHeight(block)
    case 'list': return toArray(block.items).length * 24 + 4
    case 'progress': return toArray(block.items).length * 30
    case 'bars': return toArray(block.items).length * 26
    case 'timeline': return toArray(block.items).length * 34
    case 'links': return toArray(block.items).length * 44
    case 'tree': return Math.min(10, countTreeNodes(block.nodes)) * 24 + 8
    case 'code': return 40 + Math.min(14, String(block.code || '').split('\n').length) * 17
    case 'image': return 320
    default: return BLOCK_HEIGHT[type] === undefined ? 60 : BLOCK_HEIGHT[type]
  }
}

/**
 * Count tree nodes, bounded.
 * @param {unknown} nodes raw node list.
 * @returns {number}
 */
function countTreeNodes(nodes) {
  let count = 0
  const walk = (list) => {
    for (const raw of toArray(list)) {
      if (count >= 10) return
      if (!isPlainObject(raw)) continue
      count += 1
      walk(raw.children)
    }
  }
  walk(nodes)
  return count
}

/**
 * Whether two or three sections have comparable heights, so a side-by-side row
 * does not leave one column half empty.
 * @param {{ blocks: Record<string, unknown>[] }[]} sections laid-out sections.
 * @returns {boolean} true when the tallest section is at most 2.2× the shortest.
 */
function sectionsCanSplit(sections) {
  if (sections.length < 2) return false
  const heights = sections.map((section) => {
    let total = 0
    for (const block of section.blocks) total += blockHeight(block)
    return total + Math.max(0, section.blocks.length - 1) * 11
  })
  const max = Math.max.apply(null, heights)
  const min = Math.min.apply(null, heights)
  if (max <= 0) return false
  return max / Math.max(1, min) <= 2.2
}

/** Layout modes: `auto` arranges, `stack` keeps one block per row. */
export const LAYOUTS = ['auto', 'stack']

/**
 * Build the allow test for a type list. `null` means every type is enabled.
 * @param {unknown} types resolved type list or undefined.
 * @returns {(type: string) => boolean} allow predicate.
 */
function makeAllow(types) {
  if (!Array.isArray(types) || types.length === 0) return () => true
  const allowed = new Set(types)
  return (type) => allowed.has(type)
}

/**
 * Coerce a scalar to bounded text.
 * @param {unknown} value candidate.
 * @param {number} [max] character cap.
 * @returns {string|undefined} text or undefined when empty.
 */
function text(value, max) {
  return toOptionalText(value, max)
}

/**
 * Read one labeled value list from either an array of objects or a plain map.
 * @param {unknown} value array, object map, or a single scalar.
 * @param {string} labelKey key that holds the label in array form.
 * @returns {Array<Record<string, unknown>>} raw item objects.
 */
function toItems(value, labelKey) {
  if (Array.isArray(value)) return value.filter(isPlainObject)
  if (isPlainObject(value)) {
    const items = []
    for (const label of Object.keys(value)) items.push({ [labelKey]: label, value: value[label] })
    return items
  }
  return []
}

/**
 * Read a numeric series, accepting numbers, numeric strings, and `{label,value}`
 * points (the label becomes the point label).
 * @param {unknown} value raw series.
 * @returns {{ values: number[], labels: string[] }} numbers and their labels.
 */
function readSeries(value) {
  const values = []
  const labels = []
  for (const raw of toArray(value)) {
    if (isPlainObject(raw)) {
      const number = toNumber(raw.value)
      if (number === undefined) continue
      values.push(number)
      labels.push(toText(raw.label, 60))
      continue
    }
    const number = toNumber(raw)
    if (number === undefined) continue
    values.push(number)
    labels.push('')
  }
  return { values, labels }
}

/**
 * Derive the block list of a content spec.
 *
 * Field order is the layout order, except that `summary` always opens the card
 * and `actions` always closes it. Unknown fields are ignored.
 *
 * @param {unknown} content raw `content` object.
 * @param {{ types?: string[], layout?: 'auto' | 'stack', depth?: number }} [options]
 *   `types` is the enabled block list (config), `layout` picks arrangement,
 *   `depth` guards the `sections` recursion.
 * @returns {Record<string, unknown>[]} raw blocks, ready for normalization.
 */
export function deriveContent(content, options) {
  if (!isPlainObject(content)) return []
  const settings = isPlainObject(options) ? options : {}
  const allow = makeAllow(settings.types)
  const layout = settings.layout === 'stack' ? 'stack' : 'auto'
  const depth = typeof settings.depth === 'number' && settings.depth > 0 ? settings.depth : 0
  const entries = []
  for (const key of Object.keys(content)) {
    const value = content[key]
    if (value === undefined || value === null) continue
    const blocks = deriveField(key, value, { allow, layout, depth, types: settings.types })
    if (blocks.length > 0) entries.push({ key, blocks })
  }
  if (entries.length === 0) return []
  const head = []
  const body = []
  const tail = []
  for (const entry of entries) {
    if (entry.key === 'summary') head.push(...entry.blocks)
    else if (entry.key === 'actions') tail.push(...entry.blocks)
    else body.push(...entry.blocks)
  }
  // Blocks stack in reading order: only `sections` (or an explicit `columns`
  // in `blocks`) turns part of a card into a side-by-side row. Auto-pairing
  // unrelated blocks read as two disconnected panels, so it is gone.
  return head.concat(body, tail)
}

/**
 * Share each section column receives: a section that carries a wide block takes
 * two shares, a text-only section one. All-equal stays implicit (1:1).
 * @param {{ blocks: Record<string, unknown>[] }[]} sections laid-out sections.
 * @returns {number[]|undefined} weights, or undefined for equal columns.
 */
function sectionWeights(sections) {
  const weights = sections.map((section) => (
    section.blocks.some((block) => WIDE_TYPES.has(block.type)) ? 2 : 1
  ))
  return weights.some((weight) => weight > 1) ? weights : undefined
}

/**
 * Derive the blocks of one content field.
 * @param {string} key field name.
 * @param {unknown} value field value.
 * @param {{ allow: (type: string) => boolean, layout: string, depth: number, types?: string[] }} context
 *   derivation context.
 * @returns {Record<string, unknown>[]} raw blocks (possibly empty).
 */
function deriveField(key, value, context) {
  switch (key) {
    case 'summary':
      return single(summaryBlock(value, 'info'))
    case 'note':
      return single(noteBlock(value))
    case 'metrics':
      return metricsBlocks(value, context.allow)
    case 'series':
      return seriesBlocks(value, context.allow)
    case 'breakdown':
      return breakdownBlocks(value, context.allow)
    case 'table':
      return tableBlocks(value, context.allow)
    case 'steps':
      return stepsBlocks(value, context.allow)
    case 'items':
      return itemsBlocks(value, context.allow)
    case 'facts':
      return factsBlocks(value, context.allow)
    case 'tags':
      return tagsBlocks(value, context.allow)
    case 'code':
      return codeBlocks(value, context.allow)
    case 'quote':
      return quoteBlocks(value, context.allow)
    case 'links':
      return linksBlocks(value, context.allow)
    case 'image':
      return imageBlocks(value, context.allow)
    case 'tree':
      return treeBlocks(value, context.allow)
    case 'flow':
      return flowBlocks(value, context.allow)
    case 'sections':
      return sectionBlocks(value, context)
    case 'blocks':
      return manualBlocks(value)
    case 'actions':
      return actionsBlocks(value, context.allow)
    default:
      return []
  }
}

/**
 * Wrap one optional block into a list.
 * @param {Record<string, unknown>|null} block normalized-ish raw block.
 * @returns {Record<string, unknown>[]} zero or one block.
 */
function single(block) {
  return block === null ? [] : [block]
}

/**
 * Build a callout block from a string or an object.
 * @param {unknown} value string or `{text, title?, tone?}`.
 * @param {string} defaultTone tone used when the value has none.
 * @returns {Record<string, unknown>|null} raw callout block.
 */
function summaryBlock(value, defaultTone) {
  if (typeof value === 'string' || typeof value === 'number') {
    const body = text(value)
    return body === undefined ? null : { type: 'callout', text: body, tone: defaultTone }
  }
  if (!isPlainObject(value)) return null
  const body = text(value.text)
  if (body === undefined) return null
  const block = { type: 'callout', text: body }
  put(block, 'title', text(value.title))
  const tone = toTone(value.tone)
  block.tone = tone === undefined ? defaultTone : tone
  return block
}

/**
 * Build the notice block of the `note` field.
 * @param {unknown} value string or `{text, title?, tone?}`.
 * @returns {Record<string, unknown>|null} raw callout block.
 */
function noteBlock(value) {
  return summaryBlock(value, 'warn')
}

/**
 * Build the metric block: a stat grid up to six values, a table above that.
 * @param {unknown} value item array or label→value map.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function metricsBlocks(value, allow) {
  const items = toItems(value, 'label')
  const usable = []
  for (const raw of items) {
    const label = text(raw.label, 60)
    if (label === undefined) continue
    const item = { label, value: raw.value }
    put(item, 'hint', text(raw.hint))
    put(item, 'delta', text(raw.delta))
    put(item, 'tone', toTone(raw.tone))
    usable.push(item)
  }
  if (usable.length === 0) return []
  if (allow('stats')) return [{ type: 'stats', items: usable }]
  if (allow('list')) {
    return [{ type: 'list', items: usable.map((item) => item.label + ' — ' + toText(item.value)) }]
  }
  return []
}

/**
 * Build the series block: a trend line for a real trend, columns for a short
 * labeled comparison.
 * @param {unknown} value `{values, labels?, title?, unit?, kind?}` or a number array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function seriesBlocks(value, allow) {
  const spec = Array.isArray(value) ? { values: value } : isPlainObject(value) ? value : null
  if (spec === null) return []
  const read = readSeries(spec.values)
  if (read.values.length === 0) return []
  const labels = Array.isArray(spec.labels) && spec.labels.length === read.values.length
    ? spec.labels.map((label) => toText(label, 60))
    : read.labels
  const hasLabels = labels.some((label) => label !== '')
  const explicit = spec.kind === 'compare' || spec.kind === 'bars'
    ? 'compare'
    : spec.kind === 'trend' || spec.kind === 'line'
      ? 'trend'
      : undefined
  const trend = explicit === undefined
    ? read.values.length >= 6 || !hasLabels
    : explicit === 'trend'
  if (trend && allow('sparkline')) {
    const block = { type: 'sparkline', values: read.values }
    if (hasLabels) block.labels = labels
    put(block, 'title', text(spec.title))
    put(block, 'unit', text(spec.unit, 40))
    put(block, 'tone', toTone(spec.tone))
    return [block]
  }
  if (allow('bars')) {
    const items = read.values.map((number, index) => {
      const label = labels[index] !== undefined && labels[index] !== '' ? labels[index] : String(index + 1)
      return { label, value: number }
    })
    const block = { type: 'bars', items }
    if (items.length <= 8) block.direction = 'vertical'
    put(block, 'title', text(spec.title))
    put(block, 'unit', text(spec.unit, 40))
    return [block]
  }
  if (allow('sparkline')) {
    const block = { type: 'sparkline', values: read.values }
    if (hasLabels) block.labels = labels
    put(block, 'title', text(spec.title))
    put(block, 'unit', text(spec.unit, 40))
    return [block]
  }
  return []
}

/**
 * Build the share block: a donut up to the slice cap, bars beyond it or on request.
 * @param {unknown} value `{items, title?, unit?, kind?}` or an item array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function breakdownBlocks(value, allow) {
  const spec = Array.isArray(value) ? { items: value } : isPlainObject(value) ? value : null
  if (spec === null) return []
  const items = toItems(spec.items, 'label')
  if (items.length === 0) return []
  const numeric = []
  for (const raw of items) {
    const value = toNumber(raw.value)
    if (value === undefined || value < 0) continue
    const label = text(raw.label, 60)
    if (label === undefined) continue
    const item = { label, value }
    put(item, 'tone', toTone(raw.tone))
    numeric.push(item)
  }
  if (numeric.length === 0) return []
  const wantsPie = spec.kind !== 'bars' && spec.kind !== 'columns'
  if (wantsPie && numeric.length <= CAPS.pieSlices && allow('pie')) {
    const block = { type: 'pie', items: numeric }
    put(block, 'title', text(spec.title))
    put(block, 'unit', text(spec.unit, 40))
    return [block]
  }
  if (allow('bars')) {
    const block = { type: 'bars', items: numeric }
    put(block, 'title', text(spec.title))
    put(block, 'unit', text(spec.unit, 40))
    return [block]
  }
  return allow('pie') ? [{ type: 'pie', items: numeric }] : []
}

/**
 * Build the table block.
 * @param {unknown} value `{columns, rows, align?, caption?}`.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function tableBlocks(value, allow) {
  if (!isPlainObject(value) || !allow('table')) return []
  const columns = []
  for (const raw of toArray(value.columns)) {
    const column = toText(raw).trim()
    if (column !== '') columns.push(column)
  }
  if (columns.length === 0) return []
  const block = { type: 'table', columns, rows: toArray(value.rows) }
  if (Array.isArray(value.align)) block.align = value.align
  put(block, 'caption', text(value.caption))
  return [block]
}

/**
 * Build the steps block as a timeline; plain strings are titles.
 * @param {unknown} value step array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function stepsBlocks(value, allow) {
  const items = []
  for (const raw of toArray(value)) {
    if (isPlainObject(raw)) {
      const title = text(raw.title, 120)
      if (title === undefined) continue
      const item = { title }
      put(item, 'text', text(raw.text))
      put(item, 'time', text(raw.time, 40))
      put(item, 'tone', toTone(raw.tone))
      items.push(item)
      continue
    }
    const title = text(raw, 120)
    if (title !== undefined) items.push({ title })
  }
  if (items.length === 0) return []
  if (allow('timeline')) return [{ type: 'timeline', items }]
  if (allow('list')) return [{ type: 'list', ordered: true, items: items.map((item) => item.title) }]
  return []
}

/**
 * Build the bullets block.
 * @param {unknown} value string array (or `{text}` items).
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function itemsBlocks(value, allow) {
  const items = []
  for (const raw of toArray(value)) {
    const body = isPlainObject(raw) ? text(raw.text) : text(raw)
    if (body !== undefined) items.push(body)
  }
  if (items.length === 0) return []
  if (allow('list')) return [{ type: 'list', items }]
  if (allow('text')) return [{ type: 'text', text: items.join(' · ') }]
  return []
}

/**
 * Build the spec-sheet block, two facts per row up to eight.
 * @param {unknown} value `{key: value}` map or `{key, value}` item array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function factsBlocks(value, allow) {
  const items = []
  for (const raw of toItems(value, 'key')) {
    const key = text(raw.key, 60)
    if (key === undefined) continue
    items.push({ key, value: toText(raw.value) })
  }
  if (items.length === 0) return []
  if (allow('keyvalue')) {
    return [{ type: 'keyvalue', items }]
  }
  if (allow('list')) {
    return [{ type: 'list', items: items.map((item) => item.key + ': ' + item.value) }]
  }
  return []
}

/**
 * Build the tags block.
 * @param {unknown} value string array or `{label, tone?}` item array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function tagsBlocks(value, allow) {
  const items = []
  for (const raw of toArray(value)) {
    if (isPlainObject(raw)) {
      const label = text(raw.label, 40)
      if (label === undefined) continue
      const item = { label }
      put(item, 'tone', toTone(raw.tone))
      items.push(item)
      continue
    }
    const label = text(raw, 40)
    if (label !== undefined) items.push({ label })
  }
  if (items.length === 0) return []
  return allow('badges') ? [{ type: 'badges', items }] : []
}

/**
 * Build the code block.
 * @param {unknown} value source string or `{code, language?, title?}`.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function codeBlocks(value, allow) {
  if (!allow('code')) return []
  if (typeof value === 'string') {
    const code = value.slice(0, CAPS.codeChars)
    return code === '' ? [] : [{ type: 'code', code }]
  }
  if (!isPlainObject(value)) return []
  const code = typeof value.code === 'string' ? value.code : typeof value.source === 'string' ? value.source : ''
  if (code === '') return []
  const block = { type: 'code', code: code.slice(0, CAPS.codeChars) }
  put(block, 'language', text(value.language, 80))
  put(block, 'title', text(value.title))
  return [block]
}

/**
 * Build the pull-quote block.
 * @param {unknown} value quote string or `{text, by?}`.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function quoteBlocks(value, allow) {
  if (!allow('quote')) return []
  if (typeof value === 'string') {
    const body = text(value)
    return body === undefined ? [] : [{ type: 'quote', text: body }]
  }
  if (!isPlainObject(value)) return []
  const body = text(value.text)
  if (body === undefined) return []
  const block = { type: 'quote', text: body }
  put(block, 'by', text(value.by, 120))
  return [block]
}

/**
 * Build the links block.
 * @param {unknown} value `{label, href, description?}` item array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function linksBlocks(value, allow) {
  if (!allow('links')) return []
  const items = []
  for (const raw of toArray(value)) {
    if (!isPlainObject(raw)) continue
    const label = text(raw.label, 120)
    const href = text(raw.href, 2000)
    if (label === undefined || href === undefined) continue
    const item = { label, href }
    put(item, 'description', text(raw.description))
    items.push(item)
  }
  return items.length === 0 ? [] : [{ type: 'links', items }]
}

/**
 * Build the inline image block.
 * @param {unknown} value source string or `{src, alt?, caption?, height?, fit?}`.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function imageBlocks(value, allow) {
  if (!allow('image')) return []
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [{ type: 'image', src: value }]
  }
  if (!isPlainObject(value)) return []
  const block = { type: 'image', src: value.src }
  put(block, 'alt', text(value.alt, 300))
  put(block, 'caption', text(value.caption, 300))
  if (typeof value.height === 'number') block.height = value.height
  if (value.fit === 'cover' || value.fit === 'contain') block.fit = value.fit
  return [block]
}

/**
 * Build the hierarchy block.
 * @param {unknown} value `{nodes, title?}` or a node array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function treeBlocks(value, allow) {
  if (!allow('tree')) return []
  const spec = Array.isArray(value) ? { nodes: value } : isPlainObject(value) ? value : null
  if (spec === null) return []
  const block = { type: 'tree', nodes: toArray(spec.nodes) }
  put(block, 'title', text(spec.title))
  return [block]
}

/**
 * Build the flow block as a diagram.
 * @param {unknown} value diagram fields (`kind`, `nodes`, `edges`, …).
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function flowBlocks(value, allow) {
  if (!allow('diagram') || !isPlainObject(value)) return []
  const block = { type: 'diagram' }
  const kind = typeof value.kind === 'string' ? value.kind : ''
  if (kind !== '') block.kind = kind
  put(block, 'title', text(value.title))
  put(block, 'direction', text(value.direction, 2))
  if (Array.isArray(value.nodes)) block.nodes = value.nodes
  if (Array.isArray(value.edges)) block.edges = value.edges
  if (Array.isArray(value.participants)) block.participants = value.participants
  if (Array.isArray(value.messages)) block.messages = value.messages
  return [block]
}

/**
 * Build the manual escape hatch: explicit blocks, passed through untouched.
 * @param {unknown} value block array.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function manualBlocks(value) {
  const blocks = []
  for (const raw of toArray(value)) {
    if (isPlainObject(raw) && typeof raw.type === 'string' && raw.type !== '') blocks.push(raw)
  }
  return blocks
}

/**
 * Build the next-step buttons block.
 * @param {unknown} value `{label, prompt, tone?}` item array.
 * @param {(type: string) => boolean} allow allow predicate.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function actionsBlocks(value, allow) {
  if (!allow('actions')) return []
  const items = []
  for (const raw of toArray(value)) {
    if (!isPlainObject(raw)) continue
    const label = text(raw.label, 80)
    const prompt = text(raw.prompt)
    if (label === undefined || prompt === undefined) continue
    const item = { label, prompt }
    put(item, 'tone', raw.tone === 'primary' ? 'primary' : undefined)
    items.push(item)
  }
  return items.length === 0 ? [] : [{ type: 'actions', items }]
}

/**
 * Lay out named sections: two or three become columns, four or five become
 * tabs, more than that stacks under their own headings.
 * @param {unknown} value section array.
 * @param {{ allow: (type: string) => boolean, layout: string, depth: number }} context derivation context.
 * @returns {Record<string, unknown>[]} raw blocks.
 */
function sectionBlocks(value, context) {
  const sections = []
  for (const raw of toArray(value)) {
    if (!isPlainObject(raw)) continue
    const heading = text(raw.heading) || text(raw.title) || text(raw.label) || 'Section ' + (sections.length + 1)
    const inner = {}
    for (const key of Object.keys(raw)) {
      if (key === 'heading' || key === 'title' || key === 'label') continue
      inner[key] = raw[key]
    }
    const blocks = context.depth >= 2
      ? []
      : deriveContent(inner, {
        types: context.types,
        layout: 'stack',
        depth: context.depth + 1,
      })
    if (blocks.length === 0) continue
    sections.push({ heading, blocks })
  }
  if (sections.length === 0) return []
  if (context.layout === 'auto' && sections.length >= 2 && sections.length <= CAPS.columns
    && context.allow('columns') && sectionsCanSplit(sections)) {
    const columns = {
      type: 'columns',
      items: sections.map((section) => ({ label: section.heading, blocks: section.blocks })),
    }
    const weights = sectionWeights(sections)
    if (weights !== undefined) columns.weights = weights
    return [columns]
  }
  if (context.layout === 'auto' && sections.length > CAPS.columns && sections.length <= CAPS.tabs && context.allow('tabs')) {
    return [{
      type: 'tabs',
      items: sections.map((section) => ({ label: section.heading.slice(0, 60), blocks: section.blocks })),
    }]
  }
  const blocks = []
  for (const section of sections) {
    blocks.push({ type: 'heading', text: section.heading, level: 2 })
    blocks.push(...section.blocks)
  }
  return blocks
}

/** Content contract line groups, served by `render_ui_blocks` type "content". */
const CONTRACT_GROUPS = [
  ['`summary` string | {text, tone?, title?} — tinted notice that opens the card.', '`note` string | {text, tone?} — warning/info notice near the end.'],
  ['`metrics` [{label, value, delta?, hint?, tone?}] | {label: value} — metric grid, wraps over rows.', '`series` {values: number[], labels?, title?, unit?, kind?: "trend"|"compare"} — trend line (sparkline) or columns (bars).', '`breakdown` {items: [{label, value}], title?, unit?, kind?: "pie"|"bars"} — donut of shares, bars beyond ' + CAPS.pieSlices + ' slices.'],
  ['`table` {columns, rows, align?, caption?} — data table.', '`steps` [{title, text?, time?, tone?}] | string[] — timeline.', '`items` string[] — bullets.', '`facts` {key: value} | [{key, value}] — spec sheet, two columns up to 8.'],
  ['`tags` string[] | [{label, tone?}] — badges.', '`code` {code, language?, title?} — source block.', '`quote` {text, by?} — pull quote.', '`links` [{label, href, description?}] — link tiles.'],
  ['`image` string | {src, alt?, caption?, height?, fit?} — inline image from an https URL or a data: URI (not dock-safe).', '`tree` {nodes, title?} — hierarchy tree.', '`flow` {kind?, nodes, edges?, participants?, messages?, direction?, title?} — diagram.', '`sections` [{heading, ...any content field}] — 2–3 sections become side-by-side columns, 4–5 become tabs, more stack under headings.'],
  ['`blocks` [Block, ...] — escape hatch: explicit blocks appended after the derived ones.', '`actions` [{label, prompt, tone?}] — next-step buttons, always last.'],
]

/**
 * Build the contract text of the auto-layout `content` object.
 *
 * Served on demand by `render_ui_blocks` so the renderer's description stays
 * compact while the field vocabulary stays discoverable.
 *
 * @returns {string} content contract text.
 */
export function contentContractText() {
  const lines = [
    '`content` (auto layout) — describe what to show and let the card pick the controls and the arrangement. The card derives the blocks; `blocks` stays available for exact control, and both may be combined (derived blocks first, manual blocks after). `layout` sets the arrangement.',
    '  - shape: { summary?, metrics?, series?, breakdown?, table?, steps?, items?, facts?, tags?, code?, quote?, links?, tree?, flow?, note?, sections?, blocks?, actions? } plus the card fields title, subtitle, icon, status, place',
  ]
  for (const group of CONTRACT_GROUPS) {
    for (const line of group) lines.push('  - ' + line)
  }
  lines.push('  - `layout`: "auto" (default) lays 2–3 sections side by side; "stack" keeps every block on its own row. Ordinary blocks always stack — pass `blocks` with a `columns` block for a hand-made split.')
  lines.push('  - widths: a section row is asymmetric when one section carries a table, diagram, code, image, kanban or tree — that section takes two shares. Pass `blocks` with a `columns` block to set `weights` yourself.')
  lines.push('  - order: fields keep their written order, except `summary` (always first) and `actions` (always last).')
  lines.push('  - block types: these names are content fields, not block types. If one is written as an explicit block `type`, it folds onto the matching control (`note`/`summary` → `callout`, `metrics` → `stats`, `series` → `sparkline`, `breakdown` → `pie`, `steps` → `timeline`, `items` → `list`, `tags` → `badges`, `facts` → `keyvalue`, `flow` → `diagram`).')
  lines.push('  - caps: the derived card still obeys the block cap (' + CAPS.blocks + ') and every block cap; an over-long payload is truncated or reported in "dropped".')
  lines.push('  - example: {"title":"Deploy summary","content":{"summary":"All 3 services are healthy after the 14:00 rollout.","metrics":[{"label":"Pods ready","value":"12/12","tone":"success"},{"label":"P95 latency","value":"212 ms","delta":"-8%"}],"series":{"title":"Latency","values":[262,244,231,219,212],"unit":"ms"},"breakdown":{"title":"Traffic","unit":"%","items":[{"label":"api","value":62},{"label":"web","value":27},{"label":"jobs","value":11}]},"table":{"columns":["Service","Status","CPU"],"rows":[["api","healthy","41%"],["worker","healthy","63%"]]},"actions":[{"label":"查看日志","prompt":"查看这次部署的日志","tone":"primary"}]}}')
  return lines.join('\n')
}