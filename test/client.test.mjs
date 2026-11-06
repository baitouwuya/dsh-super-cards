/**
 * Client half tests — no DOM, no React renderer.
 *
 * The module is loaded exactly the way the browser loads it: a stubbed
 * `window.__ModuleLoader__` captures `{ id, factory }`, and the factory gets a
 * minimal React stub (`createElement` returns plain objects; hooks are inert).
 * Everything below then exercises the pure helpers and the component trees
 * those helpers build.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import * as hostPlugin from '../index.js'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Minimal React face: enough to build and inspect element trees. */
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity) }
  },
  memo: (component) => component,
  useCallback: (callback) => callback,
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useState: (initial) => [initial, () => {}],
  Component: class Component {},
}

/** The `{ id, factory }` payload the browser loader received. */
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry
    },
  },
}

// Load the browser module through dynamic import, after the window stub exists.
await import('../client.js')

/** Run the captured factory with the React stub. */
function loadClient() {
  assert.ok(captured !== null, 'client.js registers itself with the loader')
  return captured.factory((id) => {
    if (id === 'react') return reactStub
    throw new Error('unexpected require: ' + id)
  })
}

const client = loadClient()
const { extractSpec, normalizeSpec, normalizeBlock, parseInline, safeHref, contentText, renderBlock, listFlows, statColumns, card, row, boundary, actions, code, key, slot, ns, renderUiCallArgs, readPlacement, resolveStatus, normalizeControls, readControlValues, normalizeLive, selectDockCard, selectBoardConversion, inlineDefinition, inline, dock, turnTailBoard, selectTailCards, turnTailCards, controls, closed } = client.__test

// ---------------------------------------------------------------------------
// Tiny element-tree helpers (the stub elements are plain objects)
// ---------------------------------------------------------------------------

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function findAll(node, predicate) {
  const found = []
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate)
  })
  return found
}

function findOne(node, predicate) {
  let found = null
  walk(node, (candidate) => {
    if (found === null && predicate(candidate)) found = candidate
  })
  return found
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object') return node.children.map(textOf).join('')
  return ''
}

/** Render a function component once (the stub never invokes components itself). */
function mount(node) {
  let current = node
  let guard = 0
  while (current && typeof current === 'object' && typeof current.type === 'function') {
    guard += 1
    assert.ok(guard < 20, 'component tree resolves')
    current = current.type(current.props)
  }
  return current
}

function hasClass(node, className) {
  const value = node && node.props ? node.props.className : undefined
  return typeof value === 'string' && value.split(/\s+/u).indexOf(className) !== -1
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** The canonical example from SPEC.md. */
const CANONICAL = {
  title: 'Deploy summary',
  subtitle: 'production · just now',
  icon: 'check',
  blocks: [
    { type: 'callout', tone: 'success', title: 'Rollout complete', text: 'All 3 services are healthy.' },
    {
      type: 'stats',
      items: [
        { label: 'Version', value: 'v2.14.0' },
        { label: 'Pods ready', value: '12/12', tone: 'success' },
        { label: 'P95 latency', value: '212 ms', delta: '-8%', tone: 'success' },
      ],
    },
    {
      type: 'table',
      columns: ['Service', 'Status', 'CPU'],
      rows: [['api', 'healthy', '41%'], ['worker', 'healthy', '63%']],
      align: ['left', 'left', 'right'],
    },
    { type: 'actions', items: [{ label: '查看日志', prompt: '查看这次部署的日志', tone: 'primary' }] },
  ],
}

/** One block of every spec type, for render coverage. */
const ALL_BLOCKS = [
  { type: 'text', text: 'Hello **world**\nsecond line' },
  { type: 'heading', text: 'Section', level: 1 },
  { type: 'callout', tone: 'info', title: 'Note', text: 'Body' },
  { type: 'stats', items: [{ label: 'A', value: 1 }] },
  { type: 'table', columns: ['x'], rows: [['1']] },
  { type: 'keyvalue', items: [{ key: 'k', value: 'v' }], columns: 1 },
  { type: 'list', ordered: true, items: ['one', 'two'] },
  { type: 'badges', items: [{ label: 'tag', tone: 'brand' }] },
  { type: 'progress', items: [{ label: 'p', value: 0.5, tone: 'success' }] },
  { type: 'bars', title: 'Bars', items: [{ label: 'a', value: 2 }], max: 4, unit: 'ms' },
  { type: 'sparkline', title: 'Spark', values: [1, 3, 2], labels: ['a', 'b', 'c'], unit: 'ms', tone: 'brand' },
  { type: 'pie', title: 'Share', items: [{ label: 'a', value: 60 }, { label: 'b', value: 40, tone: 'brand' }], unit: '%' },
  { type: 'tree', title: 'Repo', nodes: [{ label: 'src', children: [{ label: 'index.js', badge: '1k' }] }] },
  { type: 'heatmap', title: 'Load', columns: 7, items: [{ label: '1', value: 0 }, { label: '2', value: 4 }] },
  { type: 'diff', title: 'Patch', path: 'a.js', lines: [{ kind: 'ctx', text: 'a' }, { kind: 'add', text: 'b' }, { kind: 'del', text: 'c' }] },
  { type: 'kanban', title: 'Board', columns: [{ title: 'Todo', cards: [{ title: 'Card', text: 'do it', badges: ['P1'] }] }] },
  { type: 'tabs', title: 'Views', items: [{ label: 'One', blocks: [{ type: 'text', text: 'pane' }] }, { label: 'Two', blocks: [{ type: 'divider' }] }] },
  { type: 'columns', title: 'Side by side', items: [{ label: 'API', blocks: [{ type: 'text', text: 'left' }] }, { blocks: [{ type: 'stats', items: [{ label: 'a', value: 1 }] }] }] },
  { type: 'image', src: 'https://example.com/a.png', alt: 'a chart', caption: 'Latency', height: 200 },
  { type: 'code', code: 'const a = 1\nconst b = 2', language: 'js', title: 'snippet' },
  { type: 'quote', text: 'quote', by: 'someone' },
  { type: 'timeline', items: [{ title: 'step', text: 'did it', time: 'now' }] },
  {
    type: 'links',
    items: [
      { label: 'docs', href: 'https://example.com', description: 'read' },
      { label: 'bad', href: 'javascript:alert(1)' },
    ],
  },
  { type: 'actions', items: [{ label: 'Go', prompt: 'go', tone: 'primary' }] },
  { type: 'divider' },
  { type: 'live', field: 'last-message', limit: 2 },
  {
    type: 'diagram',
    kind: 'flowchart',
    title: 'Deploy flow',
    nodes: [{ id: 'req', label: 'Request' }, { id: 'build', label: 'Build' }, { id: 'ok', label: 'Deploy', shape: 'round', tone: 'success' }],
    edges: [{ from: 'req', to: 'build' }, { from: 'build', to: 'ok', label: 'green' }],
  },
  {
    type: 'html',
    title: 'Custom visual',
    height: 200,
    html: '<div style="height:80px;display:grid;place-items:center">ok</div>',
  },
  {
    type: 'controls',
    title: 'Settings',
    items: [{ kind: 'setting', setting: 'theme', label: '主题', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }] }],
  },
]

const ALL_TYPES = ALL_BLOCKS.map((block) => block.type)

/**
 * Every fixture block, normalized. The card caps one payload at 24 blocks, so
 * the fixture is normalized in chunks and the results are concatenated.
 */
function normalizeAllBlocks() {
  const normalized = []
  for (let index = 0; index < ALL_BLOCKS.length; index += hostPlugin.__test.CAPS.blocks) {
    const spec = normalizeSpec({ blocks: ALL_BLOCKS.slice(index, index + hostPlugin.__test.CAPS.blocks) })
    assert.ok(spec !== null)
    normalized.push(...spec.blocks)
  }
  return normalized
}

function renderAllBlocks() {
  const bindings = { theme: { get: () => 'light', set: () => {} } }
  const live = { messageCount: 2, toolCount: 1, messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }] }
  return normalizeAllBlocks().map((block, index) => renderBlock(block, 'b' + index, { t: (token) => token, live, bindings }))
}

// ---------------------------------------------------------------------------
// Module identity and wiring
// ---------------------------------------------------------------------------

test('module registers with the exact package id', () => {
  assert.equal(captured.id, 'dsh-super-cards')
  assert.equal(typeof captured.factory, 'function')
})

test('exports apply, inject, and test helpers', () => {
  assert.equal(typeof client.apply, 'function')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'uiConversation'])
  assert.equal(typeof client.__test.extractSpec, 'function')
  assert.equal(typeof client.__test.normalizeSpec, 'function')
  assert.equal(key, 'render_ui')
  assert.equal(slot, 'tool.call.toolview')
  assert.equal(ns, 'superCards')
})

/** Build a fake Client plugin context that records effects/registrations. */
function createFakeContext() {
  const effects = []
  const injections = []
  const registrations = []
  const dictionaries = []

  const locale = {
    register(namespace, dicts) {
      dictionaries.push({ namespace, dicts })
      return () => {}
    },
    bind() {
      return (token) => {
        const latest = dictionaries[dictionaries.length - 1]
        if (!latest) return token
        return latest.dicts.zh[token] ?? latest.dicts.en[token] ?? token
      }
    },
    getLocale() {
      return { active: 'zh' }
    },
  }

  const slots = {
    inject(name, factory) {
      injections.push(name)
      return factory()
    },
    register(definition, component) {
      registrations.push({ definition, component })
      return () => {}
    },
  }

  const definitions = []
  const conversation = {
    events: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
  }

  const provided = []
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'uiConversation') return conversation
      return undefined
    },
    provide(name, value) {
      provided.push({ name, value })
      return () => {
        const index = provided.findIndex((entry) => entry.name === name)
        if (index !== -1) provided.splice(index, 1)
      }
    },
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
  }

  return { ctx, effects, injections, registrations, dictionaries, definitions, provided }
}

test('before the inline row exists the tool row carries the whole card', () => {
  const tree = row({ phase: 'start', block: { argsRaw: JSON.stringify(CANONICAL) }, t: (token) => token })
  assert.equal(tree.type, boundary)
  assert.equal(tree.children[0].type, card)
})

test('apply waits for uiConversation instead of reading it once', () => {
  // A cold page load can activate the Conversation package after this plugin.
  // The inline surface must register when the service appears, or replay has no
  // row definition and every historical card disappears.
  const effects = []
  const registrations = []
  const definitions = []
  const conversation = {
    events: {
      register(definition) { definitions.push(definition); return () => {} },
    },
  }
  const slots = {
    inject(_name, factory) { return factory() },
    register(definition, component) { registrations.push({ definition, component }); return () => {} },
  }
  const locale = {
    register() { return () => {} },
    bind() { return (token) => token },
    getLocale() { return { active: 'zh' } },
  }
  let pending = null
  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'uiConversation') return conversation
      return undefined
    },
    inject(deps, callback) {
      pending = { deps, callback }
      return {}
    },
    provide() { return () => {} },
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      return () => { if (typeof disposer === 'function') disposer() }
    },
  }

  client.apply(ctx)
  assert.ok(pending, 'apply must wait for uiConversation, not read it once')
  assert.deepEqual(pending.deps, ['uiConversation'])
  assert.equal(definitions.length, 0, 'nothing row-shaped before the service appears')

  pending.callback(ctx)
  assert.equal(definitions.length, 4)
  assert.deepEqual(definitions.map((entry) => entry.kind), ['super-cards', 'super-cards-auto', 'super-cards-team', 'super-cards-next'])
  const nodes = registrations.filter((entry) => entry.definition.name === 'conversation.chat.node')
  assert.deepEqual(nodes.map((entry) => entry.definition.key), ['super-cards', 'super-cards-auto', 'super-cards-team', 'super-cards-next'])
  assert.ok(effects.includes('superCards.events'))
  assert.ok(effects.includes('superCards.auto-events'))
  assert.ok(effects.includes('superCards.team-events'))
  assert.ok(effects.includes('superCards.next-events'))
  assert.ok(effects.includes('superCards.node'))
  assert.ok(effects.includes('superCards.auto-node'))
  assert.ok(effects.includes('superCards.team-node'))
  assert.ok(effects.includes('superCards.next-node'))
  assert.ok(effects.includes('superCards.inline'))
})

test('apply installs the inline Chat row and its process marker', () => {
  const harness = createFakeContext()
  client.apply(harness.ctx)

  assert.deepEqual(harness.injections, [
    'tool.call.toolview',
    'conversation.chat.node',
    'conversation.chat.node',
    'conversation.chat.node',
    'conversation.chat.node',
    'conversation.input.dock',
    'conversation.chat.turnTail',
    'conversation.chat.turnTail',
    'plugins.bundle.config',
    'settings.plugins.tab',
  ])
  assert.equal(harness.registrations.length, 10)
  const [view, inlineRow, autoRow, teamRow, nextRow, dock, tail, tailNext, bundleConfig, settingsTab] = harness.registrations
  assert.equal(view.definition.name, 'tool.call.toolview')
  assert.equal(view.definition.key, 'render_ui')
  assert.equal(view.definition.locale, 'superCards')
  assert.equal(typeof view.component, 'function')

  assert.equal(inlineRow.definition.name, 'conversation.chat.node')
  assert.equal(inlineRow.definition.key, 'super-cards')
  assert.equal(inlineRow.definition.locale, 'superCards')
  assert.equal(typeof inlineRow.component, 'function')

  assert.equal(autoRow.definition.name, 'conversation.chat.node')
  assert.equal(autoRow.definition.key, 'super-cards-auto')
  assert.equal(autoRow.definition.locale, 'superCards')
  assert.equal(typeof autoRow.component, 'function')

  assert.equal(teamRow.definition.name, 'conversation.chat.node')
  assert.equal(teamRow.definition.key, 'super-cards-team')
  assert.equal(teamRow.definition.locale, 'superCards')
  assert.equal(typeof teamRow.component, 'function')

  assert.equal(nextRow.definition.name, 'conversation.chat.node')
  assert.equal(nextRow.definition.key, 'super-cards-next')
  assert.equal(nextRow.definition.locale, 'superCards')
  assert.equal(typeof nextRow.component, 'function')

  assert.equal(dock.definition.name, 'conversation.input.dock')
  assert.equal(dock.definition.id, 'super-cards-dock')
  assert.equal(typeof dock.component, 'function')

  assert.equal(tail.definition.name, 'conversation.chat.turnTail')
  assert.equal(tail.definition.id, 'super-cards-board-card')
  assert.equal(typeof tail.component, 'function')

  assert.equal(tailNext.definition.name, 'conversation.chat.turnTail')
  assert.equal(tailNext.definition.id, 'super-cards-tail-card')
  assert.equal(tailNext.definition.order, 32)
  assert.equal(typeof tailNext.component, 'function')

  // A) the bundle's configuration entry on its Plugins page, keyed by package name.
  assert.equal(bundleConfig.definition.name, 'plugins.bundle.config')
  assert.equal(bundleConfig.definition.key, 'dsh-super-cards')
  assert.equal(bundleConfig.definition.locale, 'superCards')
  assert.equal(typeof bundleConfig.component, 'function')

  // B) the Settings -> Built-in plugins tab, a localized list entry.
  assert.equal(settingsTab.definition.name, 'settings.plugins.tab')
  assert.equal(settingsTab.definition.id, 'super-cards')
  assert.equal(settingsTab.definition.order, 30)
  assert.equal(settingsTab.definition.locale, 'superCards')
  assert.equal(typeof settingsTab.definition.label, 'function')
  assert.equal(settingsTab.definition.label(), '超级卡片')
  assert.equal(typeof settingsTab.component, 'function')

  assert.equal(harness.definitions.length, 4)
  assert.deepEqual(harness.definitions.map((entry) => entry.kind), ['super-cards', 'super-cards-auto', 'super-cards-team', 'super-cards-next'])
  const definition = harness.definitions[0]
  assert.equal(definition.kind, 'super-cards')
  assert.equal(definition.target, 'chat')
  assert.equal(typeof definition.match['tool/call'], 'function')
  assert.equal(typeof definition.start, 'function')
  assert.equal(typeof definition.buildViewNode, 'function')

  const nextDefinition = harness.definitions[3]
  assert.equal(nextDefinition.kind, 'super-cards-next')
  assert.equal(nextDefinition.target, 'chat')
  assert.equal(typeof nextDefinition.match, 'function')
  assert.equal(typeof nextDefinition.start, 'function')
  assert.equal(typeof nextDefinition.update, 'function')
  assert.equal(typeof nextDefinition.publication, 'function')
  assert.equal(typeof nextDefinition.buildViewNode, 'function')

  assert.equal(harness.dictionaries.length, 1)
  assert.equal(harness.dictionaries[0].namespace, 'superCards')
  assert.equal(typeof harness.dictionaries[0].dicts.zh, 'object')
  assert.equal(typeof harness.dictionaries[0].dicts.en, 'object')
  // The generated card's only own string: the default question.
  const zhQuestion = harness.dictionaries[0].dicts.zh['next.question']
  const enQuestion = harness.dictionaries[0].dicts.en['next.question']
  assert.equal(typeof zhQuestion, 'string')
  assert.equal(typeof enQuestion, 'string')
  assert.ok(zhQuestion.trim().length > 0)
  assert.ok(enQuestion.trim().length > 0)
  assert.notEqual(zhQuestion, enQuestion)
  assert.ok(harness.effects.includes('superCards.locale'))
  assert.ok(harness.effects.includes('superCards.toolview'))
  assert.ok(harness.effects.includes('superCards.events'))
  assert.ok(harness.effects.includes('superCards.node'))
  assert.ok(harness.effects.includes('superCards.dock'))
  assert.ok(harness.effects.includes('superCards.tail'))
  assert.ok(harness.effects.includes('superCards.tail-next'))
  assert.ok(harness.effects.includes('superCards.next-events'))
  assert.ok(harness.effects.includes('superCards.next-node'))
  assert.ok(harness.effects.includes('superCards.bundle-config'))
  assert.ok(harness.effects.includes('superCards.settings-tab'))
  // Config copy is localized in both dictionaries.
  for (const token of ['config.tab', 'config.save', 'config.reset', 'config.unavailable']) {
    assert.equal(typeof harness.dictionaries[0].dicts.zh[token], 'string', token + ' zh')
    assert.equal(typeof harness.dictionaries[0].dicts.en[token], 'string', token + ' en')
  }
})

test('apply never throws when services are missing or reject', () => {
  assert.doesNotThrow(() => client.apply({}))
  assert.doesNotThrow(() => client.apply({ get: () => undefined, effect: (callback) => callback() }))
  const broken = createFakeContext()
  broken.ctx.get = (name) => {
    if (name !== 'slots') return undefined
    return {
      inject(_name, factory) {
        return factory()
      },
      register() {
        throw new Error('slot core refused the declaration')
      },
    }
  }
  assert.doesNotThrow(() => client.apply(broken.ctx))
  // ...and a missing locale service must not throw either.
  const noLocale = createFakeContext()
  noLocale.ctx.get = (name) => (name === 'slots' ? {
    inject(_name, factory) {
      return factory()
    },
    register() {
      return () => {}
    },
  } : undefined)
  assert.doesNotThrow(() => client.apply(noLocale.ctx))
})

test('the module stays inert: no HTML injection, timers, storage, or network', () => {
  assert.equal(SOURCE.includes('dangerouslySetInnerHTML'), false)
  assert.equal(SOURCE.includes('innerHTML'), false)
  assert.equal(/setTimeout\s*\(/u.test(SOURCE), false)
  // One documented timer exception: the live subagent row refreshes relative
  // times once a second while its run is running. Nothing else may install one,
  // and the interval must always be cleared.
  assert.equal((SOURCE.match(/setInterval\s*\(/gu) || []).length, 1, 'only the team ticker uses an interval')
  assert.equal((SOURCE.match(/clearInterval\s*\(/gu) || []).length, 1, 'that interval is always cleared')
  assert.equal(SOURCE.includes('requestAnimationFrame'), false)
  assert.equal(SOURCE.includes('localStorage'), false)
  assert.equal(SOURCE.includes('sessionStorage'), false)
  assert.equal(/\bfetch\s*\(/u.test(SOURCE), false)
  // The module is self-contained except for one optional probe: the host
  // seeds `@deepseek-ai/dsh-client-ui-primitives` into its module table, so the
  // plugin can read its syntax highlighter without shipping a copy or declaring
  // an external dependency.
  const requires = SOURCE.match(/require\(/gu) || []
  assert.ok(requires.length <= 2, 'at most two module requires (react + the platform-seed probe)')
  if (requires.length > 1) assert.ok(
    SOURCE.includes("require('@deepseek-ai/dsh-client-ui-primitives')"),
    'the extra require must be the host primitives module',
  )
  // Only DSH theme tokens may carry color: no hard-coded colors in the file.
  assert.equal(/#[0-9a-f]{3,8}\b/iu.test(SOURCE), false)
  assert.equal(/\brgba?\s*\(/u.test(SOURCE), false)
  assert.equal(/\bhsla?\s*\(/u.test(SOURCE), false)
  // Agent HTML has exactly one entry point: the sandboxed frame. It must never
  // gain same-origin access, and the document it loads blocks every network
  // origin, so replay stays deterministic and the frame cannot reach the app.
  assert.equal((SOURCE.match(/srcDoc:/g) || []).length, 1, 'one srcdoc, on the html frame')
  const sandbox = SOURCE.match(/sandbox: '([^']*)'/u)
  assert.ok(sandbox, 'the frame declares a sandbox')
  assert.equal(sandbox[1], 'allow-scripts', 'scripts only: never allow-same-origin')
  assert.match(SOURCE, /Content-Security-Policy/u)
  assert.match(SOURCE, /default-src 'none'/u)
})

test('every color token used is one of the allowed theme tokens', () => {
  const allowed = new Set([
    'bg-base',
    'bg-layer-1',
    'bg-layer-2',
    'bg-layer-3',
    'bg-overlay',
    'border-l1',
    'border-l2',
    'border-l3',
    'brand-primary',
    'label-primary',
    'label-secondary',
    'state-error-primary',
    'state-idle-primary',
    'state-success-primary',
    'state-warn-primary',
  ])
  const used = SOURCE.match(/--dsw-alias-[a-z0-9-]+/gu) || []
  assert.ok(used.length > 0, 'the card styles itself with theme tokens')
  for (const token of used) {
    assert.ok(allowed.has(token.slice('--dsw-alias-'.length)), 'unexpected theme token: ' + token)
  }
})

// ---------------------------------------------------------------------------
// Motion: one arrival per card, state changes on the property that changed
// ---------------------------------------------------------------------------

test('motion: a card enters once and its blocks follow in reading order', () => {
  const css = client.__test.css
  for (const name of ['card-in', 'block-in', 'view-in', 'pop', 'breathe', 'ring', 'grow-x']) {
    assert.ok(css.includes('@keyframes dsh-sc-' + name), 'missing keyframes for ' + name)
  }
  // The entrance sits on the card itself, so a status change on the same DOM
  // node cannot replay it.
  assert.match(css, /\.dsh-sc-card \{\n  animation: dsh-sc-card-in 240ms/u)
  assert.match(css, /\.dsh-sc-blocks > \* \{\n  animation: dsh-sc-block-in/u)
  assert.equal(css.includes('animation-delay: 24ms'), true, 'blocks are staggered')
  // No blanket transitions: every animated property is named explicitly, and
  // only the progress fill animates a dimension (a 6px track, not the card).
  assert.equal(css.includes('transition: all'), false)
  assert.equal(css.includes('animation: all'), false)
})

test('motion: everything animated is removed under reduced motion, last in the sheet', () => {
  const css = client.__test.css
  const reduceAt = css.lastIndexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(reduceAt > css.indexOf('animation: dsh-sc-card-in'), 'the reduce block out-orders every animation')
  const reduce = css.slice(reduceAt)
  for (const selector of [
    '.dsh-sc-card,',
    '.dsh-sc-blocks > *,',
    '.dsh-sc-dock,',
    '.dsh-sc-bar-fill,',
    ".dsh-sc-card[data-status='success'] .dsh-sc-status,",
    '.dsh-sc-status--running .dsh-sc-status-dot::after,',
  ]) {
    assert.ok(reduce.includes(selector), 'reduced motion covers ' + selector)
  }
  assert.equal(reduce.includes('animation: none !important'), true)
  assert.equal(reduce.includes('transition: none !important'), true)
})

test('motion: a pressable control and the disclosure chevron animate, not jump', () => {
  const css = client.__test.css
  assert.equal(css.includes('.dsh-sc-action:active'), true)
  assert.match(css, /\.dsh-sc-line-chevron svg,\n\.dsh-sc-dock-chevron svg \{\n  transition: transform 200ms/u)
  // The chevron is one glyph that rotates; the path never changes with state.
  const glyph = client.__test.chevronGlyph(true)
  assert.equal(glyph.props.style.transform, 'rotate(180deg)')
  assert.equal(glyph.children[0].props.d, 'M4.2 6.2 8 10l3.8-3.8')
})

// ---------------------------------------------------------------------------
// Agent motion: the model names a preset, this half owns the CSS
// ---------------------------------------------------------------------------

test('agent motion: presets mirror the Host vocabulary and normalize identically', () => {
  assert.deepEqual(client.__test.motionEffects, hostPlugin.__test.MOTION_EFFECTS, 'both halves allow the same presets')
  assert.deepEqual(client.__test.motionDefaults, {
    duration: hostPlugin.__test.MOTION_DEFAULTS.duration,
    delay: hostPlugin.__test.MOTION_DEFAULTS.delay,
    loop: hostPlugin.__test.MOTION_DEFAULTS.loop,
  })
  const normalize = client.__test.normalizeMotion
  assert.deepEqual(normalize({ effect: 'sweep', duration: 1200, delay: 200, loop: true }), {
    effect: 'sweep',
    duration: 1200,
    delay: 200,
    loop: true,
  })
  assert.deepEqual(normalize({ effect: 'pulse' }), { effect: 'pulse', duration: 1000, delay: 0, loop: false })
  assert.equal(normalize({ effect: 'draw', duration: 99_999 }).duration, 6000, 'duration is clamped like the Host')
  assert.equal(normalize({ effect: 'draw', duration: 5 }).duration, 200)
  assert.equal(normalize({ effect: 'draw', delay: -5 }).delay, 0)
  assert.equal(normalize({ effect: 'draw', loop: 'yes' }).loop, false)
  assert.equal(normalize({ effect: 'sparkle' }), null)
  assert.equal(normalize('pulse'), null)

  const spec = normalizeSpec({
    blocks: [{ type: 'progress', items: [{ label: 'a', value: 0.4 }], motion: { effect: 'sweep' } }],
  })
  assert.equal(spec.blocks[0].motion.effect, 'sweep', 'the preset survives normalization')
  const typo = normalizeSpec({ blocks: [{ type: 'text', text: 'ok', motion: { effect: 'sparkle' } }] })
  assert.equal(typo.blocks[0].type, 'text', 'a bad preset never drops the block')
  assert.equal(typo.blocks[0].motion, undefined)

  // The client service publishes the same vocabulary to other plugins.
  const service = client.__test.service
  assert.deepEqual(service.motion.list(), client.__test.motionEffects)
  assert.equal(service.motion.has('sweep'), true)
  assert.equal(service.motion.has('sparkle'), false)
})

test('agent motion: the card wraps only the animated block and forwards its timing', () => {
  const argsRaw = JSON.stringify({
    blocks: [
      { type: 'progress', items: [{ label: 'a', value: 0.4 }], motion: { effect: 'sweep', duration: 1200, delay: 300, loop: true } },
      { type: 'text', text: 'plain' },
    ],
  })
  const tree = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  const wraps = findAll(tree, (node) => hasClass(node, 'dsh-sc-motion-wrap'))
  assert.equal(wraps.length, 1, 'a block without motion is rendered untouched')
  const wrap = wraps[0]
  assert.ok(hasClass(wrap, 'dsh-sc-motion--sweep'))
  assert.equal(wrap.props['data-block'], 'progress')
  assert.equal(wrap.props['data-motion'], 'sweep')
  assert.equal(wrap.props.style['--dsh-sc-motion-duration'], '1200ms')
  assert.equal(wrap.props.style['--dsh-sc-motion-delay'], '300ms')
  assert.equal(wrap.props.style['--dsh-sc-motion-iterations'], 'infinite')
  // The block itself is still inside the envelope, in reading order.
  assert.equal(findAll(wrap, (node) => hasClass(node, 'dsh-sc-progress')).length, 1)

  // A live block keeps its half-row width through the envelope.
  const liveWrap = client.__test.withMotion(
    { type: 'div', props: {}, children: [], key: 'blk0' },
    { type: 'live', motion: { effect: 'pulse', duration: 1000, delay: 0, loop: true } },
  )
  assert.ok(hasClass(liveWrap, 'dsh-sc-motion-wrap--live'))
  assert.ok(hasClass(liveWrap, 'dsh-sc-motion--pulse'))
})

test('agent motion: every preset has keyframes, a class, and a reduced-motion escape', () => {
  const css = client.__test.css
  for (const effect of client.__test.motionEffects) {
    assert.ok(css.includes('.dsh-sc-motion--' + effect), 'the preset class must exist for ' + effect)
    assert.ok(css.includes('@keyframes dsh-sc-motion-' + effect), 'the preset keyframes must exist for ' + effect)
  }
  // Draw and flow work on normalized path lengths, so one keyframe fits every edge.
  assert.match(css, /\.dsh-sc-motion--draw \.dsh-sc-spark-line/u)
  assert.match(css, /stroke-dasharray: 6 4/u)
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(reduce.includes('.dsh-sc-motion-wrap,'), 'the envelope is neutralized')
  assert.ok(reduce.includes('.dsh-sc-motion-wrap * { animation: none !important; }'), 'so is every animated descendant')
  // Diagram and sparkline paths carry a normalized length for draw/flow.
  const diagram = mount(client.__test.renderBlock(
    normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] }),
    'd1',
    { t: (token) => token },
  ))
  const edges = findAll(diagram, (node) => node.type === 'path' && node.props.pathLength === 100)
  assert.ok(edges.length >= 1, 'diagram edges are normalized for draw/flow')
})

// ---------------------------------------------------------------------------
// Sandboxed HTML card: the agent's own document in an isolated frame
// ---------------------------------------------------------------------------

test('html: the block is normalized with a clamped frame height and source cap', () => {
  assert.equal(normalizeBlock({ type: 'html', html: '  ' }), null, 'an empty document is unusable')
  const block = normalizeBlock({ type: 'html', html: '<b>x</b>', height: 9999, title: 'T', caption: 'C' })
  assert.equal(block.height, 800)
  assert.equal(block.title, 'T')
  assert.equal(block.caption, 'C')
  assert.equal(normalizeBlock({ type: 'html', html: '<b>x</b>', height: 1 }).height, 120)
  assert.equal(normalizeBlock({ type: 'html', html: '<b>x</b>' }).height, 240)
  assert.equal(normalizeBlock({ type: 'html', html: 'x'.repeat(25000) }).html.length, 20000)
})

test('html: the card is one sandboxed frame plus a source view', () => {
  const block = normalizeBlock({ type: 'html', html: '<style>@keyframes a{}</style><div>y</div>', title: 'Custom', height: 180, caption: 'note' })
  const tree = mount(client.__test.renderBlock(block, 'h1', { t: (token) => token }))
  const frame = findOne(tree, (node) => node.type === 'iframe')
  assert.ok(frame, 'the visual is an iframe, never inline markup')
  assert.equal(frame.props.sandbox, 'allow-scripts')
  assert.equal(frame.props.sandbox.includes('allow-same-origin'), false, 'opaque origin: no access to the app')
  assert.equal(frame.props.style.height, '180px')
  assert.equal(frame.props.title, 'Custom')
  const srcdoc = frame.props.srcDoc
  assert.ok(srcdoc.includes('<div>y</div>'), 'the agent document is embedded verbatim')
  assert.match(srcdoc, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'/)
  assert.match(srcdoc, /script-src 'unsafe-inline'/)
  assert.match(srcdoc, /connect-src 'none'/)
  assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-html-toggle')), 'a source toggle is available')
  assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-html-caption')))
})

test('html: the composed document injects theme tokens, fonts, and reduced motion', () => {
  const compose = client.__test.composeHtmlDocument
  const fragment = compose('<p>x</p>', { '--dsw-alias-brand-primary': 'rgb(1, 2, 3)', '--dsw-alias-bg-base': 'white' })
  assert.match(fragment, /^<!doctype html>/)
  assert.ok(fragment.includes('--dsw-alias-brand-primary:rgb(1, 2, 3);'), 'the frame gets the live token values')
  assert.ok(fragment.includes('--dsw-alias-bg-base:white;'))
  assert.match(fragment, /prefers-reduced-motion: reduce/)
  assert.match(fragment, /system-ui/)
  assert.match(fragment, /<body><p>x<\/p><\/body>/)
  // Tokens are optional: a DOM-less context simply omits the declarations.
  assert.equal(compose('<p>y</p>', {}).includes('--dsw-alias-brand-primary'), false)
  assert.equal(compose('<p>y</p>').includes('--dsw-alias-brand-primary'), false)

  // A full document keeps its own head and gets the policy injected once.
  const full = compose('<!doctype html><html><head><title>t</title></head><body><p>y</p></body></html>', {})
  assert.match(full, /<head><meta charset="utf-8">/)
  assert.match(full, /<title>t<\/title>/)
  assert.equal((full.match(/Content-Security-Policy/g) || []).length, 1)
  assert.ok(full.includes('<p>y</p>'))
})

// ---------------------------------------------------------------------------
// extractSpec: the spec comes only from recorded call material
// ---------------------------------------------------------------------------

test('extractSpec: preparing has no arguments yet', () => {
  assert.deepEqual(extractSpec('preparing', undefined), { kind: 'preparing' })
  assert.deepEqual(extractSpec('preparing', {}), { kind: 'preparing' })
})

test('extractSpec: start parses block.argsRaw', () => {
  const extracted = extractSpec('start', { argsRaw: JSON.stringify(CANONICAL) })
  assert.equal(extracted.kind, 'ready')
  assert.equal(extracted.spec.title, 'Deploy summary')
  assert.equal(extracted.spec.blocks.length, 4)
})

test('extractSpec: start with malformed JSON is an invalid card, never a throw', () => {
  const extracted = extractSpec('start', { argsRaw: '{not json' })
  assert.equal(extracted.kind, 'invalid')
  assert.equal(extracted.reason, 'parse')
  assert.equal(typeof extracted.detail, 'string')
  assert.equal(extractSpec('start', { argsRaw: '' }).kind, 'invalid')
  assert.equal(extractSpec('start', { argsRaw: '"just a string"' }).kind, 'invalid')
})

test('extractSpec: an invalid card names what is missing', () => {
  // A call rejected before dispatch reaches the row with `arguments: {}`.
  assert.deepEqual(extractSpec('start', { argsRaw: '{}' }), { kind: 'invalid', reason: 'empty' })
  assert.equal(extractSpec('start', { argsRaw: '  ' }).reason, 'empty')
  assert.equal(extractSpec('start', { argsRaw: 'null' }).reason, 'empty')
  assert.equal(extractSpec('result', { call: { argsRaw: '{}' }, isError: false }).reason, 'empty')
  // Parsed but unusable: no blocks, no content.
  assert.equal(extractSpec('start', { argsRaw: '{"title":"T"}' }).reason, 'shape')
  // Unparsed: the parser's own message rides along as detail.
  const truncated = extractSpec('start', { argsRaw: '{"blocks":[{"type":"list"' })
  assert.equal(truncated.reason, 'parse')
  assert.match(truncated.detail, /JSON/u)
})

test('extractSpec: result reads block.call.argsRaw', () => {
  const extracted = extractSpec('result', { call: { argsRaw: JSON.stringify(CANONICAL) }, isError: false })
  assert.equal(extracted.kind, 'ready')
  assert.equal(extracted.spec.title, 'Deploy summary')
})

test('extractSpec: result with a truncated call (block.call === null) is missing-call', () => {
  assert.deepEqual(extractSpec('result', { call: null, isError: false }), { kind: 'missing-call' })
  assert.deepEqual(extractSpec('result', { call: { argsRaw: 42 }, isError: false }), { kind: 'missing-call' })
})

test('extractSpec: an error result renders from block.content text', () => {
  const extracted = extractSpec('result', {
    call: { argsRaw: JSON.stringify(CANONICAL) },
    isError: true,
    content: [
      { type: 'text', text: 'render_ui: titles must be strings' },
      { type: 'text', text: 'second line' },
    ],
  })
  assert.equal(extracted.kind, 'tool-error')
  assert.equal(extracted.text, 'render_ui: titles must be strings\nsecond line')
  // An in-window error result never renders a spec.
  const errorNoContent = extractSpec('result', { isError: true, content: [] })
  assert.equal(errorNoContent.kind, 'tool-error')
  assert.equal(errorNoContent.text, '')
})

test('extractSpec: unknown stage degrades from the recorded shape', () => {
  assert.equal(extractSpec(undefined, undefined).kind, 'invalid')
  assert.equal(extractSpec('bogus', { argsRaw: JSON.stringify(CANONICAL) }).kind, 'ready')
})

// ---------------------------------------------------------------------------
// normalizeSpec: host-mirrored caps, unknown-block skipping
// ---------------------------------------------------------------------------

test('normalizeSpec rejects non-spec values', () => {
  assert.equal(normalizeSpec(null), null)
  assert.equal(normalizeSpec(undefined), null)
  assert.equal(normalizeSpec('text'), null)
  assert.equal(normalizeSpec([]), null)
  assert.equal(normalizeSpec({}), null)
  assert.equal(normalizeSpec({ blocks: 'nope' }), null)
})

test('normalizeSpec keeps unknown wire types as placeholders and drops malformed blocks', () => {
  const spec = normalizeSpec({
    blocks: [
      { type: 'mystery' },
      null,
      42,
      { type: 'text', text: '   ' },
      { type: 'heading' },
      { type: 'divider' },
      { type: 'heading', text: 'kept', level: 9 },
    ],
  })
  // A well-typed wire block without a renderer stays visible as a placeholder;
  // malformed blocks (no type, unusable content) are still dropped.
  assert.deepEqual(spec.blocks.map((block) => block.type), [client.__test.unsupportedType, 'divider', 'heading'])
  assert.equal(spec.blocks[0].missingType, 'mystery')
  assert.equal(spec.blocks[2].level, 2)
  assert.equal(spec.unknown, undefined)
})

test('normalizeSpec caps blocks at 24', () => {
  const blocks = Array.from({ length: 30 }, (_, index) => ({ type: 'text', text: 'block ' + index }))
  const spec = normalizeSpec({ blocks })
  assert.equal(spec.blocks.length, 24)
  assert.equal(spec.blocks[0].text, 'block 0')
  assert.equal(spec.blocks[23].text, 'block 23')
})

test('normalizeSpec caps table rows at 50 and text fields at 4000 chars', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ['row ' + index])
  const spec = normalizeSpec({
    blocks: [
      { type: 'table', columns: ['c'], rows },
      { type: 'text', text: 'x'.repeat(5000) },
      { type: 'callout', text: 'y'.repeat(5000) },
    ],
  })
  assert.equal(spec.blocks[0].rows.length, 50)
  assert.equal(spec.blocks[1].text.length, 4000)
  assert.equal(spec.blocks[2].text.length, 4000)
})

test('normalizeSpec caps sparkline values at 120 and code at 8000 chars', () => {
  const spec = normalizeSpec({
    blocks: [
      { type: 'sparkline', values: Array.from({ length: 200 }, (_, index) => index) },
      { type: 'code', code: 'z'.repeat(9000) },
    ],
  })
  assert.equal(spec.blocks[0].values.length, 120)
  assert.equal(spec.blocks[1].code.length, 8000)
})

test('normalizeSpec caps actions at 8', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ label: 'go ' + index, prompt: 'prompt ' + index }))
  const spec = normalizeSpec({ blocks: [{ type: 'actions', items }] })
  assert.equal(spec.blocks[0].items.length, 8)
  assert.equal(spec.blocks[0].items[0].tone, 'default')
})

test('normalizeSpec keeps only known icons and drops blank title/subtitle', () => {
  assert.equal(normalizeSpec({ icon: 'check', blocks: [] }).icon, 'check')
  assert.equal(normalizeSpec({ icon: 'rocket', blocks: [] }).icon, undefined)
  const spec = normalizeSpec({ title: '  ', subtitle: ' sub ', blocks: [] })
  assert.equal(spec.title, undefined)
  assert.equal(spec.subtitle, 'sub')
})

// ---------------------------------------------------------------------------
// Inline formatting and safe links
// ---------------------------------------------------------------------------

test('parseInline: bold and code marks become tokens, everything else stays text', () => {
  assert.deepEqual(parseInline('a **b** and `c`'), [
    { kind: 'text', text: 'a ' },
    { kind: 'bold', text: 'b' },
    { kind: 'text', text: ' and ' },
    { kind: 'code', text: 'c' },
  ])
  assert.deepEqual(parseInline('plain text'), [{ kind: 'text', text: 'plain text' }])
  assert.deepEqual(parseInline(''), [])
})

test('parseInline never interprets HTML and keeps unmatched markers literal', () => {
  assert.deepEqual(parseInline('<img src=x onerror=alert(1)>'), [
    { kind: 'text', text: '<img src=x onerror=alert(1)>' },
  ])
  assert.deepEqual(parseInline('**broken'), [{ kind: 'text', text: '**broken' }])
  assert.deepEqual(parseInline('`unclosed'), [{ kind: 'text', text: '`unclosed' }])
})

test('safeHref allows only http(s) and mailto', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(safeHref('http://example.com'), 'http://example.com')
  assert.equal(safeHref('mailto:someone@example.com'), 'mailto:someone@example.com')
  assert.equal(safeHref('HTTPS://EXAMPLE.COM'), 'HTTPS://EXAMPLE.COM')
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('data:text/html,<b>x</b>'), null)
  assert.equal(safeHref('/relative/path'), null)
  assert.equal(safeHref(''), null)
  assert.equal(safeHref(42), null)
})

test('contentText joins text blocks and ignores non-text ones', () => {
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'image' }, 'b']), 'a\nb')
  assert.equal(contentText(undefined), '')
  assert.equal(contentText('nope'), '')
  assert.equal(contentText([{ type: 'text', text: 'c'.repeat(5000) }]).length, 4000)
})

// ---------------------------------------------------------------------------
// renderBlock: all 17 types, accessibility, safety
// ---------------------------------------------------------------------------

test('normalize + render covers all 29 block types', () => {
  const normalized = normalizeAllBlocks()
  assert.deepEqual(normalized.map((block) => block.type), ALL_TYPES)
  assert.equal(normalized.length, 29)
  const rendered = renderAllBlocks()
  assert.equal(rendered.length, 29)
  for (const node of rendered) assert.notEqual(node, null)
})

test('renderBlock returns null for an unknown type', () => {
  assert.equal(renderBlock({ type: 'mystery' }, 'x', { t: (token) => token }), null)
  assert.equal(renderBlock(null, 'x', {}), null)
  assert.equal(renderBlock({}, 'x', {}), null)
})

test('tables use th scope=col, honour align, and mark null cells', () => {
  const block = normalizeSpec({
    blocks: [{ type: 'table', columns: ['A', 'B'], rows: [['1', null]], align: ['left', 'right'] }],
  }).blocks[0]
  const tree = renderBlock(block, 't', { t: (token) => token })
  const headers = findAll(tree, (node) => node.type === 'th')
  assert.equal(headers.length, 2)
  for (const header of headers) assert.equal(header.props.scope, 'col')
  assert.ok(hasClass(headers[1], 'dsh-sc-align-right'))
  assert.equal(findAll(tree, (node) => node.type === 'td').length, 2)
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-null'))), '—')
})

test('progress clamps 0..1 and exposes progressbar ARIA values', () => {
  const block = normalizeSpec({
    blocks: [{ type: 'progress', items: [{ label: 'high', value: 1.6 }, { label: 'low', value: -0.4 }] }],
  }).blocks[0]
  const tree = renderBlock(block, 'p', { t: (token) => token })
  const bars = findAll(tree, (node) => node.props.role === 'progressbar')
  assert.equal(bars.length, 2)
  assert.equal(bars[0].props['aria-valuemin'], 0)
  assert.equal(bars[0].props['aria-valuemax'], 1)
  assert.equal(bars[0].props['aria-valuenow'], 1)
  assert.equal(bars[1].props['aria-valuenow'], 0)
})

test('pie: slices are shares of their own total, with an exact legend', () => {
  const block = normalizeBlock({
    type: 'pie',
    title: 'Traffic',
    unit: '%',
    items: [
      { label: 'api', value: 60 },
      { label: 'web', value: 30, tone: 'brand' },
      { label: 'bad', value: -4 },
    ],
  })
  assert.equal(block.items.length, 2, 'negative shares are dropped')
  const tree = renderBlock(block, 'p', { t: (token) => token })
  assert.equal(findAll(tree, (node) => node.type === 'circle' && hasClass(node, 'dsh-sc-pie-slice')).length, 2)
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-pie-row')).length, 2)
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-pie-total'))), '90')
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-pie-unit'))), '%')
  // With a '%' unit the legend value already is the share: no duplicate percent.
  assert.deepEqual(
    findAll(tree, (node) => hasClass(node, 'dsh-sc-pie-value')).map((node) => textOf(node)),
    ['60%', '30%'],
  )
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-pie-pct')).length, 0)
  const box = findOne(tree, (node) => node.props && node.props.role === 'img')
  assert.equal(box.props['aria-label'], 'api 66.7% · web 33.3%')
  // Without a '%' unit each row carries the value and the share side by side.
  const absolute = renderBlock(
    normalizeBlock({ type: 'pie', items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }),
    'a',
    { t: (token) => token },
  )
  assert.deepEqual(
    findAll(absolute, (node) => hasClass(node, 'dsh-sc-pie-pct')).map((node) => textOf(node)),
    ['33.3%', '66.7%'],
  )
  // `donut: false` is a filled pie: no centre label, the ring becomes a disc.
  const filled = renderBlock(
    normalizeBlock({ type: 'pie', donut: false, items: [{ label: 'a', value: 1 }] }),
    'f',
    { t: (token) => token },
  )
  assert.equal(findOne(filled, (node) => hasClass(node, 'dsh-sc-pie-center')), null)
  assert.equal(findOne(filled, (node) => hasClass(node, 'dsh-sc-pie-slice')).props.strokeWidth, 46)
})

test('pie: a zero total or empty item list renders nothing, never an empty chart', () => {
  assert.equal(normalizeBlock({ type: 'pie', items: [{ label: 'a', value: 0 }] }), null)
  assert.equal(normalizeBlock({ type: 'pie', items: [] }), null)
})

test('bars: direction vertical renders proportional columns with their values', () => {
  const block = normalizeBlock({
    type: 'bars',
    direction: 'vertical',
    unit: 'k',
    items: [{ label: 'Mon', value: 10 }, { label: 'Tue', value: 20, tone: 'success' }],
  })
  const tree = renderBlock(block, 'v', { t: (token) => token })
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-column')).length, 2)
  assert.deepEqual(
    findAll(tree, (node) => hasClass(node, 'dsh-sc-column-fill')).map((node) => node.props.style.height),
    ['50%', '100%'],
  )
  assert.equal(textOf(findAll(tree, (node) => hasClass(node, 'dsh-sc-column-label'))[0]), 'Mon')
  assert.equal(textOf(findAll(tree, (node) => hasClass(node, 'dsh-sc-column-value'))[1]), '20k')
  // Omitting direction keeps the horizontal ranked rows.
  const rows = renderBlock(
    normalizeBlock({ type: 'bars', items: [{ label: 'a', value: 1 }] }),
    'h',
    { t: (token) => token },
  )
  assert.ok(findOne(rows, (node) => hasClass(node, 'dsh-sc-bars')))
})

test('bars and sparkline are hand-written accessible SVG, no library', () => {
  const rendered = renderAllBlocks()
  const bars = rendered[ALL_TYPES.indexOf('bars')]
  const barsBox = findOne(bars, (node) => node.props && node.props.role === 'img')
  assert.ok(barsBox)
  assert.ok(String(barsBox.props['aria-label']).indexOf('Bars') === 0)
  assert.equal(findAll(bars, (node) => node.type === 'svg').length >= 1, true)
  assert.equal(findAll(bars, (node) => node.type === 'rect').length, 2)

  const spark = mount(rendered[ALL_TYPES.indexOf('sparkline')])
  assert.equal(spark.props.role, undefined)
  const sparkBox = findOne(spark, (node) => node.props && node.props.role === 'img')
  assert.ok(sparkBox)
  assert.equal(sparkBox.props['aria-label'].includes('min 1'), true)
  const svg = findOne(sparkBox, (node) => node.type === 'svg')
  assert.equal(svg.props.preserveAspectRatio, 'none')
  assert.equal(findAll(svg, (node) => node.type === 'path').length, 2)
  assert.equal(findAll(svg, (node) => node.props['aria-hidden'] === 'true').length, 1)
})

test('links render anchors only for safe hrefs', () => {
  const block = normalizeSpec({
    blocks: [{
      type: 'links',
      items: [
        { label: 'docs', href: 'https://example.com', description: 'read me' },
        { label: 'bad', href: 'javascript:alert(1)' },
      ],
    }],
  }).blocks[0]
  const tree = renderBlock(block, 'l', { t: (token) => token })
  const anchors = findAll(tree, (node) => node.type === 'a')
  assert.equal(anchors.length, 1)
  assert.equal(anchors[0].props.href, 'https://example.com')
  assert.equal(anchors[0].props.target, '_blank')
  assert.equal(anchors[0].props.rel, 'noreferrer noopener')
  const plain = findAll(tree, (node) => hasClass(node, 'dsh-sc-link-plain'))
  assert.equal(plain.length, 1)
  assert.equal(textOf(plain[0]), 'bad')
})

test('actions put the prompt in the draft and never submit', () => {
  const block = normalizeSpec({
    blocks: [{ type: 'actions', items: [{ label: 'Go', prompt: '查看日志', tone: 'primary' }] }],
  }).blocks[0]
  const calls = { drafts: [], submits: 0 }
  const inputActions = {
    setDraft(text) {
      calls.drafts.push(text)
    },
    submit() {
      calls.submits += 1
    },
  }
  const tree = actions({ block, t: (token) => token, inputActions })
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props.type, 'button')
  assert.equal(buttons[0].props['data-tone'], 'primary')
  buttons[0].props.onClick()
  assert.deepEqual(calls.drafts, ['查看日志'])
  assert.equal(calls.submits, 0)
})

test('actions fall back safely when setDraft is unavailable', () => {
  const block = normalizeSpec({
    blocks: [{ type: 'actions', items: [{ label: 'Copy', prompt: 'copy me' }] }],
  }).blocks[0]
  const tree = actions({ block, t: (token) => token })
  const buttons = findAll(tree, (node) => node.type === 'button')
  assert.equal(buttons.length, 1)
  assert.doesNotThrow(() => buttons[0].props.onClick())
})

test('code block collapses long code and exposes a labelled, scrollable pre', () => {
  const longCode = Array.from({ length: 20 }, (_, index) => 'line ' + index).join('\n')
  const block = normalizeBlock({ type: 'code', code: longCode, language: 'js', title: 'snippet' })
  const tree = code({ block, t: (token) => token })
  const pre = findOne(tree, (node) => node.type === 'pre')
  assert.equal(pre.props.tabIndex, 0)
  assert.equal(pre.props['aria-label'], 'snippet')
  assert.ok(hasClass(pre, 'dsh-sc-code-pre'))
  assert.equal(hasClass(pre, 'dsh-sc-code-text'), false)
  const toggle = findOne(tree, (node) => node.type === 'button')
  assert.equal(toggle.props['aria-expanded'], 'false')
  assert.doesNotThrow(() => toggle.props.onClick())
})

// ---------------------------------------------------------------------------
// Card surfaces: header, skeleton, error notices, boundary
// ---------------------------------------------------------------------------

test('start card renders header, blocks, and an aria-label from the title', () => {
  const tree = card({ phase: 'start', block: { argsRaw: JSON.stringify(CANONICAL) }, t: (token) => token })
  assert.equal(tree.type, 'section')
  assert.equal(tree.props['aria-label'], 'Deploy summary')
  assert.ok(hasClass(tree, 'dsh-sc-card'))
  const title = findOne(tree, (node) => node.type === 'h3' && hasClass(node, 'dsh-sc-title'))
  assert.equal(textOf(title), 'Deploy summary')
  const svg = findOne(tree, (node) => node.type === 'svg')
  assert.equal(svg.props['aria-hidden'], 'true')
  const blocks = findOne(tree, (node) => hasClass(node, 'dsh-sc-blocks'))
  assert.equal(blocks.children.length, 4)
})

test('strong and inline code render as safe React nodes, newlines as breaks', () => {
  const tree = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ blocks: [{ type: 'text', text: 'a **b** `c`\nd' }] }) },
    t: (token) => token,
  })
  const paragraph = findOne(tree, (node) => node.type === 'p')
  const strong = findOne(tree, (node) => node.type === 'strong')
  assert.equal(textOf(strong), 'b')
  assert.equal(findOne(tree, (node) => node.type === 'code').children[0], 'c')
  assert.equal(findAll(tree, (node) => node.type === 'br').length, 1)
})

test('preparing renders a localized skeleton', () => {
  const tree = mount(card({ phase: 'preparing', t: (token) => token }))
  assert.equal(tree.type, 'section')
  assert.ok(hasClass(tree, 'dsh-sc-card--skeleton'))
  assert.equal(tree.props.role, 'status')
  assert.equal(tree.props['aria-label'], 'preparing')
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-sk-line')).length, 4)
})

test('tool error result renders a small error card from block.content text', () => {
  const tree = mount(card({
    phase: 'result',
    block: {
      isError: true,
      call: null,
      content: [{ type: 'text', text: 'render_ui: blocks must be an array' }],
    },
    t: (token) => token,
  }))
  assert.ok(hasClass(tree, 'dsh-sc-card--notice'))
  assert.equal(tree.props.role, 'alert')
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-notice-text'))), 'render_ui: blocks must be an array')
})

test('missing call and invalid spec render notice cards instead of throwing', () => {
  const missing = mount(card({ phase: 'result', block: { call: null }, t: (token) => token }))
  assert.equal(textOf(findOne(missing, (node) => hasClass(node, 'dsh-sc-notice-text'))), 'error.missingCall')

  const invalid = mount(card({ phase: 'start', block: { argsRaw: '{oops' }, t: (token) => token }))
  assert.equal(textOf(findOne(invalid, (node) => hasClass(node, 'dsh-sc-notice-text'))), 'error.parseArgs')
  assert.ok(findOne(invalid, (node) => hasClass(node, 'dsh-sc-notice-detail')), 'parse errors show the parser message')

  // An empty call (rejected before dispatch) explains itself instead of claiming an invalid spec.
  const empty = mount(card({ phase: 'start', block: { argsRaw: '{}' }, t: (token) => token }))
  assert.equal(textOf(findOne(empty, (node) => hasClass(node, 'dsh-sc-notice-text'))), 'error.emptyArgs')
  assert.equal(findOne(empty, (node) => hasClass(node, 'dsh-sc-notice-detail')), null)

  // Parsed but blockless: its own message.
  const shapeless = mount(card({ phase: 'start', block: { argsRaw: '{"title":"T"}' }, t: (token) => token }))
  assert.equal(textOf(findOne(shapeless, (node) => hasClass(node, 'dsh-sc-notice-text'))), 'error.emptySpec')
})

test('an empty spec still renders a stable card with an empty notice', () => {
  const tree = card({ phase: 'start', block: { argsRaw: '{"blocks":[]}' }, t: (token) => token })
  assert.ok(hasClass(tree, 'dsh-sc-card'))
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-muted'))), 'empty')
})

test('ErrorBoundary fallback is a minimal localized card', () => {
  assert.deepEqual(boundary.getDerivedStateFromError(), { failed: true })
  const fallback = boundary.prototype.render.call({
    state: { failed: true },
    props: { t: (token) => token },
  })
  assert.equal(fallback.type, 'section')
  assert.equal(fallback.props.role, 'alert')
  assert.equal(fallback.props['aria-label'], 'error.render')
  assert.ok(hasClass(fallback, 'dsh-sc-card--notice'))
})

test('the inline row renders the card from the recorded arguments', () => {
  const argsRaw = JSON.stringify(CANONICAL)
  const tree = inline({ node: { data: { argsRaw } }, t: (token) => token })
  assert.equal(tree.type, boundary)
  const cardElement = tree.children[0]
  assert.equal(cardElement.type, card)
  assert.equal(cardElement.props.block.argsRaw, argsRaw)
  assert.equal(inline({ node: { data: {} }, t: (token) => token }), null)
})

test('renderUiCallArgs accepts tool/call arguments as JSON text or an object', () => {
  const argsRaw = '{"blocks":[{"type":"divider"}]}'
  assert.equal(renderUiCallArgs({ type: 'tool/call', data: { name: 'render_ui', arguments: argsRaw } }), argsRaw)
  assert.equal(
    renderUiCallArgs({ type: 'tool/call', data: { name: 'render_ui', arguments: { blocks: [{ type: 'divider' }] } } }),
    argsRaw,
  )
  assert.equal(renderUiCallArgs({ type: 'tool/call', data: { name: 'bash', arguments: '{}' } }), '')
  assert.equal(renderUiCallArgs({ type: 'tool/result', data: { name: 'render_ui', arguments: argsRaw } }), '')
  assert.equal(renderUiCallArgs(undefined), '')
  // PTC dispatch shapes carry the same call when a `run_code` script makes it.
  assert.equal(
    renderUiCallArgs({ type: 'tool/ptc-dispatch-start', data: { name: 'render_ui', subCallId: 'c1:ptc:1', arguments: { blocks: [{ type: 'divider' }] } } }),
    argsRaw,
  )
  assert.equal(renderUiCallArgs({ type: 'tool/ptc-dispatch', data: { name: 'render_ui', subCallId: 'c1:ptc:1', arguments: argsRaw } }), argsRaw)
  assert.equal(renderUiCallArgs({ type: 'tool/ptc-dispatch', data: { name: 'bash', subCallId: 'c1:ptc:1', arguments: argsRaw } }), '')
})

test('renderUiCallId reads the direct call id or the nested sub-call id', () => {
  assert.equal(client.__test.renderUiCallId({ type: 'tool/call', data: { name: 'render_ui', callId: 'c1' } }), 'c1')
  assert.equal(
    client.__test.renderUiCallId({ type: 'tool/ptc-dispatch-start', data: { name: 'render_ui', subCallId: 'c1:ptc:1' } }),
    'c1:ptc:1',
  )
  assert.equal(client.__test.renderUiCallId({ type: 'tool/call', data: { name: 'render_ui', callId: 7 } }), '')
  assert.equal(client.__test.renderUiCallId({ type: 'tool/result', data: { name: 'render_ui', callId: 'c1' } }), '')
  assert.equal(client.__test.renderUiCallId(undefined), '')
})

test('the inline definition matches only render_ui calls and builds a visible turn row', () => {
  const argsRaw = JSON.stringify({ blocks: [{ type: 'divider' }] })
  const event = { type: 'tool/call', seq: 42, data: { name: 'render_ui', callId: 'c1', arguments: argsRaw } }
  const match = inlineDefinition.match['tool/call']
  assert.equal(match({ type: 'tool/call', data: { name: 'bash', callId: 'c2', arguments: '{}' } }), null)
  assert.equal(match({ type: 'tool/call', data: { name: 'render_ui', callId: '', arguments: argsRaw } }), null)
  assert.deepEqual(match(event), { id: 'c1', role: 'start' })

  const context = {
    key: 'ctx-key',
    id: 'c1',
    start: { event, location: { kind: 'step', turn: { turn: 1 }, step: {} } },
    matches: [],
  }
  const state = inlineDefinition.start(context, context.start)
  const node = inlineDefinition.buildViewNode({ ...context, state })
  assert.equal(node.key, 'ctx-key')
  assert.equal(node.kind, 'super-cards')
  assert.equal(node.target, 'chat')
  // Outside the folded process: the row is interleaved with the answer text.
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 42)
  assert.equal(node.data.argsRaw, argsRaw)
  assert.equal(inlineDefinition.buildViewNode({ ...context }), null)
})

test('placement selects the group position: answer stays visible, process folds', () => {
  const make = (place) => {
    const spec = place === undefined ? { blocks: [{ type: 'divider' }] } : { place, blocks: [{ type: 'divider' }] }
    const event = { type: 'tool/call', seq: 7, data: { name: 'render_ui', callId: 'c9', arguments: JSON.stringify(spec) } }
    const context = { key: 'k', id: 'c9', start: { event, location: { kind: 'step', turn: { turn: 1 }, step: {} } }, matches: [] }
    const state = inlineDefinition.start(context, context.start)
    return inlineDefinition.buildViewNode({ ...context, state })
  }
  assert.equal(make(undefined).groupTree, 'turn')
  assert.equal(make('answer').groupTree, 'turn')
  assert.equal(make('process').groupTree, 'process')
  assert.equal(make('process').data.place, 'process')
  assert.equal(readPlacement('{"place":"process","blocks":[]}'), 'process')
  assert.equal(readPlacement('{"blocks":[]}'), 'answer')
  assert.equal(readPlacement('not json'), 'answer')
})

test('render_ui called from a run_code script (PTC) still produces one answer row', () => {
  const spec = { title: '日报', place: 'answer', blocks: [{ type: 'divider' }] }
  const argsRaw = JSON.stringify(spec)
  const start = {
    type: 'tool/ptc-dispatch-start',
    seq: 2432,
    data: { rootCallId: 'c1', parentCallId: 'c1', subCallId: 'c1:ptc:1', name: 'render_ui', arguments: spec },
  }
  const settled = {
    type: 'tool/ptc-dispatch',
    seq: 2433,
    data: { rootCallId: 'c1', parentCallId: 'c1', subCallId: 'c1:ptc:1', name: 'render_ui', arguments: spec, isError: false, content: [] },
  }
  // Both dispatch shapes match under the nested call's own identity.
  assert.deepEqual(inlineDefinition.match['tool/ptc-dispatch-start'](start), { id: 'c1:ptc:1', role: 'start' })
  assert.deepEqual(inlineDefinition.match['tool/ptc-dispatch'](settled), { id: 'c1:ptc:1', role: 'start' })
  // A dispatch of any other Tool is not ours.
  assert.equal(
    inlineDefinition.match['tool/ptc-dispatch']({ ...settled, data: { ...settled.data, name: 'bash' } }),
    null,
  )
  const context = {
    key: 'k',
    id: 'c1:ptc:1',
    start: { event: start, location: { kind: 'step', turn: { turn: 26 }, step: {} } },
    matches: [],
  }
  const state = inlineDefinition.start(context, context.start)
  const node = inlineDefinition.buildViewNode({ ...context, state })
  assert.equal(node.kind, 'super-cards')
  // The card lands in the answer flow, exactly like a direct call's card.
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.anchorSeq, 2432)
  assert.equal(node.data.callId, 'c1:ptc:1')
  assert.equal(node.data.argsRaw, argsRaw)
  const tree = inline({ node: { data: node.data }, t: (token) => token })
  assert.equal(tree.type, boundary)
  assert.equal(tree.children[0].type, card)
  assert.equal(tree.children[0].props.block.argsRaw, argsRaw)
  // The settle event reuses the start id, so an identical one is a no-op.
  assert.equal(inlineDefinition.update({ ...context, state }, { event: settled }), state)
  // Different final arguments refresh the spec without moving the row.
  const changed = { ...settled, data: { ...settled.data, arguments: { blocks: [{ type: 'heading', text: 'x' }] } } }
  const updated = inlineDefinition.update({ ...context, state }, { event: changed })
  assert.notEqual(updated, state)
  assert.equal(updated.callId, state.callId)
  assert.equal(updated.seq, state.seq)
  assert.equal(JSON.parse(updated.argsRaw).blocks[0].type, 'heading')
})

test('the live block renders counters and a message feed only with a live source', () => {
  const live = {
    messageCount: 3,
    toolCount: 2,
    messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
  }
  const counter = normalizeBlock({ type: 'live', field: 'messages', label: '消息' })
  const counterTree = renderBlock(counter, 'l', { t: (token) => token, live })
  assert.ok(hasClass(counterTree, 'dsh-sc-live'))
  assert.equal(textOf(counterTree), '消息3')
  const feed = normalizeBlock({ type: 'live', field: 'last-message', limit: 2 })
  const feedTree = renderBlock(feed, 'f', { t: (token) => token, live })
  assert.equal(findAll(feedTree, (node) => hasClass(node, 'dsh-sc-live-line')).length, 2)
  assert.equal(textOf(feedTree).includes('hello'), true)
  // A transcript card has no live source: the block is omitted, not an error.
  assert.equal(renderBlock(counter, 'l', { t: (token) => token }), null)
})

test('selectDockCard picks the newest dock spec and the live facts it listens to', () => {
  const dockArgs = JSON.stringify({ blocks: [{ type: 'live', field: 'messages' }] })
  const answerArgs = JSON.stringify({ blocks: [{ type: 'divider' }] })
  const nodes = new Map([
    ['u1', { kind: 'user', data: { content: [{ type: 'text', text: 'hi' }] } }],
    ['a1', { kind: 'super-cards', data: { place: 'answer', argsRaw: answerArgs } }],
    ['t1', { kind: 'tool-call', data: { root: { name: 'bash' } } }],
    ['d1', {
      kind: 'super-cards',
      location: { kind: 'turn', turn: { turn: 2 } },
      data: { place: 'dock', argsRaw: dockArgs },
    }],
  ])
  const snapshot = { order: ['u1', 'a1', 't1', 'd1'], nodes: { get: (key) => nodes.get(key) } }
  const fingerprint = selectDockCard(snapshot)
  const data = JSON.parse(fingerprint)
  assert.equal(data.spec, dockArgs)
  assert.equal(data.live.messageCount, 1)
  assert.equal(data.live.toolCount, 1)
  assert.equal(data.live.messages.length, 2)
  // No dock call yet, or no snapshot at all: nothing to render.
  assert.equal(selectDockCard({ order: ['u1'], nodes: { get: (key) => nodes.get(key) } }), '')
  assert.equal(selectDockCard(undefined), '')
  // A board belongs to its Turn: once that Turn closes it is retired.
  const closing = { ...snapshot, timeline: { turns: new Map([[2, { status: 'closed' }]]) } }
  assert.equal(selectDockCard(closing), '')
  const running = { ...snapshot, timeline: { turns: new Map([[2, { status: 'open' }]]) } }
  assert.equal(selectDockCard(running), fingerprint)
})

test('the dock board renders a compact collapsible header and body', () => {
  const spec = JSON.stringify({ title: '任务看板', blocks: [{ type: 'progress', items: [{ label: 'p', value: 0.5 }] }] })
  const fingerprint = JSON.stringify({ spec, live: { messageCount: 0, toolCount: 0, messages: [] } })
  const useChat = (selector) => selector({ order: [], nodes: { get: () => undefined } })
  const tree = dock({ useChat: () => fingerprint, t: (token) => token })
  assert.equal(tree.type, 'div')
  assert.ok(hasClass(tree, 'dsh-sc-dock'))
  const head = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-head'))
  assert.equal(head.type, 'div')
  const toggle = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-toggle'))
  assert.equal(toggle.type, 'button')
  assert.equal(toggle.props['aria-expanded'], 'true')
  const close = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-close'))
  assert.equal(close.type, 'button')
  const body = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-body'))
  assert.ok(body)
  assert.equal(body.children[0].type, boundary)
  assert.equal(dock({ useChat: () => '', t: (token) => token }), null)
  assert.equal(dock({ useChat, t: (token) => token }), null)
})

test('a completed dock board collapses to its single header line', () => {
  const spec = JSON.stringify({ title: 'B', blocks: [{ type: 'progress', items: [{ label: 'p', value: 1 }] }] })
  const fingerprint = JSON.stringify({ spec, live: { messageCount: 0, toolCount: 0, messages: [] } })
  const tree = dock({ useChat: () => fingerprint, t: (token) => token })
  const head = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-head'))
  assert.equal(head.props['data-status'], 'success')
  const toggle = findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-toggle'))
  assert.equal(toggle.props['aria-expanded'], 'false')
  assert.equal(findOne(tree, (node) => hasClass(node, 'dsh-sc-dock-body')), null)
})

test('the dock variant drops long-form blocks, caps the list, and hides the card header', () => {
  const argsRaw = JSON.stringify({
    title: 'Board',
    blocks: [
      { type: 'table', columns: ['a'], rows: [['1']] },
      { type: 'progress', items: [{ label: 'p', value: 0.5 }] },
      { type: 'code', code: 'x' },
      { type: 'stats', items: [{ label: 's', value: 1 }] },
      { type: 'badges', items: [{ label: 'b' }] },
    ],
  })
  const tree = card({ phase: 'start', block: { argsRaw }, t: (token) => token, variant: 'dock' })
  assert.ok(hasClass(tree, 'dsh-sc-card--dock'))
  const blocks = findOne(tree, (node) => hasClass(node, 'dsh-sc-blocks'))
  assert.equal(blocks.children.length, 3)
  assert.equal(findOne(tree, (node) => node.type === 'h3'), null)
})

test('a dock card keeps its (invisible) node inside the process position', () => {
  const argsRaw = JSON.stringify({ place: 'dock', blocks: [{ type: 'divider' }] })
  const event = { type: 'tool/call', seq: 11, data: { name: 'render_ui', callId: 'd1', arguments: argsRaw } }
  const context = { key: 'k', id: 'd1', start: { event, location: { kind: 'step', turn: { turn: 2 }, step: {} } }, matches: [] }
  const state = inlineDefinition.start(context, context.start)
  const node = inlineDefinition.buildViewNode({ ...context, state })
  assert.equal(node.groupTree, 'process')
  assert.equal(node.data.place, 'dock')
  assert.equal(inline({ node: { data: node.data }, t: (token) => token }), null)
})

test('a retired board converts to a turn-tail card unless an answer card exists', () => {
  const dockArgs = JSON.stringify({ title: 'B', blocks: [{ type: 'progress', items: [{ label: 'p', value: 1 }] }] })
  const answerArgs = JSON.stringify({ blocks: [{ type: 'divider' }] })
  const make = (extraNodes) => {
    const nodes = new Map([
      ['d1', {
        kind: 'super-cards',
        location: { kind: 'turn', turn: { turn: 2 } },
        data: { place: 'dock', argsRaw: dockArgs },
      }],
      ...extraNodes,
    ])
    return { order: ['d1', ...extraNodes.keys()], nodes: { get: (key) => nodes.get(key) } }
  }
  const plain = make(new Map())
  assert.equal(JSON.parse(selectBoardConversion(plain, 2)).spec, dockArgs)
  assert.equal(selectBoardConversion(plain, 3), '')
  assert.equal(selectBoardConversion(plain, undefined), '')
  const withAnswer = make(new Map([['a1', {
    kind: 'super-cards',
    location: { kind: 'turn', turn: { turn: 2 } },
    data: { place: 'answer', argsRaw: answerArgs },
  }]]))
  assert.equal(selectBoardConversion(withAnswer, 2), '')
  assert.equal(selectBoardConversion(undefined, 2), '')
})

test('the turn-tail board renders the converted card and nothing without a board', () => {
  const spec = JSON.stringify({ title: 'B', blocks: [{ type: 'divider' }] })
  const fingerprint = JSON.stringify({ spec, live: { messageCount: 0, toolCount: 0, messages: [] } })
  const tree = turnTailBoard({ turn: { turn: 2 }, useChat: () => fingerprint, t: (token) => token })
  assert.equal(tree.type, 'div')
  assert.ok(hasClass(tree, 'dsh-sc-tail-card'))
  assert.equal(tree.children[0].type, boundary)
  assert.equal(turnTailBoard({ turn: { turn: 2 }, useChat: () => '', t: (token) => token }), null)
})

test('a tail card leaves the answer flow and ends the turn after the reply', () => {
  const argsRaw = JSON.stringify({
    place: 'tail',
    look: 'relaxed',
    blocks: [
      { type: 'text', text: 'Run the test suite to back the static review?' },
      { type: 'actions', items: [
        { label: 'Run the tests', prompt: 'Run the repo test suite.', tone: 'primary' },
        { label: 'No, that is enough', prompt: 'No, that is enough.' },
      ] },
    ],
  })
  const event = { type: 'tool/call', seq: 12, data: { name: 'render_ui', callId: 't1', arguments: argsRaw } }
  const context = { key: 'k', id: 't1', start: { event, location: { kind: 'step', turn: { turn: 2 }, step: {} } }, matches: [] }
  const state = inlineDefinition.start(context, context.start)
  const node = inlineDefinition.buildViewNode({ ...context, state })
  assert.equal(node.data.place, 'tail')
  // The card must not render inline at the call position: only the Turn tail shows it.
  assert.equal(inline({ node: { data: node.data }, t: (token) => token }), null)

  const answerArgs = JSON.stringify({ blocks: [{ type: 'divider' }] })
  const nodes = new Map([
    ['a1', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'answer', argsRaw: answerArgs } }],
    ['t1', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'tail', argsRaw } }],
    ['t2', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 3 } }, data: { place: 'tail', argsRaw } }],
  ])
  const snapshot = { order: ['a1', 't1', 't2'], nodes: { get: (key) => nodes.get(key) } }
  // A tail card is a hint for its own Turn: once Turn 3 started, Turn 2's
  // footer keeps nothing, while the newest Turn still shows its card.
  assert.equal(selectTailCards(snapshot, 2), '', 'an older Turn retires its tail cards')
  assert.deepEqual(JSON.parse(selectTailCards(snapshot, 3)).cards, [argsRaw], 'the newest Turn keeps its card')
  assert.equal(selectTailCards(snapshot, 4), '')
  assert.equal(selectTailCards(undefined, 2), '')
  assert.equal(selectTailCards(snapshot, undefined), '')

  // A tail card never counts as the Turn's answer card, so a retired board still converts.
  // The board footer is long-lived: a newer Turn does not remove it.
  const boardArgs = JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 1 }] }] })
  const dockNodes = new Map([
    ['b1', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'dock', argsRaw: boardArgs } }],
    ['t1', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'tail', argsRaw } }],
    ['u3', { kind: 'user', location: { kind: 'turn', turn: { turn: 3 } }, data: {} }],
  ])
  const dockPlusTail = { order: ['b1', 't1', 'u3'], nodes: { get: (key) => dockNodes.get(key) } }
  assert.equal(JSON.parse(selectBoardConversion(dockPlusTail, 2)).spec, boardArgs, 'the retired board survives a newer Turn')
  assert.equal(selectTailCards(dockPlusTail, 2), '', 'only the tail cards retire')

  const tree = turnTailCards({ turn: { turn: 2 }, useChat: () => JSON.stringify({ cards: [argsRaw] }), t: (token) => token })
  assert.ok(hasClass(tree, 'dsh-sc-tail-card--next'))
  assert.equal(tree.children.length, 1)
  assert.equal(tree.children[0].type, boundary)
  assert.equal(turnTailCards({ turn: { turn: 2 }, useChat: () => '', t: (token) => token }), null)
})

test('the turn selectors walk the snapshot once per commit, not once per Turn', () => {
  // Every Turn footer mounts its own selector; a per-Turn scan made a long
  // transcript O(Turns × nodes) on every store commit. The shared snapshot
  // index must answer all Turns after a single pass.
  const order = []
  const nodes = new Map()
  const turnCount = 30
  for (let turn = 1; turn <= turnCount; turn += 1) {
    const push = (key, node) => { order.push(key); nodes.set(key, node) }
    push('u' + turn, { kind: 'user', location: { kind: 'turn', turn: { turn } }, data: { content: [{ type: 'text', text: 'q' + turn }] } })
    push('a' + turn, { kind: 'assistant-step', location: { kind: 'turn', turn: { turn } }, data: { blocks: [{ kind: 'text', text: 'a' + turn }] } })
    push('t' + turn, { kind: 'tool-call', location: { kind: 'turn', turn: { turn } }, data: { root: { name: 'bash' } } })
    push('c' + turn, {
      kind: 'super-cards',
      location: { kind: 'turn', turn: { turn } },
      data: { place: 'tail', argsRaw: JSON.stringify({ blocks: [{ type: 'text', text: 'tail ' + turn }] }) },
    })
    push('d' + turn, {
      kind: 'super-cards',
      location: { kind: 'turn', turn: { turn } },
      data: { place: 'dock', argsRaw: JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: turn / turnCount }] }] }) },
    })
  }
  let reads = 0
  const snapshot = {
    order,
    nodes: { get(key) { reads += 1; return nodes.get(key) } },
  }
  for (let turn = 1; turn <= turnCount; turn += 1) {
    selectTailCards(snapshot, turn, (token) => token)
    selectBoardConversion(snapshot, turn)
  }
  selectDockCard(snapshot)
  assert.ok(reads <= order.length + 2, 'one pass serves every Turn (' + reads + ' node reads for ' + order.length + ' nodes)')

  // Behaviour is unchanged: the newest Turn keeps its tail card, an older one
  // retires, and the last dock board is still the live one.
  const latest = JSON.parse(selectTailCards(snapshot, turnCount, (token) => token))
  assert.equal(latest.cards.length, 1)
  assert.equal(selectTailCards(snapshot, 1), '')
  const lastDock = JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 1 }] }] })
  assert.equal(JSON.parse(selectDockCard(snapshot)).spec, lastDock)
  assert.equal(JSON.parse(selectBoardConversion(snapshot, turnCount)).spec, lastDock)
})

test('the tool row renders nothing once inline placement is installed', () => {
  const harness = createFakeContext()
  client.apply(harness.ctx)
  assert.equal(row({ phase: 'start', block: { argsRaw: JSON.stringify({ blocks: [{ type: 'divider' }] }) }, t: (token) => token }), null)
  assert.equal(row({ phase: 'result', block: { isError: true, content: [] }, t: (token) => token }), null)
})

test('card lifecycle status: explicit wins, full progress completes, partial stays running, plain cards stay plain', () => {
  const spec = (status, value) => normalizeSpec({
    status,
    blocks: [{ type: 'progress', items: [{ label: 'p', value }] }],
  })
  assert.equal(resolveStatus(spec('warn', 0.4)), 'warn')
  assert.equal(resolveStatus(spec(undefined, 1)), 'success')
  assert.equal(resolveStatus(spec(undefined, 0.4)), 'running')
  // A card with nothing to complete is a display card, not a running one.
  const noProgress = normalizeSpec({ blocks: [{ type: 'text', text: 'x' }] })
  assert.equal(resolveStatus(noProgress), 'none')

  const done = card({ phase: 'start', block: { argsRaw: JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 1 }] }] }) }, t: (token) => token })
  assert.equal(done.props['data-status'], 'success')
  // A finished row shows its own check mark next to 100%.
  assert.ok(findOne(done, (node) => hasClass(node, 'dsh-sc-progress-check')))
  const running = card({ phase: 'start', block: { argsRaw: JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 0.5 }] }] }) }, t: (token) => token })
  assert.equal(running.props['data-status'], 'running')
  // A completed Turn hands the card back without a live "running" state.
  const converted = card({ phase: 'start', completed: true, block: { argsRaw: JSON.stringify({ blocks: [{ type: 'text', text: 'x' }] }) }, t: (token) => token })
  assert.equal(converted.props['data-status'], 'none')
})

test('a display card carries no status pill and never folds itself', () => {
  // Nothing to complete: title + stats, no explicit status, no progress block.
  const display = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: '插件架构', blocks: [{ type: 'stats', items: [{ label: '行数', value: '879' }, { label: '槽位', value: '4' }, { label: '测试', value: '84' }] }] }) },
    t: (token) => token,
  })
  assert.equal(display.props['data-status'], 'none')
  assert.equal(findOne(display, (node) => hasClass(node, 'dsh-sc-status')), null)
  assert.equal(hasClass(display, 'dsh-sc-card--line'), false)
  // The header still renders its title, but a read-only display card keeps no
  // close button: there is nothing to dismiss.
  const head = findOne(display, (node) => hasClass(node, 'dsh-sc-head'))
  assert.ok(head)
  assert.equal(findOne(display, (node) => hasClass(node, 'dsh-sc-close')), null)

  // `status: "none"` keeps a full-progress card a display card: no pill, no fold.
  const forced = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ status: 'none', title: '容量', blocks: [{ type: 'progress', items: [{ label: 'a', value: 1 }, { label: 'b', value: 1 }, { label: 'c', value: 1 }] }] }) },
    t: (token) => token,
  })
  assert.equal(forced.props['data-status'], 'none')
  assert.equal(findOne(forced, (node) => hasClass(node, 'dsh-sc-status')), null)
  assert.equal(hasClass(forced, 'dsh-sc-card--line'), false)

  // A plain board stays expanded and shows no state label.
  const spec = JSON.stringify({ title: 'B', blocks: [{ type: 'stats', items: [{ label: 'x', value: 1 }] }] })
  const fingerprint = JSON.stringify({ spec, live: { messageCount: 0, toolCount: 0, messages: [] } })
  const board = dock({ useChat: () => fingerprint, t: (token) => token })
  const dockHead = findOne(board, (node) => hasClass(node, 'dsh-sc-dock-head'))
  assert.equal(dockHead.props['data-status'], 'none')
  assert.equal(textOf(dockHead).includes('status.none'), false)
  // Expanded: the body wrapper exists (the card inside is mounted by the
  // boundary at render time, so the wrapper is what this test can see).
  assert.ok(findOne(board, (node) => hasClass(node, 'dsh-sc-dock-body')))
})

test('the card header shows a status pill, and the dock header reflects the state', () => {
  const spec = JSON.stringify({ title: 'T', status: 'success', blocks: [{ type: 'divider' }] })
  const tree = card({ phase: 'start', block: { argsRaw: spec }, t: (token) => token })
  const pill = findOne(tree, (node) => hasClass(node, 'dsh-sc-status'))
  assert.ok(pill)
  assert.equal(hasClass(pill, 'dsh-sc-status--success'), true)
  assert.equal(textOf(pill), 'status.success')

  const fingerprint = JSON.stringify({ spec, live: { messageCount: 0, toolCount: 0, messages: [] } })
  const dockTree = dock({ useChat: () => fingerprint, t: (token) => token })
  const head = findOne(dockTree, (node) => hasClass(node, 'dsh-sc-dock-head'))
  assert.equal(head.props['data-status'], 'success')
  assert.equal(textOf(head).includes('status.success'), true)
})

test('a completed card with several items folds into one checked line', () => {
  const argsRaw = JSON.stringify({
    title: '发布清单',
    blocks: [{
      type: 'progress',
      items: [
        { label: '构建', value: 1 },
        { label: '测试', value: 1 },
        { label: '灰度', value: 1 },
        { label: '全量', value: 1 },
      ],
    }],
  })
  const folded = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(hasClass(folded, 'dsh-sc-card--line'))
  assert.equal(folded.props['data-status'], 'success')
  const head = findOne(folded, (node) => hasClass(node, 'dsh-sc-line-head'))
  assert.equal(head.type, 'button')
  assert.equal(head.props['aria-expanded'], 'false')
  assert.equal(findOne(folded, (node) => hasClass(node, 'dsh-sc-blocks')), null)
  assert.equal(textOf(folded).includes('card.doneMeta'), true)

  // Few items stay expanded: folding is for multi-item cards.
  const small = normalizeSpec({ blocks: [{ type: 'stats', items: [{ label: 'a', value: 1 }] }] })
  const smallCard = card({ phase: 'start', block: { argsRaw: JSON.stringify({ status: 'success', blocks: small.blocks }) }, t: (token) => token })
  assert.equal(hasClass(smallCard, 'dsh-sc-card--line'), false)
  assert.ok(findOne(smallCard, (node) => hasClass(node, 'dsh-sc-blocks')))

  // A running card never folds.
  const running = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: 'T', blocks: [{ type: 'progress', items: [{ label: 'a', value: 0.4 }, { label: 'b', value: 0 }, { label: 'c', value: 0 }] }] }) },
    t: (token) => token,
  })
  assert.equal(hasClass(running, 'dsh-sc-card--line'), false)
})

test('controls bind a DSH setting and hand prompts to the agent', () => {
  const block = normalizeControls({
    type: 'controls',
    title: '外观',
    items: [
      { kind: 'setting', setting: 'theme', label: '主题', options: [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }] },
      { kind: 'button', label: '改 README', action: { kind: 'prompt', prompt: '把 README 加一节', send: true } },
    ],
  })
  assert.ok(block)
  const calls = { themes: [], drafts: [], submits: 0 }
  const bindings = { theme: { get: () => 'light', set: (value) => calls.themes.push(value) } }
  const inputActions = {
    setDraft: (text) => calls.drafts.push(text),
    submit: () => { calls.submits += 1 },
  }
  const tree = mount(controls({ block, t: (token) => token, inputActions, bindings }))
  const buttons = findAll(tree, (node) => node.type === 'button')
  const light = buttons.find((node) => textOf(node) === '浅色')
  const dark = buttons.find((node) => textOf(node) === '深色')
  assert.equal(light.props['aria-pressed'], 'true')
  dark.props.onClick()
  assert.deepEqual(calls.themes, ['dark'])
  const action = buttons.find((node) => textOf(node) === '改 README')
  action.props.onClick()
  assert.deepEqual(calls.drafts, ['把 README 加一节'])
  assert.equal(calls.submits, 1)
  // Only the allow-listed setting keys survive normalization.
  const bogus = normalizeControls({ type: 'controls', items: [{ kind: 'setting', setting: 'shell', options: [{ value: 'x' }] }] })
  assert.equal(bogus, null)
  assert.deepEqual(readControlValues(block, bindings), { theme: 'light' })
})

test('cards carry a close button and rest as a reopenable one-line bar', () => {
  const tree = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ status: 'running', blocks: CANONICAL.blocks }) },
    t: (token) => token,
  })
  const close = findOne(tree, (node) => hasClass(node, 'dsh-sc-close'))
  assert.equal(close.type, 'button')
  assert.equal(close.props['aria-label'], 'close.label')

  let reopened = 0
  const resting = closed({ title: '部署摘要', t: (token) => token, onReopen: () => { reopened += 1 } })
  assert.ok(hasClass(resting, 'dsh-sc-card--closed'))
  const head = findOne(resting, (node) => hasClass(node, 'dsh-sc-line-head'))
  assert.equal(head.type, 'button')
  assert.equal(head.props['aria-label'], 'card.reopen')
  head.props.onClick()
  assert.equal(reopened, 1)
  assert.equal(textOf(resting).includes('card.closed'), true)
})

test('a content field name used as a block type renders as its control', () => {
  const spec = normalizeSpec({ blocks: [{ type: 'note', text: '参考' }, { type: 'summary', text: '一句话' }, { type: 'mystery' }] })
  assert.deepEqual(spec.blocks.map((block) => block.type), ['callout', 'callout', client.__test.unsupportedType])
  assert.equal(spec.blocks[0].tone, 'warn')
  assert.equal(spec.blocks[1].tone, 'info')

  const tree = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ blocks: [{ type: 'note', text: '参考' }, { type: 'divider' }] }) },
    t: (token) => token,
  })
  assert.equal(findOne(tree, (node) => hasClass(node, 'dsh-sc-unsupported')), null, 'the alias is not a placeholder')
  const callout = findOne(tree, (node) => hasClass(node, 'dsh-sc-callout'))
  assert.ok(callout, 'the folded block draws its control')
  assert.equal(textOf(callout).includes('参考'), true)
})

test('an unknown wire block type renders a visible missing-renderer notice', () => {
  const tree = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: 'T', blocks: [{ type: 'mystery' }, { type: 'divider' }] }) },
    t: (token) => token,
  })
  const blocks = findOne(tree, (node) => hasClass(node, 'dsh-sc-blocks'))
  assert.equal(blocks.children.length, 2, 'the unknown block still occupies its place')
  const notice = findOne(tree, (node) => hasClass(node, 'dsh-sc-unsupported'))
  assert.ok(notice, 'unknown types render a placeholder, not nothing')
  assert.equal(notice.props['data-block-type'], 'mystery')
  assert.equal(textOf(notice).includes('block.missing'), true)
  assert.equal(textOf(notice).includes('block.missingHint'), true)
})

test('registering a renderer replaces the placeholder, and disposing restores it', () => {
  const argsRaw = JSON.stringify({ blocks: [{ type: 'meter', value: 42 }] })
  const before = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(findOne(before, (node) => hasClass(node, 'dsh-sc-unsupported')))

  const dispose = client.__test.service.blocks.register({
    type: 'meter',
    normalize: (raw) => ({ type: 'meter', value: raw.value }),
    render: (block, key) => ({ type: 'div', key, props: { className: 'dsh-sc-meter', 'data-value': String(block.value) }, children: [] }),
  })
  try {
    const after = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
    assert.equal(findOne(after, (node) => hasClass(node, 'dsh-sc-unsupported')), null)
    const meter = findOne(after, (node) => hasClass(node, 'dsh-sc-meter'))
    assert.ok(meter, 'the registered renderer takes over the same recorded call')
    assert.equal(meter.props['data-value'], '42')
  } finally {
    dispose()
  }
  const restored = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(findOne(restored, (node) => hasClass(node, 'dsh-sc-unsupported')), 'disposing restores the placeholder')
})

test('host and client agree on the block contract, the dock subset, and the caps', () => {
  const host = hostPlugin.__test
  // One wire set: a block type cannot exist on one half only.
  assert.deepEqual(client.__test.blockOrder, host.BLOCK_TYPES)
  // One alias table: a content field name folds identically on both halves.
  assert.deepEqual([...client.__test.blockAliases], [...host.BLOCK_ALIASES])
  // One dock subset: the board's allow-list is the same on both sides.
  assert.deepEqual(client.__test.dockBlocks, host.DOCK_BLOCKS)
  assert.equal(client.__test.dockBlockLimit, host.CAPS.dockBlocks)
  // One set of caps: the client never renders a bigger payload than the Host accepts.
  assert.deepEqual(client.__test.caps, {
    blocks: host.CAPS.blocks,
    tableRows: host.CAPS.tableRows,
    sparklineValues: host.CAPS.sparklineValues,
    codeChars: host.CAPS.codeChars,
    textChars: host.CAPS.textChars,
    actions: host.CAPS.actions,
    htmlChars: host.CAPS.htmlChars,
    pieSlices: host.CAPS.pieSlices,
    treeNodes: host.CAPS.treeNodes,
    treeDepth: host.CAPS.treeDepth,
    heatmapCells: host.CAPS.heatmapCells,
    diffLines: host.CAPS.diffLines,
    kanbanColumns: host.CAPS.kanbanColumns,
    kanbanCards: host.CAPS.kanbanCards,
    tabs: host.CAPS.tabs,
    tabBlocks: host.CAPS.tabBlocks,
    columns: host.CAPS.columns,
    columnBlocks: host.CAPS.columnBlocks,
    imageChars: host.CAPS.imageChars,
  })
  // The render-coverage fixture covers exactly the declared block set.
  assert.deepEqual([...ALL_TYPES].sort(), [...client.__test.blockOrder].sort())
})

// ---------------------------------------------------------------------------
// Block / placement registries and the `superCards` extension service
// ---------------------------------------------------------------------------

test('the block registry lists every type in documentation order and marks the dock subset', () => {
  const impl = client.__test.blocks
  assert.deepEqual(client.__test.blockOrder, Object.keys(impl))
  assert.equal(client.__test.blockOrder.length, 29)
  assert.deepEqual(
    client.__test.dockBlocks,
    Object.keys(impl).filter((type) => impl[type].dock === true),
  )
  // Every entry is a complete implementation, so a card can never half-render.
  for (const type of Object.keys(impl)) {
    assert.equal(typeof impl[type].normalize, 'function', type + '.normalize')
    assert.equal(typeof impl[type].render, 'function', type + '.render')
    assert.equal(typeof impl[type].dock, 'boolean', type + '.dock')
  }
  // The registry lookup is prototype-safe: a type named like an object member
  // is still unknown, not an inherited function.
  assert.equal(normalizeBlock({ type: 'constructor', text: 'x' }), null)
  assert.equal(renderBlock({ type: 'toString', text: 'x' }, 'k', { t: (token) => token }), null)
})

test('replacing a block renderer changes renderBlock and a mounted card', () => {
  const service = client.__test.service
  const argsRaw = JSON.stringify({ title: 'T', blocks: [{ type: 'table', columns: ['a'], rows: [['1']] }] })
  const before = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(findOne(before, (node) => hasClass(node, 'dsh-sc-table')))
  assert.ok(findOne(before, (node) => hasClass(node, 'dsh-sc-table-block')))

  const changes = []
  const unsubscribe = service.subscribe((change) => changes.push(change))
  const restore = service.blocks.replace('table', {
    render: (block, key) => reactStub.createElement('div', { key, className: 'dsh-sc-table-replaced' }),
  })
  try {
  assert.deepEqual(changes, [{ kind: 'blocks', name: 'table' }])
  // The mounted card re-renders from the same recorded args: the new renderer wins.
  const remounted = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(findOne(remounted, (node) => hasClass(node, 'dsh-sc-table-replaced')))
  assert.equal(findOne(remounted, (node) => hasClass(node, 'dsh-sc-table-block')), null)
  // renderBlock itself follows the registry (same entry the card uses).
  const rendered = renderBlock(normalizeSpec({ blocks: [{ type: 'table', columns: ['a'], rows: [['1']] }] }).blocks[0], 'k', { t: (token) => token })
  assert.equal(rendered.props.className, 'dsh-sc-table-replaced')

  } finally {
    // The disposer restores the built-in renderer for new and mounted cards.
    restore()
    unsubscribe()
  }
  const after = card({ phase: 'start', block: { argsRaw }, t: (token) => token })
  assert.ok(findOne(after, (node) => hasClass(node, 'dsh-sc-table-block')))
  assert.equal(findOne(after, (node) => hasClass(node, 'dsh-sc-table-replaced')), null)
  assert.equal(service.blocks.get('table').render, client.__test.blocks.table.render)
})

test('the service registers a new block type that normalizes and renders', () => {
  const service = client.__test.service
  assert.equal(service.blocks.has('meter'), false)
  const restore = service.blocks.register({
    type: 'meter',
    dock: true,
    normalize: (raw) => (typeof raw.value === 'number' ? { type: 'meter', value: raw.value } : null),
    render: (block, key) => reactStub.createElement('div', { key, className: 'dsh-sc-meter', 'data-value': block.value }),
  })
  try {
  assert.equal(service.blocks.has('meter'), true)
  assert.ok(service.blocks.list().includes('meter'))
  assert.ok(client.__test.blockOrder.includes('meter') === false, 'documentation order stays the built-in order')

  const spec = normalizeSpec({ blocks: [{ type: 'meter', value: 42 }] })
  assert.equal(spec.blocks.length, 1)
  assert.equal(spec.blocks[0].type, 'meter')
  const rendered = renderBlock(spec.blocks[0], 'm', { t: (token) => token })
  assert.equal(rendered.props.className, 'dsh-sc-meter')
  assert.equal(rendered.props['data-value'], 42)

  // A registered `dock: true` type is accepted on a compact board.
  const board = card({
    phase: 'start',
    variant: 'dock',
    block: { argsRaw: JSON.stringify({ blocks: [{ type: 'meter', value: 7 }] }) },
    t: (token) => token,
  })
  assert.ok(findOne(board, (node) => hasClass(node, 'dsh-sc-meter')))

  } finally {
    // The disposer removes the registration: the type is unknown again.
    restore()
  }
  assert.equal(service.blocks.has('meter'), false)
  assert.equal(normalizeBlock({ type: 'meter', value: 42 }), null)
})

test('registry mutations notify subscribers until they unsubscribe', () => {
  const service = client.__test.service
  const seen = []
  const unsubscribe = service.subscribe((change) => seen.push(change))
  const restore = service.blocks.register({ type: 'note', render: () => null })
  try {
    assert.deepEqual(seen, [{ kind: 'blocks', name: 'note' }])
    restore()
  } finally {
    if (service.blocks.has('note')) restore()
  }
  assert.deepEqual(seen, [{ kind: 'blocks', name: 'note' }, { kind: 'blocks', name: 'note' }])

  unsubscribe()
  const restoreAgain = service.blocks.register({ type: 'note', render: () => null })
  try {
    assert.equal(seen.length, 2)
  } finally {
    restoreAgain()
  }
  // A definition without a render function is refused instead of breaking render.
  const refused = service.blocks.register({ type: 'broken' })
  assert.equal(service.blocks.has('broken'), false)
  refused()
})

test('placements fall back to answer and drive the chat row position', () => {
  assert.deepEqual(client.__test.placement('answer'), { groupTree: 'turn' })
  assert.deepEqual(client.__test.placement('process'), { groupTree: 'process' })
  assert.deepEqual(client.__test.placement('dock'), { groupTree: 'process', dock: true })
  assert.deepEqual(client.__test.placement('sideways'), { groupTree: 'turn' })
  assert.deepEqual(client.__test.placement('tail'), { groupTree: 'turn', tail: true })

  const make = (place) => {
    const spec = place === undefined ? { blocks: [{ type: 'divider' }] } : { place, blocks: [{ type: 'divider' }] }
    const event = { type: 'tool/call', seq: 7, data: { name: 'render_ui', callId: 'c9', arguments: JSON.stringify(spec) } }
    const context = { key: 'k', id: 'c9', start: { event, location: { kind: 'step', turn: { turn: 1 }, step: {} } }, matches: [] }
    const state = inlineDefinition.start(context, context.start)
    return inlineDefinition.buildViewNode({ ...context, state })
  }
  assert.equal(make('answer').groupTree, 'turn')
  assert.equal(make('process').groupTree, 'process')
  // The dock node stays in the process position and has no inline row.
  assert.equal(make('dock').groupTree, 'process')
  assert.equal(make('dock').data.place, 'dock')
  assert.equal(make('sideways').groupTree, 'turn')
  assert.equal(make('sideways').data.place, 'answer')
  assert.equal(inline({ node: { data: { argsRaw: '{"blocks":[]}', place: 'dock' } }, t: (token) => token }), null)
  assert.ok(inline({ node: { data: { argsRaw: '{"blocks":[]}', place: 'answer' } }, t: (token) => token }))
})

test('the service registers a placement and the disposer restores the fallback', () => {
  const service = client.__test.service
  const restore = service.placements.register('beside', { groupTree: 'turn', tail: true })
  try {
  assert.equal(readPlacement(JSON.stringify({ place: 'beside', blocks: [] })), 'beside')
  assert.deepEqual(client.__test.placement('beside'), { groupTree: 'turn', tail: true })
  const event = { type: 'tool/call', seq: 3, data: { name: 'render_ui', callId: 'c3', arguments: JSON.stringify({ place: 'beside', blocks: [{ type: 'divider' }] }) } }
  const context = { key: 'k', id: 'c3', start: { event, location: { kind: 'unresolved' } }, matches: [] }
  const node = inlineDefinition.buildViewNode({ ...context, state: inlineDefinition.start(context, context.start) })
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.data.place, 'beside')

  } finally {
    restore()
  }
  assert.equal(readPlacement(JSON.stringify({ place: 'beside', blocks: [] })), 'answer')
  assert.deepEqual(client.__test.placement('beside'), { groupTree: 'turn' })
})

test('apply provides the superCards service through ctx.provide', () => {
  const provided = []
  const ctx = {
    get: () => undefined,
    effect(callback) {
      const disposer = callback()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    provide(name, value) {
      provided.push({ name, value })
      return () => {
        provided.pop()
      }
    },
  }
  assert.doesNotThrow(() => client.apply(ctx))
  assert.equal(provided.length, 1)
  assert.equal(provided[0].name, 'superCards')
  const service = provided[0].value
  assert.equal(service, client.__test.service)
  assert.equal(service.version, 1)
  assert.equal(typeof service.subscribe, 'function')
  assert.deepEqual(service.blocks.list(), client.__test.blockOrder)
  assert.deepEqual(service.placements.list(), ['answer', 'process', 'dock', 'tail'])
  assert.equal(typeof service.blocks.get('table').render, 'function')
  assert.equal(service.blocks.has('table'), true)
  assert.equal(service.placements.get('dock').dock, true)
})

// ---------------------------------------------------------------------------
// diagram block
// ---------------------------------------------------------------------------

test('diagram: a flowchart renders one node group and one edge path per item', () => {
  const block = normalizeBlock({
    type: 'diagram',
    kind: 'flowchart',
    title: 'Deploy flow',
    nodes: [
      { id: 'req', label: 'Request' },
      { id: 'build', label: 'Build', detail: 'ci' },
      { id: 'ok', label: 'Deploy', shape: 'round', tone: 'success' },
    ],
    edges: [{ from: 'req', to: 'build' }, { from: 'build', to: 'ok', label: 'green' }],
  })
  assert.ok(block)
  assert.equal(block.kind, 'flowchart')
  const tree = mount(renderBlock(block, 'k', { t: (token) => token }))
  const figure = findOne(tree, (node) => hasClass(node, 'dsh-sc-diagram'))
  assert.ok(figure)
  assert.equal(figure.props['data-kind'], 'flowchart')
  assert.equal(textOf(figure).includes('Deploy flow'), true)

  const svg = findOne(tree, (node) => hasClass(node, 'dsh-sc-diagram-svg'))
  assert.equal(svg.props.role, 'img')
  assert.equal(typeof svg.props['aria-label'], 'string')
  assert.match(svg.props.viewBox, /^0 0 \d+ \d+$/)

  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-node')).length, 3)
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-edge')).length, 2)
  assert.equal(findOne(tree, (node) => node.type === 'marker').props.id.includes('diagram-arrow'), true)
  assert.equal(textOf(tree).includes('green'), true)
  assert.equal(textOf(tree).includes('ci'), true, 'node detail renders as a second line')
})

test('diagram: TB direction stacks layers vertically', () => {
  const block = normalizeBlock({
    type: 'diagram',
    direction: 'TB',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
  })
  const tree = mount(renderBlock(block, 'k', { t: (token) => token }))
  assert.equal(findOne(tree, (node) => hasClass(node, 'dsh-sc-diagram')).props['data-direction'], 'TB')
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-edge')).length, 1)
})

test('diagram: a sequence renders participants, lifelines, and dashed return/async arrows', () => {
  const block = normalizeBlock({
    type: 'diagram',
    kind: 'sequence',
    participants: [
      { id: 'user', label: 'User' },
      { id: 'api', label: 'API' },
      { id: 'db', label: 'DB' },
    ],
    messages: [
      { from: 'user', to: 'api', label: 'GET /deploy' },
      { from: 'api', to: 'db', label: 'query', style: 'return' },
      { from: 'api', to: 'api', label: 'retry', style: 'async' },
    ],
  })
  assert.ok(block)
  const tree = mount(renderBlock(block, 'k', { t: (token) => token }))
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-participant')).length, 3)
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-lifeline')).length, 3)
  const messages = findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-message'))
  assert.equal(messages.length, 3)
  assert.equal(messages.filter((node) => node.props['data-style'] === 'return').length, 1)
  assert.equal(messages.filter((node) => node.props['data-style'] === 'async').length, 1)
  const arrowPaths = findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-message-arrow'))
  const dashed = arrowPaths.filter((node) => node.props.className.includes('dsh-sc-diagram-edge--dashed'))
  assert.equal(dashed.length, 2, 'return and async messages are dashed')
  assert.equal(textOf(tree).includes('GET /deploy'), true)
})

test('diagram: class entities render header, field, and method compartments', () => {
  const block = normalizeBlock({
    type: 'diagram',
    kind: 'class',
    nodes: [
      { id: 'auth', label: 'AuthService', fields: ['+ token: string'], methods: ['+ login()'] },
      { id: 'user', label: 'User', fields: ['+ id: number'] },
    ],
    edges: [{ from: 'auth', to: 'user', label: 'uses' }],
  })
  const tree = mount(renderBlock(block, 'k', { t: (token) => token }))
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-entity')).length, 2)
  // AuthService: fields + methods separators; User: fields separator.
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-separator')).length, 3)
  assert.equal(textOf(tree).includes('+ token: string'), true)
  assert.equal(textOf(tree).includes('+ login()'), true)
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-relation')).length, 1)
  assert.equal(textOf(tree).includes('uses'), true)
})

test('diagram: unknown kinds fall back to flowchart and state nodes default to round', () => {
  const unknown = normalizeBlock({ type: 'diagram', kind: 'mindmap', nodes: [{ id: 'a', label: 'A' }] })
  assert.equal(unknown.kind, 'flowchart')
  const tree = mount(renderBlock(unknown, 'k', { t: (token) => token }))
  assert.equal(findOne(tree, (node) => hasClass(node, 'dsh-sc-diagram')).props['data-kind'], 'flowchart')

  const state = normalizeBlock({
    type: 'diagram',
    kind: 'state',
    nodes: [{ id: 'a', label: 'Idle' }, { id: 'b', label: 'Running' }],
    edges: [{ from: 'a', to: 'b' }],
  })
  const stateTree = mount(renderBlock(state, 'k', { t: (token) => token }))
  const nodes = findAll(stateTree, (node) => hasClass(node, 'dsh-sc-diagram-node'))
  assert.equal(nodes.length, 2)
  const shape = nodes[0].children.find((node) => hasClass(node, 'dsh-sc-diagram-shape'))
  assert.equal(shape.type, 'rect')
  assert.equal(
    shape.props.rx,
    client.__test.diagramGeometry.nodeHeight / 2,
    'round shape uses half the node height',
  )
})

test('diagram: unknown endpoints are pruned and empty diagrams normalize to null', () => {
  const graph = normalizeBlock({
    type: 'diagram',
    nodes: [{ id: 'a', label: 'A' }],
    edges: [{ from: 'a', to: 'missing' }, { from: 'a', to: 'a', label: 'loop' }],
  })
  assert.deepEqual(graph.edges, [{ from: 'a', to: 'a', label: 'loop' }])
  const tree = mount(renderBlock(graph, 'k', { t: (token) => token }))
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-diagram-edge')).length, 1, 'self loop is drawn')

  // A sequence message with an unknown endpoint leaves nothing drawable.
  assert.equal(normalizeBlock({
    type: 'diagram',
    kind: 'sequence',
    participants: [{ id: 'a', label: 'A' }],
    messages: [{ from: 'a', to: 'ghost' }],
  }), null)
  assert.equal(normalizeBlock({ type: 'diagram', kind: 'flowchart', nodes: [] }), null)
  assert.equal(normalizeBlock({ type: 'diagram', kind: 'sequence', participants: [] }), null)
})

test('diagram: over-long labels are truncated with an ellipsis and keep a full title', () => {
  const long = 'x'.repeat(120)
  const block = normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: long }] })
  const capped = block.nodes[0].label
  assert.equal(capped.length, client.__test.diagramCaps.label)
  const tree = mount(renderBlock(block, 'k', { t: (token) => token }))
  const fullTitle = findOne(tree, (node) => node.type === 'title' && textOf(node) === capped)
  assert.ok(fullTitle, 'the full label lives in a title child')
  const visible = findAll(tree, (node) => node.type === 'text')
    .map((node) => textOf(node))
    .join('')
  assert.equal(visible.includes('…'), true)
})

test('diagramToMermaid rebuilds readable source for every kind', () => {
  const toMermaid = client.__test.diagramToMermaid

  const flow = normalizeBlock({
    type: 'diagram',
    kind: 'flowchart',
    direction: 'TB',
    nodes: [{ id: 'a', label: 'Start' }, { id: 'b', label: 'Ok?', shape: 'diamond' }, { id: 'c', label: 'End', shape: 'round' }],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'yes', style: 'dashed' }],
  })
  const flowText = toMermaid(flow)
  assert.match(flowText, /^flowchart TB/)
  assert.match(flowText, /a\[Start\]/)
  assert.match(flowText, /b\{Ok\?\}/)
  assert.match(flowText, /c\(End\)/)
  assert.match(flowText, /a --> b/)
  assert.match(flowText, /b -\.->\|yes\| c/)

  const state = normalizeBlock({
    type: 'diagram',
    kind: 'state',
    nodes: [{ id: '__start', label: '开始', shape: 'circle' }, { id: 'idle', label: 'Idle' }, { id: '__end', label: '结束', shape: 'circle' }],
    edges: [{ from: '__start', to: 'idle' }, { from: 'idle', to: '__end', label: 'stop' }],
  })
  const stateText = toMermaid(state)
  assert.match(stateText, /^stateDiagram-v2/)
  assert.match(stateText, /\[\*\] --> idle/)
  assert.match(stateText, /idle --> \[\*\] : stop/)

  const sequence = normalizeBlock({
    type: 'diagram',
    kind: 'sequence',
    participants: [{ id: 'u', label: 'User' }, { id: 's', label: 'Server' }],
    messages: [{ from: 'u', to: 's', label: 'login' }, { from: 's', to: 'u', label: 'token', style: 'return' }],
  })
  const seqText = toMermaid(sequence)
  assert.match(seqText, /^sequenceDiagram/)
  assert.match(seqText, /participant u as User/)
  assert.match(seqText, /u->>s: login/)
  assert.match(seqText, /s-->>u: token/)

  const klass = normalizeBlock({
    type: 'diagram',
    kind: 'class',
    nodes: [{ id: 'Order', label: 'Order', fields: ['id: uuid'], methods: ['submit()'] }, { id: 'User', label: 'User' }],
    edges: [{ from: 'Order', to: 'User', label: 'belongs to' }],
  })
  const classText = toMermaid(klass)
  assert.match(classText, /^classDiagram/)
  assert.match(classText, /class Order \{/)
  assert.match(classText, /    id: uuid/)
  assert.match(classText, /    submit\(\)/)
  assert.match(classText, /Order --> User : belongs to/)
})

test('normalize keeps an optional mermaid source, capped for display', () => {
  const block = normalizeBlock({ type: 'diagram', kind: 'flowchart', nodes: [{ id: 'a', label: 'A' }], source: 'flowchart LR\n  a[A]' })
  assert.equal(block.source, 'flowchart LR\n  a[A]')

  const long = 'x'.repeat(9000)
  assert.equal(normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }], source: long }).source.length, 8000)
  assert.equal('source' in normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }] }), false)
  assert.equal('source' in normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }], source: '   ' }), false)
})

test('diagram card toggles between the chart and its source', () => {
  const diagram = normalizeBlock({
    type: 'diagram',
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
    source: 'flowchart LR\n  a[A] --> b[B]',
  })
  const chart = mount(renderBlock(diagram, 'k', { t: (token) => token }))
  const button = findOne(chart, (node) => hasClass(node, 'dsh-sc-diagram-toggle'))
  assert.ok(button, 'the chart carries a source toggle')
  assert.equal(button.type, 'button')
  assert.equal(button.props['aria-pressed'], 'false')
  assert.equal(button.props['aria-label'], 'diagram.source')
  assert.equal(textOf(button), 'diagram.source')
  assert.ok(findOne(chart, (node) => hasClass(node, 'dsh-sc-diagram-svg')))
  assert.equal(findOne(chart, (node) => hasClass(node, 'dsh-sc-diagram-source')), null)

  const source = client.__test.diagramFigure(diagram, { t: (token) => token, blockKey: 'k', showSource: true })
  const pre = findOne(source, (node) => hasClass(node, 'dsh-sc-diagram-source'))
  assert.ok(pre)
  assert.equal(pre.type, 'pre')
  assert.equal(textOf(pre), diagram.source)
  assert.equal(findOne(source, (node) => hasClass(node, 'dsh-sc-diagram-svg')), null)
  const pressed = findOne(source, (node) => hasClass(node, 'dsh-sc-diagram-toggle'))
  assert.equal(pressed.props['aria-pressed'], 'true')
  assert.equal(pressed.props['aria-label'], 'diagram.chart')

  // A block without stored source shows the rebuilt mermaid instead.
  const rebuilt = client.__test.diagramFigure(
    normalizeBlock({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }] }),
    { t: (token) => token, blockKey: 'k', showSource: true },
  )
  assert.match(textOf(findOne(rebuilt, (node) => hasClass(node, 'dsh-sc-diagram-source'))), /^flowchart LR/)
})

test('auto-converted diagram cards keep the original mermaid as source', () => {
  const code = 'flowchart LR\n  A[开始] --> B{检查}\n  B -->|是| C((完成))'
  const specs = client.__test.buildAutoSpecs('```mermaid\n' + code + '\n```')
  assert.equal(specs.length, 1)
  assert.equal(specs[0].blocks[0].type, 'diagram')
  assert.equal(specs[0].blocks[0].source, code)

  const sourceView = client.__test.diagramFigure(specs[0].blocks[0], { t: (token) => token, blockKey: 'k', showSource: true })
  assert.equal(textOf(findOne(sourceView, (node) => hasClass(node, 'dsh-sc-diagram-source'))), code)
})

test('only cards with something to dismiss show a close button', () => {
  // A read-only display card (text + diagram, no lifecycle, no interaction) has
  // no close affordance: nothing would be dismissed.
  const staticCard = card({
    phase: 'start',
    block: {
      argsRaw: JSON.stringify({
        title: '只读说明',
        blocks: [
          { type: 'text', text: '一段说明' },
          { type: 'diagram', kind: 'state', nodes: [{ id: 'a', label: '空闲' }], edges: [] },
        ],
      }),
    },
    t: (token) => token,
  })
  assert.equal(staticCard.props['data-status'], 'none')
  assert.equal(findOne(staticCard, (node) => hasClass(node, 'dsh-sc-close')), null)
  assert.ok(findOne(staticCard, (node) => hasClass(node, 'dsh-sc-head')))

  // Interactive or dynamic blocks keep the card dismissible.
  for (const block of [
    { type: 'controls', items: [{ kind: 'button', label: 'Go', action: { kind: 'prompt', prompt: 'go' } }] },
    { type: 'actions', items: [{ label: '再看一次', prompt: '再看一次' }] },
    { type: 'live', field: 'messages' },
  ]) {
    const tree = card({ phase: 'start', block: { argsRaw: JSON.stringify({ blocks: [block] }) }, t: (token) => token })
    assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-close')), block.type + ' keeps its close button')
  }

  // A lifecycle status also keeps it dismissible.
  const running = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 0.4 }] }] }) },
    t: (token) => token,
  })
  assert.ok(findOne(running, (node) => hasClass(node, 'dsh-sc-close')))
})

test('extractFences finds mermaid fences only', () => {
  const text = [
    'Lead-in prose.',
    '```js',
    'const a = 1',
    '```',
    '```mermaid',
    'graph LR',
    'A-->B',
    '```',
    'Middle.',
    '~~~mmd',
    'sequenceDiagram',
    'A->>B: hi',
    '~~~',
    '```',
    'not a language',
    '```',
  ].join('\n')
  const fences = client.__test.extractFences(text)
  assert.equal(fences.length, 2)
  assert.equal(fences[0].lang, 'mermaid')
  assert.match(fences[0].code, /graph LR/)
  assert.equal(fences[1].lang, 'mmd')
  assert.match(fences[1].code, /sequenceDiagram/)
  assert.deepEqual(client.__test.extractFences('no fences here'), [])
  assert.deepEqual(client.__test.extractFences(undefined), [])
})

test('parseMermaid reads flowcharts, directions, shapes and labeled edges', () => {
  const parsed = client.__test.parseMermaid([
    '%% Deploy flow',
    'graph LR',
    'A[开始] --> B{检查?}',
    'B -->|是| C(发布)',
    'C -.-> D[告警]',
    'E((结束))',
  ].join('\n'))
  assert.ok(parsed)
  assert.equal(parsed.title, 'Deploy flow')
  const block = parsed.block
  assert.equal(block.kind, 'flowchart')
  assert.equal(block.direction, 'LR')
  const byId = Object.fromEntries(block.nodes.map((node) => [node.id, node]))
  assert.deepEqual(byId.A, { id: 'A', label: '开始', shape: 'box' })
  assert.equal(byId.B.shape, 'diamond')
  assert.equal(byId.C.shape, 'round')
  assert.equal(byId.E.shape, 'circle')
  assert.deepEqual(block.edges.map((edge) => [edge.from, edge.to, edge.label || '']), [
    ['A', 'B', ''],
    ['B', 'C', '是'],
    ['C', 'D', ''],
  ])
  assert.equal(block.edges[2].style, 'dashed')

  assert.equal(client.__test.parseMermaid('graph TD\nA-->B').block.direction, 'TB')
  assert.equal(client.__test.parseMermaid('graph RL\nA-->B').block.direction, 'LR')
})

test('parseMermaid reads sequence, class and state diagrams', () => {
  const sequence = client.__test.parseMermaid([
    'sequenceDiagram',
    'participant U as 用户',
    'participant S as 服务',
    'U->>S: 登录',
    'S-->>U: token',
    'U->S: ping',
  ].join('\n')).block
  assert.equal(sequence.kind, 'sequence')
  assert.deepEqual(sequence.participants.map((participant) => participant.label), ['用户', '服务'])
  assert.deepEqual(sequence.messages.map((message) => message.style), ['sync', 'return', 'sync'])
  assert.equal(sequence.messages[1].label, 'token')

  const klass = client.__test.parseMermaid([
    'classDiagram',
    'class Order {',
    '+id: uuid',
    '+submit()',
    '}',
    'Order --> User : belongs to',
    'User : +email',
  ].join('\n')).block
  assert.equal(klass.kind, 'class')
  const order = klass.nodes.find((node) => node.id === 'Order')
  const user = klass.nodes.find((node) => node.id === 'User')
  assert.deepEqual(order.fields, ['id: uuid'])
  assert.deepEqual(order.methods, ['submit()'])
  assert.deepEqual(user.fields, ['email'])
  assert.deepEqual(klass.edges, [{ from: 'Order', to: 'User', label: 'belongs to' }])

  const state = client.__test.parseMermaid([
    'stateDiagram-v2',
    '[*] --> Idle',
    'Idle --> Running : start',
    'Running --> [*]',
  ].join('\n')).block
  assert.equal(state.kind, 'state')
  assert.equal(state.direction, 'LR')
  const labels = state.nodes.map((node) => node.label)
  assert.ok(labels.includes('开始'))
  assert.ok(labels.includes('结束'))
  assert.deepEqual(state.edges.map((edge) => edge.label || ''), ['', 'start', ''])
})

test('parseMermaid returns null for sources outside the subset', () => {
  assert.equal(client.__test.parseMermaid('pie title X'), null)
  assert.equal(client.__test.parseMermaid('graph LR\nsubgraph one\nend'), null)
  assert.equal(client.__test.parseMermaid('sequenceDiagram\nNote over A: hi'), null)
  assert.equal(client.__test.parseMermaid(''), null)
  assert.equal(client.__test.parseMermaid(undefined), null)
})

test('auto definition matches assistant messages with mermaid fences only', () => {
  const definition = client.__test.autoDefinition
  const withFence = {
    type: 'assistant/message',
    seq: 42,
    data: { message: { content: [{ type: 'text', text: 'Here:\n```mermaid\ngraph LR\nA-->B\n```' }] } },
  }
  const withoutFence = {
    type: 'assistant/message',
    seq: 43,
    data: { message: { content: [{ type: 'text', text: 'no diagram' }, { type: 'reasoning', text: '```mermaid\ngraph LR\nA-->B\n```' }] } },
  }
  assert.equal(definition.match['assistant/message'](withoutFence), null)
  assert.deepEqual(definition.match['assistant/message'](withFence), { id: 'auto-42', role: 'start' })

  const state = definition.start(null, { event: withFence })
  assert.equal(state.seq, 42)
  assert.equal(state.specs.length, 1)
  const node = definition.buildViewNode({
    key: 'auto-key',
    id: 'auto-42',
    start: { location: { kind: 'unresolved' } },
    state,
  })
  assert.equal(node.kind, client.__test.autoKind)
  assert.equal(node.target, 'chat')
  assert.equal(node.anchorSeq, 42)
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.data.specs.length, 1)
})

test('auto row renders a card per fence and keeps the source on parse failure', () => {
  const specs = client.__test.buildAutoSpecs([
    '```mermaid',
    'graph LR',
    'A-->B',
    '```',
    '```mermaid',
    'pie title X',
    '```',
  ].join('\n'))
  assert.equal(specs.length, 2)
  assert.equal(specs[0].blocks[0].type, 'diagram')
  assert.equal(specs[1].blocks[0].type, 'code')
  assert.match(specs[1].blocks[0].code, /pie title X/)

  const wrapper = client.__test.autoRow({ node: { data: { specs } }, t: (token) => token })
  assert.equal(hasClass(wrapper, 'dsh-sc-auto'), true)
  assert.equal(wrapper.children.length, 2)

  const chart = mount(wrapper.children[0].children[0])
  assert.equal(hasClass(chart, 'dsh-sc-card'), true)
  // The converted diagram is a read-only card: no close button.
  assert.equal(findOne(chart, (node) => hasClass(node, 'dsh-sc-close')), null)

  const fallback = mount(wrapper.children[1].children[0])
  const title = findOne(fallback, (node) => hasClass(node, 'dsh-sc-title'))
  assert.ok(title, 'the fallback card is titled')
  assert.equal(textOf(title).includes('图表源码'), true)

  assert.equal(client.__test.autoRow({ node: { data: { specs: [] } }, t: (token) => token }), null)
  assert.equal(client.__test.autoRow({ t: (token) => token }), null)
})

// ---------------------------------------------------------------------------
// subagent progress card
// ---------------------------------------------------------------------------

/** Build one `team/member` event; `time` is the optional event epoch ms. */
function teamMemberEvent(seq, teamId, member, time) {
  const event = { type: 'team/member', seq, data: { teamId, member } }
  if (typeof time === 'number') event.time = time
  return event
}

/** Build one `team/task` event; `time` is the optional event epoch ms. */
function teamTaskEvent(seq, teamId, task, time) {
  const event = { type: 'team/task', seq, data: { teamId, task } }
  if (typeof time === 'number') event.time = time
  return event
}

/** Build one `team/message/queued` event. */
function teamMessageEvent(seq, teamId, message, time) {
  const event = { type: 'team/message/queued', seq, data: { teamId, message } }
  if (typeof time === 'number') event.time = time
  return event
}

/** Build one `team/message/delivered` event. */
function teamDeliveredEvent(seq, teamId, messageId, time) {
  const event = { type: 'team/message/delivered', seq, data: { teamId, messageId } }
  if (typeof time === 'number') event.time = time
  return event
}

/** Fold a list of team events through the definition into one state. */
function mergeTeamEvents(events) {
  const definition = client.__test.teamDefinition
  let state = null
  for (const event of events) {
    state = state === null ? definition.start(null, { event }) : definition.update({ state }, { event })
  }
  return state
}

/** Translator backed by the plugin's own zh dictionary. */
function zhT(token, vars) {
  const template = client.__test.dictionaries.zh[token]
  if (template === undefined) return token
  return template.replace(/\{(\w+)\}/gu, (match, name) => (
    vars && vars[name] !== undefined ? String(vars[name]) : match
  ))
}

/** Translator backed by the plugin's own en dictionary. */
function enT(token, vars) {
  const template = client.__test.dictionaries.en[token]
  if (template === undefined) return token
  return template.replace(/\{(\w+)\}/gu, (match, name) => (
    vars && vars[name] !== undefined ? String(vars[name]) : match
  ))
}

test('team definition matches member and task events only', () => {
  const definition = client.__test.teamDefinition
  assert.equal(definition.match({ type: 'assistant/message', seq: 1, data: {} }), null)
  assert.equal(definition.match({ type: 'team/member', seq: 2, data: { member: {} } }), null)
  assert.equal(definition.match({ type: 'team/task', seq: 3, data: { task: {} } }), null)
  assert.deepEqual(
    definition.match(teamMemberEvent(4, 'team-1', { id: 'm1', name: 'host', phase: 'provisioning' })),
    { id: 'team-team-1', role: 'start' },
  )
  assert.deepEqual(
    definition.match(teamTaskEvent(5, 'team-1', { id: 'task-1', status: 'pending' })),
    { id: 'team-team-1', role: 'start' },
  )
})

test('team card: members alone are running; progress follows the tasks', () => {
  const definition = client.__test.teamDefinition
  const teamSpec = client.__test.teamSpec
  const t = (token) => token

  let state = definition.start(null, { event: teamMemberEvent(4, 'team-1', { id: 'm1', name: 'host', phase: 'provisioning' }) })
  const node = definition.buildViewNode({ key: 'k', id: 'team-team-1', start: { location: { kind: 'unresolved' } }, state })
  assert.equal(node.kind, client.__test.teamKind)
  assert.equal(node.anchorSeq, 4)
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.visibility, 'visible')

  let spec = teamSpec(node.data, t)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks[0].type, 'stats')
  assert.deepEqual(spec.blocks[0].items.map((item) => item.value), ['1', '0/0'])
  assert.equal(spec.blocks[1], undefined, 'no tasks means no progress block')

  state = definition.update({ state }, { event: teamTaskEvent(5, 'team-1', { id: 'task-1', subject: 'Host half', status: 'pending' }) })
  spec = teamSpec(state, t)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks[1].items[0].value, 0)

  state = definition.update({ state }, { event: teamTaskEvent(6, 'team-1', { id: 'task-1', subject: 'Host half', status: 'in_progress' }) })
  spec = teamSpec(state, t)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks[1].items[0].value, 0.5)
  const anchored = definition.buildViewNode({
    key: 'k',
    id: 'team-team-1',
    start: { location: { kind: 'unresolved' } },
    state,
  })
  assert.equal(anchored.anchorSeq, 4, 'the card stays anchored at the first team event')

  state = definition.update({ state }, { event: teamTaskEvent(7, 'team-1', { id: 'task-1', subject: 'Host half', status: 'completed' }) })
  spec = teamSpec(state, t)
  assert.equal(spec.status, 'success')
  assert.equal(spec.status === 'success', true)
  assert.deepEqual(spec.blocks[0].items.map((item) => item.value), ['1', '1/1'])
  assert.equal(spec.blocks[1].items[0].value, 1)
})

test('team card: failures derive error, single failure warns, in-progress keeps running', () => {
  const definition = client.__test.teamDefinition
  const teamSpec = client.__test.teamSpec
  const t = (token) => token
  const statusOf = (events) => {
    let state = null
    for (const event of events) {
      state = state === null ? definition.start(null, { event }) : definition.update({ state }, { event })
    }
    return teamSpec(state, t)
  }

  const failed = statusOf([
    teamTaskEvent(10, 'team-1', { id: 'a', subject: 'A', status: 'failed' }),
    teamTaskEvent(11, 'team-1', { id: 'b', subject: 'B', status: 'failed' }),
  ])
  assert.equal(failed.status, 'error')
  assert.equal(failed.blocks[1].items[0].tone, 'error')
  assert.equal(failed.blocks[1].items[0].value, 0)

  const single = statusOf([teamTaskEvent(12, 'team-1', { id: 'a', subject: 'A', status: 'failed' })])
  assert.equal(single.status, 'warn', 'one failure without other work is a warning')

  const running = statusOf([
    teamTaskEvent(13, 'team-1', { id: 'a', subject: 'A', status: 'failed' }),
    teamTaskEvent(14, 'team-1', { id: 'b', subject: 'B', status: 'in_progress' }),
  ])
  assert.equal(running.status, 'running', 'a failure does not end a run that is still in progress')
})

test('team card: no tasks follows member phases; cancelled work warns', () => {
  const t = (token) => token
  const derive = client.__test.deriveTeamStatus

  assert.equal(derive([], [{ id: 'm1', phase: 'provisioning' }]), 'running')
  assert.equal(derive([], [{ id: 'm1', phase: 'active' }]), 'running')
  assert.equal(derive([], [{ id: 'm1', phase: 'done' }]), 'success')

  assert.equal(derive([{ id: 'a', status: 'cancelled' }], []), 'warn')
  assert.equal(derive([{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'in_progress' }], []), 'running')
  assert.equal(derive([{ id: 'a', status: 'failed' }, { id: 'b', status: 'failed' }], []), 'error')

  const spec = client.__test.teamSpec({ members: [{ id: 'm1', name: 'host', phase: 'provisioning' }], tasks: [] }, t)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks.length, 1, 'members alone have no progress block')
})

test('team card renders stats and progress, and folds when every task completes', () => {
  const data = {
    members: [{ id: 'm1', name: 'host', phase: 'active' }],
    tasks: [
      { id: 't1', subject: 'Host half', status: 'in_progress' },
      { id: 't2', subject: 'Client half', status: 'pending' },
    ],
  }
  const row = client.__test.teamRow({ node: { data }, t: (token) => token })
  const card = mount(row.children[0])
  assert.ok(findOne(card, (node) => hasClass(node, 'dsh-sc-stats')))
  assert.ok(findOne(card, (node) => hasClass(node, 'dsh-sc-progress')))
  assert.equal(textOf(card).includes('team.title'), true)

  const doneData = {
    members: [{ id: 'm1', name: 'host', phase: 'active' }],
    tasks: [
      { id: 't1', subject: 'Host half', status: 'completed' },
      { id: 't2', subject: 'Client half', status: 'completed' },
    ],
  }
  const doneCard = mount(client.__test.teamRow({ node: { data: doneData }, t: (token) => token }).children[0])
  assert.equal(hasClass(doneCard, 'dsh-sc-card--line'), true, 'a finished run folds into one checked line')
  assert.ok(findOne(doneCard, (node) => hasClass(node, 'dsh-sc-line-head')))

  // Nothing to show yet: the row renders nothing at all.
  assert.equal(client.__test.teamRow({ node: { data: { members: [], tasks: [] } }, t: (token) => token }), null)
  assert.equal(client.__test.teamRow({ t: (token) => token }), null)
})

test('team card keeps long task subjects whole and caps the progress rows', () => {
  const long = 'x'.repeat(60)
  const tasks = [{ id: 't0', subject: long, status: 'in_progress' }]
  for (let index = 1; index < 20; index += 1) {
    tasks.push({ id: 't' + index, subject: 'Task ' + index, status: 'pending' })
  }
  const spec = client.__test.teamSpec({ members: [], tasks }, (token) => token)
  assert.equal(spec.blocks[1].items.length, 12)
  assert.equal(spec.blocks[1].items[0].label, long, 'the subject is kept whole; the row ellipsizes it on overflow')
  assert.equal(spec.blocks[1].items[0].label.includes('…'), false)
  assert.equal(spec.blocks[0].items[1].value, '0/20')
  // Truncation is visual, never in the data: the rule ellipsizes an overflowing
  // label and keeps the value column from being pushed out of the row.
  const rule = client.__test.css.match(/\.dsh-sc-progress-label \{[^}]*\}/)
  assert.ok(rule, 'the progress label rule exists')
  assert.match(rule[0], /overflow: hidden;/)
  assert.match(rule[0], /text-overflow: ellipsis;/)
  assert.match(rule[0], /white-space: nowrap;/)
})

test('relativeTime: zh/en boundaries, missing and backwards clocks', () => {
  const { relativeTime } = client.__test
  assert.equal(relativeTime(0, 0), '刚刚')
  assert.equal(relativeTime(4999, 0), '刚刚')
  assert.equal(relativeTime(5000, 0), '5 秒前')
  assert.equal(relativeTime(59000, 0), '59 秒前')
  assert.equal(relativeTime(60000, 0), '1 分钟前')
  assert.equal(relativeTime(3599000, 0), '59 分钟前')
  assert.equal(relativeTime(3600000, 0), '1 小时前')
  assert.equal(relativeTime(7200000, 0), '2 小时前')
  assert.equal(relativeTime(0, 5000), '刚刚', 'a backwards clock never renders a negative time')
  assert.equal(relativeTime(1000, undefined), '刚刚', 'a missing timestamp reads as just now')
  assert.equal(relativeTime(5000, 0, enT), '5s ago')
  assert.equal(relativeTime(120000, 0, enT), '2m ago')
  assert.equal(relativeTime(7200000, 0, enT), '2h ago')
  assert.equal(relativeTime(0, 0, enT), 'just now')
})

test('team definition matches all four team events and rejects malformed payloads', () => {
  const definition = client.__test.teamDefinition
  const parse = client.__test.teamEventData
  const member = teamMemberEvent(4, 'team-1', { id: 'm1', name: 'host', phase: 'provisioning' }, 1700000000000)
  assert.deepEqual(parse(member), {
    type: 'member',
    teamId: 'team-1',
    time: 1700000000000,
    member: { id: 'm1', name: 'host', phase: 'provisioning' },
  })
  const queued = teamMessageEvent(20, 'team-1', {
    id: 'msg-1',
    senderId: 'lead',
    senderName: 'lead',
    targetId: 'web-builder',
    content: [{ type: 'text', text: 'hello' }],
  }, 1700000001000)
  assert.deepEqual(definition.match(queued), { id: 'team-team-1', role: 'start' })
  assert.equal(parse(queued).type, 'message-queued')
  assert.equal(parse(queued).time, 1700000001000)
  const delivered = teamDeliveredEvent(21, 'team-1', 'msg-1', 1700000002000)
  assert.deepEqual(definition.match(delivered), { id: 'team-team-1', role: 'start' })
  assert.equal(parse(delivered).type, 'message-delivered')
  assert.equal(parse(delivered).messageId, 'msg-1')
  // An event without a member/task/message id, or without a messageId.
  assert.equal(definition.match({ type: 'team/message/queued', seq: 22, data: { teamId: 'team-1' } }), null)
  assert.equal(definition.match({ type: 'team/message/delivered', seq: 23, data: { teamId: 'team-1', messageId: '' } }), null)
  assert.equal(definition.match({ type: 'team/message/delivered', seq: 24, data: { teamId: 'team-1' } }), null)
  // A team event with no recorded time still parses; it just has no timestamp.
  assert.equal(parse({ type: 'team/message/queued', data: { teamId: 'team-1', message: { id: 'x' } } }).time, null)
})

test('team card: queued messages join the trail and delivery marks the line', () => {
  const { teamSpec, mergeTeamEvent } = client.__test
  const now = 1700000010000
  let state = mergeTeamEvents([
    teamMemberEvent(1, 'team-1', { id: 'm1', name: 'lead', phase: 'active' }, now - 10000),
    teamTaskEvent(2, 'team-1', { id: 'task-1', subject: 'Client half', status: 'in_progress' }, now - 8000),
    teamMessageEvent(3, 'team-1', {
      id: 'msg-1',
      senderName: 'lead',
      targetId: 'web-builder',
      content: [{ type: 'text', text: '  please review the ticker  ' }],
    }, now - 6000),
  ])
  assert.deepEqual(state.trail[0], {
    time: now - 6000,
    kind: 'message',
    text: 'lead -> web-builder: please review the ticker',
    messageId: 'msg-1',
    senderName: 'lead',
    targetId: 'web-builder',
    excerpt: 'please review the ticker',
    delivered: false,
  })
  const spec = teamSpec(state, zhT, now)
  const list = spec.blocks.find((block) => block.type === 'list')
  assert.ok(list, 'a message adds the activity list')
  assert.ok(list.items[0].includes('lead -> web-builder: please review the ticker'))
  assert.ok(list.items[0].includes('6 秒前'))

  state = mergeTeamEvent(state, teamDeliveredEvent(4, 'team-1', 'msg-1', now - 2000))
  assert.equal(state.trail.length, 3, 'delivery marks the line instead of adding one')
  assert.equal(state.trail[0].delivered, true)
  assert.ok(teamSpec(state, zhT, now).blocks.find((block) => block.type === 'list').items[0].includes('已送达'))
})

test('team activity trail keeps the newest six entries and caps the line at 60 chars', () => {
  const now = 1700000100000
  const events = [teamMemberEvent(1, 'team-1', { id: 'm1', name: 'lead', phase: 'active' }, now - 20000)]
  for (let index = 0; index < 9; index += 1) {
    events.push(teamMessageEvent(index + 2, 'team-1', {
      id: 'msg-' + index,
      senderName: 'lead',
      targetId: 'web-builder',
      content: [{ type: 'text', text: 'x'.repeat(80) }],
    }, now - 15000 + index * 1000))
  }
  const state = mergeTeamEvents(events)
  assert.equal(state.trail.length, client.__test.teamTrailLimit)
  assert.deepEqual(state.trail.map((entry) => entry.messageId), ['msg-8', 'msg-7', 'msg-6', 'msg-5', 'msg-4', 'msg-3'])
  assert.equal(state.trail[0].excerpt, 'x'.repeat(60))
  assert.equal(state.trail[0].text, 'lead -> web-builder: ' + 'x'.repeat(60))
})

test('team card: status transitions keep full subjects and timed captions', () => {
  const { teamDefinition, teamSpec } = client.__test
  const now = 1700000200000
  const long = 'A'.repeat(120)
  let state = mergeTeamEvents([teamTaskEvent(1, 'team-1', { id: 'task-1', subject: long, status: 'pending' }, now - 9000)])
  let spec = teamSpec(state, zhT, now)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks[1].items[0].label, long, 'the full subject is never truncated in the data')
  assert.equal(spec.blocks[1].items[0].caption, '待开始 · 9 秒前')
  assert.equal(spec.blocks[1].items[0].value, 0)

  state = teamDefinition.update({ state }, { event: teamTaskEvent(2, 'team-1', { id: 'task-1', subject: long, status: 'in_progress' }, now - 6000) })
  spec = teamSpec(state, zhT, now)
  assert.equal(spec.status, 'running')
  assert.equal(spec.blocks[1].items[0].caption, '进行中 · 6 秒前')
  assert.equal(spec.blocks[1].items[0].value, 0.5)
  assert.equal(spec.blocks[2].type, 'list', 'task changes also feed the activity trail')
  assert.ok(spec.blocks[2].items[0].includes('task-1 进行中'))
  assert.ok(spec.blocks[2].items[1].includes('task-1 待开始'))
  assert.ok(teamSpec(state, zhT, now).blocks[0].items.some((item) => item.label === '最后活动'))

  state = teamDefinition.update({ state }, { event: teamTaskEvent(3, 'team-1', { id: 'task-1', subject: long, status: 'completed' }, now) })
  spec = teamSpec(state, zhT, now)
  assert.equal(spec.status, 'success')
  assert.equal(spec.blocks[1].items[0].caption, '完成 · 刚刚')
  assert.equal(spec.blocks[1].items[0].value, 1)
  assert.equal(spec.blocks[0].items[2].value, '刚刚')
})

test('team card: mixed run shows stats, progress bars, and the newest three activity lines', () => {
  const now = 1700000300000
  const state = mergeTeamEvents([
    teamMemberEvent(1, 'team-1', { id: 'm1', name: 'lead', phase: 'active' }, now - 30000),
    teamMemberEvent(2, 'team-1', { id: 'm2', name: 'web-builder', phase: 'active' }, now - 28000),
    teamTaskEvent(3, 'team-1', { id: 'task-1', subject: 'Host half', status: 'completed' }, now - 20000),
    teamTaskEvent(4, 'team-1', { id: 'task-2', subject: 'Client half', status: 'in_progress' }, now - 5000),
    teamMessageEvent(5, 'team-1', {
      id: 'msg-1',
      senderName: 'lead',
      targetId: 'web-builder',
      content: [{ type: 'text', text: 'ship it' }],
    }, now - 1000),
  ])
  const spec = client.__test.teamSpec(state, zhT, now)
  assert.equal(spec.title, '子代理进度')
  assert.equal(spec.status, 'running')
  assert.deepEqual(spec.blocks.map((block) => block.type), ['stats', 'progress', 'list'])
  assert.deepEqual(spec.blocks[0].items.map((item) => item.label), ['子代理', '任务完成', '最后活动'])
  assert.deepEqual(spec.blocks[0].items.map((item) => item.value), ['2', '1/2', '刚刚'])
  assert.deepEqual(spec.blocks[1].items.map((item) => item.label), ['Host half', 'Client half'])
  assert.equal(spec.blocks[1].items[1].caption, '进行中 · 5 秒前')
  assert.equal(spec.blocks[2].items.length, client.__test.teamTrailVisible)
  assert.ok(spec.blocks[2].items[0].includes('lead -> web-builder: ship it'))
  assert.ok(spec.blocks[2].items[2].includes('task-1 完成'))
})

test('team row ticks only while the run is running and always clears the interval', () => {
  const { teamRow, teamTicker, shouldTickTeamCard } = client.__test
  const now = 1700000400000
  const running = {
    members: [{ id: 'm1', name: 'lead', phase: 'active' }],
    tasks: [{ id: 't1', subject: 'Host half', status: 'in_progress', time: now - 3000 }],
  }
  const row = teamRow({ node: { data: running }, t: zhT })
  assert.equal(row.props['data-team-tick'], '1')
  assert.equal(row.props['data-team-interval'], '1000')
  assert.deepEqual(teamTicker(running), { status: 'running', active: true, intervalMs: 1000 })

  const done = {
    members: [{ id: 'm1', name: 'lead', phase: 'active' }],
    tasks: [
      { id: 't1', subject: 'Host half', status: 'completed', time: now - 2000 },
      { id: 't2', subject: 'Client half', status: 'completed', time: now - 1000 },
    ],
  }
  assert.equal(teamRow({ node: { data: done }, t: zhT }).props['data-team-tick'], '0')
  assert.equal(teamTicker(done).active, false)
  const doneCard = mount(teamRow({ node: { data: done }, t: zhT }).children[0])
  assert.equal(hasClass(doneCard, 'dsh-sc-card--line'), true, 'a finished run still folds into one checked line')

  const failed = { members: [], tasks: [{ id: 't1', subject: 'A', status: 'failed', time: now }] }
  assert.equal(teamTicker(failed).active, false)
  assert.equal(teamTicker({ members: [], tasks: [{ id: 't1', status: 'cancelled' }] }).status, 'warn')
  assert.equal(shouldTickTeamCard('running'), true)
  assert.equal(shouldTickTeamCard('running', true), false, 'a folded card never ticks')
  assert.equal(shouldTickTeamCard('success'), false)
  assert.equal(shouldTickTeamCard('warn'), false)
  assert.equal(shouldTickTeamCard('error'), false)
  // The effect owns exactly one interval and its cleanup clears it.
  assert.match(SOURCE, /const timer = setInterval\(\(\) => setClock\(Date\.now\(\)\), TEAM_TICK_MS\)/)
  assert.match(SOURCE, /return \(\) => clearInterval\(timer\)/)
})

test('sparkIndexAt maps a horizontal ratio to the nearest sample index', () => {
  const at = client.__test.sparkIndexAt
  assert.equal(at(-0.3, 5), 0)
  assert.equal(at(0, 5), 0)
  assert.equal(at(0.24, 5), 1)
  assert.equal(at(0.5, 5), 2)
  assert.equal(at(0.99, 5), 4)
  assert.equal(at(1, 5), 4)
  assert.equal(at(1.5, 5), 4)
  assert.equal(at(0, 1), 0)
  assert.equal(at(0.5, 1), 0)
  assert.equal(at(0, 0), -1)
  assert.equal(at(0.5, -1), -1)
  assert.equal(at(NaN, 5), 0)
  assert.equal(at(undefined, 5), 0)
})

test('sparkline hover wrapper is keyboardable and carries a live reader', () => {
  const spark = mount(renderAllBlocks()[ALL_TYPES.indexOf('sparkline')])
  const box = findOne(spark, (node) => node.props && node.props.role === 'img')
  assert.ok(box)
  assert.equal(box.props.tabIndex, 0)
  assert.equal(typeof box.props.onPointerMove, 'function')
  assert.equal(typeof box.props.onPointerLeave, 'function')
  assert.equal(typeof box.props.onKeyDown, 'function')
  const live = findOne(spark, (node) => node.props && node.props['aria-live'] === 'polite')
  assert.ok(live)
})

test('sparkline active state draws the guide, the dot, and the sample read-out', () => {
  const original = reactStub.useState
  const block = normalizeBlock({
    type: 'sparkline',
    title: 'Latency',
    values: [10, 20, 30, 40, 50],
    labels: ['a', 'b', 'c', 'd', 'e'],
    unit: 'ms',
  })
  try {
    // Force the hovered sample: state 2 of 5 -> x 50%, value 30 -> y 50%.
    reactStub.useState = () => [2, () => {}]
    const tree = client.__test.sparkBlock({ block, t: (token) => token })
    const guide = findOne(tree, (node) => hasClass(node, 'dsh-sc-spark-guide'))
    const dot = findOne(tree, (node) => hasClass(node, 'dsh-sc-spark-dot'))
    const tip = findOne(tree, (node) => hasClass(node, 'dsh-sc-spark-tip'))
    assert.equal(guide.props.style.left, '50%')
    assert.equal(dot.props.style.left, '50%')
    assert.equal(dot.props.style.top, '50%')
    assert.equal(textOf(tip), 'c · 30ms')
    assert.equal(findOne(tree, (node) => node.props && node.props['aria-live'] === 'polite').children[0], 'c · 30ms')

    // Hover maps pointer x onto the nearest sample; keys move one sample.
    let next
    reactStub.useState = (initial) => [initial, (value) => { next = value }]
    const live = client.__test.sparkBlock({ block, t: (token) => token })
    const box = findOne(live, (node) => node.props && node.props.role === 'img')
    box.props.onPointerMove({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) }, clientX: 50 })
    assert.equal(next, 2)
    box.props.onPointerMove({ currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) }, clientX: 100 })
    assert.equal(next, 4)
    box.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
    assert.equal(next, 0)
    box.props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} })
    assert.equal(next, 4)
    box.props.onKeyDown({ key: 'Home', preventDefault() {} })
    assert.equal(next, 0)
    box.props.onKeyDown({ key: 'End', preventDefault() {} })
    assert.equal(next, 4)
    box.props.onPointerLeave()
    assert.equal(next, null)
    box.props.onKeyDown({ key: 'Escape' })
    assert.equal(next, null)
  } finally {
    reactStub.useState = original
  }
})

// ---------------------------------------------------------------------------
// Expanded widget set: tree, heatmap, diff, kanban, tabs
// ---------------------------------------------------------------------------

test('tree renders nested lists with note, badge, and a toned label', () => {
  const block = normalizeBlock({
    type: 'tree',
    title: 'Repo',
    nodes: [
      { label: 'src', note: 'source', children: [{ label: 'client.js', badge: '6.9k' }, { label: 'index.js', tone: 'success' }] },
      { label: 'README.md' },
    ],
  })
  const tree = renderBlock(block, 'tr', { t: (token) => token })
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-tree')).length, 2, 'one list per level')
  const rows = findAll(tree, (node) => hasClass(node, 'dsh-sc-tree-row'))
  assert.equal(rows.length, 4)
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-tree-note'))), 'source')
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-tree-badge'))), '6.9k')
  const toned = findOne(tree, (node) => hasClass(node, 'dsh-sc-tree-label') && node.props.style)
  assert.ok(toned.props.style['--dsh-sc-tone'])
  assert.equal(normalizeBlock({ type: 'tree', nodes: [] }), null)
})

test('heatmap buckets cells into five levels and labels the scale', () => {
  const block = normalizeBlock({
    type: 'heatmap',
    title: 'Deploys',
    columns: 4,
    max: 8,
    items: [{ label: 'a', value: 0 }, { label: 'b', value: 1 }, { label: 'c', value: 5 }, { label: 'd', value: 8 }],
  })
  assert.equal(block.columns, 4)
  const tree = renderBlock(block, 'hm', { t: (token) => token })
  const cells = findAll(tree, (node) => hasClass(node, 'dsh-sc-heat-cell'))
  const grid = findOne(tree, (node) => hasClass(node, 'dsh-sc-heatmap'))
  assert.deepEqual(
    grid.children.map((cell) => cell.props['data-level']),
    ['0', '1', '3', '4'],
  )
  assert.equal(grid.children[2].props.title, 'c · 5')
  assert.equal(grid.props['aria-label'], 'heatmap.label · 4 · 14')
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-heatmap-scale-label')).length, 2)
  assert.equal(cells.length >= 4, true)
})

test('diff marks added, removed, and context lines and summarises the patch', () => {
  const block = normalizeBlock({
    type: 'diff',
    title: 'Retry',
    path: 'src/config.js',
    lines: [{ kind: 'ctx', text: 'retries: 3,' }, { kind: 'del', text: 'timeout: 30,' }, { kind: 'add', text: 'timeout: 45,' }, { kind: 'wat', text: 'still here' }],
  })
  assert.equal(block.lines.length, 4)
  assert.equal(block.lines[3].kind, 'ctx', 'an unknown kind falls back to context')
  const tree = renderBlock(block, 'df', { t: (token) => token })
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-diff-path'))), 'src/config.js')
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-diff-stat-add'))), '+1')
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-diff-stat-del'))), '−1')
  assert.deepEqual(
    findAll(tree, (node) => hasClass(node, 'dsh-sc-diff-line')).map((line) => line.props['data-kind']),
    ['ctx', 'del', 'add', 'ctx'],
  )
})

test('kanban renders columns with cards, badges, counts, and an empty state', () => {
  const block = normalizeBlock({
    type: 'kanban',
    title: 'Sprint',
    columns: [
      { title: 'Todo', tone: 'warn', cards: [{ title: 'Rate limit', text: 'per key', badges: ['P1', 'api'] }] },
      { title: 'Done', cards: [] },
    ],
  })
  const tree = renderBlock(block, 'kb', { t: (token) => token })
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-kanban-col')).length, 2)
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-kanban-card')).length, 1)
  assert.deepEqual(findAll(tree, (node) => hasClass(node, 'dsh-sc-kanban-badge')).map((badge) => textOf(badge)), ['P1', 'api'])
  assert.equal(textOf(findOne(tree, (node) => hasClass(node, 'dsh-sc-kanban-card-text'))), 'per key')
  assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-kanban-empty')))
  assert.deepEqual(findAll(tree, (node) => hasClass(node, 'dsh-sc-kanban-count')).map((count) => textOf(count)), ['1', '0'])
})

test('tabs render a tablist with one selected pane and keyboard selection', () => {
  const block = normalizeBlock({
    type: 'tabs',
    title: 'Services',
    items: [
      { label: 'API', blocks: [{ type: 'stats', items: [{ label: 'p95', value: '212 ms' }] }] },
      { label: 'Worker', blocks: [{ type: 'text', text: 'queue is empty' }] },
    ],
  })
  const original = reactStub.useState
  try {
    reactStub.useState = () => [0, () => {}]
    const tree = client.__test.tabsBlock({ block, t: (token) => token, context: { t: (token) => token } })
    const list = findOne(tree, (node) => node.props && node.props.role === 'tablist')
    assert.ok(list)
    const tabs = findAll(tree, (node) => node.props && node.props.role === 'tab')
    assert.equal(tabs.length, 2)
    assert.equal(tabs[0].props['aria-selected'], 'true')
    assert.equal(tabs[1].props['aria-selected'], 'false')
    const panel = findOne(tree, (node) => node.props && node.props.role === 'tabpanel')
    assert.ok(panel)
    // Only the selected pane's blocks render.
    assert.ok(findOne(panel, (node) => hasClass(node, 'dsh-sc-stats')))
    assert.equal(findOne(panel, (node) => node.type === 'p' && textOf(node) === 'queue is empty'), null)

    let next
    reactStub.useState = (initial) => [initial, (value) => { next = value }]
    const live = client.__test.tabsBlock({ block, t: (token) => token, context: { t: (token) => token } })
    const list2 = findOne(live, (node) => node.props && node.props.role === 'tablist')
    list2.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
    assert.equal(next, 1)
    list2.props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} })
    assert.equal(next, 1, 'from index 0 the left key wraps to the last tab minus one')
  } finally {
    reactStub.useState = original
  }
  // A tab may not nest another tab; empty tab lists are unusable.
  const nested = normalizeBlock({ type: 'tabs', items: [{ label: 'a', blocks: [{ type: 'tabs', items: [] }, { type: 'text', text: 'ok' }] }] })
  assert.deepEqual(nested.items[0].blocks.map((inner) => inner.type), ['text'])
  assert.equal(normalizeBlock({ type: 'tabs', items: [] }), null)
})

test('the tab row is the host SegmentedTabs when the shell exports it', () => {
  const block = normalizeBlock({
    type: 'tabs',
    title: 'Services',
    items: [
      { label: 'API', blocks: [{ type: 'text', text: 'pane one' }] },
      { label: 'Worker', blocks: [{ type: 'text', text: 'pane two' }] },
    ],
  })
  // Stand-in for the host component: the element tree keeps it unrendered, so
  // the props it would receive are read straight off the element.
  function SegmentedTabs() {
    return null
  }
  const primed = captured.factory((id) => {
    if (id === 'react') return reactStub
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { SegmentedTabs }
    throw new Error('unexpected require: ' + id)
  })
  const original = reactStub.useState
  try {
    reactStub.useState = () => [0, () => {}]
    const tree = primed.__test.tabsBlock({ block, t: (token) => token, context: { t: (token) => token } })
    // The host control replaces the local row; the card still owns the pane.
    assert.equal(findAll(tree, (node) => node.props && node.props.role === 'tablist').length, 0)
    const hostRow = findOne(tree, (node) => node.type === SegmentedTabs)
    assert.ok(hostRow)
    assert.equal(hostRow.props.value, 0)
    assert.equal(hostRow.props.size, 'sm', 'a card wants the compact host size')
    assert.equal(hostRow.props.label, 'Services', 'the block title names the tablist')
    assert.equal(hostRow.props.className, 'dsh-sc-tabs-segmented')
    assert.deepEqual(hostRow.props.items, [{ value: 0, label: 'API' }, { value: 1, label: 'Worker' }])
    const panel = findOne(tree, (node) => node.props && node.props.role === 'tabpanel')
    assert.ok(findOne(panel, (node) => node.type === 'p' && textOf(node) === 'pane one'))

    // A value the shell hands back selects that tab; the label falls back to the
    // dictionary when the block carries no title.
    let next
    reactStub.useState = (initial) => [initial, (value) => { next = value }]
    const untitled = primed.__test.tabsBlock({
      block: normalizeBlock({ type: 'tabs', items: block.items }),
      t: (token) => token,
      context: { t: (token) => token },
    })
    const untitledRow = findOne(untitled, (node) => node.type === SegmentedTabs)
    assert.equal(untitledRow.props.label, 'tabs.label')
    untitledRow.props.onChange(1)
    assert.equal(next, 1)
    assert.equal(untitledRow.props.value, 0, 'the rendered value is the state read back')
  } finally {
    reactStub.useState = original
  }
  // The stylesheet sizes the host row and drops the old frame around the pane.
  const css = client.__test.css
  assert.match(css, /\.dsh-sc-tabs-segmented \{ margin-bottom: 9px; \}/u)
  assert.match(css, /\.dsh-sc-tabs-panel \{ display: flex; flex-direction: column; gap: 10px; min-width: 0; \}/u)
})

// ---------------------------------------------------------------------------
// Auto layout: a `content` spec, derived by both halves identically
// ---------------------------------------------------------------------------

/** The same content spec the Host tests use. */
const CONTENT_SAMPLE = {
  summary: 'All 3 services are healthy.',
  metrics: [
    { label: 'Pods ready', value: '12/12', tone: 'success' },
    { label: 'P95 latency', value: '212 ms', delta: '-8%' },
  ],
  series: { title: 'Latency', values: [262, 244, 231, 219, 212], unit: 'ms' },
  breakdown: { title: 'Traffic', unit: '%', items: [{ label: 'api', value: 62 }, { label: 'web', value: 27 }, { label: 'jobs', value: 11 }] },
  table: { columns: ['Service', 'Status'], rows: [['api', 'healthy'], ['worker', 'healthy']] },
  steps: [{ title: 'Build', time: '14:02' }, { title: 'Deploy', time: '14:05' }],
  facts: { Region: 'eu-west-1', Runtime: 'Node 22' },
  items: ['one', 'two'],
  tags: ['stable', { label: 'canary', tone: 'warn' }],
  code: { code: 'dsh deploy', language: 'bash' },
  quote: { text: 'Ship small.', by: 'Release notes' },
  links: [{ label: 'Runbook', href: 'https://example.com/runbook' }],
  note: 'Rolling out at 14:00.',
  actions: [{ label: '查看日志', prompt: '查看这次部署的日志', tone: 'primary' }],
}

/** Drop renderer-neutral noise: absent vs undefined, and the neutral tone default. */
function canonicalSpec(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(canonicalSpec)
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      const item = value[key]
      if (item === undefined) continue
      // Renderer defaults the Host simply omits: same card, same pixels.
      if (key === 'tone' && (item === 'neutral' || item === 'default')) continue
      if (key === 'donut' && item === true) continue
      if (key === 'ordered' && item === false) continue
      if (key === 'muted' && item === false) continue
      if (Array.isArray(item) && item.length === 0) continue
      if (key === 'align' && Array.isArray(item) && item.every((entry) => entry === null || entry === undefined)) continue
      out[key] = canonicalSpec(item)
    }
    return out
  }
  return value
}

test('content parity: the Host and the Client derive the same blocks from the same content', () => {
  const fixtures = [
    CONTENT_SAMPLE,
    { items: ['a'], tags: ['x'] },
    { series: { values: [1, 2, 3, 4, 5, 6, 7] } },
    { series: { values: [1, 2, 3, 4], labels: ['a', 'b', 'c', 'd'] } },
    { series: { values: [1, 2, 3], labels: ['a', 'b', 'c'], kind: 'trend' } },
    { breakdown: { items: [{ label: 'a', value: 3 }, { label: 'b', value: 1 }] } },
    { breakdown: { items: [{ label: 'a', value: 3 }, { label: 'b', value: 1 }], kind: 'bars' } },
    { sections: [{ heading: 'A', items: ['a'] }, { heading: 'B', facts: { k: 'v' } }] },
    { sections: Array.from({ length: 5 }, (_, index) => ({ heading: 'S' + index, items: ['x'] })) },
    { summary: { text: 'ok', tone: 'warn' }, note: 'caution', actions: [{ label: 'Go', prompt: 'go' }] },
    { flow: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] } },
    { content: { nothing: true } },
  ]
  for (const content of fixtures) {
    const hostBlocks = hostPlugin.__test.deriveContent(content, { layout: 'auto' })
    assert.deepEqual(client.__test.deriveContent(content, 'auto'), hostBlocks, JSON.stringify(content))
    // A spec with nothing usable is rejected by the Host, never rendered.
    if (hostBlocks.length === 0) continue
    // Normalized specs are identical too: the card a reader sees is the same.
    const hostSpec = hostPlugin.__test.normalizeSpec({ content })
    const clientSpec = normalizeSpec({ content })
    assert.deepEqual(
      canonicalSpec(clientSpec.blocks),
      canonicalSpec(hostSpec.blocks),
      'normalized blocks: ' + JSON.stringify(content),
    )
    assert.equal(clientSpec.auto, hostSpec.auto === true)
  }
})

test('a content spec marks the card auto and keeps explicit blocks manual', () => {
  const derived = normalizeSpec({ content: CONTENT_SAMPLE })
  assert.equal(derived.auto, true)
  assert.equal(derived.blocks[0].type, 'callout')
  assert.equal(derived.blocks[derived.blocks.length - 1].type, 'actions')
  // Ordinary blocks stack: only `sections` (or an explicit columns block) splits a row.
  assert.equal(derived.blocks.some((block) => block.type === 'columns'), false)

  const withSections = normalizeSpec({ content: { sections: [{ heading: 'A', items: ['a'] }, { heading: 'B', items: ['b'] }] } })
  assert.deepEqual(withSections.blocks.map((block) => block.type), ['columns'])

  const manual = normalizeSpec({ blocks: [{ type: 'text', text: 'x' }] })
  assert.equal(manual.auto, false)

  const stacked = normalizeSpec({ content: { items: ['a'], tags: ['x'] }, layout: 'stack' })
  assert.deepEqual(stacked.blocks.map((block) => block.type), ['list', 'badges'])
})

test('the card header names the auto layout only on a derived card', () => {
  const derived = card({ phase: 'start', block: { argsRaw: JSON.stringify({ title: 'T', content: CONTENT_SAMPLE }) }, t: (token) => token })
  const chip = findOne(derived, (node) => hasClass(node, 'dsh-sc-auto'))
  assert.ok(chip, 'a derived card carries the auto chip')
  assert.equal(textOf(chip), 'auto.label')

  const manual = card({ phase: 'start', block: { argsRaw: JSON.stringify(CANONICAL) }, t: (token) => token })
  assert.equal(findOne(manual, (node) => hasClass(node, 'dsh-sc-auto')), null)
})

test('stats pick a column count that never leaves one tile alone', () => {
  // One row for the small, natural cases.
  assert.equal(statColumns(1), 1)
  assert.equal(statColumns(2), 2)
  assert.equal(statColumns(3), 3)
  assert.equal(statColumns(4), 4)
  // Six metrics read 3+3 rather than 5+1.
  assert.equal(statColumns(5), 3)
  assert.equal(statColumns(6), 3)
  assert.equal(statColumns(7), 4)
  assert.equal(statColumns(8), 4)
  assert.equal(statColumns(9), 5)
  assert.equal(statColumns(12), 4)
  // Defensive input still yields a usable grid.
  assert.equal(statColumns(0), 1)
  assert.equal(statColumns(undefined), 1)

  const six = Array.from({ length: 6 }, (_, index) => ({ label: 'k' + index, value: index }))
  const tree = mount(renderBlock(normalizeBlock({ type: 'stats', items: six }), 'stats', { t: (token) => token }))
  assert.equal(tree.props['data-cols'], '3')
  assert.equal(findAll(tree, (node) => hasClass(node, 'dsh-sc-stat')).length, 6)

  const two = mount(renderBlock(normalizeBlock({ type: 'stats', items: six.slice(0, 2) }), 'stats', { t: (token) => token }))
  assert.equal(two.props['data-cols'], '2')

  const css = client.__test.css
  assert.match(css, /\.dsh-sc-stats\[data-cols="3"\] \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/u)
  assert.match(css, /\.dsh-sc-stats\[data-cols\] > \.dsh-sc-stat:last-child:nth-child\(odd\) \{ grid-column: span 2; \}/u)
  assert.match(css, /\.dsh-sc-stat-value \{[^}]*word-break: keep-all;/u)
})

test('facts are a tile grid when short and a row sheet when long', () => {
  const { kvLayout, KV_TILE_MAX_ITEMS, KV_TILE_MAX_KEY, KV_TILE_MAX_VALUE } = client.__test
  const fact = (key, value) => ({ key, value })

  // Short facts tile: two side by side, three in one row, four as a 2x2, one
  // on the line.
  assert.deepEqual(kvLayout([fact('a', '1'), fact('b', '2')]), { layout: 'tiles', cols: 2 })
  assert.deepEqual(kvLayout([fact('a', '1'), fact('b', '2'), fact('c', '3')]), { layout: 'tiles', cols: 3 })
  assert.deepEqual(kvLayout([fact('a', '1'), fact('b', '2'), fact('c', '3'), fact('d', '4')]), { layout: 'tiles', cols: 2 })
  assert.deepEqual(kvLayout([fact('a', '1')]), { layout: 'tiles', cols: 1 })

  // Five or six short facts read 3+2 and 3+3.
  assert.deepEqual(kvLayout(Array.from({ length: 5 }, (_, index) => fact('k' + index, 'v'))), { layout: 'tiles', cols: 3 })
  assert.deepEqual(kvLayout(Array.from({ length: 6 }, (_, index) => fact('k' + index, 'v'))), { layout: 'tiles', cols: 3 })

  // A value that reads as a sentence, a key that cannot hold a label column,
  // or a seventh fact all mean the sheet becomes rows.
  assert.equal(KV_TILE_MAX_ITEMS, 6)
  const sentence = 'x'.repeat(KV_TILE_MAX_VALUE + 1)
  assert.equal(kvLayout([fact('a', sentence)]).layout, 'rows')
  assert.equal(kvLayout([fact('k'.repeat(KV_TILE_MAX_KEY + 1), 'v')]).layout, 'rows')
  assert.equal(kvLayout(Array.from({ length: 7 }, (_, index) => fact('k' + index, 'v'))).layout, 'rows')

  // A short value at the limit still tiles.
  assert.equal(kvLayout([fact('a', 'x'.repeat(KV_TILE_MAX_VALUE))]).layout, 'tiles')

  // An explicit single-column request wins over the shape.
  assert.deepEqual(kvLayout([fact('a', '1'), fact('b', '2')], 1), { layout: 'tiles', cols: 1 })

  // Defensive input still yields a usable grid.
  assert.deepEqual(kvLayout(undefined), { layout: 'tiles', cols: 1 })

  const tiles = mount(renderBlock(
    normalizeBlock({ type: 'keyvalue', items: [fact('版本', '0.12.5'), fact('大小', '48 KB')] }),
    'kv',
    { t: (token) => token },
  ))
  assert.equal(tiles.props['data-layout'], 'tiles')
  assert.equal(tiles.props['data-cols'], '2')
  assert.equal(findAll(tiles, (node) => hasClass(node, 'dsh-sc-kv-item')).length, 2)

  const rows = mount(renderBlock(
    normalizeBlock({
      type: 'keyvalue',
      items: [1, 2, 3, 4, 5, 6, 7].map((index) => fact('key ' + index, 'value ' + index)),
    }),
    'kv',
    { t: (token) => token },
  ))
  assert.equal(rows.props['data-layout'], 'rows', 'seven facts read as a row sheet')
  assert.equal(rows.props['data-cols'], '2')

  // The row sheet is one label column and one value column: the items flatten
  // into the grid so labels align across rows.
  const css = client.__test.css
  assert.match(css, /\.dsh-sc-kv\[data-layout="rows"\] \{[^}]*max-width: var\(--dsh-sc-measure-wide, 76ch\);/u)
  assert.match(css, /\.dsh-sc-kv\[data-layout="rows"\] \{[^}]*grid-template-columns: fit-content\(34%\) minmax\(0, 1fr\);/u)
  assert.match(css, /\.dsh-sc-kv\[data-layout="rows"\] > \.dsh-sc-kv-item \{ display: contents; \}/u)
  // A narrow card stacks the sheet instead of squeezing two columns.
  assert.match(css, /\.dsh-sc-kv\[data-layout="rows"\] \{ grid-template-columns: minmax\(0, 1fr\); gap: 1px; \}/u)
  // Tile grids may spend the card's width; prose blocks keep their measure.
  assert.match(css, /\.dsh-sc-kv \{[^}]*max-width: min\(100%, 84ch\);/u)
})

test('a kanban stacks its lanes once the card is narrow', () => {
  const css = client.__test.css
  assert.match(css, /@container \(max-width: 600px\) \{[^@]*\.dsh-sc-kanban \{ flex-direction: column; overflow-x: visible; \}/u)
  assert.match(css, /@container \(max-width: 600px\) \{[^@]*\.dsh-sc-kanban-col \{ flex: 0 0 auto; \}/u)
  // The stack rule has to come after the 190px basis it overrides.
  assert.ok(
    css.indexOf('.dsh-sc-kanban-col { flex: 0 0 auto; }') > css.indexOf('flex: 1 0 190px;'),
    'the narrow rule must follow the lane basis',
  )
})

test('a heatmap names the range it covers on its foot line', () => {
  const render = (block) => mount(renderBlock(normalizeBlock(block), 'heat', { t: (token) => token }))
  const rangeOf = (tree) => findAll(tree, (node) => hasClass(node, 'dsh-sc-heatmap-range'))[0]

  const labelled = rangeOf(render({
    type: 'heatmap',
    unit: ' 次',
    items: [
      { label: '10/21', value: 3 },
      { label: '10/22', value: 0 },
      { label: '11/03', value: 4 },
    ],
  }))
  // A CJK unit attaches without a space; a Latin unit takes one.
  assert.equal(labelled.children.join(''), '10/21 – 11/03 · 7次')
  assert.equal(
    rangeOf(render({
      type: 'heatmap',
      unit: 'ms',
      items: [{ label: 'a', value: 3 }, { label: 'b', value: 4 }],
    })).children.join(''),
    'a – b · 7 ms',
  )
  assert.equal(
    rangeOf(render({
      type: 'heatmap',
      unit: '%',
      items: [{ label: 'a', value: 3 }, { label: 'b', value: 4 }],
    })).children.join(''),
    'a – b · 7%',
  )

  // One labelled cell has no range to describe, and an unlabelled series falls
  // back to the legend alone.
  assert.equal(rangeOf(render({ type: 'heatmap', items: [{ label: '10/21', value: 3 }] })).children.join(''), '10/21 · 3')
  assert.equal(rangeOf(render({ type: 'heatmap', items: [{ value: 3 }, { value: 1 }] })), undefined)

  assert.match(client.__test.css, /\.dsh-sc-heatmap-foot \{[^}]*justify-content: space-between;/u)
})

test('a progress caption that only repeats the percentage is dropped', () => {
  const render = (items) => mount(renderBlock(
    normalizeBlock({ type: 'progress', items }),
    'progress',
    { t: (token) => token },
  ))
  const captions = (tree) => findAll(tree, (node) => hasClass(node, 'dsh-sc-progress-caption'))

  // `caption: '62%'` beside a value of 0.62 says the same thing twice.
  assert.equal(captions(render([{ label: '发布进度', value: 0.62, caption: '62%' }])).length, 0)
  assert.equal(captions(render([{ label: '发布进度', value: 0.62, caption: ' 62% ' }])).length, 0)

  // A caption that adds information stays.
  const kept = captions(render([{ label: '发布进度', value: 0.62, caption: '较上周 +6%' }]))
  assert.equal(kept.length, 1)
  assert.equal(kept[0].children.join(''), '较上周 +6%')

  // The bar label column hugs its labels instead of taking a fixed share.
  assert.match(client.__test.css, /\.dsh-sc-bar-row \{[^}]*grid-template-columns: fit-content\(30%\) minmax\(0, 1fr\) auto;/u)
  // The timeline rail runs into the next item so the steps read as one line.
  assert.match(client.__test.css, /\.dsh-sc-tl-item::after \{[^}]*bottom: -6px;/u)
})

test('code takes the host highlighter when the shell seeds it, and stays plain otherwise', () => {
  /** Resolve every function component, not just the outermost one. */
  const deep = (node) => {
    if (Array.isArray(node)) return node.map(deep)
    if (!node || typeof node !== 'object') return node
    let current = node
    let guard = 0
    while (current && typeof current === 'object' && typeof current.type === 'function') {
      guard += 1
      assert.ok(guard < 20, 'component tree resolves')
      current = current.type(current.props)
    }
    if (!current || typeof current !== 'object') return current
    return { ...current, children: current.children.map(deep) }
  }
  const render = (instance, block) => deep(instance.__test.renderBlock(
    instance.__test.normalizeBlock(block),
    'code',
    { t: (token) => token },
  ))
  const codeOf = (tree) => findAll(tree, (node) => hasClass(node, 'dsh-sc-code-text'))[0]

  // The test shell throws for any module but React, exactly like a shell whose
  // seed table predates the primitives package: the text renders as written.
  const plain = codeOf(render(client, { type: 'code', code: 'const a = 1', language: 'ts' }))
  assert.deepEqual(plain.children, ['const a = 1'])

  // A shell that seeds the host highlighter renders its tokens, one span each,
  // still inside one <code>, so the block's own chrome is untouched.
  const primed = captured.factory((id) => {
    if (id === 'react') return reactStub
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        useCodeHighlighter: (lang) => (code) => (lang === 'ts'
          ? [[{ text: 'const', style: { color: 'var(--shiki-token-keyword)' } }, { text: ' a = 1', style: { color: 'var(--shiki-token-plain)' } }]]
          : undefined),
      }
    }
    throw new Error('unexpected require: ' + id)
  })
  const lit = codeOf(render(primed, { type: 'code', code: 'const a = 1', language: 'ts' }))
  assert.equal(lit.props.className, 'dsh-sc-code-text dsh-sc-code-text--tokens')
  const tokens = findAll(lit, (node) => node.type === 'span')
  assert.deepEqual(tokens.map((node) => node.children.join('')), ['const', ' a = 1'])
  assert.deepEqual(tokens[0].props.style, { color: 'var(--shiki-token-keyword)' })

  // A language the host cannot tokenize falls back to the plain body, and a
  // later render of a known language highlights again.
  const unknown = codeOf(render(primed, { type: 'code', code: 'dsh deploy', language: 'bash' }))
  assert.deepEqual(unknown.children, ['dsh deploy'])
  const noLanguage = codeOf(render(primed, { type: 'code', code: 'hello' }))
  assert.deepEqual(noLanguage.children, ['hello'])
})

test('a long list flows into columns on a wide card, a short or prose list does not', () => {
  const render = (items, ordered) => mount(renderBlock(
    normalizeBlock({ type: 'list', ordered, items }),
    'flow',
    { t: (token) => token },
  ))
  const six = Array.from({ length: 6 }, (_, index) => 'item ' + index)

  const flowed = render(six)
  assert.equal(flowed.type, 'ul')
  assert.equal(flowed.props['data-flow'], '1', 'six bullets leave the single measure')
  assert.equal(findAll(flowed, (node) => hasClass(node, 'dsh-sc-li')).length, 6)

  // Five bullets stay stacked: a second column would hold one lonely line.
  assert.equal(render(six.slice(0, 5)).props['data-flow'], undefined)
  // A bullet that is really a paragraph reads better in one column.
  assert.equal(render(six.slice(0, 5).concat(['x'.repeat(221)])).props['data-flow'], undefined)
  // Ordered lists flow too; the grid keeps DOM order left to right.
  const ordered = render(six, true)
  assert.equal(ordered.type, 'ol')
  assert.equal(ordered.props['data-flow'], '1')

  assert.equal(listFlows(six), true)
  assert.equal(listFlows([]), false)
  assert.equal(listFlows(undefined), false)

  // The stylesheet reads one measure token, and the flow rule keys off the attribute.
  const css = client.__test.css
  assert.match(css, /--dsh-sc-measure: 62ch/u)
  assert.match(css, /\.dsh-sc-text \{\n  margin: 0;\n  max-width: var\(--dsh-sc-measure, 62ch\);/u)
  assert.match(css, /\.dsh-sc-list\[data-flow="1"\] \{\n  display: grid;/u)
})

test('columns render side by side with an optional label and real nested blocks', () => {
  const block = normalizeBlock({
    type: 'columns',
    items: [
      { label: 'API', blocks: [{ type: 'stats', items: [{ label: 'p95', value: '212 ms' }] }] },
      { blocks: [{ type: 'text', text: 'right side' }] },
    ],
  })
  const tree = mount(renderBlock(block, 'cols', { t: (token) => token }))
  assert.ok(hasClass(tree, 'dsh-sc-cols'))
  assert.equal(tree.props['data-cols'], '2')
  const columns = findAll(tree, (node) => hasClass(node, 'dsh-sc-col'))
  assert.equal(columns.length, 2)
  const label = findOne(tree, (node) => hasClass(node, 'dsh-sc-col-label'))
  assert.ok(label)
  assert.equal(textOf(label), 'API')
  assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-stats')), 'nested blocks render through the registry')
  assert.match(textOf(tree), /right side/)
})

test('a content spec renders end to end through the inline row', () => {
  const argsRaw = JSON.stringify({ title: 'Deploy', content: CONTENT_SAMPLE })
  const tree = inline({ node: { data: { argsRaw } }, t: (token) => token })
  const cardElement = tree.children[0]
  assert.equal(cardElement.type, card)
  const rendered = mount(cardElement)
  assert.ok(findOne(rendered, (node) => hasClass(node, 'dsh-sc-auto')), 'the inline card marks auto layout')
  assert.equal(findAll(rendered, (node) => node.type === client.__test.columnsBlock).length, 0, 'ordinary blocks stack')
  assert.ok(findOne(rendered, (node) => hasClass(node, 'dsh-sc-stats')), 'the metric grid renders inline')
})

// ---------------------------------------------------------------------------
// Card actions: copy as Markdown, top-right corner, close stays conditional
// ---------------------------------------------------------------------------

test('cardToMarkdown: the card becomes one copyable document', () => {
  const md = client.__test.cardToMarkdown({
    title: 'Deploy summary',
    subtitle: 'production · just now',
    blocks: [
      { type: 'callout', tone: 'success', title: 'Rollout complete', text: 'All 3 services are healthy.' },
      { type: 'stats', items: [{ label: 'Pods ready', value: '12/12', tone: 'success' }, { label: 'P95', value: '212 ms', delta: '-8%' }] },
      { type: 'table', columns: ['Service', 'CPU'], rows: [['api', '41%'], ['worker', '63%']] },
      { type: 'list', ordered: true, items: ['build', 'deploy'] },
      { type: 'code', language: 'bash', title: 'Deploy', code: 'dsh deploy --prod' },
      { type: 'actions', items: [{ label: '查看日志', prompt: '查看日志' }] },
    ],
  })
  assert.match(md, /^## Deploy summary/)
  assert.match(md, /_production · just now_/)
  assert.match(md, /> \*\*Rollout complete\*\*\n> All 3 services are healthy\./)
  assert.match(md, /- \*\*Pods ready\*\*: 12\/12/)
  assert.match(md, /- \*\*P95\*\*: 212 ms \(-8%\)/)
  assert.match(md, /\| Service \| CPU \|\n\| --- \| --- \|\n\| api \| 41% \|/)
  assert.match(md, /1\. build\n2\. deploy/)
  assert.match(md, /```bash\ndsh deploy --prod\n```/)
  // Interactive-only blocks are UI scaffolding, not content.
  assert.equal(md.includes('查看日志'), false)
})

test('cardToMarkdown: containers keep their structure, a diagram keeps its source', () => {
  const md = client.__test.cardToMarkdown({
    blocks: [
      { type: 'tabs', title: 'Views', items: [{ label: 'One', blocks: [{ type: 'text', text: 'pane' }] }, { label: 'Two', blocks: [{ type: 'list', items: ['x'] }] }] },
      { type: 'columns', items: [{ label: 'API', blocks: [{ type: 'stats', items: [{ label: 'qps', value: '1.2k' }] }] }, { blocks: [{ type: 'quote', text: 'q', by: 'me' }] }] },
      { type: 'tree', nodes: [{ label: 'src', children: [{ label: 'lib', children: [{ label: 'spec.js' }] }] }] },
      { type: 'diagram', kind: 'flowchart', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
      { type: 'divider' },
      { type: 'diff', title: 'Patch', lines: [{ kind: 'del', text: 'a' }, { kind: 'add', text: 'b' }] },
      { type: 'links', items: [{ label: 'Docs', href: 'https://example.com', description: 'read' }] },
    ],
  })
  assert.match(md, /\*\*Views\*\*\n\n#### One\n\npane\n\n#### Two\n\n- x/)
  assert.match(md, /\*\*API\*\*\n\n- \*\*qps\*\*: 1\.2k/)
  assert.match(md, /> q\n>\n> — me/)
  assert.match(md, /- src\n  - lib\n    - spec\.js/)
  assert.match(md, /```mermaid\nflowchart LR/)
  assert.match(md, /---/)
  assert.match(md, /```diff\n-a\n\+b\n```/)
  assert.match(md, /- \[Docs\]\(https:\/\/example\.com\) — read/)
})

test('copyCard writes the Markdown to the clipboard and reports success', async () => {
  const writes = []
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: (text) => { writes.push(text); return Promise.resolve() } } },
    configurable: true,
  })
  const seen = []
  client.__test.copyCard({ title: 'T', blocks: [{ type: 'text', text: 'hello' }] }, [{ type: 'text', text: 'hello' }], (value) => seen.push(value))
  assert.equal(writes.length, 1)
  assert.match(writes[0], /^## T\n\nhello/)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(seen, [true])
  delete globalThis.navigator
})

test('the card actions sit in the top-right corner: copy on every card, close only when dismissible', () => {
  const display = card({ phase: 'start', block: { argsRaw: JSON.stringify({ title: 'T', blocks: [{ type: 'text', text: 'x' }] }) }, t: (token) => token })
  const actions = findOne(display, (node) => hasClass(node, 'dsh-sc-head-actions'))
  assert.ok(actions, 'a display card still offers copy')
  const copyButton = findOne(display, (node) => hasClass(node, 'dsh-sc-head-action'))
  assert.ok(copyButton)
  assert.equal(copyButton.props['aria-label'], 'copy.label')
  assert.equal(findOne(display, (node) => hasClass(node, 'dsh-sc-close')), null, 'a static card has nothing to close')
  assert.ok(hasClass(actions, 'dsh-sc-head-actions'))

  const dismissible = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: 'T', blocks: [{ type: 'actions', items: [{ label: 'Go', prompt: 'go' }] }] }) },
    t: (token) => token,
  })
  const buttons = findAll(dismissible, (node) => hasClass(node, 'dsh-sc-head-action'))
  assert.equal(buttons.length, 2, 'copy and close sit side by side')
  assert.equal(buttons[1].props['aria-label'], 'close.label')
})

test('a card without a title has no header rule: the corner actions float instead', () => {
  const plain = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ blocks: [{ type: 'text', text: 'x' }] }) },
    t: (token) => token,
  })
  const head = findOne(plain, (node) => hasClass(node, 'dsh-sc-head'))
  assert.ok(head, 'a title-less card still carries its corner actions')
  assert.ok(hasClass(head, 'dsh-sc-head--float'), 'the actions-only header floats')
  assert.equal(hasClass(head, 'dsh-sc-head--actions'), true, 'the corner padding still applies')
  assert.equal(findOne(head, (node) => node.type === 'h3'), null)

  const titled = card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: 'T', blocks: [{ type: 'text', text: 'x' }] }) },
    t: (token) => token,
  })
  assert.equal(hasClass(findOne(titled, (node) => hasClass(node, 'dsh-sc-head')), 'dsh-sc-head--float'), false)

  // The float band draws no rule and reserves only the buttons' own row.
  const css = client.__test.css
  assert.match(css, /\.dsh-sc-head--float[^{]*\{[^}]*min-height: 22px[^}]*border-bottom: 0[^}]*\}/)
  // The compact look's own header padding must not resurrect the empty rule.
  assert.match(css, /\.dsh-sc-card--compact \.dsh-sc-head--float/)
})

test('the corner action cluster is absolutely positioned and reduced motion neutralizes it', () => {
  const css = client.__test.css
  assert.match(css, /\.dsh-sc-card \{[^}]*position: relative/)
  assert.match(css, /\.dsh-sc-head-actions \{[^}]*position: absolute[^}]*top: 10px[^}]*right: 10px/)
  assert.match(css, /\.dsh-sc-head--actions \{ padding-right: 62px; \}/)
  // The only animations/transitions on the new buttons are covered by the
  // reduce-motion block (which must stay last in the stylesheet).
  assert.match(css, /\.dsh-sc-head-action,?\s*\n?\s*\.dsh-sc-close/)
  // The main reduced-motion block is the last one in the stylesheet; the new
  // buttons are neutralized inside it, after their own rules.
  const reduceAt = css.lastIndexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(reduceAt > 0)
  assert.ok(css.indexOf('.dsh-sc-head-actions') < reduceAt, 'the cluster rules come before the override')
  const override = css.slice(reduceAt)
  assert.ok(override.includes('.dsh-sc-head-action,'), 'the new buttons lose their transitions under reduced motion')
})

// ---------------------------------------------------------------------------
// Inline images
// ---------------------------------------------------------------------------

test('image: renders a lazy, no-referrer frame with alt text and a caption', () => {
  const block = normalizeBlock({
    type: 'image',
    src: 'https://example.com/a.png',
    alt: 'P95 over 8 days',
    caption: 'Latency trend',
    height: 200,
  })
  const tree = mount(renderBlock(block, 'img', { t: (token) => token }))
  assert.ok(hasClass(tree, 'dsh-sc-image-block'))
  const link = findOne(tree, (node) => hasClass(node, 'dsh-sc-image-link'))
  assert.ok(link, 'a remote image links to the original')
  assert.equal(link.props.href, 'https://example.com/a.png')
  assert.equal(link.props.rel, 'noreferrer noopener')
  const img = findOne(tree, (node) => node.type === 'img')
  assert.equal(img.props.src, 'https://example.com/a.png')
  assert.equal(img.props.alt, 'P95 over 8 days')
  assert.equal(img.props.loading, 'lazy')
  assert.equal(img.props.decoding, 'async')
  assert.equal(img.props.referrerPolicy, 'no-referrer')
  assert.deepEqual(img.props.style, { height: '200px', objectFit: 'contain' })
  const caption = findOne(tree, (node) => hasClass(node, 'dsh-sc-image-caption'))
  assert.equal(textOf(caption), 'Latency trend')
})

test('image: a data URI is not a link, and a load failure becomes a readable tile', () => {
  const inline = normalizeBlock({ type: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' })
  const tree = mount(renderBlock(inline, 'img', { t: (token) => token }))
  assert.equal(findOne(tree, (node) => hasClass(node, 'dsh-sc-image-link')), null)
  assert.ok(findOne(tree, (node) => hasClass(node, 'dsh-sc-image-frame')))
  assert.equal(findOne(tree, (node) => node.type === 'img').props.alt, 'image.label')

  // The failed state is the component's own render: mount it with the error
  // state pre-set (the stub's useState returns the initial value it is given,
  // so swap it for this one render).
  const original = reactStub.useState
  reactStub.useState = () => [true, () => {}]
  const failed = client.__test.imageBlock({ block: inline, t: (token) => token })
  reactStub.useState = original
  const fallback = findOne(failed, (node) => hasClass(node, 'dsh-sc-image-fallback'))
  assert.ok(fallback)
  assert.match(textOf(fallback), /image\.failed/)
  assert.equal(findOne(failed, (node) => node.type === 'img'), null)
})

test('image: refuses unsafe schemes and clamps the frame in the client too', () => {
  assert.equal(normalizeBlock({ type: 'image', src: 'javascript:alert(1)' }), null)
  assert.equal(normalizeBlock({ type: 'image', src: 'file:///tmp/a.png' }), null)
  assert.equal(normalizeBlock({ type: 'image', src: 'https://example.com/a b.png' }), null)
  const high = normalizeBlock({ type: 'image', src: 'https://example.com/a.png', height: 9999 })
  assert.equal(high.height, 640)
  const low = normalizeBlock({ type: 'image', src: 'https://example.com/a.png', height: 1 })
  assert.equal(low.height, 80)
})

test('image: markdown export keeps the source and the caption', () => {
  const md = client.__test.cardToMarkdown({
    blocks: [
      { type: 'image', src: 'https://example.com/a.png', alt: 'P95', caption: 'Latency trend' },
      { type: 'image', src: 'data:image/png;base64,AAAA', alt: 'inline' },
    ],
  })
  assert.match(md, /!\[P95\]\(https:\/\/example\.com\/a\.png\)\n\n\*Latency trend\*/)
  assert.match(md, /!\[inline\]\(data:image\/png;base64,AAAA\)/)
})

test('image: content mode derives it and the two halves agree', () => {
  const content = { image: { src: 'https://example.com/a.png', caption: 'chart', height: 200 } }
  assert.deepEqual(hostPlugin.__test.deriveContent(content, { layout: 'auto' }), client.__test.deriveContent(content, 'auto'))
  const spec = normalizeSpec({ content })
  assert.deepEqual(spec.blocks.map((block) => block.type), ['image'])
  assert.equal(spec.auto, true)
})

// ---------------------------------------------------------------------------
// Asymmetric columns
// ---------------------------------------------------------------------------

test('columns: weights become a data-ratio and the stylesheet owns the shares', () => {
  const block = normalizeBlock({
    type: 'columns',
    weights: [2, 1],
    items: [{ label: 'Chart', blocks: [{ type: 'sparkline', values: [1, 2, 3] }] }, { blocks: [{ type: 'list', items: ['a'] }] }],
  })
  assert.deepEqual(block.weights, [2, 1])
  const tree = mount(renderBlock(block, 'cols', { t: (token) => token }))
  assert.equal(tree.props['data-ratio'], '2-1')

  // A stale list never widens the grid by surprise.
  const stale = normalizeBlock({
    type: 'columns',
    weights: [2],
    items: [{ blocks: [{ type: 'text', text: 'a' }] }, { blocks: [{ type: 'text', text: 'b' }] }],
  })
  assert.equal(stale.weights, undefined)
  assert.equal(normalizeBlock({
    type: 'columns',
    weights: [9, 0],
    items: [{ blocks: [{ type: 'text', text: 'a' }] }, { blocks: [{ type: 'text', text: 'b' }] }],
  }).weights[0], 3)

  const css = client.__test.css
  assert.match(css, /\.dsh-sc-cols\[data-ratio="2-1"\] \{ grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\); \}/)
  assert.match(css, /\.dsh-sc-cols\[data-ratio="2-1-1"\]/)
  // A narrow card collapses the ratio back to one column (container query, not viewport).
  assert.match(css, /\.dsh-sc-blocks \{[^}]*container-type: inline-size/)
  assert.match(css, /@container \(max-width: 560px\) \{\s*\.dsh-sc-cols\[data-ratio\] \{ grid-template-columns: minmax\(0, 1fr\); \}/)
})

test('content parity: asymmetric weights agree on both halves', () => {
  const fixtures = [
    { series: { values: [1, 2, 3, 4, 5, 6, 7] }, items: ['a'] },
    { items: ['a'], series: { values: [1, 2, 3, 4, 5, 6, 7] } },
    { quote: { text: 'q' }, items: ['a'] },
    { sections: [{ heading: 'T', table: { columns: ['a'], rows: [['1']] } }, { heading: 'F', facts: { k: 'v' } }] },
    { sections: [{ heading: 'A', items: ['a'] }, { heading: 'B', flow: { nodes: [{ id: 'n', label: 'N' }] } }, { heading: 'C', items: ['c'] }] },
  ]
  for (const content of fixtures) {
    assert.deepEqual(
      client.__test.deriveContent(content, 'auto'),
      hostPlugin.__test.deriveContent(content, { layout: 'auto' }),
      JSON.stringify(content),
    )
  }
})

// ---------------------------------------------------------------------------
// Card looks: one spec, four densities
// ---------------------------------------------------------------------------

test('look: only the known names reach the card, and each names a class', () => {
  const make = (look) => card({
    phase: 'start',
    block: { argsRaw: JSON.stringify({ title: 'T', look, blocks: [{ type: 'text', text: 'x' }] }) },
    t: (token) => token,
  })
  const classesOf = (tree) => String(tree.props.className || '').split(/\s+/)
  assert.ok(classesOf(make('compact')).includes('dsh-sc-card--compact'))
  assert.ok(classesOf(make('flat')).includes('dsh-sc-card--flat'))
  assert.ok(classesOf(make('relaxed')).includes('dsh-sc-card--relaxed'))
  // An explicit default adds no class; an unknown name is dropped and the card
  // falls back to the auto-detected density instead.
  const variants = (tree) => classesOf(tree).filter((name) => name.startsWith('dsh-sc-card--') && name !== 'dsh-sc-card--dock')
  assert.deepEqual(variants(make('default')), [])
  assert.deepEqual(variants(make('neon')), ['dsh-sc-card--relaxed'])
  assert.equal(normalizeSpec({ look: 'compact', blocks: [{ type: 'text', text: 'x' }] }).look, 'compact')
  assert.equal(normalizeSpec({ blocks: [{ type: 'text', text: 'x' }] }).look, undefined)
})

test('look: the stylesheet carries all three variants', () => {
  const css = client.__test.css
  for (const look of ['compact', 'flat', 'relaxed']) {
    assert.ok(css.includes('.dsh-sc-card--' + look), look + ' variant is missing')
  }
  assert.match(css, /\.dsh-sc-card--compact \{ padding: 12px 14px;/)
  assert.match(css, /\.dsh-sc-card--flat \.dsh-sc-stat \{ padding: 5px 0;/)
  assert.match(css, /\.dsh-sc-card--relaxed \{ padding: 20px 22px;/)
})

test('detectLook: long cards compress, dashboards flatten, short conclusions breathe', () => {
  const text = (n) => Array.from({ length: n }, () => ({ type: 'text', text: 'x' }))
  const stats = { type: 'stats', items: [{ label: 'a', value: 1 }] }
  const table = (rows) => ({ type: 'table', columns: ['a'], rows: Array.from({ length: rows }, (_, index) => [String(index)]) })
  const list = { type: 'list', items: ['a', 'b'] }
  const callout = { type: 'callout', text: 'note' }

  assert.equal(client.__test.detectLook([stats, table(3)]), 'flat', 'data only, no prose')
  assert.equal(client.__test.detectLook(text(6)), 'compact', 'six blocks is a report')
  assert.equal(client.__test.detectLook([stats, table(10)]), 'compact', 'a ten-row table is a report')
  assert.equal(client.__test.detectLook([{ type: 'stats', items: Array.from({ length: 25 }, (_, index) => ({ label: 'l' + index, value: index })) }]), 'compact')
  assert.equal(client.__test.detectLook([callout, list]), 'relaxed', 'a two-block conclusion gets air')
  assert.equal(client.__test.detectLook([stats, callout, list]), 'default', 'mixed content keeps the standard look')
  assert.equal(client.__test.detectLook([]), 'default')

  // The card applies the detected look when the spec does not name one.
  const tree = card({ phase: 'start', block: { argsRaw: '{"blocks":[{"type":"text","text":"x"}]}' }, t: (token) => token })
  assert.ok(String(tree.props.className).split(/\s+/).includes('dsh-sc-card--relaxed'))
})

// ---------------------------------------------------------------------------
// Host-generated next-step card (session event `super-cards/next-steps`)
// ---------------------------------------------------------------------------

/** Build one `super-cards/next-steps` event. */
function nextStepsEvent(seq, data) {
  return { type: client.__test.nextEvent, seq, data }
}

test('next-step event: malformed payloads are ignored and counts are clamped', () => {
  const parse = client.__test.nextStepsEventData
  const options = [{ label: 'Run tests', prompt: 'Run the repo test suite.' }]

  assert.equal(parse(undefined), null)
  assert.equal(parse({ type: 'assistant/message', seq: 1, data: { turn: 1, options } }), null)
  assert.equal(parse(nextStepsEvent(2, undefined)), null)
  assert.equal(parse(nextStepsEvent(3, { options })), null, 'a turn is required')
  assert.equal(parse(nextStepsEvent(4, { turn: 1.5, options })), null, 'a turn is an integer')
  assert.equal(parse(nextStepsEvent(5, { turn: -1, options })), null)
  assert.equal(parse(nextStepsEvent(6, { turn: 1, options: 'nope' })), null)
  assert.equal(parse(nextStepsEvent(7, { turn: 1, options: [] })), null)
  assert.equal(parse(nextStepsEvent(8, { turn: 1 })), null, 'options are required')

  // Only complete string pairs survive; a single usable option is enough.
  const mixed = parse(nextStepsEvent(9, {
    turn: 3,
    options: [
      null,
      'x',
      { label: 'no prompt' },
      { label: '', prompt: 'empty label' },
      { label: 'bad prompt', prompt: 42 },
      { label: ' Keep ', prompt: ' ask ' },
    ],
  }))
  assert.deepEqual(mixed, { turn: 3, text: '', options: [{ label: 'Keep', prompt: 'ask' }] })

  // Optional text: trimmed when usable, treated as absent otherwise.
  assert.equal(parse(nextStepsEvent(10, { turn: 3, text: 42, options })).text, '')
  assert.equal(parse(nextStepsEvent(11, { turn: 3, text: '   ', options })).text, '')
  assert.equal(parse(nextStepsEvent(12, { turn: 3, text: '  What next?  ', options })).text, 'What next?')

  // Optional summary: kept only for a non-empty string and capped at 240
  // characters. An older Host sends none at all, so the key stays absent.
  assert.equal('summary' in parse(nextStepsEvent(13, { turn: 3, options })), false, 'old events keep working')
  assert.equal(parse(nextStepsEvent(14, { turn: 3, summary: 42, options })).summary, undefined)
  assert.equal(parse(nextStepsEvent(15, { turn: 3, summary: '   ', options })).summary, undefined)
  assert.equal(parse(nextStepsEvent(16, { turn: 3, summary: '  Done.  ', options })).summary, 'Done.')
  assert.equal(parse(nextStepsEvent(17, { turn: 3, summary: 's'.repeat(300), options })).summary.length, 240)

  const many = parse(nextStepsEvent(18, {
    turn: 4,
    options: Array.from({ length: 20 }, (_, index) => ({ label: 'l' + index, prompt: 'p' + index })),
  }))
  assert.equal(many.options.length, client.__test.caps.actions, 'one card holds at most one actions block')
  assert.deepEqual(many.options[0], { label: 'l0', prompt: 'p0' })
})

test('next-step definition: latest event wins per turn and keeps the framework location', () => {
  const definition = client.__test.nextDefinition
  const options = [{ label: 'A', prompt: 'a' }]

  assert.equal(definition.match({ type: 'tool/call', seq: 1, data: {} }), null)
  assert.equal(definition.match(nextStepsEvent(2, { turn: 2, options: [] })), null)
  assert.deepEqual(definition.match(nextStepsEvent(3, { turn: 2, options })), { id: 'next-2', role: 'start' })

  let state = definition.start(null, { event: nextStepsEvent(10, { turn: 2, text: 'Q1', options }) })
  state = definition.update({ state }, {
    event: nextStepsEvent(11, { turn: 2, text: 'Q2', options: [{ label: 'B', prompt: 'b' }, { label: 'C', prompt: 'c' }] }),
  })
  assert.equal(state.seq, 10, 'the card stays anchored at the first event')
  assert.equal(state.text, 'Q2')
  assert.deepEqual(state.options.map((item) => item.label), ['B', 'C'])

  const location = { kind: 'turn', turn: { turn: 2 } }
  const node = definition.buildViewNode({ key: 'k', id: 'next-2', start: { location }, state })
  assert.equal(node.kind, client.__test.nextKind)
  assert.equal(node.target, 'chat')
  assert.equal(node.groupTree, 'turn')
  assert.equal(node.visibility, 'visible')
  assert.equal(node.anchorSeq, 10)
  assert.equal(node.location, location, 'the location the framework resolved is kept as-is')
  assert.equal(node.data.turn, 2)
  assert.equal(node.data.text, 'Q2')
  assert.deepEqual(node.data.options.map((item) => item.label), ['B', 'C'])

  // An unusable event never clears or moves the state.
  assert.equal(definition.update({ state }, { event: nextStepsEvent(12, { turn: 2, options: [] }) }), state)
  assert.equal(definition.buildViewNode({
    key: 'k',
    id: 'next-2',
    start: { location: { kind: 'unresolved' } },
    state: { seq: 1, turn: 2, text: '', options: [] },
  }), null)
})

test('next-step card is tail-only: the inline row is empty and the selector targets its turn', () => {
  const definition = client.__test.nextDefinition
  const event = nextStepsEvent(20, {
    turn: 2,
    text: 'What next?',
    options: [
      { label: 'Run tests', prompt: 'Run the repo test suite.' },
      { label: 'Stop', prompt: 'Stop here.' },
    ],
  })
  const state = definition.start(null, { event })
  const node = definition.buildViewNode({
    key: 'k',
    id: 'next-2',
    start: { location: { kind: 'turn', turn: { turn: 2 } } },
    state,
  })
  // The node exists in the snapshot, but its own row stays empty: the card
  // belongs to the Turn tail, exactly like dock and model tail placements.
  assert.equal(client.__test.nextRow({ node, t: (token) => token }), null)
  assert.equal(client.__test.nextRow({}), null)

  const snapshot = { order: ['n2'], nodes: { get: (key) => (key === 'n2' ? node : undefined) } }
  const cards = JSON.parse(selectTailCards(snapshot, 2, (token) => token)).cards
  assert.equal(cards.length, 1)
  const spec = JSON.parse(cards[0])
  assert.equal(spec.look, 'relaxed')
  assert.equal(spec.blocks.length, 2, 'without a summary: question + actions')
  assert.deepEqual(spec.blocks[0], { type: 'text', text: 'What next?' })
  assert.deepEqual(spec.blocks[1].items.map((item) => item.label), ['Run tests', 'Stop'])
  assert.equal(spec.blocks[1].items[0].tone, 'primary')
  assert.equal(spec.blocks[1].items[1].tone, undefined)
  assert.equal(selectTailCards(snapshot, 3, (token) => token), '', 'only the event turn sees the card')
  assert.equal(selectTailCards(snapshot, undefined, (token) => token), '')
  assert.equal(selectTailCards(undefined, 2, (token) => token), '')

  // The event is appended after `turn/end`; if the location index has not
  // resolved it yet, the payload turn names the same coordinate.
  const unresolved = { ...node, location: { kind: 'unresolved' } }
  const fallbackSnapshot = { order: ['n2'], nodes: { get: () => unresolved } }
  assert.equal(JSON.parse(selectTailCards(fallbackSnapshot, 2, (token) => token)).cards.length, 1)
  assert.equal(selectTailCards(fallbackSnapshot, 3, (token) => token), '')

  // A node without usable options never renders a card.
  const emptySnapshot = { order: ['n2'], nodes: { get: () => ({ ...node, data: { ...node.data, options: [] } }) } }
  assert.equal(selectTailCards(emptySnapshot, 2, (token) => token), '')
})

test('next-step card: a newer Turn retires the previous Turn tail cards', () => {
  const definition = client.__test.nextDefinition
  const state = definition.start(null, {
    event: nextStepsEvent(25, { turn: 2, text: 'What next?', options: [{ label: 'A', prompt: 'a' }] }),
  })
  const generated = definition.buildViewNode({
    key: 'k',
    id: 'next-2',
    start: { location: { kind: 'turn', turn: { turn: 2 } } },
    state,
  })
  const modelArgs = JSON.stringify({ place: 'tail', blocks: [{ type: 'text', text: 'Mine' }] })
  const nodes = new Map([
    ['g2', generated],
    ['m2', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'tail', argsRaw: modelArgs } }],
    ['u3', { kind: 'user', location: { kind: 'turn', turn: { turn: 3 } }, data: {} }],
  ])
  const snapshot = { order: ['g2', 'm2', 'u3'], nodes: { get: (key) => nodes.get(key) } }
  // Turn 3 already started: Turn 2's footer renders nothing, either card kind.
  assert.equal(selectTailCards(snapshot, 2), '')
  // The newest Turn is unaffected: no larger Turn exists, so it still renders.
  const latestNodes = new Map([
    ['t3', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 3 } }, data: { place: 'tail', argsRaw: modelArgs } }],
  ])
  const latest = { order: ['t3'], nodes: { get: (key) => latestNodes.get(key) } }
  assert.deepEqual(JSON.parse(selectTailCards(latest, 3)).cards, [modelArgs], 'the newest Turn still renders its tail card')

  // Without the newer Turn the same cards render: only age hides them.
  const sameTurn = { order: ['g2', 'm2'], nodes: { get: (key) => nodes.get(key) } }
  assert.deepEqual(JSON.parse(selectTailCards(sameTurn, 2)).cards, [modelArgs])

  // A NEXT_KIND node with only the payload turn (no location turn) also counts
  // as a newer Turn, and renders normally when it is the current Turn.
  const unresolvedNewer = { ...generated, location: { kind: 'unresolved' }, data: { ...generated.data, turn: 4 } }
  const futureSnapshot = { order: ['g2', 'f4'], nodes: { get: (key) => (key === 'g2' ? generated : unresolvedNewer) } }
  assert.equal(selectTailCards(futureSnapshot, 2), '', 'a data.turn-only node still names a newer Turn')
  assert.equal(JSON.parse(selectTailCards({ order: ['f4'], nodes: { get: () => unresolvedNewer } }, 4)).cards.length, 1)

  // Replaying a session whose last Turn is 2 keeps its card (no later Turn).
  assert.equal(JSON.parse(selectTailCards(sameTurn, 2)).cards.length, 1)
})

test('next-step card: the optional summary is its own paragraph before the question', () => {
  const specOf = (data) => JSON.parse(client.__test.nextSpec(data, (token) => token))

  const withSummary = specOf({
    text: 'Which option should we take?',
    summary: 'The client half landed and the suite is green.',
    options: [{ label: 'Ship it', prompt: 'Ship the release.' }, { label: 'Hold', prompt: 'Hold the release.' }],
  })
  assert.equal(withSummary.look, 'relaxed')
  assert.equal(withSummary.blocks.length, 3)
  assert.deepEqual(withSummary.blocks[0], { type: 'text', text: 'The client half landed and the suite is green.' })
  assert.deepEqual(withSummary.blocks[1], { type: 'text', text: 'Which option should we take?' })
  assert.equal(withSummary.blocks[2].type, 'actions')
  assert.equal(withSummary.blocks[2].items[0].tone, 'primary')
  assert.equal(withSummary.blocks[2].items[1].tone, undefined)

  // No summary (older Host event): question + actions only.
  const plain = specOf({ text: 'Which option should we take?', options: [{ label: 'Ship it', prompt: 'Ship the release.' }] })
  assert.equal(plain.blocks.length, 2)
  assert.equal(plain.blocks[0].type, 'text')
  assert.equal(plain.blocks[1].type, 'actions')

  // Blank summary adds no paragraph; an over-long one is capped at 240.
  assert.equal(specOf({ text: 'Q?', summary: '   ', options: [{ label: 'A', prompt: 'a' }] }).blocks.length, 2)
  const long = specOf({ text: 'Q?', summary: 's'.repeat(400), options: [{ label: 'A', prompt: 'a' }] })
  assert.equal(long.blocks.length, 3)
  assert.equal(long.blocks[0].text.length, 240)

  // A missing question still falls back to the localized default, after the summary.
  // Without a translator the spec uses the English dictionary fallback.
  const fallback = JSON.parse(client.__test.nextSpec({ summary: 'Done.', options: [{ label: 'A', prompt: 'a' }] }))
  assert.deepEqual(fallback.blocks.map((block) => block.type), ['text', 'text', 'actions'])
  assert.deepEqual(fallback.blocks[0], { type: 'text', text: 'Done.' })
  assert.deepEqual(fallback.blocks[1], { type: 'text', text: 'What would you like to do next?' })

  // The whole event -> node -> tail chain carries the summary through.
  const definition = client.__test.nextDefinition
  const state = definition.start(null, {
    event: nextStepsEvent(30, {
      turn: 5,
      summary: 'Server is healthy.',
      text: 'Next?',
      options: [{ label: 'A', prompt: 'a' }],
    }),
  })
  assert.equal(state.summary, 'Server is healthy.')
  const node = definition.buildViewNode({
    key: 'k',
    id: 'next-5',
    start: { location: { kind: 'turn', turn: { turn: 5 } } },
    state,
  })
  assert.equal(node.data.summary, 'Server is healthy.')
  const snapshot = { order: ['n5'], nodes: { get: () => node } }
  const delivered = JSON.parse(JSON.parse(selectTailCards(snapshot, 5, (token) => token)).cards[0])
  assert.deepEqual(delivered.blocks.map((block) => block.type), ['text', 'text', 'actions'])
  assert.deepEqual(delivered.blocks[0], { type: 'text', text: 'Server is healthy.' })
})

test('a model tail card suppresses the generated one; the generated card renders actions', () => {
  const definition = client.__test.nextDefinition
  const state = definition.start(null, {
    event: nextStepsEvent(21, { turn: 2, options: [{ label: 'Draft', prompt: 'Draft it.' }] }),
  })
  const generated = definition.buildViewNode({
    key: 'k',
    id: 'next-2',
    start: { location: { kind: 'turn', turn: { turn: 2 } } },
    state,
  })
  const modelArgsRaw = JSON.stringify({ place: 'tail', blocks: [{ type: 'text', text: 'Model choice' }] })
  const nodes = new Map([
    ['g2', generated],
    ['m2', { kind: 'super-cards', location: { kind: 'turn', turn: { turn: 2 } }, data: { place: 'tail', argsRaw: modelArgsRaw } }],
  ])
  const snapshot = { order: ['g2', 'm2'], nodes: { get: (key) => nodes.get(key) } }
  assert.deepEqual(JSON.parse(selectTailCards(snapshot, 2, (token) => token)).cards, [modelArgsRaw], 'the model closing card wins')

  const onlyGenerated = { order: ['g2'], nodes: { get: (key) => (key === 'g2' ? generated : undefined) } }
  // Absent text falls back to the localized default question.
  const zhT = (token) => (token === 'next.question' ? '接下来做什么？' : token)
  const localized = JSON.parse(JSON.parse(selectTailCards(onlyGenerated, 2, zhT)).cards[0])
  assert.equal(localized.blocks[0].text, '接下来做什么？')
  // Without a translator the English dictionary entry is the fallback.
  const fallback = JSON.parse(JSON.parse(selectTailCards(onlyGenerated, 2)).cards[0])
  assert.equal(fallback.blocks[0].text, 'What would you like to do next?')

  // TurnTailCards reuses the normal card stack, so inputActions keep working.
  const drafts = []
  const inputActions = { setDraft(text) { drafts.push(text) } }
  const tree = turnTailCards({
    turn: { turn: 2 },
    useChat: () => selectTailCards(onlyGenerated, 2, zhT),
    t: zhT,
    inputActions,
  })
  assert.ok(hasClass(tree, 'dsh-sc-tail-card--next'))
  assert.equal(tree.children.length, 1)
  const rendered = mount(tree.children[0].children[0])
  assert.equal(rendered.props['data-status'], 'none')
  assert.ok(textOf(rendered).includes('接下来做什么？'))
  assert.equal(rendered.props.className.includes('dsh-sc-card--relaxed'), true)
  const actionsElement = findOne(rendered, (node) => node.type === actions
    && node.props && node.props.block && node.props.block.type === 'actions')
  assert.ok(actionsElement, 'the generated card carries an actions block')
  const buttons = findAll(mount(actionsElement), (node) => node.type === 'button')
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].props['data-tone'], 'primary', 'the first generated option is the primary action')
  assert.ok(textOf(buttons[0]).includes('Draft'))
  buttons[0].props.onClick()
  assert.deepEqual(drafts, ['Draft it.'])
})

// ---------------------------------------------------------------------------
// Configuration surfaces: the bundle page card and the Settings tab
// ---------------------------------------------------------------------------

/** Build a ready ConfigFormSnapshot with the resolved row values. */
function configState(overrides) {
  return Object.assign({
    status: 'ready',
    value: {
      nextSteps: true,
      dock: false,
      defaultPlace: 'answer',
      maxBlocks: 24,
      nextStepsMax: 3,
      nextStepsTimeoutMs: 15000,
      nextStepsMinChars: 200,
      nextStepsProvider: 'deepseek',
      nextStepsModel: 'chat',
      blocks: ['text', 'stats'],
    },
    base: {},
    user: {},
    revision: 3,
    writable: true,
    mode: 'host',
  }, overrides)
}

test('config field table: basic and full surfaces, ranges mirror the Host schema', () => {
  const fields = (scope) => client.__test.configFields(scope).map((field) => field.key)
  assert.deepEqual(fields('basic'), ['nextSteps', 'dock', 'defaultPlace', 'maxBlocks'])
  assert.deepEqual(fields('full'), [
    'nextSteps', 'dock', 'defaultPlace', 'maxBlocks',
    'nextStepsMax', 'nextStepsTimeoutMs', 'nextStepsMinChars',
    'nextStepsProvider', 'nextStepsModel', 'blocks',
  ])
  assert.deepEqual(client.__test.configPlaces, ['answer', 'process', 'dock', 'tail'])
  const byKey = Object.fromEntries(client.__test.configFields('full').map((field) => [field.key, field]))
  assert.deepEqual({ min: byKey.maxBlocks.min, max: byKey.maxBlocks.max }, { min: 1, max: 24 })
  assert.deepEqual({ min: byKey.nextStepsMax.min, max: byKey.nextStepsMax.max }, { min: 1, max: 4 })
  assert.deepEqual({ min: byKey.nextStepsTimeoutMs.min, max: byKey.nextStepsTimeoutMs.max }, { min: 1000, max: 60000 })
  assert.deepEqual({ min: byKey.nextStepsMinChars.min, max: byKey.nextStepsMinChars.max }, { min: 0, max: 2000 })
  for (const field of client.__test.configFields('full')) {
    assert.equal(typeof field.label, 'string')
    assert.notEqual(field.label, '')
  }
})

test('config draft: seeded from accepted values, numbers and lists become text', () => {
  const draft = client.__test.configDraft(configState())
  assert.equal(draft.nextSteps, true)
  assert.equal(draft.dock, false)
  assert.equal(draft.defaultPlace, 'answer')
  assert.equal(draft.maxBlocks, '24')
  assert.equal(draft.nextStepsProvider, 'deepseek')
  assert.equal(draft.blocks, 'text, stats')
  assert.equal(client.__test.configInvalid(draft), false)

  // Missing values stay empty and a required number is then invalid.
  const empty = client.__test.configDraft(undefined)
  assert.equal(empty.nextSteps, false)
  assert.equal(empty.maxBlocks, '')
  assert.equal(empty.nextStepsProvider, '')
  assert.equal(client.__test.configInvalid(empty), true)
  // Out-of-range and non-numeric text are rejected before a write.
  const outOfRange = Object.assign({}, draft, { maxBlocks: '25' })
  assert.equal(client.__test.configInvalid(outOfRange), true)
  assert.equal(client.__test.configInvalid(Object.assign({}, draft, { maxBlocks: '0' })), true)
  assert.equal(client.__test.configInvalid(Object.assign({}, draft, { nextStepsMax: '1.5' })), true)
  assert.equal(client.__test.configInvalid(Object.assign({}, draft, { nextStepsTimeoutMs: 'abc' })), true)
  assert.equal(client.__test.configInvalid(Object.assign({}, draft, { maxBlocks: '12' })), false)
})

test('config ops: only changed fields, cleared optional fields unset, list normalized', () => {
  const state = configState()
  const draft = Object.assign(client.__test.configDraft(state), {
    nextSteps: false,
    dock: true,
    defaultPlace: 'dock',
    maxBlocks: '12',
    nextStepsMax: '4',
    nextStepsTimeoutMs: '20000',
    nextStepsMinChars: '0',
    nextStepsProvider: '',
    nextStepsModel: 'next-model',
    blocks: ' text,  table ,text, ',
  })
  assert.deepEqual(client.__test.configOps(draft, state), [
    { op: 'set', path: ['nextSteps'], value: false },
    { op: 'set', path: ['dock'], value: true },
    { op: 'set', path: ['defaultPlace'], value: 'dock' },
    { op: 'set', path: ['maxBlocks'], value: 12 },
    { op: 'set', path: ['nextStepsMax'], value: 4 },
    { op: 'set', path: ['nextStepsTimeoutMs'], value: 20000 },
    { op: 'set', path: ['nextStepsMinChars'], value: 0 },
    { op: 'unset', path: ['nextStepsProvider'] },
    { op: 'set', path: ['nextStepsModel'], value: 'next-model' },
    { op: 'set', path: ['blocks'], value: ['text', 'table'] },
  ])

  // Nothing changed: one empty op list, so the save action stays disabled.
  assert.deepEqual(client.__test.configOps(client.__test.configDraft(state), state), [])

  // A disabled optional list clears its override instead of writing [].
  const clearedBlocks = Object.assign(client.__test.configDraft(state), { blocks: '  ' })
  assert.deepEqual(client.__test.configOps(clearedBlocks, state), [{ op: 'unset', path: ['blocks'] }])

  // An invalid number produces no op at all.
  const invalidNumber = Object.assign(client.__test.configDraft(state), { maxBlocks: '99' })
  assert.deepEqual(client.__test.configOps(invalidNumber, state), [])
})

test('config reset: unsets exactly the fields the user layer holds', () => {
  const state = configState({ user: { nextSteps: false, maxBlocks: 12 } })
  assert.deepEqual(client.__test.configResetOps(state), [
    { op: 'unset', path: ['nextSteps'] },
    { op: 'unset', path: ['maxBlocks'] },
  ])
  assert.deepEqual(client.__test.configResetOps(configState()), [])
  assert.deepEqual(client.__test.configResetOps(undefined), [])
})

test('config summary: one localized line for the accepted values', () => {
  const t = (token, vars) => (token === 'config.summary'
    ? [vars.place, vars.blocks, vars.steps, vars.dock].join('|')
    : token)
  assert.equal(
    client.__test.configSummaryText(configState(), t),
    'config.place.answer|24|config.on|config.off',
  )
  assert.equal(
    client.__test.configSummaryText(configState({ value: { defaultPlace: 'dock', maxBlocks: 12, nextSteps: true, dock: true } }), t),
    'config.place.dock|12|config.on|config.on',
  )
  assert.equal(client.__test.configSummaryText(undefined, t), 'config.summaryEmpty')
  // Unknown placement falls back to the first option.
  assert.equal(
    client.__test.configSummaryText(configState({ value: { defaultPlace: 'weird', maxBlocks: 6 } }), t),
    'config.place.answer|6|config.off|config.off',
  )
})

test('config namespace: picks the settings entry ending in the package stem', () => {
  const service = (namespaces) => ({
    describe: () => ({ getSnapshot: () => ({ view: { namespaces } }) }),
  })
  assert.equal(client.__test.configNamespace(service([{ ns: 'other' }, { ns: 'project-super-cards' }])), 'project-super-cards')
  assert.equal(client.__test.configNamespace(service([{ ns: 'super-cards' }])), 'super-cards')
  assert.equal(client.__test.configNamespace(service([{ ns: 'other' }])), 'super-cards')
  assert.equal(client.__test.configNamespace(undefined), 'super-cards')
  const throwing = { describe() { throw new Error('no describe') } }
  assert.equal(client.__test.configNamespace(throwing), 'super-cards')
})

test('bundle page: summary line and the four basic fields with one save', () => {
  const state = configState()
  const calls = []
  const form = {
    state,
    mutate(ops, revision) {
      calls.push({ ops, revision })
      return true
    },
  }
  const page = client.__test.configBundleCard
  const t = (token) => token

  // summary: the card one-liner.
  const summary = mount(page({ view: 'summary', form, t }))
  assert.ok(hasClass(summary, 'dsh-sc-config-summary'))
  assert.ok(textOf(summary).includes('config.summary'))

  // page: four labelled rows, the basic controls, and the two actions.
  const draft = Object.assign(client.__test.configDraft(state), { nextSteps: false, maxBlocks: '12' })
  const rendered = mount(mount(page({ view: 'page', form, draft, t })))
  const rows = findAll(rendered, (node) => hasClass(node, 'dsh-sc-config-row'))
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map((row) => textOf(findOne(row, (node) => hasClass(node, 'dsh-sc-config-label')))), [
    'config.nextSteps', 'config.dock', 'config.defaultPlace', 'config.maxBlocks',
  ])
  const inputs = findAll(rendered, (node) => node.type === 'input')
  assert.deepEqual(inputs.map((input) => input.props.type), ['checkbox', 'checkbox', 'number'])
  const select = findOne(rendered, (node) => node.type === 'select')
  assert.ok(select)
  assert.deepEqual(select.children.map((option) => option.props.value), ['answer', 'process', 'dock', 'tail'])
  const save = findOne(rendered, (node) => node.type === 'button' && node.props['data-variant'] === 'primary')
  assert.ok(save)
  assert.equal(save.props.disabled, false)
  save.props.onClick()
  assert.deepEqual(calls, [{
    ops: [
      { op: 'set', path: ['nextSteps'], value: false },
      { op: 'set', path: ['maxBlocks'], value: 12 },
    ],
    revision: 3,
  }])

  // The running Plugins page hands no `form` to a bundle entry, so the page
  // must resolve the same values from the configForms service itself.
  const nsCalls = []
  const service = {
    describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'super-cards' }] } }) }),
    get(ns) {
      nsCalls.push(ns)
      return { getSnapshot: () => state, subscribe: () => () => {}, mutate: () => true }
    },
  }
  const fromService = mount(mount(page({ view: 'page', getForms: () => service, t })))
  assert.deepEqual(nsCalls, ['super-cards'])
  assert.equal(findAll(fromService, (node) => hasClass(node, 'dsh-sc-config-row')).length, 4)

  // No owner form and no service: a muted line, never a throw.
  const absent = mount(page({ view: 'page', t }))
  assert.ok(hasClass(absent, 'dsh-sc-config-muted'))
  assert.ok(textOf(absent).includes('config.unavailable'))
})

test('settings tab: full form from configForms, and a muted line without it', () => {
  const state = configState()
  const calls = []
  const nsCalls = []
  const form = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    mutate(ops, revision) {
      calls.push({ ops, revision })
      return true
    },
  }
  const service = {
    describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'other' }, { ns: 'project-super-cards' }] } }) }),
    get(ns) {
      nsCalls.push(ns)
      return form
    },
  }
  const tab = client.__test.configSettingsTab
  const t = (token) => token
  const draft = Object.assign(client.__test.configDraft(state), { nextStepsMax: '4' })
  const rendered = mount(mount(tab({ getForms: () => service, draft, t })))
  assert.deepEqual(nsCalls, ['project-super-cards'])
  assert.equal(findAll(rendered, (node) => hasClass(node, 'dsh-sc-config-row')).length, 10)
  const save = findOne(rendered, (node) => node.type === 'button' && node.props['data-variant'] === 'primary')
  assert.ok(save)
  save.props.onClick()
  assert.deepEqual(calls, [{ ops: [{ op: 'set', path: ['nextStepsMax'], value: 4 }], revision: 3 }])

  // No configForms service: one localized muted line, no throw.
  const absent = mount(tab({ getForms: () => undefined, t }))
  assert.ok(hasClass(absent, 'dsh-sc-config-muted'))
  assert.equal(textOf(absent), 'config.unavailable')

  // A service that refuses reads or throws must degrade the same way.
  const throwing = { describe() { throw new Error('gone') }, get() { throw new Error('gone') } }
  const broken = mount(tab({ getForms: () => throwing, t }))
  assert.ok(hasClass(broken, 'dsh-sc-config-muted'))
  assert.equal(textOf(broken), 'config.unavailable')
})
