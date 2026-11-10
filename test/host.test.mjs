/**
 * Host-half tests for the Super Cards bundle.
 *
 * Runs with `node --test` and no dependencies: a fake Cordis context records
 * tool/prompt registrations, effect disposals, and event listeners so the tool
 * definition, normalization caps, error contract, prompt section, and the
 * automatic next-step generator can be exercised without the Host runtime.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as host from '../index.js'

const { apply, inject, __test } = host
const { TOOL_NAME, BLOCKS_TOOL_NAME, BLOCK_TYPES, DOCK_BLOCKS, ICONS, CAPS, normalizeSpec, blockContractCatalog, resolveConfig } = __test
const {
  MOTION_EFFECTS,
  MOTION_DEFAULTS,
  MOTION_LIMITS,
  MOTION_LOOKUP,
  normalizeMotion,
  motionContractText,
  createHostService,
} = __test
const {
  NEXT_STEPS_EVENT,
  NEXT_STEPS_EVENT_LEGACY,
  isNextStepsEventType,
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
} = __test

/**
 * Stand-in for the Host's `appendPluginRecord`.
 *
 * The real writer stamps `ignorable: true` and the `plugin:` namespace; the fake
 * records the same envelope on the fake session so the wire contract stays under
 * test. Install it as `env.appendPluginRecord`.
 */
function fakeRecordWriter(session, type, data) {
  return session.append(type, data)
}

/** Install environment carrying the record writer (real timers). */
const RECORD_ENV = { appendPluginRecord: fakeRecordWriter }

/** The canonical example from SPEC.md, used verbatim in the tool description. */
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
      rows: [
        ['api', 'healthy', '41%'],
        ['worker', 'healthy', '63%'],
      ],
      align: ['left', 'left', 'right'],
    },
    { type: 'actions', items: [{ label: '查看日志', prompt: '查看这次部署的日志', tone: 'primary' }] },
  ],
}

/** Minimal valid payloads, one per block type, for per-type normalization tests. */
const MINIMAL_BLOCKS = {
  text: { text: 'a paragraph' },
  heading: { text: 'a heading' },
  callout: { text: 'a notice' },
  stats: { items: [{ label: 'Metric', value: 1 }] },
  table: { columns: ['A'], rows: [['1']] },
  keyvalue: { items: [{ key: 'k', value: 'v' }] },
  list: { items: ['one', 'two'] },
  badges: { items: [{ label: 'tag' }] },
  progress: { items: [{ label: 'step', value: 0.5 }] },
  bars: { items: [{ label: 'bar', value: 2 }] },
  sparkline: { values: [1, 2, 3] },
  pie: { items: [{ label: 'api', value: 60 }, { label: 'web', value: 40 }] },
  code: { code: 'const a = 1' },
  quote: { text: 'a quote', by: 'someone' },
  timeline: { items: [{ title: 'step one' }] },
  links: { items: [{ label: 'Docs', href: 'https://example.com' }] },
  actions: { items: [{ label: 'Retry', prompt: 'Retry the deploy' }] },
  divider: {},
  live: { field: 'last-message', limit: 2 },
  controls: { title: 'Settings', items: [{ kind: 'setting', setting: 'theme', options: [{ value: 'dark', label: 'Dark' }] }] },
  diagram: {
    kind: 'flowchart',
    nodes: [{ id: 'a', label: 'Request' }, { id: 'b', label: 'Deploy' }],
    edges: [{ from: 'a', to: 'b', label: 'go' }],
  },
  tree: { nodes: [{ label: 'src', children: [{ label: 'index.js' }] }] },
  heatmap: { columns: 4, items: [{ label: 'a', value: 1 }, { label: 'b', value: 0 }] },
  diff: { path: 'a.js', lines: [{ kind: 'ctx', text: 'a' }, { kind: 'add', text: 'b' }] },
  kanban: { columns: [{ title: 'Todo', cards: [{ title: 'Card', badges: ['P1'] }] }] },
  tabs: { items: [{ label: 'One', blocks: [{ type: 'text', text: 'pane' }] }] },
  columns: { items: [{ blocks: [{ type: 'text', text: 'left' }] }, { blocks: [{ type: 'text', text: 'right' }] }] },
  image: { src: 'https://example.com/a.png', alt: 'a chart', height: 200 },
  html: { html: '<div style="height:40px">ok</div>' },
}

/**
 * Build a fake Cordis context that records registrations and effects.
 * @param {Record<string, unknown>} [services] services returned by `ctx.get`.
 * @returns {{ctx: object, tools: Map<string, object>, sections: Map<string, object>, provided: Map<string, object>, effects: Array<object>, listeners: Map<string, Array<Function>>}} fake context and recorders.
 */
function createFakeCtx(services = {}) {
  const tools = new Map()
  const sections = new Map()
  const provided = new Map()
  const effects = []
  const listeners = new Map()
  const ctx = {
    provide(name, value) {
      assert.equal(typeof name, 'string')
      assert.ok(!provided.has(name), `duplicate service: ${name}`)
      provided.set(name, value)
      return () => provided.delete(name)
    },
    get(name) {
      return services[name]
    },
    on(name, listener) {
      assert.equal(typeof name, 'string')
      assert.equal(typeof listener, 'function')
      const bucket = listeners.get(name) ?? []
      bucket.push(listener)
      listeners.set(name, bucket)
      return () => {
        const current = listeners.get(name) ?? []
        const index = current.indexOf(listener)
        if (index >= 0) current.splice(index, 1)
      }
    },
    tools: {
      register(definition) {
        assert.equal(typeof definition, 'object')
        assert.equal(typeof definition.name, 'string')
        assert.ok(!tools.has(definition.name), `duplicate tool registration: ${definition.name}`)
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        assert.equal(typeof section, 'object')
        assert.equal(typeof section.name, 'string')
        sections.set(section.name, section)
        return () => sections.delete(section.name)
      },
    },
    effect(callback, label) {
      const returned = callback()
      const record = {
        label,
        disposed: false,
        dispose() {
          if (record.disposed) return
          record.disposed = true
          if (typeof returned === 'function') returned()
        },
      }
      effects.push(record)
      return record.dispose
    },
  }
  return { ctx, tools, sections, provided, effects, listeners }
}

/**
 * Deliver one event to every listener registered for its name.
 * @param {{ listeners: Map<string, Array<Function>> }} fake fake context recorders.
 * @param {string} name event name.
 * @param {...unknown} args listener arguments.
 * @returns {void}
 */
function emit(fake, name, ...args) {
  for (const listener of (fake.listeners.get(name) ?? []).slice()) listener(...args)
}

/**
 * Apply the plugin to a fresh fake context and return the recorders.
 * @returns {{ctx: object, tools: Map<string, object>, sections: Map<string, object>, effects: Array<object>, tool: object}} registrations and the tool definition.
 */
function setup() {
  const fake = createFakeCtx()
  apply(fake.ctx)
  const tool = fake.tools.get(TOOL_NAME)
  assert.ok(tool, 'apply() must register the render_ui tool')
  return { ...fake, tool }
}

/**
 * Assert one rejected promise carries the actionable `render_ui: ` prefix.
 * @param {() => Promise<unknown>} fn failing operation.
 * @param {string} [context] extra label for failure messages.
 * @returns {Promise<void>} resolves after the rejection was checked.
 */
async function assertRenderUiError(fn, context) {
  await assert.rejects(fn, (error) => {
    assert.ok(error instanceof Error, `${context}: expected an Error instance`)
    assert.ok(
      error.message.startsWith(TOOL_NAME + ': '),
      `${context}: error message must start with "render_ui: " — got ${JSON.stringify(error.message)}`,
    )
    assert.ok(
      error.message.length > TOOL_NAME.length + 8,
      `${context}: error must carry an actionable reason — got ${JSON.stringify(error.message)}`,
    )
    return true
  })
}

const ALLOWED_SCHEMA_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'description',
  'title',
  'default',
  'examples',
])

/**
 * Assert a raw JSON Schema only uses the Host-supported keyword subset.
 * @param {Record<string, unknown>} node schema node.
 * @param {string} path diagnostic path.
 * @returns {void}
 */
function assertSupportedSchema(node, path) {
  assert.ok(node !== null && typeof node === 'object' && !Array.isArray(node), `${path} must be a schema object`)
  for (const [key, value] of Object.entries(node)) {
    assert.ok(ALLOWED_SCHEMA_KEYWORDS.has(key), `${path}.${key} is not a supported JSON-Schema keyword`)
    if (key === 'properties') {
      assert.ok(value !== null && typeof value === 'object')
      for (const [name, child] of Object.entries(value)) assertSupportedSchema(child, `${path}.properties.${name}`)
    } else if (key === 'items') {
      assertSupportedSchema(value, `${path}.items`)
    }
  }
}

test('module exposes exactly the Cordis plugin surface (no default export)', () => {
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
  assert.equal(typeof apply, 'function')
  assert.equal('default' in host, false)
  assert.equal(host.apply, apply)
})

test('apply() registers the tool and the prompt section inside effects, and disposal unregisters them', () => {
  const fake = createFakeCtx()
  apply(fake.ctx)

  assert.equal(fake.effects.length, 5, 'every registration must live in one ctx.effect')
  for (const effect of fake.effects) {
    assert.equal(typeof effect.label, 'string')
    assert.ok(effect.label.includes('super-cards'), `effect label should be identifiable: ${effect.label}`)
  }
  assert.ok(fake.tools.has(TOOL_NAME))
  assert.ok(fake.tools.has('render_ui_blocks'))
  assert.ok(fake.provided.has('superCards'))
  assert.ok(fake.sections.has('super-cards'))
  // Next steps are opt-in, so the bare row installs no session listener.
  const sessionListeners = () => (fake.listeners.get('session/event') ?? []).length
  assert.equal(fake.listeners.size, 0)
  assert.equal(sessionListeners(), 0)
  // Only an explicit `nextSteps: true` installs exactly one listener.
  const enabledFake = createFakeCtx()
  apply(enabledFake.ctx, { nextSteps: true }, RECORD_ENV)
  assert.equal((enabledFake.listeners.get('session/event') ?? []).length, 1)

  // Disposing the renderer's effect removes only the renderer tool.
  fake.effects[0].dispose()
  assert.equal(fake.tools.has(TOOL_NAME), false)
  assert.equal(fake.tools.has('render_ui_blocks'), true)
  assert.equal(fake.sections.size, 1)
  // Disposing the lookup tool effect removes only the lookup tool.
  fake.effects[1].dispose()
  assert.equal(fake.tools.size, 0)
  assert.equal(fake.sections.size, 1)
  // Disposing the service effect removes only the service.
  fake.effects[2].dispose()
  assert.equal(fake.provided.size, 0)
  assert.equal(fake.sections.size, 1)
  // Disposing the section effect removes only the section.
  fake.effects[3].dispose()
  assert.equal(fake.sections.size, 0)
  // Disposing the disabled next-step effect is a no-op.
  fake.effects[4].dispose()
  assert.equal(sessionListeners(), 0)
  // Disposing the enabled effect removes its session listener.
  enabledFake.effects[4].dispose()
  assert.equal((enabledFake.listeners.get('session/event') ?? []).length, 0)
  // Repeated disposal is a no-op, never a crash.
  fake.effects[0].dispose()
  fake.effects[1].dispose()
  fake.effects[2].dispose()
  fake.effects[3].dispose()
  fake.effects[4].dispose()
  enabledFake.effects[4].dispose()
})

test('tool definition carries the exact wire name and the full model-facing description', () => {
  const { tool } = setup()
  assert.equal(tool.name, 'render_ui')
  assert.equal(tool.name, TOOL_NAME)
  assert.equal(typeof tool.description, 'string')

  for (const phrase of ['When to use', 'When not to use', 'Do NOT repeat', 'Block directory (29 types', 'Canonical example', 'render_ui_blocks']) {
    assert.ok(tool.description.includes(phrase), `description is missing ${JSON.stringify(phrase)}`)
  }
  // Every block type is discoverable from the description, not only the schema.
  for (const type of BLOCK_TYPES) {
    assert.ok(tool.description.includes('`' + type + '`'), `description is missing block type ${type}`)
  }
  // The canonical example is embedded verbatim (modulo JSON whitespace).
  const exampleLine = tool.description
    .split('\n')
    .find((line) => line.trim().startsWith('{"title":"Deploy summary"'))
  assert.ok(exampleLine, 'description must embed the canonical example as one JSON line')
  assert.deepEqual(JSON.parse(exampleLine), CANONICAL)
  // Explicit instruction against restating the card.
  assert.match(tool.description, /do not repeat the card content in markdown/i)
  // Diagram presentation rules: one diagram per card, and mermaid fences are
  // converted automatically (so the model knows the trade-off).
  assert.match(tool.description, /each diagram in its own card/i)
  assert.match(tool.description, /Do not emit ```mermaid/i)
  assert.match(tool.description, /switch to its source with one button/i)
})

test('parameters schema is strict, requires no single field, and enumerates all 29 block types', () => {
  const { tool } = setup()
  const parameters = tool.parameters
  assertSupportedSchema(parameters, 'parameters')

  assert.equal(parameters.type, 'object')
  assert.deepEqual(parameters.required, [])
  assert.equal(parameters.additionalProperties, false)
  assert.deepEqual(
    Object.keys(parameters.properties).sort(),
    ['blocks', 'content', 'icon', 'layout', 'look', 'place', 'status', 'subtitle', 'title', 'version'],
  )

  const blocks = parameters.properties.blocks
  assert.equal(blocks.type, 'array')
  assert.equal(blocks.items.type, 'object')
  assert.deepEqual(blocks.items.required, ['type'])
  assert.equal(blocks.items.additionalProperties, true)
  const typeEnum = blocks.items.properties.type.enum
  assert.deepEqual([...typeEnum], [...BLOCK_TYPES])
  assert.equal(typeEnum.length, 29)
  assert.equal(new Set(typeEnum).size, 29)
  assert.deepEqual(
    [...typeEnum].sort(),
    [
      'actions',
      'badges',
      'bars',
      'callout',
      'code',
      'columns',
      'controls',
      'diagram',
      'diff',
      'divider',
      'heading',
      'heatmap',
      'html',
      'image',
      'kanban',
      'keyvalue',
      'links',
      'list',
      'live',
      'pie',
      'progress',
      'quote',
      'sparkline',
      'stats',
      'table',
      'tabs',
      'text',
      'timeline',
      'tree',
    ],
  )

  assert.deepEqual([...parameters.properties.icon.enum], [...ICONS])
  assert.equal(parameters.properties.title.type, 'string')
  assert.equal(parameters.properties.subtitle.type, 'string')
})

test('output contract: supported schema, one short text block telling the model not to repeat the card', () => {
  const { tool } = setup()
  assertSupportedSchema(tool.output.schema, 'output.schema')
  assert.equal(tool.output.schema.type, 'object')
  assert.deepEqual(new Set(tool.output.schema.required), new Set(['ok', 'blocks', 'types', 'place']))
  assert.equal(typeof tool.output.render, 'function')

  const rendered = tool.output.render(CANONICAL, { ok: true, blocks: 4, types: ['callout', 'stats', 'table', 'actions'] })
  assert.ok(Array.isArray(rendered))
  assert.equal(rendered.length, 1)
  assert.equal(rendered[0].type, 'text')
  assert.equal(typeof rendered[0].text, 'string')
  assert.match(rendered[0].text, /do not repeat/i)
  assert.match(rendered[0].text, /4 blocks/)
  assert.ok(rendered[0].text.split(/\s+/).length <= 20, 'model-facing text must stay one short sentence')

  // Defensive: render never throws, even with a missing/odd result value.
  for (const value of [undefined, null, {}, { blocks: 'nope' }, 42]) {
    const fallback = tool.output.render({}, value)
    assert.equal(fallback.length, 1)
    assert.equal(fallback[0].type, 'text')
    assert.match(fallback[0].text, /do not repeat/i)
  }
})

test('presentCall returns the generic Super Cards card hint and never throws', () => {
  const { tool } = setup()
  assert.equal(typeof tool.presentCall, 'function')
  assert.deepEqual(tool.presentCall(CANONICAL), { card: 'generic', title: 'Super Cards', kind: 'other' })
  for (const args of [undefined, null, {}, { blocks: 'broken' }]) {
    assert.deepEqual(tool.presentCall(args), { card: 'generic', title: 'Super Cards', kind: 'other' })
  }
})

test('execute() reports the requested placement and defaults to answer', async () => {
  const { tool } = setup()
  const process = await tool.execute({ place: 'process', blocks: [{ type: 'divider' }] })
  assert.equal(process.place, 'process')
  const bogus = await tool.execute({ place: 'sideways', blocks: [{ type: 'divider' }] })
  assert.equal(bogus.place, 'answer')
  const text = await tool.execute(JSON.stringify({ place: 'process', blocks: [{ type: 'divider' }] }))
  assert.equal(text.place, 'process')
})

test('a tail card is a normal card placed at the end of the completed turn', async () => {
  const { tool } = setup()
  const spec = {
    place: 'tail',
    look: 'relaxed',
    blocks: [
      { type: 'text', text: 'Run the suite to back the static review?' },
      { type: 'actions', items: [
        { label: 'Run the tests', prompt: 'Run the repo test suite.', tone: 'primary' },
        { label: 'No, that is enough', prompt: 'No, that is enough.' },
      ] },
    ],
  }
  const result = await tool.execute(spec)
  assert.equal(result.place, 'tail')
  assert.equal(result.blocks, 2)
  assert.deepEqual(result.types, ['text', 'actions'])
  // Tail is a position, not a block filter: any type may end a turn.
  const rich = await tool.execute({ place: 'tail', blocks: [{ type: 'table', columns: ['a'], rows: [['1']] }] })
  assert.deepEqual(rich.types, ['table'])
  assert.equal(resolveConfig({ defaultPlace: 'tail' }).defaultPlace, 'tail')
})

test('execute() accepts the canonical example and reports {ok, blocks, types}', async () => {
  const { tool } = setup()
  assert.equal(typeof tool.execute, 'function')

  const result = await tool.execute(CANONICAL)
  assert.deepEqual(result, { ok: true, blocks: 4, types: ['callout', 'stats', 'table', 'actions'], place: 'answer' })

  // The same spec as JSON text is tolerated defensively.
  assert.deepEqual(await tool.execute(JSON.stringify(CANONICAL)), result)

  // The result still satisfies the declared output schema.
  assert.equal(typeof result.ok, 'boolean')
  assert.ok(Number.isInteger(result.blocks))
  assert.ok(Array.isArray(result.types))
  assert.ok(result.types.every((type) => typeof type === 'string'))
})

test('execute() normalizes every supported block type', async () => {
  const { tool } = setup()
  for (const type of BLOCK_TYPES) {
    const result = await tool.execute({ blocks: [{ type, ...MINIMAL_BLOCKS[type] }] })
    assert.deepEqual(result, { ok: true, blocks: 1, types: [type], place: 'answer' }, `block type ${type} should normalize`)
  }
})

test('execute() truncates the block list to 24 blocks', async () => {
  const { tool } = setup()
  const blocks = Array.from({ length: 30 }, (_, index) => ({ type: 'text', text: `line ${index}` }))
  const result = await tool.execute({ blocks })
  assert.equal(result.ok, true)
  assert.equal(result.blocks, CAPS.blocks)
  assert.equal(result.types.length, CAPS.blocks)
})

test('normalizeSpec() truncates table rows, sparkline points, code, text fields, and actions', () => {
  const long = 'x'.repeat(5000)
  const spec = normalizeSpec({
    title: long,
    subtitle: long,
    blocks: [
      { type: 'table', columns: ['A', 'B'], rows: Array.from({ length: 60 }, (_, index) => [String(index), String(index)]) },
      { type: 'sparkline', values: Array.from({ length: 200 }, (_, index) => index) },
      { type: 'code', code: 'y'.repeat(10000) },
      { type: 'text', text: long },
      { type: 'actions', items: Array.from({ length: 12 }, (_, index) => ({ label: `L${index}`, prompt: `P${index}` })) },
    ],
  })

  assert.equal(spec.title.length, CAPS.textChars)
  assert.equal(spec.subtitle.length, CAPS.textChars)
  assert.equal(spec.blocks.length, 5)

  const [table, sparkline, code, text, actions] = spec.blocks
  assert.equal(table.type, 'table')
  assert.equal(table.rows.length, CAPS.tableRows)
  assert.equal(table.rows[0].length, table.columns.length)

  assert.equal(sparkline.type, 'sparkline')
  assert.equal(sparkline.values.length, CAPS.sparklineValues)

  assert.equal(code.type, 'code')
  assert.equal(code.code.length, CAPS.codeChars)

  assert.equal(text.type, 'text')
  assert.equal(text.text.length, CAPS.textChars)

  assert.equal(actions.type, 'actions')
  assert.equal(actions.items.length, CAPS.actions)
})

test('normalizeSpec() clamps progress, drops bad tone/icon values, and pads table rows', () => {
  const spec = normalizeSpec({
    icon: 'not-a-real-icon',
    blocks: [
      { type: 'progress', items: [{ label: 'high', value: 5 }, { label: 'low', value: -3 }, { label: 'plain', value: 0.42 }] },
      { type: 'callout', tone: 'loud', text: 'notice' },
      { type: 'table', columns: ['A', 'B'], rows: [['only-one-cell']] },
    ],
  })
  assert.equal('icon' in spec, false)
  assert.deepEqual(
    spec.blocks[0].items.map((item) => item.value),
    [1, 0, 0.42],
  )
  assert.equal('tone' in spec.blocks[1], false)
  assert.deepEqual(spec.blocks[2].rows, [['only-one-cell', null]])
  assert.equal('align' in spec.blocks[2], false)
})

test('unknown and unusable blocks are reported in `dropped`, never fatal', async () => {
  const { tool } = setup()

  const result = await tool.execute({
    blocks: [
      { type: 'text', text: 'kept' },
      { type: 'hologram', payload: { future: true } },
      { type: 'table', columns: [] },
      { type: 'stats', items: [] },
      { type: 'divider' },
    ],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.types, ['text', 'divider'])
  assert.deepEqual(result.dropped, [
    { index: 1, type: 'hologram', reason: 'unknown block type' },
    { index: 2, type: 'table', reason: 'no usable content' },
    { index: 3, type: 'stats', reason: 'no usable content' },
  ])

  // Forward-compatible: a future block type alone is skipped, then rejected as an empty card.
  const normalized = normalizeSpec({ blocks: [{ type: 'text', text: 'kept' }, { type: 'hologram' }] })
  assert.equal(normalized.blocks.length, 1)
  assert.equal(normalized.blocks[0].type, 'text')
})

test('a content field name used as a block type folds onto the matching control', async () => {
  const { tool } = setup()
  const result = await tool.execute({
    blocks: [
      { type: 'note', text: 'nightly 没有更新说明', tone: 'neutral' },
      { type: 'summary', text: '一句话' },
      { type: 'metrics', items: [{ label: 'Pods', value: '12/12' }] },
      { type: 'steps', items: [{ title: 'build' }, { title: 'ship' }] },
      { type: 'items', items: ['a', 'b'] },
      { type: 'tags', items: [{ label: 'x' }, { label: 'y' }] },
      { type: 'facts', items: [{ key: 'k', value: 'v' }] },
      { type: 'series', values: [1, 2, 3] },
      { type: 'breakdown', items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] },
      { type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] },
    ],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.types, [
    'callout', 'callout', 'stats', 'timeline', 'list',
    'badges', 'keyvalue', 'sparkline', 'pie', 'diagram',
  ])
  assert.equal('dropped' in result, false)

  // The notice fields keep their own default tone; an explicit tone wins.
  const spec = normalizeSpec({
    blocks: [{ type: 'note', text: 'warn by default' }, { type: 'summary', text: 'info by default' }],
  })
  assert.equal(spec.blocks[0].type, 'callout')
  assert.equal(spec.blocks[0].tone, 'warn')
  assert.equal(spec.blocks[1].tone, 'info')

  // A fold with unusable material is still reported, never fatal — and the same
  // payload with the canonical name would drop the same way.
  const degraded = normalizeSpec({ blocks: [{ type: 'tags', items: [] }, { type: 'text', text: 'kept' }] }, { dropped: [] })
  assert.deepEqual(degraded.blocks.map((block) => block.type), ['text'])
  const canonical = normalizeSpec({ blocks: [{ type: 'badges', items: ['x'] }, { type: 'text', text: 'kept' }] }, { dropped: [] })
  assert.deepEqual(canonical.blocks.map((block) => block.type), ['text'])

  // An alias is not a registered type: the wire enum stays canonical.
  assert.equal(BLOCK_TYPES.includes('note'), false)
  assert.equal(host.__test.BLOCK_ALIASES.get('note').type, 'callout')
})

test('pie and column direction normalize through the registry', async () => {
  const { tool } = setup()
  const result = await tool.execute({
    blocks: [
      { type: 'pie', title: 'Traffic', unit: '%', items: [{ label: 'a', value: 2 }, { label: 'b', value: 1 }, { label: 'c', value: -1 }] },
      { type: 'bars', direction: 'vertical', items: [{ label: 'Mon', value: 3 }] },
    ],
  })
  assert.deepEqual(result, { ok: true, blocks: 2, types: ['pie', 'bars'], place: 'answer' })

  const spec = normalizeSpec({
    blocks: [
      { type: 'pie', donut: false, items: [{ label: 'a', value: 2 }] },
      { type: 'pie', items: Array.from({ length: 12 }, (_, index) => ({ label: 's' + index, value: index + 1 })) },
      { type: 'pie', items: [{ label: 'z', value: 0 }] },
    ],
  })
  assert.equal(spec.blocks.length, 2, 'a pie without a positive share is dropped')
  assert.equal(spec.blocks[0].donut, false)
  assert.equal(spec.blocks[1].items.length, CAPS.pieSlices, 'slices are capped')
})

test('pie with no usable slice is reported in dropped, never fatal', async () => {
  const { tool } = setup()
  const result = await tool.execute({
    blocks: [{ type: 'text', text: 'kept' }, { type: 'pie', items: [{ label: 'z', value: 0 }] }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.types, ['text'])
  assert.deepEqual(result.dropped, [{ index: 1, type: 'pie', reason: 'no usable content' }])
})

test('invalid input is rejected with an actionable "render_ui: " error', async () => {
  const { tool } = setup()
  const invalid = [
    undefined,
    null,
    42,
    true,
    [],
    'not json',
    {},
    { blocks: [] },
    { blocks: 'nope' },
    { blocks: [null] },
    { blocks: [{}] },
    { blocks: [{ type: 42 }] },
    { blocks: [{ type: '' }] },
    { blocks: [{ type: 'hologram' }] },
    { blocks: [{ type: 'text', text: '' }] },
    { blocks: [{ type: 'text' }] },
  ]
  for (const args of invalid) {
    await assertRenderUiError(() => tool.execute(args), JSON.stringify(args))
  }

  await assert.rejects(
    () => tool.execute({ blocks: 'nope' }),
    (error) => {
      assert.match(error.message, /blocks/)
      assert.match(error.message, /array/i)
      return true
    },
  )
})

test('hostile arguments never escape as a non-render_ui error', async () => {
  const { tool } = setup()
  const hostile = {}
  Object.defineProperty(hostile, 'blocks', {
    get() {
      throw new Error('boom')
    },
  })
  await assertRenderUiError(() => tool.execute(hostile), 'throwing getter')
  await assertRenderUiError(() => tool.execute(JSON.stringify([1, 2, 3])), 'JSON array')
})

test('system prompt section is short, names the tool, and says the card is the answer', () => {
  const { sections } = setup()
  const section = sections.get('super-cards')
  assert.ok(section, 'apply() must register the super-cards prompt section')
  assert.equal(section.name, 'super-cards')
  assert.equal(section.order, __test.PROMPT_SECTION_ORDER)
  assert.equal(section.order, 60)
  assert.equal(typeof section.text, 'string')

  const lines = section.text.split('\n')
  const contentLines = lines.filter((line) => line.trim() !== '')
  assert.ok(lines.length >= 10 && lines.length <= 18, `prompt section should be ~10-18 lines, got ${lines.length}`)
  assert.ok(
    contentLines.length >= 8 && contentLines.length <= 16,
    `prompt section should have ~8-16 content lines, got ${contentLines.length}`,
  )
  assert.ok(section.text.includes('render_ui'))
  assert.match(section.text, /do not repeat its content in markdown/i)
  assert.match(section.text, /structured/i)
  // The prompt repeats the one-diagram-per-card rule when diagrams are enabled,
  // and tells the model that mermaid fences are auto-converted.
  assert.match(section.text, /One diagram per card/)
  assert.match(section.text, /Do not write ```mermaid blocks/)
  assert.match(section.text, /toggles between the chart and its source/)
  // Short section: it must not duplicate the full block reference.
  assert.ok(section.text.length < __test.TOOL_DESCRIPTION.length)
  for (const type of ['sparkline', 'keyvalue', 'badges', 'progress', 'timeline']) {
    assert.equal(section.text.includes('`' + type + '`'), false, `prompt section must not duplicate block reference (${type})`)
  }
})

test('display cards: status "none" is accepted, and a missing status is never invented', () => {
  const { tool } = setup()
  assert.ok(tool.parameters.properties.status.enum.includes('none'))

  // "none" opts a progress-bearing card out of the lifecycle state machine.
  const forced = normalizeSpec({ status: 'none', blocks: [{ type: 'progress', items: [{ label: 'a', value: 1 }] }] })
  assert.equal(forced.status, 'none')

  // An unknown status is dropped (the client then treats the card as display),
  // never an error that loses the whole card.
  const dropped = normalizeSpec({ status: 'bogus', blocks: [{ type: 'text', text: 'x' }] })
  assert.equal('status' in dropped, false)

  // Omitting status leaves it out of the spec: the model does not have to opt in
  // to "display card", it is the default.
  const plain = normalizeSpec({ blocks: [{ type: 'stats', items: [{ label: 'a', value: 1 }] }] })
  assert.equal('status' in plain, false)
})

test('the block directory and the dock subset are generated from the registry', () => {
  const { tool } = setup()
  const lines = tool.description.split('\n')
  const header = lines.find((line) => line.startsWith('Block directory ('))
  assert.ok(header, 'description must carry a generated block directory')
  assert.ok(header.includes(String(BLOCK_TYPES.length) + ' types'))
  // Progressive disclosure: the directory lists every type by name, and points
  // at the lookup tool for the exact contract.
  assert.ok(header.includes('render_ui_blocks'))
  for (const type of BLOCK_TYPES) {
    assert.ok(tool.description.includes('`' + type + '`'), `missing directory entry for ${type}`)
  }
  // Exact shapes stay out of the always-on description.
  assert.equal(tool.description.includes('{columns: string[]'), false, 'exact block shapes must be deferred to render_ui_blocks')
  assert.equal(tool.description.includes('{items: [{label, value'), false, 'exact block shapes must be deferred to render_ui_blocks')
  const dockLine = lines.find((line) => line.startsWith('Dock boards render only'))
  assert.ok(dockLine, 'description must name the dock subset')
  assert.ok(dockLine.includes(DOCK_BLOCKS.join(', ')), 'dock subset must come from the registry')
  assert.ok(dockLine.includes('at most ' + CAPS.dockBlocks))
  // Only the glanceable blocks are dock-safe; long-form blocks are not.
  assert.deepEqual(DOCK_BLOCKS, ['text', 'heading', 'callout', 'stats', 'list', 'badges', 'progress', 'live'])
  for (const type of ['table', 'code', 'actions', 'controls', 'divider']) {
    assert.equal(DOCK_BLOCKS.includes(type), false, type + ' must not be dock-safe')
  }
})

test('a dock board rejects long-form blocks with an actionable error', async () => {
  const { tool } = setup()
  await assert.rejects(
    () => tool.execute({ place: 'dock', blocks: [{ type: 'table', columns: ['a'], rows: [['1']] }] }),
    (error) => {
      assert.ok(error.message.startsWith('render_ui: '), 'error must be actionable')
      assert.match(error.message, /accepts only/)
      assert.match(error.message, /answer/)
      return true
    },
  )
})

test('a dock board keeps its glanceable blocks and reports what it dropped', async () => {
  const { tool } = setup()
  const result = await tool.execute({
    place: 'dock',
    blocks: [
      { type: 'progress', items: [{ label: 'p', value: 0.5 }] },
      { type: 'table', columns: ['a'], rows: [['1']] },
      { type: 'hologram' },
    ],
  })
  assert.equal(result.place, 'dock')
  assert.deepEqual(result.types, ['progress'])
  assert.deepEqual(result.dropped, [
    { index: 1, type: 'table', reason: 'not allowed in a dock board' },
    { index: 2, type: 'hologram', reason: 'unknown block type' },
  ])

  // A clean call carries no optional `dropped` key at all.
  const clean = await tool.execute({ blocks: [{ type: 'divider' }] })
  assert.equal('dropped' in clean, false)
})

test('the confirmation sentence reports dropped blocks within one short line', () => {
  const { tool } = setup()
  const rendered = tool.output.render({}, {
    ok: true,
    blocks: 2,
    types: ['progress'],
    place: 'dock',
    dropped: [{ index: 1, type: 'table', reason: 'not allowed in a dock board' }],
  })
  assert.equal(rendered.length, 1)
  assert.match(rendered[0].text, /1 block dropped/)
  assert.match(rendered[0].text, /do not repeat/i)
  assert.ok(rendered[0].text.split(/\s+/).length <= 20, 'model-facing text must stay one short sentence')
})

test('diagram blocks normalize graphs, sequences, and class compartments', () => {
  // Graph kinds: an unknown kind falls back to flowchart; direction defaults to LR.
  const flow = normalizeSpec({
    blocks: [{
      type: 'diagram',
      kind: 'mindmap',
      nodes: [{ id: 'a', label: 'A', shape: 'diamond', tone: 'brand' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b', label: 'go' }, { from: 'a', to: 'ghost' }],
    }],
  }).blocks[0]
  assert.equal(flow.kind, 'flowchart')
  assert.equal(flow.direction, 'LR')
  assert.equal(flow.nodes[0].shape, 'diamond')
  assert.equal(flow.nodes[0].tone, 'brand')
  assert.deepEqual(flow.edges, [{ from: 'a', to: 'b', label: 'go' }], 'edges with unknown endpoints are pruned')

  // Sequence: participants plus messages; return style survives; ghost endpoints are pruned.
  const seq = normalizeSpec({
    blocks: [{
      type: 'diagram',
      kind: 'sequence',
      participants: [{ id: 'u', label: 'User' }, { id: 's', label: 'Server' }],
      messages: [
        { from: 'u', to: 's', label: 'login' },
        { from: 'u', to: 'ghost' },
        { from: 's', to: 'u', style: 'return' },
      ],
    }],
  }).blocks[0]
  assert.equal(seq.messages.length, 2)
  assert.equal(seq.messages[1].style, 'return')

  // Class: compartments are carried through.
  const klass = normalizeSpec({
    blocks: [{
      type: 'diagram',
      kind: 'class',
      nodes: [{ id: 'order', label: 'Order', fields: ['id: uuid', 'total: money'], methods: ['submit()'] }],
    }],
  }).blocks[0]
  assert.deepEqual(klass.nodes[0].fields, ['id: uuid', 'total: money'])
  assert.deepEqual(klass.nodes[0].methods, ['submit()'])

  // Duplicate ids are deduped, so two nodes never share an id.
  const dup = normalizeSpec({ blocks: [{ type: 'diagram', nodes: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] }] }).blocks[0]
  assert.notEqual(dup.nodes[0].id, dup.nodes[1].id)
})

test('a diagram with nothing drawable is rejected like an empty card', async () => {
  const { tool } = setup()
  await assert.rejects(
    () => tool.execute({ blocks: [{ type: 'diagram', kind: 'sequence', participants: [{ id: 'u', label: 'User' }] }] }),
    (error) => {
      assert.match(error.message, /no renderable blocks/)
      return true
    },
  )
})

test('html: the source is kept verbatim, capped, and the frame height is clamped', async () => {
  const source = '<style>@keyframes p{50%{opacity:.4}}</style><div style="height:120px">hi</div>'
  const block = normalizeSpec({ blocks: [{ type: 'html', html: source, height: 200 }] }).blocks[0]
  assert.equal(block.type, 'html')
  assert.equal(block.html, source, 'the source is the card: byte-for-byte')
  assert.equal(block.height, 200)

  assert.equal(normalizeSpec({ blocks: [{ type: 'html', html: source }] }).blocks[0].height, 240, 'default height')
  assert.equal(normalizeSpec({ blocks: [{ type: 'html', html: source, height: 1 }] }).blocks[0].height, 120, 'height floor')
  assert.equal(normalizeSpec({ blocks: [{ type: 'html', html: source, height: 9999 }] }).blocks[0].height, 800, 'height cap')

  const capped = normalizeSpec({ blocks: [{ type: 'html', html: 'x'.repeat(30000) }] }).blocks[0]
  assert.equal(capped.html.length, CAPS.htmlChars)

  const { tool } = setup()
  await assert.rejects(
    () => tool.execute({ blocks: [{ type: 'html', html: '   ' }] }),
    (error) => {
      assert.match(error.message, /no renderable blocks/)
      return true
    },
  )
  assert.equal(BLOCK_TYPES.includes('html'), true)
  assert.equal(DOCK_BLOCKS.includes('html'), false, 'a sandboxed document is not a glanceable board block')
})

test('html: the contract names the sandbox and the theme tokens', async () => {
  const { tools } = setup()
  const contract = await tools.get(BLOCKS_TOOL_NAME).execute({ type: 'html' })
  assert.deepEqual(contract.types, ['html'])
  assert.match(contract.text, /sandboxed frame/)
  assert.match(contract.text, /no network/)
  assert.match(contract.text, /--dsw-alias-brand-primary/)
  assert.match(contract.text, /height/)
})

test('progressive disclosure: exact block contracts are served on demand', async () => {
  const fake = createFakeCtx()
  apply(fake.ctx)
  const renderer = fake.tools.get(TOOL_NAME)
  const blocksTool = fake.tools.get(BLOCKS_TOOL_NAME)
  assert.ok(blocksTool, 'apply() must register the lookup tool')
  assert.match(blocksTool.description, /exact field contract/)
  // The always-on description stays smaller than the catalog it defers.
  assert.ok(
    renderer.description.length < blockContractCatalog(BLOCK_TYPES).length,
    'the renderer description must defer the exact contracts',
  )

  const one = await blocksTool.execute({ type: 'table' })
  assert.deepEqual(one.types, ['table'])
  assert.match(one.text, /`table` \{columns/)
  assert.match(one.text, /example: \{"type":"table"/)
  // render() surfaces the contract text to the model.
  const rendered = blocksTool.output.render({}, one)
  assert.equal(rendered.length, 1)
  assert.match(rendered[0].text, /columns/)

  const all = await blocksTool.execute({})
  assert.equal(all.types.length, BLOCK_TYPES.length)
  for (const type of BLOCK_TYPES) {
    assert.ok(all.text.includes('`' + type + '`'), 'catalog must cover ' + type)
  }

  await assert.rejects(
    () => blocksTool.execute({ type: 'hologram' }),
    (error) => {
      assert.ok(error.message.startsWith(BLOCKS_TOOL_NAME + ': '))
      assert.match(error.message, /Available types/)
      return true
    },
  )
})

test('row config narrows the block set, the cap, the dock, and the default placement', async () => {
  const fake = createFakeCtx()
  apply(fake.ctx, { blocks: ['text', 'table'], maxBlocks: 2, dock: false, defaultPlace: 'process' })
  const tool = fake.tools.get(TOOL_NAME)
  const lookup = fake.tools.get(BLOCKS_TOOL_NAME)

  assert.deepEqual(tool.parameters.properties.blocks.items.properties.type.enum, ['text', 'table'])
  assert.deepEqual(tool.parameters.properties.place.enum, ['answer', 'process', 'tail'])
  assert.equal(tool.description.includes('`progress`'), false, 'disabled types must leave the directory')
  assert.match(tool.description, /Dock boards are disabled/)
  assert.deepEqual(lookup.parameters.properties.type.oneOf[0].enum, ['text', 'table', 'motion', 'content'], 'the lookup enum follows the configured allow-list, plus the motion and content keywords')

  const plain = await tool.execute({ blocks: [{ type: 'text', text: 'ok' }] })
  assert.equal(plain.place, 'process', 'defaultPlace applies when the model omits place')

  const disabled = await tool.execute({ blocks: [{ type: 'progress', items: [{ label: 'p', value: 0.5 }] }, { type: 'text', text: 'ok' }] })
  assert.deepEqual(disabled.types, ['text'])
  assert.deepEqual(disabled.dropped, [{ index: 0, type: 'progress', reason: 'block type not enabled by config' }])

  const capped = await tool.execute({ blocks: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }] })
  assert.equal(capped.blocks, 2)
  assert.deepEqual(capped.dropped, [{ index: 2, type: 'text', reason: 'over the block cap' }])

  const docked = await tool.execute({ place: 'dock', blocks: [{ type: 'text', text: 'x' }] })
  assert.equal(docked.place, 'answer', 'a disabled dock placement falls back to answer')
})

test('config resolution is defensive: junk falls back to the defaults', () => {
  const junk = resolveConfig({ blocks: 'nope', maxBlocks: -5, dock: 'maybe', defaultPlace: 'sideways' })
  assert.deepEqual(junk.types, BLOCK_TYPES)
  assert.equal(junk.maxBlocks, 1, 'a negative cap clamps to one block')
  assert.equal(junk.dock, true)
  assert.equal(junk.defaultPlace, 'answer')

  const defaults = resolveConfig(undefined)
  assert.deepEqual(defaults, { types: BLOCK_TYPES, maxBlocks: CAPS.blocks, dock: true, defaultPlace: 'answer' })

  // An allow-list of unknown names cannot disable every block.
  assert.deepEqual(resolveConfig({ blocks: ['hologram'] }).types, BLOCK_TYPES)
})

test('Config is a Schemastery schema whose editable fields are volatile', () => {
  const Schema = host.Config
  // A Schemastery schema: callable, serializable, and understood by the
  // settings projection that renders a form for it.
  assert.equal(typeof Schema, 'function')
  assert.equal(Schema.type, 'object')
  assert.equal(typeof Schema.toJSON, 'function')
  assert.deepEqual(Object.keys(Schema.dict), [
    'blocks',
    'maxBlocks',
    'dock',
    'defaultPlace',
    'nextSteps',
    'nextStepsMax',
    'nextStepsTimeoutMs',
    'nextStepsMinChars',
    'nextStepsProvider',
    'nextStepsModel',
  ])

  // Every editable field is volatile, so the settings form shows it and only
  // volatile paths are writable.
  for (const [key, field] of Object.entries(Schema.dict)) {
    assert.equal(field.meta.volatile, true, key + ' must be volatile')
    assert.equal(typeof field.meta.description, 'string', key + ' must carry form help text')
    assert.ok(field.meta.description.length > 0, key + ' description must not be empty')
  }

  // Schema defaults mirror the defaults resolveConfig()/next-steps apply.
  assert.equal(Schema.dict.maxBlocks.meta.default, CAPS.blocks)
  assert.equal(Schema.dict.dock.meta.default, true)
  assert.equal(Schema.dict.defaultPlace.meta.default, 'answer')
  assert.equal(Schema.dict.nextSteps.meta.default, false)
  assert.equal(Schema.dict.nextStepsMax.meta.default, 3)
  assert.equal(Schema.dict.nextStepsTimeoutMs.meta.default, 15000)
  assert.equal(Schema.dict.nextStepsMinChars.meta.default, 200)
  assert.equal('default' in Schema.dict.nextStepsProvider.meta, false)
  assert.equal('default' in Schema.dict.nextStepsModel.meta, false)

  // Bounds, the placement enum, and the block-type allow-list.
  assert.equal(Schema.dict.maxBlocks.meta.min, 1)
  assert.equal(Schema.dict.maxBlocks.meta.max, CAPS.blocks)
  assert.equal(Schema.dict.nextStepsMax.meta.min, 1)
  assert.equal(Schema.dict.nextStepsMax.meta.max, 4)
  assert.equal(Schema.dict.nextStepsTimeoutMs.meta.min, 1000)
  assert.equal(Schema.dict.nextStepsTimeoutMs.meta.max, 60000)
  assert.equal(Schema.dict.nextStepsMinChars.meta.min, 0)
  assert.equal(Schema.dict.nextStepsMinChars.meta.max, 2000)
  assert.deepEqual(Schema.dict.defaultPlace.list.map((item) => item.value), __test.PLACEMENTS)
  assert.deepEqual(Schema.dict.blocks.inner.list.map((item) => item.value), BLOCK_TYPES)

  // Parsing a row config fills every default; Schemastery hands back volatile
  // references, which the runtime face projects back to plain values below.
  const parsed = Schema({ nextSteps: true })
  assert.equal(parsed.nextSteps.get(), true)
  assert.equal(parsed.maxBlocks.get(), CAPS.blocks)
  assert.equal(parsed.defaultPlace.get(), 'answer')
  assert.deepEqual(parsed.blocks.get(), [])

  // Out-of-range, non-integer, unknown-block, and wrong-type values are rejected.
  for (const bad of [
    { maxBlocks: 0 },
    { maxBlocks: CAPS.blocks + 1 },
    { maxBlocks: 2.5 },
    { nextStepsMax: 0 },
    { nextStepsMax: 5 },
    { nextStepsTimeoutMs: 999 },
    { nextStepsTimeoutMs: 60001 },
    { nextStepsMinChars: -1 },
    { nextStepsMinChars: 2001 },
    { defaultPlace: 'sideways' },
    { dock: 'no' },
    { nextSteps: 'yes' },
    { blocks: 'text' },
    { blocks: ['hologram'] },
  ]) {
    assert.throws(
      () => Schema(bad),
      (error) => error.name === 'ValidationError',
      JSON.stringify(bad) + ' must be rejected',
    )
  }
})

test('the Config standard-schema face projects plain values and rejects unknown keys', () => {
  const face = host.Config['~standard']
  assert.equal(face.version, 1)
  assert.equal(typeof face.validate, 'function')
  // Not "schemastery": the loader then applies a config edit as an ordinary
  // remount, which is how this registration-time config takes effect.
  assert.equal(face.vendor, 'super-cards')

  const ok = face.validate({ blocks: ['text', 'table'], maxBlocks: 12, dock: false, defaultPlace: 'process' })
  assert.equal(ok.issues, undefined)
  // Plain JSON values, never volatile boxes: apply() reads these directly.
  for (const value of Object.values(ok.value)) {
    assert.notEqual(typeof value?.get, 'function', 'validated config must not leak volatile references')
  }
  assert.deepEqual(ok.value.blocks, ['text', 'table'])
  assert.equal(ok.value.maxBlocks, 12)
  assert.equal(ok.value.dock, false)
  assert.equal(ok.value.defaultPlace, 'process')
  assert.equal(ok.value.nextSteps, false)
  assert.equal(ok.value.nextStepsMax, 3)
  assert.equal(ok.value.nextStepsTimeoutMs, 15000)
  assert.equal(ok.value.nextStepsMinChars, 200)
  assert.equal(ok.value.nextStepsProvider, undefined)
  assert.equal(ok.value.nextStepsModel, undefined)
  // A missing row config resolves to the same defaults as resolveConfig(undefined).
  const defaults = face.validate(undefined).value
  assert.equal(defaults.maxBlocks, CAPS.blocks)
  assert.equal(defaults.dock, true)
  assert.equal(defaults.defaultPlace, 'answer')
  assert.equal(defaults.nextSteps, false)
  assert.deepEqual(defaults.blocks, [])
  assert.deepEqual(resolveConfig(defaults), resolveConfig(undefined))

  // Unknown keys are rejected with one actionable issue each, like the old
  // hand-written validator, so a patch typo fails loudly.
  const unknown = face.validate({ extra: 1, another: true })
  assert.ok(Array.isArray(unknown.issues))
  assert.equal(unknown.issues.length, 2)
  assert.match(unknown.issues[0].message, /unknown config key "extra"/)
  assert.deepEqual(unknown.issues[0].path, ['extra'])

  // Schemastery bounds/enum failures surface as issues with the field path.
  const bad = face.validate({ maxBlocks: 0 })
  assert.ok(Array.isArray(bad.issues))
  assert.match(bad.issues[0].message, /maxBlocks/)
  assert.deepEqual(bad.issues[0].path, ['maxBlocks'])

  // The validated value feeds apply() and is clamped again defensively.
  const fake = createFakeCtx()
  apply(fake.ctx, { blocks: ['text'], maxBlocks: 3 })
  assert.deepEqual(fake.tools.get(TOOL_NAME).parameters.properties.blocks.items.properties.type.enum, ['text'])
  assert.equal(fake.tools.get(BLOCKS_TOOL_NAME).parameters.required.length, 0)
  // ... and through the standard face, which is the real runtime path.
  const validatedFake = createFakeCtx()
  apply(validatedFake.ctx, face.validate({ blocks: ['text'], maxBlocks: 3 }).value)
  assert.deepEqual(validatedFake.tools.get(TOOL_NAME).parameters.properties.blocks.items.properties.type.enum, ['text'])
})

test('the Host provides a read-only superCards service for the plugin lifetime', async () => {
  const fake = createFakeCtx()
  apply(fake.ctx)
  assert.ok(fake.provided.has('superCards'), 'apply() must provide the service')
  const service = fake.provided.get('superCards')
  assert.equal(service.version, 1)
  assert.deepEqual(service.blocks.list(), BLOCK_TYPES)
  assert.deepEqual(service.blocks.dock(), DOCK_BLOCKS)
  assert.equal(service.blocks.has('table'), true)
  assert.equal(service.blocks.has('hologram'), false)
  assert.deepEqual(service.blocks.get('table'), { type: 'table', purpose: 'data table', dock: false })
  assert.match(service.blocks.contract('table'), /`table` \{columns/)
  assert.match(service.blocks.contract(['text', 'table']), /`text` [^]*`table`/)
  assert.match(service.blocks.contract(), /`controls`/)
  assert.deepEqual(service.placements.list(), ['answer', 'process', 'dock', 'tail'])
  assert.equal(service.placements.has('dock'), true)
  assert.equal(service.placements.has('tail'), true)
  assert.equal(service.placements.has('sidebar'), false)
})

test('the lookup tool accepts one type or a list of types', async () => {
  const { tools } = setup()
  const tool = tools.get(BLOCKS_TOOL_NAME)
  const one = await tool.execute({ type: 'progress' })
  assert.deepEqual(one.types, ['progress'])
  assert.match(one.text, /`progress` \{items/)

  const many = await tool.execute({ type: ['table', 'stats', 'table'] })
  assert.deepEqual(many.types, ['stats', 'table'], 'documentation order, no duplicates')
  assert.match(many.text, /`stats` [^]*`table`/)

  await assert.rejects(
    () => tool.execute({ type: ['table', 'hologram'] }),
    (error) => {
      assert.ok(error.message.startsWith(BLOCKS_TOOL_NAME + ': '))
      assert.match(error.message, /unknown block type hologram/)
      assert.match(error.message, /Available types/)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Motion: the model names a preset, the Client owns the CSS
// ---------------------------------------------------------------------------

test('motion: a preset survives normalization, is clamped, and never costs the block', () => {
  assert.deepEqual(normalizeMotion({ effect: 'sweep', duration: 1200, delay: 200, loop: true }), {
    effect: 'sweep',
    duration: 1200,
    delay: 200,
    loop: true,
  })
  assert.deepEqual(
    normalizeMotion({ effect: 'pulse' }),
    { effect: 'pulse', duration: MOTION_DEFAULTS.duration, delay: 0, loop: false },
    'only the effect is required',
  )
  assert.equal(normalizeMotion({ effect: 'draw', duration: 99999 }).duration, MOTION_LIMITS.duration[1])
  assert.equal(normalizeMotion({ effect: 'draw', duration: 1 }).duration, MOTION_LIMITS.duration[0])
  assert.equal(normalizeMotion({ effect: 'draw', delay: -5 }).delay, 0)
  assert.equal(normalizeMotion({ effect: 'draw', duration: 10_000_000 }).delay, 0)
  assert.equal(normalizeMotion({ effect: 'draw', duration: 'x' }).duration, MOTION_DEFAULTS.duration)
  assert.equal(normalizeMotion({ effect: 'draw', loop: 'yes' }).loop, false, 'loop is boolean-only')
  assert.equal(normalizeMotion({ effect: 'openssl' }), undefined)
  assert.equal(normalizeMotion('pulse'), undefined)
  assert.equal(normalizeMotion(undefined), undefined)

  const spec = normalizeSpec({
    blocks: [{ type: 'progress', items: [{ label: '构建', value: 0.5 }], motion: { effect: 'sweep' } }],
  })
  assert.equal(spec.blocks[0].motion.effect, 'sweep', 'the preset rides along with the recorded block')

  const typo = normalizeSpec({ blocks: [{ type: 'text', text: 'ok', motion: { effect: 'sparkle' } }] })
  assert.equal(typo.blocks[0].type, 'text', 'a bad effect never drops the content')
  assert.equal(typo.blocks[0].motion, undefined)
})

test('motion: the vocabulary is documented on demand and discoverable in the tool schema', async () => {
  const fake = createFakeCtx()
  apply(fake.ctx)
  const lookup = fake.tools.get(BLOCKS_TOOL_NAME)
  const renderer = fake.tools.get(TOOL_NAME)

  const motion = await lookup.execute({ type: MOTION_LOOKUP })
  assert.deepEqual(motion.types, [MOTION_LOOKUP])
  assert.equal(motion.text, motionContractText())
  for (const effect of MOTION_EFFECTS) {
    assert.ok(motion.text.includes('`' + effect + '`'), 'the contract must document ' + effect)
  }
  assert.match(motion.text, /never write CSS/i)
  assert.match(motion.text, /example:/)

  // A mixed request keeps blocks in documentation order and appends motion.
  const mixed = await lookup.execute({ type: ['motion', 'table'] })
  assert.deepEqual(mixed.types, ['table', MOTION_LOOKUP])

  // The full catalog points at the vocabulary instead of inlining it.
  const catalog = await lookup.execute({})
  assert.match(catalog.text, /optional `motion` object/)

  // The model never needs a lookup to see the effect names.
  const item = renderer.parameters.properties.blocks.items.properties.motion
  assert.deepEqual(item.properties.effect.enum, MOTION_EFFECTS)
  assert.deepEqual(item.required, ['effect'])
  assert.equal(item.additionalProperties, false)
  assert.match(renderer.description, /`motion`/)
  assert.match(__test.PROMPT_SECTION_TEXT, /motion/)
})

test('motion: the read-only service exposes the same vocabulary', () => {
  const service = createHostService()
  assert.deepEqual(service.motion.list(), MOTION_EFFECTS)
  assert.equal(service.motion.has('sweep'), true)
  assert.equal(service.motion.has('sparkle'), false)
  assert.deepEqual(service.motion.get('flow').effect, 'flow')
  assert.equal(typeof service.motion.get('flow').meaning, 'string')
  assert.equal(service.motion.get('sparkle'), undefined)
  assert.match(service.motion.contract(), /never write CSS/i)
})

test('host modules are self-contained: only relative imports, no console, timers, or network', () => {
  const files = [
    '../index.js',
    '../lib/shared.js',
    '../lib/blocks.js',
    '../lib/spec.js',
    '../lib/tools.js',
    '../lib/config.js',
    '../lib/service.js',
    '../lib/next-steps.js',
  ]
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    // Modular architecture: relative imports are expected. The one external
    // dependency is the framework schema library that declares the row config
    // (the settings projection only understands Schemastery); everything else
    // stays behind `ctx` and `lib/`.
    for (const match of source.matchAll(/^\s*import\s[^\n]*from\s+'([^']+)'/gm)) {
      const allowed = match[1].startsWith('./')
        || (file === '../lib/config.js' && match[1] === '@deepseek-ai/schemastery')
      assert.ok(allowed, `${file} may only import relative modules, got ${match[1]}`)
    }
    // One deliberate exception to self-containment: the next-step generator
    // resolves the Host's `appendPluginRecord` lazily, through a guarded
    // dynamic import, so a Host without that export loses one optional card
    // instead of the whole plugin. Nothing else may reach outside the package.
    for (const match of source.matchAll(/import\('([^']+)'\)/g)) {
      assert.equal(match[1], '@deepseek-ai/dsh-session', `${file} may only dynamically import the Host session package`)
      assert.equal(file, '../lib/next-steps.js', 'only the next-step generator resolves a Host module')
    }
    assert.equal(/\bconsole\./.test(source), false, `${file} must not write to the console`)
    // Every module is timer-free except the next-step generator, whose single
    // one-shot timeout bounds the auxiliary request; it must be cleared on
    // completion, supersession, and disposal (covered below), and it must never
    // become a repeating interval.
    assert.equal(/\bsetInterval\s*\(/.test(source), false, `${file} must not use repeating timers`)
    if (file !== '../lib/next-steps.js') {
      assert.equal(/\bsetTimeout\s*\(/.test(source), false, `${file} must not use timers`)
    }
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|\bWebSocket\b/.test(source), false, `${file} must not use the network`)
  }
})
test('container blocks stay bounded: tree, heatmap, diff, kanban, and tabs caps', () => {
  // tree: the depth cap flattens the tail, the node cap bounds the total.
  const deep = { label: 'L0', children: [{ label: 'L1', children: [{ label: 'L2', children: [{ label: 'L3', children: [{ label: 'L4' }] }] }] }] }
  const tree = normalizeSpec({ blocks: [{ type: 'tree', nodes: [deep] }] }).blocks[0]
  let edges = 0
  let cursor = tree.nodes[0]
  while (cursor && cursor.children) {
    edges += 1
    cursor = cursor.children[0]
  }
  assert.equal(edges, CAPS.treeDepth, 'the hierarchy stops at the depth cap')
  const wide = Array.from({ length: 300 }, (_, index) => ({ label: 'n' + index }))
  assert.equal(normalizeSpec({ blocks: [{ type: 'tree', nodes: wide }] }).blocks[0].nodes.length, CAPS.treeNodes)

  // heatmap: row width and cell count are clamped.
  const heat = normalizeSpec({
    blocks: [{ type: 'heatmap', columns: 99, items: Array.from({ length: 400 }, (_, index) => ({ value: index })) }],
  }).blocks[0]
  assert.equal(heat.items.length, CAPS.heatmapCells)
  assert.equal(heat.columns, 53)

  // diff: line count and dimensions stay bounded.
  const diff = normalizeSpec({
    blocks: [{ type: 'diff', lines: Array.from({ length: 500 }, () => ({ kind: 'ctx', text: 'x'.repeat(5000) })) }],
  }).blocks[0]
  assert.equal(diff.lines.length, CAPS.diffLines)
  assert.equal(diff.lines[0].text.length, CAPS.textChars)

  // kanban: columns and cards per column are capped.
  const kanban = normalizeSpec({
    blocks: [{
      type: 'kanban',
      columns: Array.from({ length: 6 }, () => ({ title: 't', cards: Array.from({ length: 12 }, () => ({ title: 'c' })) })),
    }],
  }).blocks[0]
  assert.equal(kanban.columns.length, CAPS.kanbanColumns)
  assert.equal(kanban.columns[0].cards.length, CAPS.kanbanCards)

  // tabs: tab count and blocks per tab are capped; a nested tab is refused.
  const tabs = normalizeSpec({
    blocks: [{
      type: 'tabs',
      items: Array.from({ length: 8 }, (_, index) => ({
        label: 't' + index,
        blocks: Array.from({ length: 9 }, (_, inner) => ({ type: 'text', text: 'b' + inner })),
      })),
    }],
  }).blocks[0]
  assert.equal(tabs.items.length, CAPS.tabs)
  assert.equal(tabs.items[0].blocks.length, CAPS.tabBlocks)

  // A tab whose only pane holds a tab loses all content, so the card is rejected.
  assert.throws(
    () => normalizeSpec({
      blocks: [{
        type: 'tabs',
        items: [{ label: 'a', blocks: [{ type: 'tabs', items: [{ label: 'b', blocks: [{ type: 'text', text: 'x' }] }] }] }],
      }],
    }),
    /no renderable blocks/,
  )
})

// ---------------------------------------------------------------------------
// Content mode: the card picks the controls and the arrangement
// ---------------------------------------------------------------------------

/** One content spec that exercises every field the auto-layout engine knows. */
const CONTENT_SAMPLE = {
  summary: 'All 3 services are healthy.',
  metrics: [
    { label: 'Pods ready', value: '12/12', tone: 'success' },
    { label: 'P95 latency', value: '212 ms', delta: '-8%' },
    { label: 'Errors', value: 0 },
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

test('content mode derives the blocks, opens with the summary, and closes with the actions', async () => {
  const { tool } = setup()
  const result = await tool.execute({ title: 'Deploy', content: CONTENT_SAMPLE })
  assert.deepEqual(result, {
    ok: true,
    blocks: 14,
    types: ['callout', 'stats', 'sparkline', 'pie', 'table', 'timeline', 'keyvalue', 'list', 'badges', 'code', 'quote', 'links', 'callout', 'actions'],
    place: 'answer',
    auto: true,
  })
})

test('content selects the control that fits each field', async () => {
  const { tool } = setup()
  const typesOf = async (content, extra) => (await tool.execute({ content, ...(extra || {}) })).types

  // A labeled comparison of four points reads better as columns than as a trend.
  assert.deepEqual(await typesOf({ series: { values: [3, 1, 4, 2], labels: ['a', 'b', 'c', 'd'] } }), ['bars'])
  // `kind` decides when the shape is ambiguous.
  assert.deepEqual(await typesOf({ series: { values: [3, 1, 4, 2], labels: ['a', 'b', 'c', 'd'], kind: 'trend' } }), ['sparkline'])
  assert.deepEqual(await typesOf({ series: { values: [3, 1, 4, 2], kind: 'compare' } }), ['bars'])
  // Shares: a donut up to the slice cap, bars beyond it.
  const share = Array.from({ length: CAPS.pieSlices + 1 }, (_, index) => ({ label: 's' + index, value: index + 1 }))
  assert.deepEqual(await typesOf({ breakdown: { items: share } }), ['bars'])
  assert.deepEqual(await typesOf({ breakdown: { items: share.slice(0, CAPS.pieSlices) } }), ['pie'])
  // Map forms are accepted wherever a labeled list is.
  assert.deepEqual(await typesOf({ metrics: { pods: '12/12', errors: 0 } }), ['stats'])
  assert.deepEqual(await typesOf({ facts: { region: 'eu-west-1' } }), ['keyvalue'])
  // Arrays of strings are enough for the simple blocks.
  assert.deepEqual(await typesOf({ steps: ['build', 'deploy'] }), ['timeline'])
  assert.deepEqual(await typesOf({ items: ['a', 'b'] }), ['list'])
  assert.deepEqual(await typesOf({ tags: ['stable'] }), ['badges'])
  assert.deepEqual(await typesOf({ note: 'watch out' }), ['callout'])
  assert.deepEqual(await typesOf({ flow: { nodes: [{ id: 'a', label: 'A' }], edges: [] } }), ['diagram'])
})

test('content layout: ordinary blocks stack, only sections split, explicit blocks append', async () => {
  const { tool } = setup()
  const short = { items: ['a'], tags: ['x'] }
  // Auto layout no longer pairs unrelated blocks: they read as separate panels.
  assert.deepEqual((await tool.execute({ content: short })).types, ['list', 'badges'])
  assert.deepEqual((await tool.execute({ content: short, layout: 'stack' })).types, ['list', 'badges'])
  assert.deepEqual(
    (await tool.execute({ content: { items: ['a'] }, blocks: [{ type: 'divider' }] })).types,
    ['list', 'divider'],
    'derived blocks come first, explicit blocks after',
  )
  // An explicit columns block in `blocks` is still the hand-made way to split a row.
  const split = await tool.execute({
    content: { items: ['a'] },
    blocks: [{ type: 'columns', weights: [3, 1], items: [{ blocks: [{ type: 'text', text: 'x' }] }, { blocks: [{ type: 'text', text: 'y' }] }] }],
  })
  assert.deepEqual(split.types, ['list', 'columns'])
})

test('content sections lay out side by side, then as tabs, then stacked under headings', async () => {
  const { tool } = setup()
  const section = (index) => ({ heading: 'S' + index, items: ['row ' + index] })
  const two = await tool.execute({ content: { sections: [section(1), section(2)] } })
  assert.deepEqual(two.types, ['columns'])
  const five = await tool.execute({ content: { sections: Array.from({ length: 5 }, (_, index) => section(index)) } })
  assert.deepEqual(five.types, ['tabs'])
  const six = await tool.execute({ content: { sections: Array.from({ length: 6 }, (_, index) => section(index)) } })
  assert.deepEqual(six.types, ['heading', 'list', 'heading', 'list', 'heading', 'list', 'heading', 'list', 'heading', 'list', 'heading', 'list'])
  // A section may carry explicit blocks as well: the auto engine keeps them.
  const mixed = await tool.execute({ content: { sections: [{ heading: 'A', blocks: [{ type: 'quote', text: 'q' }] }] } })
  assert.deepEqual(mixed.types, ['heading', 'quote'])
})

test('content ignores unknown fields and reports nothing renderable', async () => {
  const { tool } = setup()
  await assert.rejects(
    () => tool.execute({ content: { nothing: true } }),
    (error) => {
      assert.match(error.message, /"content" has no usable fields/)
      assert.match(error.message, /summary/)
      return true
    },
  )
  await assert.rejects(
    () => tool.execute({}),
    (error) => {
      assert.match(error.message, /"blocks" array .*"content" object|"content" object/)
      return true
    },
  )
})

test('content obeys the block cap and reports what it dropped', async () => {
  const fake = createFakeCtx()
  apply(fake.ctx, { maxBlocks: 2 })
  const tool = fake.tools.get(TOOL_NAME)
  const result = await tool.execute({ content: { summary: 's', table: { columns: ['a'], rows: [['1']] }, code: { code: 'x' } } })
  assert.equal(result.blocks, 2)
  assert.equal(result.dropped.length, 1)
  assert.equal(result.dropped[0].reason, 'over the block cap')
})

test('the content contract is served on demand by the lookup tool', async () => {
  const { tools } = setup()
  const lookup = tools.get(BLOCKS_TOOL_NAME)
  assert.match(lookup.description, /content/)
  const contract = await lookup.execute({ type: 'content' })
  assert.deepEqual(contract.types, ['content'])
  for (const field of __test.CONTENT_FIELDS) {
    assert.ok(contract.text.includes('`' + field + '`'), 'contract must document ' + field)
  }
  assert.match(contract.text, /auto layout/)
  assert.match(contract.text, /example: \{"title":"Deploy summary","content"/)
  assert.match(contract.text, /`layout`/)
  // The keyword keeps working next to block types and the motion vocabulary.
  const mixed = await lookup.execute({ type: ['table', 'content'] })
  assert.deepEqual(mixed.types, ['table', 'content'])
})

test('columns: normalizes nested blocks, caps the grid, and refuses a second level', () => {
  const raw = {
    type: 'columns',
    title: 'Services',
    items: Array.from({ length: 6 }, (_, index) => ({
      label: 'C' + index,
      blocks: Array.from({ length: 10 }, () => ({ type: 'text', text: 'x' })),
    })),
  }
  const block = normalizeSpec({ blocks: [raw] }).blocks[0]
  assert.equal(block.type, 'columns')
  assert.equal(block.items.length, CAPS.columns)
  assert.equal(block.items[0].blocks.length, CAPS.columnBlocks)
  assert.equal(block.items[0].label, 'C0')

  const nested = normalizeSpec({
    blocks: [{
      type: 'columns',
      items: [
        { blocks: [{ type: 'columns', items: [{ blocks: [{ type: 'text', text: 'x' }] }] }] },
        { blocks: [{ type: 'text', text: 'kept' }] },
      ],
    }],
  }).blocks[0]
  assert.equal(nested.items.length, 1, 'a nested grid is dropped, the readable column stays')
  assert.equal(nested.items[0].blocks[0].text, 'kept')

  // A column is a layout, not a glance: a dock board never carries one.
  assert.equal(DOCK_BLOCKS.includes('columns'), false)
  assert.equal(BLOCK_TYPES.indexOf('columns') > BLOCK_TYPES.indexOf('tabs'), true)
})

// ---------------------------------------------------------------------------
// Inline images: one block, one deliberate exception to "the card never loads"
// ---------------------------------------------------------------------------

test('image: accepts http(s) and inline data URIs, refuses every other scheme', () => {
  const one = (src, extra) => {
    try {
      return normalizeSpec({ blocks: [{ type: 'image', src, ...(extra || {}) }] }).blocks[0]
    } catch {
      return undefined
    }
  }
  assert.equal(one('https://example.com/a.png').type, 'image')
  assert.equal(one('http://127.0.0.1:50623/a.jpg').src, 'http://127.0.0.1:50623/a.jpg')
  const inline = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(one(inline).src, inline)
  assert.equal(one('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').type, 'image')
  assert.equal(one('data:image/svg+xml,%3Csvg%3E%3C/svg%3E').type, 'image')

  for (const bad of [
    'javascript:alert(1)',
    'file:///tmp/a.png',
    'blob:http://127.0.0.1/abc',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,',
    '  ',
    'https://example.com/a b.png',
  ]) {
    assert.equal(one(bad), undefined, bad + ' must be dropped')
  }
  // The source cap is enforced, not truncated: an oversized data URI is unusable.
  const huge = 'data:image/png;base64,' + 'A'.repeat(CAPS.imageChars)
  assert.equal(one(huge), undefined)
})

test('image: normalizes the frame and falls back to the caption for alt text', () => {
  const block = normalizeSpec({
    blocks: [{ type: 'image', src: 'https://example.com/a.png', caption: 'P95 over 8 days', height: 9999 }],
  }).blocks[0]
  assert.equal(block.alt, 'P95 over 8 days')
  assert.equal(block.caption, 'P95 over 8 days')
  assert.equal(block.height, 640, 'height clamps to the 80–640 frame')

  assert.equal(normalizeSpec({ blocks: [{ type: 'image', src: 'https://example.com/a.png' }] }).blocks[0].height, 240)
  assert.equal(normalizeSpec({ blocks: [{ type: 'image', src: 'https://example.com/a.png', height: 1 }] }).blocks[0].height, 80)
  assert.equal(normalizeSpec({ blocks: [{ type: 'image', src: 'https://example.com/a.png', fit: 'cover' }] }).blocks[0].fit, 'cover')
  assert.equal(normalizeSpec({ blocks: [{ type: 'image', src: 'https://example.com/a.png', fit: 'zoom' }] }).blocks[0].fit, undefined)

  // Not a dock block, and it stays out of a dock board with a reason.
  assert.equal(DOCK_BLOCKS.includes('image'), false)
})

test('image: the contract states the source rules and the network caveat', async () => {
  const { tools } = setup()
  const contract = await tools.get(BLOCKS_TOOL_NAME).execute({ type: 'image' })
  assert.deepEqual(contract.types, ['image'])
  assert.match(contract.text, /\{src, alt\?, caption\?\}/)
  assert.match(contract.text, /http\(s\) or data:image/)
  assert.match(contract.text, /shown whole, at the card width/)
  assert.match(contract.text, /no referrer/)
  assert.match(contract.text, /row config/)
})

test('image: content mode picks it from the `image` field', async () => {
  const { tool } = setup()
  const result = await tool.execute({ content: { image: { src: 'https://example.com/a.png', caption: 'chart' } } })
  assert.deepEqual(result.types, ['image'])
  assert.equal(result.auto, true)
  assert.deepEqual((await tool.execute({ content: { image: 'https://example.com/b.png' } })).types, ['image'])
  // An unusable source leaves nothing renderable.
  await assert.rejects(
    () => tool.execute({ content: { image: { src: 'javascript:alert(1)' } } }),
    (error) => {
      assert.match(error.message, /no renderable blocks|no usable fields/)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Asymmetric layout: wide blocks keep the larger share
// ---------------------------------------------------------------------------

test('content layout stacks ordinary blocks instead of pairing them', () => {
  const types = (content) => __test.deriveContent(content, { layout: 'auto' }).map((block) => block.type)
  // A chart and a list read as two panels side by side; they stay stacked now.
  assert.deepEqual(types({ series: { values: [1, 2, 3, 4, 5, 6, 7] }, items: ['a'] }), ['sparkline', 'list'])
  assert.deepEqual(types({ items: ['a'], series: { values: [1, 2, 3, 4, 5, 6, 7] } }), ['list', 'sparkline'])
  assert.deepEqual(types({ quote: { text: 'q' }, items: ['a'] }), ['quote', 'list'])
  assert.deepEqual(types({ series: { values: [1, 2, 3, 4, 5, 6, 7] }, breakdown: { items: [{ label: 'a', value: 1 }] } }), ['sparkline', 'pie'])
  // `layout: "stack"` is therefore the same for ordinary blocks...
  assert.deepEqual(__test.deriveContent({ items: ['a'], tags: ['x'] }, { layout: 'stack' }).map((block) => block.type), ['list', 'badges'])
})

test('content sections give a wide section two shares', () => {
  const table7 = { columns: ['a', 'b'], rows: Array.from({ length: 7 }, (_, index) => [String(index), 'x']) }
  const eightFacts = Object.fromEntries(Array.from({ length: 8 }, (_, index) => ['k' + index, 'v']))
  const two = __test.deriveContent({
    sections: [{ heading: 'Table', table: table7 }, { heading: 'Facts', facts: eightFacts }],
  }, { layout: 'auto' })
  assert.deepEqual(two[0].weights, [2, 1])
  assert.equal(two[0].items[0].label, 'Table')

  const flipped = __test.deriveContent({
    sections: [{ heading: 'Facts', facts: eightFacts }, { heading: 'Screenshot', image: { src: 'https://example.com/a.png', height: 200 } }],
  }, { layout: 'auto' })
  assert.deepEqual(flipped[0].weights, [1, 2], 'the wide section can sit on the right')

  // A chart scales with its frame, so a chart section does not take a wider share.
  const chartSection = __test.deriveContent({
    sections: [{ heading: 'Facts', facts: eightFacts }, { heading: 'Chart', series: { values: [1, 2, 3, 4, 5, 6, 7] } }],
  }, { layout: 'auto' })
  assert.equal(chartSection[0].weights, undefined)

  const three = __test.deriveContent({
    sections: [
      { heading: 'A', items: ['a', 'b', 'c', 'd'] },
      { heading: 'B', flow: { nodes: [{ id: 'n', label: 'N' }, { id: 'm', label: 'M' }], edges: [{ from: 'n', to: 'm' }] } },
      { heading: 'C', items: ['a', 'b', 'c', 'd'] },
    ],
  }, { layout: 'auto' })
  assert.deepEqual(three[0].weights, [1, 2, 1])

  // Two text sections keep the default equal columns.
  const equal = __test.deriveContent({
    sections: [{ heading: 'A', items: ['a'] }, { heading: 'B', items: ['b'] }],
  }, { layout: 'auto' })
  assert.equal(equal[0].weights, undefined)
  // `stack` never lays out columns at all.
  const stacked = __test.deriveContent({
    sections: [{ heading: 'A', items: ['a'] }, { heading: 'B', items: ['b'] }],
  }, { layout: 'stack' })
  assert.equal(stacked.some((block) => block.type === 'columns'), false)
})

test('content keeps sections stacked when their heights would leave a hole', () => {
  // Two facts beside a three-row table: the short column would hang in empty
  // space, so the card stacks them under their own headings instead.
  const uneven = __test.deriveContent({
    sections: [
      { heading: 'Rules', facts: { a: '1', b: '2' } },
      { heading: 'Daily', table: { columns: ['d', 'n'], rows: [['Mon', '3'], ['Tue', '5'], ['Wed', '2']] } },
    ],
  }, { layout: 'auto' })
  assert.deepEqual(uneven.map((block) => block.type), ['heading', 'keyvalue', 'heading', 'table'])

  // Comparable heights still split, and the labels stay with their section.
  const even = __test.deriveContent({
    sections: [
      { heading: 'A', items: ['a', 'b', 'c'] },
      { heading: 'B', items: ['d', 'e', 'f'] },
    ],
  }, { layout: 'auto' })
  assert.deepEqual(even.map((block) => block.type), ['columns'])
})

test('columns: weights are optional, clamped, and ignored when the count drifts', () => {
  const build = (weights) => normalizeSpec({
    blocks: [{ type: 'columns', weights, items: [{ blocks: [{ type: 'text', text: 'a' }] }, { blocks: [{ type: 'text', text: 'b' }] }] }],
  }).blocks[0]
  assert.deepEqual(build([2, 1]).weights, [2, 1])
  assert.deepEqual(build([9, 0]).weights, [3, 1], 'shares clamp to 1–3')
  assert.deepEqual(build([2.6, 1.2]).weights, [3, 1], 'shares are whole numbers')
  assert.equal(build([2, 1, 1]).weights, undefined, 'a stale weight list is ignored, the content stays')
  assert.equal(build(undefined).weights, undefined)
})

// ---------------------------------------------------------------------------
// Automatic next steps: the Host asks the model and appends the turn-tail event
// ---------------------------------------------------------------------------

/** A valid model answer: one question and two labeled options. */
const NEXT_STEPS_OUTPUT = JSON.stringify({
  summary: '部署完成，全部健康检查通过，服务已上线。',
  text: '下一步做什么？',
  options: [
    { label: '跑测试', prompt: '请运行完整测试套件' },
    { label: '看 diff', prompt: '展示这次改动的完整 diff' },
  ],
})

/** The route a session logs for its last request. */
const ROUTE_HEADER = { config: { provider: 'deepseek', model: 'deepseek-chat' } }

/** Assistant text long enough to pass the default 200-character threshold. */
const LONG_REPLY = 'The deployment finished and every health check passed, so the service is live. '.repeat(4)

/**
 * Build one assistant/message event in the shape the session log uses.
 * @param {number} seq event sequence number.
 * @param {number} turn turn number.
 * @param {string} text assistant text.
 * @param {number} [step] step number.
 * @returns {object} session event envelope.
 */
function assistantEvent(seq, turn, text, step = 0) {
  return {
    type: 'assistant/message',
    seq,
    time: seq,
    data: {
      turn,
      step,
      message: { id: 'm' + seq, role: 'assistant', content: [{ type: 'text', text }] },
    },
  }
}

/**
 * Build one render_ui tool/call event carrying a placement.
 * @param {number} seq event sequence number.
 * @param {number} turn turn number.
 * @param {string} place requested placement.
 * @returns {object} session event envelope.
 */
function toolCallEvent(seq, turn, place) {
  return {
    type: 'tool/call',
    seq,
    time: seq,
    data: { turn, step: 0, callId: 'c' + seq, name: TOOL_NAME, arguments: JSON.stringify({ place }) },
  }
}

/**
 * Build one turn/end event envelope.
 * @param {number} seq event sequence number.
 * @param {number} turn turn number.
 * @returns {object} session event envelope.
 */
function turnEnd(seq, turn) {
  return { type: 'turn/end', seq, time: seq, data: { turn, reason: { kind: 'stop' } } }
}

/**
 * Build a fake session that records appends on top of a fixed event log.
 * @param {{ events?: Array<object>, header?: object, sessionHeader?: object, id?: string }} [options] seed state.
 * @returns {object} fake session exposing the real Host surface.
 */
function createFakeSession(options = {}) {
  const log = (options.events ?? []).slice()
  const appended = []
  return {
    id: options.id ?? 'session-one',
    header: options.sessionHeader,
    log,
    appended,
    snapshotEvents() {
      return log.slice()
    },
    requestHeader() {
      return options.header
    },
    append(type, data) {
      const event = { type, seq: log.length, time: 1, data }
      log.push(event)
      appended.push(event)
      return event
    },
  }
}

/**
 * Build a fake async-iterable LLM service.
 * @param {Array<object>} chunks stream chunks to emit.
 * @param {{ wait?: Promise<unknown> }} [options] optional gate awaited before streaming.
 * @returns {{ calls: Array<object>, stream: Function }} fake llm service.
 */
function createFakeLlm(chunks, options = {}) {
  const calls = []
  return {
    calls,
    stream(generateOptions) {
      calls.push(generateOptions)
      return (async function* () {
        if (options.wait !== undefined) await options.wait
        for (const chunk of chunks) {
          if (generateOptions.signal?.aborted) return
          yield chunk
        }
      })()
    },
  }
}

/**
 * Build one externally resolvable promise.
 * @returns {{ promise: Promise<unknown>, resolve: Function }} deferred.
 */
function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * Let pending microtasks and stream iterations run.
 * @param {number} [times] setImmediate turns to wait.
 * @returns {Promise<void>} resolves after the turns.
 */
async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('next steps config: defaults, defensive clamping, and Standard Schema validation', () => {
  // Opt-in: a bare row (and any non-boolean value) keeps the generator off.
  assert.deepEqual(resolveNextStepsConfig(undefined), {
    enabled: false,
    max: 3,
    timeoutMs: 15000,
    minChars: 200,
    provider: undefined,
    model: undefined,
  })
  assert.equal(NEXT_STEPS_DEFAULTS.enabled, false)
  for (const nextSteps of [undefined, false, 'yes', 1, 0, null, {}]) {
    assert.equal(resolveNextStepsConfig({ nextSteps }).enabled, false, 'opt-in requires an explicit true: ' + JSON.stringify(nextSteps))
  }
  assert.equal(resolveNextStepsConfig({ nextSteps: true }).enabled, true)
  assert.deepEqual(resolveNextStepsConfig({
    nextSteps: true,
    nextStepsMax: 4,
    nextStepsTimeoutMs: 1000,
    nextStepsMinChars: 0,
    nextStepsProvider: 'deepseek',
    nextStepsModel: 'deepseek-chat',
  }), {
    enabled: true,
    max: 4,
    timeoutMs: 1000,
    minChars: 0,
    provider: 'deepseek',
    model: 'deepseek-chat',
  })

  // Junk falls back; numbers clamp into their accepted ranges; an unpaired
  // provider/model override is ignored so the session header route still works.
  const junk = resolveNextStepsConfig({
    nextSteps: 'yes',
    nextStepsMax: 99,
    nextStepsTimeoutMs: -1,
    nextStepsMinChars: 9999,
    nextStepsProvider: '',
    nextStepsModel: 'only-a-model',
  })
  assert.equal(junk.enabled, false, 'a non-boolean nextSteps falls back to the default (off)')
  assert.equal(junk.max, NEXT_STEPS_LIMITS.max[1])
  assert.equal(junk.timeoutMs, NEXT_STEPS_LIMITS.timeoutMs[0])
  assert.equal(junk.minChars, NEXT_STEPS_LIMITS.minChars[1])
  assert.equal(junk.provider, undefined)
  assert.equal(junk.model, undefined)
  assert.deepEqual(resolveNextStepsConfig({ nextSteps: false }), {
    enabled: false,
    max: 3,
    timeoutMs: 15000,
    minChars: 200,
    provider: undefined,
    model: undefined,
  })
  assert.deepEqual(resolveNextStepsConfig({ nextStepsProvider: 'only-provider' }), {
    enabled: false,
    max: 3,
    timeoutMs: 15000,
    minChars: 200,
    provider: undefined,
    model: undefined,
  })
  assert.equal(NEXT_STEPS_DEFAULTS.max, 3)
  assert.deepEqual([...NEXT_STEPS_LIMITS.max], [1, 4])

  // The Schemastery row config declares every knob; the runtime face projects
  // them to plain values (see the Config tests above for the full contract).
  const schema = host.Config['~standard']
  const ok = schema.validate({ nextSteps: true, nextStepsMax: 4, nextStepsTimeoutMs: 2000, nextStepsMinChars: 100 })
  assert.equal(ok.issues, undefined)
  assert.deepEqual(
    {
      nextSteps: ok.value.nextSteps,
      nextStepsMax: ok.value.nextStepsMax,
      nextStepsTimeoutMs: ok.value.nextStepsTimeoutMs,
      nextStepsMinChars: ok.value.nextStepsMinChars,
    },
    { nextSteps: true, nextStepsMax: 4, nextStepsTimeoutMs: 2000, nextStepsMinChars: 100 },
  )
  const routed = schema.validate({ nextStepsProvider: 'p', nextStepsModel: 'm' }).value
  assert.equal(routed.nextStepsProvider, 'p')
  assert.equal(routed.nextStepsModel, 'm')
  // The validated value feeds apply() and installs the listener.
  const enabledFake = createFakeCtx({ llm: createFakeLlm([]) })
  apply(enabledFake.ctx, ok.value)
  assert.equal((enabledFake.listeners.get('session/event') ?? []).length, 1)

  // Out-of-range or wrongly typed next-step values fail the schema; the route
  // pair is optional, and the runtime ignores a lone override defensively.
  for (const bad of [
    { nextSteps: 'yes' },
    { nextStepsMax: 5 },
    { nextStepsTimeoutMs: 999 },
    { nextStepsMinChars: -1 },
  ]) {
    const rejected = schema.validate(bad)
    assert.ok(Array.isArray(rejected.issues), JSON.stringify(bad) + ' must be rejected')
    assert.equal(typeof rejected.issues[0].message, 'string')
  }
  assert.equal(resolveNextStepsConfig(schema.validate({ nextStepsProvider: 'only-provider' }).value).provider, undefined)
})

test('turn facts: assistant text, model tail cards, and existing generated events', () => {
  const events = [
    assistantEvent(1, 1, 'first part'),
    { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 0, callId: 'c2', name: 'other_tool', arguments: '{}' } },
    assistantEvent(3, 1, 'second part', 1),
    assistantEvent(4, 2, 'another turn'),
    toolCallEvent(5, 2, 'answer'),
    { type: 'assistant/message', seq: 6, time: 6, data: { turn: 3, step: 0, message: { content: [{ type: 'reasoning', text: 'why' }] } } },
  ]
  assert.equal(collectTurnText(events, 1), 'first part\n\nsecond part')
  assert.equal(collectTurnText(events, 3), '')
  assert.equal(collectTurnText(undefined, 1), '')
  assert.equal(hasTailCard(events, 1), false, 'another tool does not count')
  assert.equal(hasTailCard(events, 2), false, 'place "answer" is not a tail card')

  const tail = [...events, {
    type: 'tool/call',
    seq: 7,
    time: 7,
    data: { turn: 2, step: 0, callId: 'c7', name: TOOL_NAME, arguments: JSON.stringify({ place: 'tail' }) },
  }]
  assert.equal(hasTailCard(tail, 2), true)
  // Whitespace variants and non-JSON arguments still count through the raw text check.
  const spaced = [{ type: 'tool/call', seq: 8, time: 8, data: { turn: 1, step: 0, callId: 'x', name: TOOL_NAME, arguments: '{ "place" : "tail" }' } }]
  assert.equal(hasTailCard(spaced, 1), true)
  const notJson = [{ ...spaced[0], data: { ...spaced[0].data, arguments: 'not json' } }]
  assert.equal(hasTailCard(notJson, 1), false)

  // The generated event is deduped by its required `turn`.
  const generated = [{ type: NEXT_STEPS_EVENT, seq: 9, time: 9, data: { turn: 2, text: 'q', options: [], at: 1 } }]
  assert.equal(hasNextStepsEvent(generated, 2), true)
  assert.equal(hasNextStepsEvent(generated, 1), false)
})

test('next steps are skipped for every documented reason', () => {
  const llm = { stream() {} }
  const route = { provider: 'p', model: 'm' }
  const base = { enabled: true, llm, route, text: 'x'.repeat(200), tail: false, recorded: false, minChars: 200 }
  assert.equal(nextStepsSkipReason(base), null)
  assert.match(nextStepsSkipReason({ ...base, enabled: false }), /disabled/)
  assert.match(nextStepsSkipReason({ ...base, llm: undefined }), /llm service/)
  assert.match(nextStepsSkipReason({ ...base, llm: {} }), /llm service/)
  assert.match(nextStepsSkipReason({ ...base, route: undefined }), /no model route/)
  assert.match(nextStepsSkipReason({ ...base, route: { provider: 'p' } }), /no model route/)
  assert.match(nextStepsSkipReason({ ...base, nested: true }), /delegated child/)
  assert.match(nextStepsSkipReason({ ...base, recorded: true }), /next-step card/)
  assert.match(nextStepsSkipReason({ ...base, tail: true }), /tail card/)
  assert.match(nextStepsSkipReason({ ...base, text: 'x'.repeat(199) }), /shorter/)
  // minChars is clamped, and junk input is a skip, never a crash.
  assert.equal(nextStepsSkipReason({ ...base, minChars: 0, text: '' }), null)
  assert.match(nextStepsSkipReason(undefined), /disabled/)
})

test('parseNextSteps tolerates fences and prose, clamps, dedupes, and drops junk', () => {
  const fenced = '```json\n{"text":"What next?","options":[{"label":"Run tests","prompt":"Run them"},{"label":"Stop","prompt":"Stop here"}]}\n```'
  assert.deepEqual(parseNextSteps(fenced, 4), {
    text: 'What next?',
    options: [{ label: 'Run tests', prompt: 'Run them' }, { label: 'Stop', prompt: 'Stop here' }],
  })

  const prose = 'Sure! Here are options:\n{"text":" Pick one ","options":[{"label":" A ","prompt":" do a "},{"label":"A","prompt":"dup"}]}\nHope this helps.'
  assert.deepEqual(parseNextSteps(prose, 4), { text: 'Pick one', options: [{ label: 'A', prompt: 'do a' }] })

  // Long fields clamp; unusable entries are dropped; the option cap is honored.
  const capped = parseNextSteps(JSON.stringify({
    options: [
      { label: 'L'.repeat(100), prompt: 'P'.repeat(1000) },
      { label: 'second', prompt: 'ok' },
      { label: 'third', prompt: 'ok' },
      null,
      'bare label',
      { prompt: 'no label' },
    ],
  }), 2)
  assert.equal(capped.text, '')
  assert.equal(capped.options.length, 2)
  assert.equal(capped.options[0].label.length, NEXT_STEPS_CAPS.labelChars)
  assert.equal(capped.options[0].prompt.length, NEXT_STEPS_CAPS.promptChars)

  // A bare string is a usable label with the label as its prompt, and a
  // top-level array of options is tolerated.
  assert.deepEqual(parseNextSteps('{"options":["ship it"]}', 4).options, [{ label: 'ship it', prompt: 'ship it' }])
  assert.deepEqual(parseNextSteps('[{"label":"a","prompt":"b"}]', 4).options, [{ label: 'a', prompt: 'b' }])

  // Nothing usable returns null, so the caller appends no event at all.
  for (const raw of [undefined, null, 42, '', 'no json here', '{"options":[]}', '{"text":"only a question"}', '{"options":[{}]}', '```json\nnot json\n```']) {
    assert.equal(parseNextSteps(raw, 4), null)
  }
})

test('parseNextSteps treats summary as optional, clamps it, and omits unusable values', () => {
  const options = [{ label: 'A', prompt: 'a' }]
  assert.equal(NEXT_STEPS_CAPS.summaryChars, 240)

  // With a summary: trimmed and carried next to the question and options.
  assert.deepEqual(
    parseNextSteps(JSON.stringify({ summary: '  已修复登录 bug，测试全部通过。  ', text: 'What next?', options }), 4),
    { summary: '已修复登录 bug，测试全部通过。', text: 'What next?', options },
  )

  // Without a summary (or with a blank/non-string one): the key is omitted, so
  // the event stays exactly backward compatible.
  for (const summary of [undefined, '', '   ', 42, null, [], {}]) {
    const parsed = parseNextSteps(JSON.stringify({ summary, text: 'q', options }), 4)
    assert.equal('summary' in parsed, false, 'unusable summary must be omitted: ' + JSON.stringify(summary))
    assert.deepEqual(parsed, { text: 'q', options })
  }

  // An over-long summary is truncated to the cap, not dropped.
  const long = parseNextSteps(JSON.stringify({ summary: 'S'.repeat(1000), text: 'q', options }), 4)
  assert.equal(long.summary.length, NEXT_STEPS_CAPS.summaryChars)
  assert.equal(long.summary, 'S'.repeat(NEXT_STEPS_CAPS.summaryChars))

  // A summary alone never makes an optionless answer usable.
  assert.equal(parseNextSteps(JSON.stringify({ summary: 'only a recap', text: 'q', options: [] }), 4), null)
})

test('nextStepsPrompt frames the reply and its output contract', () => {
  const prompt = nextStepsPrompt(LONG_REPLY, 2)
  assert.equal(typeof prompt.system, 'string')
  assert.match(prompt.system, /Return only one JSON object/)
  assert.match(prompt.system, /2 to 2 distinct/)
  assert.match(prompt.system, /language of the reply/)
  // The summary is part of the output contract: an optional one-to-two-sentence
  // recap placed before the question, bounded at the summary cap.
  assert.match(prompt.system, /"summary":"<one or two sentences summarizing/)
  assert.match(prompt.system, /summary is optional: one or two sentences/)
  assert.match(prompt.system, new RegExp('at most ' + NEXT_STEPS_CAPS.summaryChars + ' characters'))
  assert.match(prompt.system, /do not restate long passages/)
  assert.equal(prompt.messages.length, 1)
  const message = prompt.messages[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, NEXT_STEPS_SOURCE)
  assert.equal(typeof message.id, 'string')
  assert.ok(message.id.length > 0)
  assert.equal(message.content.length, 1)
  assert.equal(message.content[0].type, 'text')
  assert.ok(message.content[0].text.includes(LONG_REPLY))

  // A huge reply is excerpted so the auxiliary request stays bounded.
  const huge = 'x'.repeat(NEXT_STEPS_CAPS.inputChars * 3)
  const excerpted = nextStepsPrompt(huge, 3)
  assert.ok(excerpted.messages[0].content[0].text.length < huge.length)
  assert.match(excerpted.messages[0].content[0].text, /\[truncated\]/)
  // Junk max clamps to the documented range.
  assert.match(nextStepsPrompt('x', 99).system, /2 to 4 distinct/)
})

test('the route comes from the configured pair or the session request header', () => {
  const session = { requestHeader: () => ROUTE_HEADER }
  assert.deepEqual(resolveNextStepsRoute({}, session), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.deepEqual(resolveNextStepsRoute({ provider: 'cfg-p', model: 'cfg-m' }, session), { provider: 'cfg-p', model: 'cfg-m' })
  // A lone override is ignored, and an unreadable header is no route.
  assert.deepEqual(resolveNextStepsRoute({ provider: 'cfg-p' }, session), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(resolveNextStepsRoute({}, { requestHeader: () => undefined }), undefined)
  assert.equal(resolveNextStepsRoute({}, { requestHeader() { throw new Error('gone') } }), undefined)
  assert.equal(resolveNextStepsRoute({}, undefined), undefined)
})

test('nextStepsEventData carries the required contract fields', () => {
  assert.deepEqual(
    nextStepsEventData(7, { text: 'q', options: [{ label: 'A', prompt: 'a' }] }, 1234),
    { turn: 7, text: 'q', options: [{ label: 'A', prompt: 'a' }], at: 1234 },
  )
  // The summary rides along only when usable, keeping the event backward
  // compatible for Clients that do not render it.
  assert.deepEqual(
    nextStepsEventData(7, { summary: ' Shipped it. ', text: 'q', options: [{ label: 'A', prompt: 'a' }] }, 1234),
    { turn: 7, summary: 'Shipped it.', text: 'q', options: [{ label: 'A', prompt: 'a' }], at: 1234 },
  )
  for (const summary of [undefined, '', '   ', 42, null]) {
    const data = nextStepsEventData(7, { summary, text: 'q', options: [] }, 1234)
    assert.equal('summary' in data, false, 'no summary key for ' + JSON.stringify(summary))
  }
  // A direct caller cannot smuggle an oversized summary past the cap.
  const oversized = nextStepsEventData(1, { summary: 'S'.repeat(1000), text: 'q', options: [] })
  assert.equal(oversized.summary.length, NEXT_STEPS_CAPS.summaryChars)
  // Defensive: junk parsed values still produce the documented shape.
  const data = nextStepsEventData(1, {})
  assert.deepEqual(data, { turn: 1, text: '', options: [], at: data.at })
  assert.equal(typeof data.at, 'number')
})

test('install is a no-op when next steps are disabled', () => {
  const fake = createFakeCtx({ llm: createFakeLlm([]) })
  const dispose = installNextSteps(fake.ctx, { nextSteps: false })
  assert.equal(fake.listeners.size, 0, 'a disabled feature installs no listener')
  dispose()
  dispose()
})

test('a delegated child session never generates a next-step card', async () => {
  const llm = createFakeLlm([
    { type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const fake = createFakeCtx({ llm })
  apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
  // Subagent children end their own turns constantly; a card there is noise.
  for (const sessionHeader of [{ origin: 'subagent' }, { parentSession: 'parent-one' }, { delegationDepth: 2 }]) {
    const session = createFakeSession({
      events: [assistantEvent(0, 1, LONG_REPLY)],
      header: ROUTE_HEADER,
      sessionHeader,
    })
    emit(fake, 'session/event', session, turnEnd(1, 1))
    await flush()
    assert.equal(llm.calls.length, 0, 'no auxiliary request for a child session')
    assert.equal(session.appended.length, 0)
  }
  assert.equal(llm.calls.length, 0)
})

test('a completed turn appends exactly one next-step event with the wire contract', async () => {
  const llm = createFakeLlm([
    { type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const fake = createFakeCtx({ llm })
  const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
  assert.equal(fake.listeners.get('session/event').length, 1)

  emit(fake, 'session/event', session, turnEnd(1, 1))
  await flush()

  assert.equal(llm.calls.length, 1, 'one auxiliary request')
  const call = llm.calls[0]
  assert.equal(call.provider, 'deepseek')
  assert.equal(call.model, 'deepseek-chat')
  assert.equal(call.sessionId, session.id)
  assert.equal(typeof call.system, 'string')
  assert.equal(call.messages.length, 1)
  assert.equal(typeof call.maxTokens, 'number')
  assert.ok(call.signal !== undefined)
  assert.equal(session.appended.length, 1)

  const event = session.appended[0]
  assert.equal(event.type, NEXT_STEPS_EVENT)
  assert.equal(event.data.turn, 1, 'data.turn is required: it places the card')
  assert.equal(typeof event.data.at, 'number')
  assert.equal(event.data.summary, '部署完成，全部健康检查通过，服务已上线。')
  assert.equal(event.data.text, '下一步做什么？')
  assert.deepEqual(event.data.options, [
    { label: '跑测试', prompt: '请运行完整测试套件' },
    { label: '看 diff', prompt: '展示这次改动的完整 diff' },
  ])
  // JSON-serializable: the session log accepts the payload verbatim.
  assert.deepEqual(JSON.parse(JSON.stringify(event.data)), event.data)

  // A later turn/end for the same turn never appends again.
  emit(fake, 'session/event', session, turnEnd(2, 1))
  await flush()
  assert.equal(session.appended.length, 1)
  assert.equal(llm.calls.length, 1)

  // Disposing the effect unsubscribes the listener.
  fake.effects[4].dispose()
  assert.equal(fake.listeners.get('session/event').length, 0)
})

test('the generated event is written under the plugin record namespace', async () => {
  // Why this exact shape: the Host keeps a log loadable when it meets an event
  // type it does not know only if the event is `ignorable`, and
  // `appendPluginRecord` is the single writer that stamps that marker — it also
  // accepts nothing but a `plugin:`-namespaced name.
  assert.equal(NEXT_STEPS_EVENT, 'plugin:super-cards/next-steps')
  assert.equal(NEXT_STEPS_EVENT_LEGACY, 'super-cards/next-steps')
  assert.equal(isNextStepsEventType(NEXT_STEPS_EVENT), true)
  assert.equal(isNextStepsEventType(NEXT_STEPS_EVENT_LEGACY), true)
  assert.equal(isNextStepsEventType('assistant/message'), false)
  assert.equal(isNextStepsEventType(undefined), false)

  const seen = []
  const llm = createFakeLlm([
    { type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const fake = createFakeCtx({ llm })
  const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(fake.ctx, { nextSteps: true }, {
    appendPluginRecord(recorded, type, data) {
      seen.push({ sameSession: recorded === session, type })
      return recorded.append(type, data)
    },
  })
  emit(fake, 'session/event', session, turnEnd(1, 1))
  await flush()

  assert.deepEqual(seen, [{ sameSession: true, type: 'plugin:super-cards/next-steps' }])
  assert.equal(session.appended.length, 1)
  assert.equal(session.appended[0].type, NEXT_STEPS_EVENT)
  assert.equal(session.appended[0].data.turn, 1)
})

test('a host without the record writer appends nothing and spends no model call', async () => {
  const chunks = [
    { type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  // `null` pins "this Host exposes no appendPluginRecord": the generator must
  // stay silent rather than fall back to `session.append`, whose event the Host
  // would refuse to load.
  const quietLlm = createFakeLlm(chunks)
  const noWriter = createFakeCtx({ llm: quietLlm })
  const quietSession = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(noWriter.ctx, { nextSteps: true }, { appendPluginRecord: null })
  emit(noWriter, 'session/event', quietSession, turnEnd(1, 1))
  await flush()
  assert.equal(quietSession.appended.length, 0, 'nothing is written without a safe writer')
  assert.equal(quietLlm.calls.length, 0, 'the turn spends no model call either')
  assert.equal(noWriter.listeners.get('session/event').length, 1, 'the listener stays installed')

  // A writer that throws is contained like any other append failure.
  const throwing = createFakeCtx({ llm: createFakeLlm(chunks) })
  const busySession = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(throwing.ctx, { nextSteps: true }, {
    appendPluginRecord() {
      throw new Error('read-only')
    },
  })
  emit(throwing, 'session/event', busySession, turnEnd(1, 1))
  await flush()
  assert.equal(busySession.appended.length, 0)
  assert.equal(throwing.listeners.get('session/event').length, 1)
})

test('the duplicate check matches both recorded spellings', () => {
  const data = { turn: 2, text: 'q', options: [{ label: 'a', prompt: 'b' }], at: 1 }
  assert.equal(hasNextStepsEvent([{ type: NEXT_STEPS_EVENT, data }], 2), true)
  assert.equal(hasNextStepsEvent([{ type: NEXT_STEPS_EVENT_LEGACY, data }], 2), true, 'legacy logs still suppress a second write')
  assert.equal(hasNextStepsEvent([{ type: NEXT_STEPS_EVENT_LEGACY, data }], 3), false)
  assert.equal(hasNextStepsEvent([], 2), false)
})

test('nothing is appended when a skip condition holds', async () => {
  const chunks = [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'stop' } }]
  const scenarios = [
    { name: 'no llm service', noLlm: true, events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER },
    { name: 'a short reply', events: [assistantEvent(0, 1, 'too short')], header: ROUTE_HEADER },
    { name: 'a model tail card', events: [assistantEvent(0, 1, LONG_REPLY), toolCallEvent(1, 1, 'tail')], header: ROUTE_HEADER },
    {
      name: 'an existing generated event',
      events: [
        assistantEvent(0, 1, LONG_REPLY),
        { type: NEXT_STEPS_EVENT, seq: 2, time: 2, data: { turn: 1, text: 'q', options: [{ label: 'a', prompt: 'b' }], at: 1 } },
      ],
      header: ROUTE_HEADER,
    },
    { name: 'no route', events: [assistantEvent(0, 1, LONG_REPLY)], header: undefined },
  ]
  for (const scenario of scenarios) {
    const llm = createFakeLlm(chunks)
    const fake = createFakeCtx(scenario.noLlm === true ? {} : { llm })
    const session = createFakeSession({ events: scenario.events, header: scenario.header })
    apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
    emit(fake, 'session/event', session, turnEnd(9, 1))
    await flush()
    assert.equal(session.appended.length, 0, scenario.name + ' must append nothing')
    assert.equal(llm.calls.length, 0, scenario.name + ' must not call the model')
  }
})

test('unusable model output appends nothing and never rejects', async () => {
  const outputs = [
    [{ type: 'text-delta', index: 0, text: 'no json in this answer' }, { type: 'finish', reason: { kind: 'stop' } }],
    [{ type: 'text-delta', index: 0, text: '{"options":[]}' }, { type: 'finish', reason: { kind: 'stop' } }],
    [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'error' } }],
    [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'max-tokens' } }],
  ]
  for (const chunks of outputs) {
    const llm = createFakeLlm(chunks)
    const fake = createFakeCtx({ llm })
    const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
    apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
    emit(fake, 'session/event', session, turnEnd(1, 1))
    await flush()
    assert.equal(session.appended.length, 0)
  }

  // A provider that throws synchronously is contained too.
  const throwing = { stream() { throw new Error('provider down') } }
  const fake = createFakeCtx({ llm: throwing })
  const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
  emit(fake, 'session/event', session, turnEnd(1, 1))
  await flush()
  assert.equal(session.appended.length, 0)
})

test('one generation per session and turn/start aborts the in-flight request', async () => {
  const gate = deferred()
  const llm = createFakeLlm(
    [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'stop' } }],
    { wait: gate.promise },
  )
  const fake = createFakeCtx({ llm })
  const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(fake.ctx, { nextSteps: true }, RECORD_ENV)

  emit(fake, 'session/event', session, turnEnd(1, 1))
  await flush()
  assert.equal(llm.calls.length, 1)
  // A second turn finishing while the first is still waiting never starts work.
  emit(fake, 'session/event', session, turnEnd(2, 2))
  await flush()
  assert.equal(llm.calls.length, 1, 'one in-flight generation per session')

  // A new turn supersedes the pending request.
  const signal = llm.calls[0].signal
  assert.equal(signal.aborted, false)
  emit(fake, 'session/event', session, { type: 'turn/start', seq: 3, time: 3, data: { turn: 2 } })
  assert.equal(signal.aborted, true, 'turn/start aborts the previous turn request')
  gate.resolve()
  await flush()
  assert.equal(session.appended.length, 0, 'an aborted request appends nothing')
})

test('the request times out, and disposal aborts work and clears the timer', async () => {
  const timers = []
  const cleared = []
  const env = {
    setTimeout(callback, ms) {
      const timer = { callback, ms, unref() {} }
      timers.push(timer)
      return timer
    },
    clearTimeout(timer) {
      cleared.push(timer)
    },
  }
  const gate = deferred()
  const llm = createFakeLlm(
    [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'stop' } }],
    { wait: gate.promise },
  )
  const fake = createFakeCtx({ llm })
  const session = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  apply(fake.ctx, { nextSteps: true, nextStepsTimeoutMs: 2000 }, RECORD_ENV)
  // The row config is only a seam for the runtime timers; install() takes the
  // overrides directly so the test never waits two real seconds.
  fake.effects[4].dispose()
  const dispose = installNextSteps(fake.ctx, { nextSteps: true, nextStepsTimeoutMs: 2000 }, { ...env, appendPluginRecord: fakeRecordWriter })

  emit(fake, 'session/event', session, turnEnd(1, 1))
  await flush()
  assert.equal(timers.length, 1)
  assert.equal(timers[0].ms, 2000)
  assert.equal(llm.calls.length, 1)
  const signal = llm.calls[0].signal
  timers[0].callback()
  assert.equal(signal.aborted, true, 'the timeout aborts the request')
  gate.resolve()
  await flush()
  assert.equal(session.appended.length, 0)
  assert.ok(cleared.includes(timers[0]), 'the timeout is cleared after the attempt')
  dispose()

  // Disposal aborts in-flight work, clears its timer, and unsubscribes.
  const secondGate = deferred()
  const secondLlm = createFakeLlm(
    [{ type: 'text-delta', index: 0, text: NEXT_STEPS_OUTPUT }, { type: 'finish', reason: { kind: 'stop' } }],
    { wait: secondGate.promise },
  )
  const secondFake = createFakeCtx({ llm: secondLlm })
  const secondSession = createFakeSession({ events: [assistantEvent(0, 1, LONG_REPLY)], header: ROUTE_HEADER })
  const secondDispose = installNextSteps(secondFake.ctx, { nextSteps: true }, { ...env, appendPluginRecord: fakeRecordWriter })
  emit(secondFake, 'session/event', secondSession, turnEnd(1, 1))
  await flush()
  const secondSignal = secondLlm.calls[0].signal
  secondDispose()
  assert.equal(secondSignal.aborted, true, 'disposal aborts in-flight work')
  assert.equal((secondFake.listeners.get('session/event') ?? []).length, 0, 'disposal unsubscribes')
  secondGate.resolve()
  await flush()
  assert.equal(secondSession.appended.length, 0)
  secondDispose()
})

test('the session event handler never throws on hostile input', async () => {
  const fake = createFakeCtx({ llm: createFakeLlm([]) })
  apply(fake.ctx, { nextSteps: true }, RECORD_ENV)
  const hostile = [
    [undefined, undefined],
    [{}, null],
    [{}, { type: 'turn/end' }],
    [{ id: 's', snapshotEvents() { throw new Error('boom') }, append() {} }, { type: 'turn/end', data: { turn: 1 } }],
    [{ id: 's' }, { type: 'turn/start', data: {} }],
    [{ id: 's', snapshotEvents: () => [], append() { throw new Error('read-only') } }, { type: 'session/event', data: {} }],
  ]
  for (const [session, event] of hostile) {
    assert.doesNotThrow(() => emit(fake, 'session/event', session, event))
  }
  await flush()
})
