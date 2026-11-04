/**
 * Generate the README screenshots from the real Client renderer.
 *
 * The cards in these images are not hand-drawn mock-ups: this script loads
 * `client.js` exactly the way the Web client does (stub module loader, stub
 * React), renders a recorded `render_ui` call to DOM nodes with the plugin's own
 * dictionaries, wraps the result in a transcript frame, and screenshots it in
 * headless Chrome. Regenerate with:
 *
 *   node scripts/make-docs-assets.mjs            # writes docs/assets/{zh,en}/*.png
 *   node scripts/make-docs-assets.mjs --html     # keep the intermediate HTML
 *
 * Chrome is required (`/Applications/Google Chrome.app`); this script is a dev
 * tool and is not published with the package.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = join(ROOT, 'docs', 'assets')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const KEEP_HTML = process.argv.includes('--html')

// --- load the Client half --------------------------------------------------

const reactStub = {
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) } },
  memo: (component) => component,
  useCallback: (c) => c,
  useEffect: () => {},
  useMemo: (factory) => factory(),
  useRef: (value) => ({ current: value }),
  useState: (initial) => [initial, () => {}],
  Component: class Component {},
}
let captured = null
globalThis.window = { __ModuleLoader__: { load(entry) { captured = entry } } }
const source = readFileSync(join(ROOT, 'client.js'), 'utf8')
new Function('window', 'document', 'require', source)(globalThis.window, undefined, () => reactStub)
const client = captured.factory(() => reactStub)
const { card, css, dictionaries } = client.__test

// --- tiny element -> HTML renderer ----------------------------------------

const VOID = new Set(['rect', 'path', 'circle', 'line', 'img', 'hr', 'br', 'input', 'use', 'stop', 'ellipse', 'polygon', 'polyline'])
const SVG_ATTRS = new Set([
  'viewBox', 'preserveAspectRatio', 'pathLength', 'markerWidth', 'markerHeight', 'markerUnits',
  'refX', 'refY', 'orient', 'textLength', 'lengthAdjust', 'startOffset', 'gradientUnits',
  'patternUnits', 'clipPathUnits',
])

function kebab(key) {
  if (SVG_ATTRS.has(key)) return key
  if (key === 'className') return 'class'
  if (key === 'htmlFor') return 'for'
  if (key.startsWith('--') || key.startsWith('data-') || key.startsWith('aria-')) return key
  return key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())
}

function styleText(style) {
  if (!style || typeof style !== 'object') return ''
  return Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => (key.startsWith('--') ? key : key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())) + ':' + String(value))
    .join(';')
}

function attrs(props) {
  const out = []
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'children' || key === 'key' || value === undefined || value === null || value === false) continue
    if (key === 'style') {
      const text = styleText(value)
      if (text) out.push('style="' + text + '"')
      continue
    }
    if (value === true) {
      out.push(key)
      continue
    }
    out.push(kebab(key) + '="' + String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') + '"')
  }
  return out.length ? ' ' + out.join(' ') : ''
}

function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node !== 'object') return ''
  let element = node
  let guard = 0
  while (element && typeof element.type === 'function') {
    guard += 1
    if (guard > 40) throw new Error('component loop')
    element = element.type(element.props)
  }
  if (!element || typeof element !== 'object') return ''
  const tag = element.type
  if (VOID.has(tag)) return '<' + tag + attrs(element.props) + '/>'
  return '<' + tag + attrs(element.props) + '>' + render(element.children) + '</' + tag + '>'
}

// --- translator ------------------------------------------------------------

function translator(language) {
  const dict = dictionaries[language] ?? dictionaries.en
  return (key, vars) => {
    let text = typeof dict[key] === 'string' ? dict[key] : key
    for (const [name, value] of Object.entries(vars ?? {})) text = text.split('{' + name + '}').join(String(value))
    return text
  }
}

// --- theme tokens (light, matching the app's default) ---------------------

const TOKENS = `
:root{
  --dsw-alias-bg-base:#fff; --dsw-alias-bg-layer-1:#fff; --dsw-alias-bg-layer-2:#f7f8fa;
  --dsw-alias-bg-overlay:#e9ecf2;
  --dsw-alias-border-l1:rgba(0,0,0,0.05); --dsw-alias-border-l2:rgba(0,0,0,0.10);
  --dsw-alias-brand-primary:#0f1115; --dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#61666b; --dsw-alias-label-tertiary:#9aa0a6;
  --dsw-alias-state-success-primary:#22c55e; --dsw-alias-state-warn-primary:#f59e0b;
  --dsw-alias-state-error-primary:#ec1313; --dsw-alias-state-idle-primary:#d4d4d4;
}
html,body{margin:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif;padding:22px 26px 30px;font-size:14px;line-height:1.6}
.column{width:720px;margin:0 auto}
.ask{display:flex;justify-content:flex-end;margin:0 0 14px}
.ask span{display:inline-block;max-width:80%;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:8px 12px;color:var(--dsw-alias-label-primary)}
.say{color:var(--dsw-alias-label-primary);margin:0 0 14px}
.caption{font:500 11px/1.3 -apple-system,'PingFang SC',sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:26px 0 8px}
.composer{margin-top:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:12px 14px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.stack{display:flex;flex-direction:column;gap:18px}
`

function page(body, language) {
  return '<!doctype html><html lang="' + language + '"><head><meta charset="utf-8"><style>'
    + TOKENS + '</style><style>' + css + '</style></head><body><div class="column">'
    + body + '</div></body></html>'
}

// --- content -------------------------------------------------------------

function specs(language) {
  const zh = language === 'zh'
  const hero = {
    title: zh ? '本周发布情况' : 'Weekly release report',
    subtitle: zh ? '10/28 – 11/03 · 3 个服务 · 自动汇总' : 'Oct 28 – Nov 03 · 3 services · auto summary',
    icon: 'chart',
    content: {
      summary: zh
        ? '18 次发布全部完成，其中 2 次回滚已恢复；P95 延迟连续 3 天下降。'
        : 'All 18 releases completed; 2 rollbacks recovered. P95 latency fell three days in a row.',
      metrics: zh
        ? [
          { label: '发布次数', value: 18, delta: '+3', tone: 'success' },
          { label: '失败回滚', value: 2, delta: '-1', tone: 'success' },
          { label: '平均耗时', value: '6m 12s', hint: '较上周 -18%' },
          { label: 'P95 延迟', value: '212 ms', delta: '-8%' },
        ]
        : [
          { label: 'Releases', value: 18, delta: '+3', tone: 'success' },
          { label: 'Rollbacks', value: 2, delta: '-1', tone: 'success' },
          { label: 'Mean time', value: '6m 12s', hint: '18% faster' },
          { label: 'P95 latency', value: '212 ms', delta: '-8%' },
        ],
      series: zh
        ? { title: 'P95 延迟', values: [240, 228, 231, 219, 212, 205, 208, 212], unit: 'ms', labels: ['10/27', '11/03'] }
        : { title: 'P95 latency', values: [240, 228, 231, 219, 212, 205, 208, 212], unit: 'ms', labels: ['10/27', '11/03'] },
      table: zh
        ? {
          columns: ['服务', '状态', 'CPU', '发布'],
          rows: [['api', 'healthy', '41%', '9'], ['worker', 'healthy', '63%', '6'], ['cron', 'idle', '4%', '3']],
        }
        : {
          columns: ['Service', 'Status', 'CPU', 'Releases'],
          rows: [['api', 'healthy', '41%', '9'], ['worker', 'healthy', '63%', '6'], ['cron', 'idle', '4%', '3']],
        },
      actions: zh
        ? [{ label: '查看失败日志', prompt: '查看失败日志', tone: 'primary' }, { label: '导出报告', prompt: '导出本周发布报告' }]
        : [{ label: 'Open failure logs', prompt: 'Open failure logs', tone: 'primary' }, { label: 'Export report', prompt: 'Export this week report' }],
    },
  }

  const pipeline = {
    title: zh ? '灰度发布进度' : 'Canary rollout',
    icon: 'check',
    content: {
      progress: undefined,
      items: undefined,
      steps: zh
        ? [{ title: '构建镜像', text: '12:04', tone: 'success' }, { title: '灰度 10%', text: '12:11', tone: 'success' }, { title: '灰度 50%', text: '12:26', tone: 'brand' }, { title: '全量', text: '预计 12:40' }]
        : [{ title: 'Build image', text: '12:04', tone: 'success' }, { title: 'Canary 10%', text: '12:11', tone: 'success' }, { title: 'Canary 50%', text: '12:26', tone: 'brand' }, { title: 'Full rollout', text: '~12:40' }],
      actions: zh ? [{ label: '暂停发布', prompt: '暂停发布' }] : [{ label: 'Pause rollout', prompt: 'Pause rollout' }],
    },
    blocks: [
      {
        type: 'progress',
        items: zh
          ? [{ label: '发布进度', value: 0.62, caption: '62%' }, { label: '错误预算', value: 0.72, caption: '72%' }]
          : [{ label: 'Rollout', value: 0.62, caption: '62%' }, { label: 'Error budget', value: 0.72, caption: '72%' }],
      },
    ],
  }

  const diagram = {
    title: zh ? '一次调用怎么变成一张卡' : 'How one call becomes a card',
    subtitle: zh ? 'Host 记契约，Client 重建呈现' : 'The Host records the contract, the Client rebuilds the view',
    icon: 'sparkle',
    blocks: [{
      type: 'diagram',
      kind: 'flowchart',
      direction: 'LR',
      nodes: zh
        ? [
          { id: 'u', label: '用户提问', shape: 'round' },
          { id: 'a', label: 'Agent 选择卡片作答' },
          { id: 't', label: 'render_ui（Host 工具）', tone: 'brand' },
          { id: 'l', label: '会话日志 · 参数即真相', shape: 'cylinder' },
          { id: 'c', label: 'Chat 行（Client 重建）', tone: 'brand' },
          { id: 'k', label: '对话内的卡片', shape: 'round', tone: 'success' },
        ]
        : [
          { id: 'u', label: 'User question', shape: 'round' },
          { id: 'a', label: 'Agent answers with a card' },
          { id: 't', label: 'render_ui (Host tool)', tone: 'brand' },
          { id: 'l', label: 'Session log: arguments are truth', shape: 'cylinder' },
          { id: 'c', label: 'Chat row (Client rebuilds)', tone: 'brand' },
          { id: 'k', label: 'Card in the transcript', shape: 'round', tone: 'success' },
        ],
      edges: zh
        ? [
          { from: 'u', to: 'a', label: '结构化问题' },
          { from: 'a', to: 't', label: 'JSON spec' },
          { from: 't', to: 'l', label: '参数落盘' },
          { from: 'l', to: 'c', label: '回放' },
          { from: 'c', to: 'k', label: '29 种块' },
        ]
        : [
          { from: 'u', to: 'a', label: 'structured ask' },
          { from: 'a', to: 't', label: 'JSON spec' },
          { from: 't', to: 'l', label: 'arguments persist' },
          { from: 'l', to: 'c', label: 'replay' },
          { from: 'c', to: 'k', label: '29 blocks' },
        ],
    }],
  }

  const board = {
    title: zh ? '任务看板' : 'Task board',
    icon: 'list',
    content: {
      kanban: undefined,
      sections: zh
        ? [
          { heading: '本周发布', items: ['api 9 次', 'worker 6 次', 'cron 3 次'] },
          { heading: '待办', items: ['补回滚演练', '收敛告警阈值'] },
        ]
        : [
          { heading: 'This week', items: ['api 9', 'worker 6', 'cron 3'] },
          { heading: 'Backlog', items: ['Rehearse rollback', 'Tune alert thresholds'] },
        ],
    },
    blocks: [
      {
        type: 'kanban',
        columns: zh
          ? [
            { title: '待办', tone: 'neutral', cards: [{ title: '回滚演练', text: '每服务一次', badges: ['本周'] }] },
            { title: '进行中', tone: 'info', cards: [{ title: '收敛告警', text: '阈值改为 P95', badges: ['api'] }] },
            { title: '完成', tone: 'success', cards: [{ title: '发布自动化', badges: ['done'] }] },
          ]
          : [
            { title: 'Todo', tone: 'neutral', cards: [{ title: 'Rollback drill', text: 'one per service', badges: ['week'] }] },
            { title: 'Doing', tone: 'info', cards: [{ title: 'Alert tuning', text: 'threshold to P95', badges: ['api'] }] },
            { title: 'Done', tone: 'success', cards: [{ title: 'Release automation', badges: ['done'] }] },
          ],
      },
    ],
  }

  const dock = {
    title: zh ? '发布看板' : 'Release board',
    status: 'running',
    blocks: zh
      ? [
        { type: 'progress', items: [{ label: '灰度 50%', value: 0.5, caption: '50%' }] },
        { type: 'badges', items: [{ label: 'api', tone: 'success' }, { label: 'worker' }, { label: 'cron' }] },
        { type: 'live', field: 'messages' },
      ]
      : [
        { type: 'progress', items: [{ label: 'Canary 50%', value: 0.5, caption: '50%' }] },
        { type: 'badges', items: [{ label: 'api', tone: 'success' }, { label: 'worker' }, { label: 'cron' }] },
        { type: 'live', field: 'messages' },
      ],
  }

  const tail = {
    title: zh ? '下一步' : 'Next step',
    look: 'relaxed',
    blocks: [
      {
        type: 'text',
        text: zh ? '要不要我把这次发布的失败日志也整理成一张卡片？' : 'Want me to turn this release failure log into a card too?',
      },
      {
        type: 'actions',
        items: zh
          ? [{ label: '整理失败日志', prompt: '把失败日志整理成卡片', tone: 'primary' }, { label: '先不用', prompt: '先不用' }]
          : [{ label: 'Show failure log', prompt: 'Show the failure log as a card', tone: 'primary' }, { label: 'Not now', prompt: 'Not now' }],
      },
    ],
  }

  return { hero, pipeline, diagram, board, dock, tail }
}

// --- pages ----------------------------------------------------------------

function renderCard(spec, language, extra) {
  const argsRaw = JSON.stringify(spec)
  return render(card(Object.assign({ phase: 'start', block: { argsRaw }, t: translator(language) }, extra)))
}

function heroPage(language) {
  const zh = language === 'zh'
  const spec = specs(language).hero
  return page(
    '<div class="ask"><span>' + (zh ? '看看这周发布情况，做个汇总' : 'Summarize this week of releases') + '</span></div>'
    + '<p class="say">' + (zh ? '这周 18 次发布全部完成，两次回滚都已恢复；下面是明细。' : 'All 18 releases landed this week and both rollbacks recovered. Details below.') + '</p>'
    + renderCard(spec, language, { completed: true }),
    language,
  )
}

function galleryPage(language) {
  const zh = language === 'zh'
  const { diagram, pipeline, board } = specs(language)
  return page(
    '<div class="stack">' + renderCard(diagram, language, { completed: true }) + renderCard(pipeline, language, { completed: true }) + renderCard(board, language, { completed: true }) + '</div>',
    language,
  )
}

function placementsPage(language) {
  const zh = language === 'zh'
  const { dock, tail } = specs(language)
  return page(
    '<div class="caption">' + (zh ? '看板 · place: "dock"' : 'Board · place: "dock"') + '</div>'
    + renderCard(dock, language, { completed: true, variant: 'dock' })
    + '<div class="composer">' + (zh ? '输入框（看板常驻在这里上方）' : 'Composer (the board sits right above it)') + '</div>'
    + '<div class="caption">' + (zh ? '下一步 · place: "tail"' : 'Next step · place: "tail"') + '</div>'
    + renderCard(tail, language, { completed: true }),
    language,
  )
}

// --- screenshots ----------------------------------------------------------

async function screenshot(url, out, width) {
  const port = 9500 + Math.floor(Math.random() * 300)
  const profile = join(tmpdir(), 'super-cards-assets-' + port)
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--force-device-scale-factor=2', '--user-data-dir=' + profile, '--remote-debugging-port=' + port, 'about:blank'],
  { stdio: 'ignore' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const wsUrl = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })
        if (response.ok) return (await response.json()).webSocketDebuggerUrl
      } catch {}
      await sleep(120)
    }
    throw new Error('headless Chrome did not start')
  }
  try {
    const ws = new WebSocket(await wsUrl())
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    })
    const send = (method, params = {}) => new Promise((resolveSend) => {
      const id = nextId++
      pending.set(id, resolveSend)
      ws.send(JSON.stringify({ id, method, params }))
    })
    await new Promise((ready) => ws.addEventListener('open', ready, { once: true }))
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 2, mobile: false })
    await send('Page.navigate', { url })
    await sleep(1200)
    const metrics = await send('Page.getLayoutMetrics')
    const content = metrics.result?.cssContentSize ?? metrics.result?.contentSize
    const height = Math.min(3200, Math.ceil(content.height) + 4)
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false })
    await sleep(400)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
    ws.close()
    console.log('wrote ' + out)
  } finally {
    chrome.kill('SIGKILL')
  }
}

if (!existsSync(CHROME)) {
  console.error('Google Chrome is required at ' + CHROME)
  process.exit(1)
}
mkdirSync(join(ASSETS, 'zh'), { recursive: true })
mkdirSync(join(ASSETS, 'en'), { recursive: true })

const pages = { hero: heroPage, gallery: galleryPage, placements: placementsPage }
for (const language of ['zh', 'en']) {
  for (const [name, build] of Object.entries(pages)) {
    const htmlPath = join(KEEP_HTML ? ASSETS : tmpdir(), name + '-' + language + '.html')
    writeFileSync(htmlPath, build(language))
    await screenshot('file://' + htmlPath, join(ASSETS, language, name + '.png'), 790)
  }
}
console.log('done: ' + join(ASSETS, '{zh,en}', '*.png'))