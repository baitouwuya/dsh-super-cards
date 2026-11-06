/**
 * Super Cards — Client half.
 *
 * The Host half registers a global tool named `render_ui` whose JSON arguments
 * are a UI spec. This half registers a `tool.call.toolview` entry keyed by that
 * exact wire name, so the whole Tool row of every `render_ui` call is replaced
 * by the rendered card — the card *is* the model's answer.
 *
 * Nothing is bundled or compiled: the module registers itself with DSH's
 * browser module loader, `require`s React, and renders with hand-written
 * `React.createElement` calls. It reconstructs the card only from the material
 * the Session log recorded (the call's `argsRaw`), so replay and resume rebuild
 * the same card without any plugin-owned state.
 *
 * The view is deliberately inert: no network, no storage, no HTML injection,
 * no auto-sending. `actions` buttons put their prompt into the composer draft
 * and let the user press Enter; links render as links only for http(s)/mailto.
 * One documented timer exception: the automatic subagent progress card
 * refreshes its relative times once a second while that run is live. It only
 * rewrites time text, does no I/O, and its effect cleanup always clears it.
 *
 * @module dsh-super-cards/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-super-cards',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement
    /** React base class, tolerant of a minimal stub in non-browser tests. */
    const ReactComponent = (React && React.Component) || class {}

    /**
     * The host's own component library, when this deployment seeds it.
     *
     * `@deepseek-ai/dsh-client-ui-primitives` is a platform module of the Web
     * shell: the loader resolves it from the frozen seed table before it looks
     * at any package, so a plugin factory can `require` it without declaring it
     * in `dsh.client.external` and without shipping a copy. It is the same
     * instance the app itself renders with, so its syntax highlighter knows the
     * languages the host already highlights, and its CSS is already on the page.
     *
     * It is not part of the documented plugin contract, though, and older shells
     * do not seed it, so the probe is forgiving: a missing module, a module
     * without the symbol, or a `require` that throws all leave `null`, and every
     * consumer below falls back to the plugin's own renderer.
     */
    const PRIMITIVES = probePrimitives()
    /**
     * The host's code highlighter, or `null` when this shell has none.
     * @type {((lang: string) => ((code: string) => Array<Array<{ text: string, style: any }>> | undefined)) | null}
     */
    const useHostHighlighter = PRIMITIVES && typeof PRIMITIVES.useCodeHighlighter === 'function'
      ? PRIMITIVES.useCodeHighlighter
      : null

    /**
     * Read the host primitives module without letting its absence matter.
     * @returns {Record<string, any> | null} the module namespace, or null.
     */
    function probePrimitives() {
      try {
        const loaded = require('@deepseek-ai/dsh-client-ui-primitives')
        return loaded && typeof loaded === 'object' ? loaded : null
      } catch {
        return null
      }
    }

    /** Locale namespace for the few plugin-owned strings. */
    const NS = 'superCards'
    /** Slot this plugin occupies: the keyed Tool row dispatch. */
    const SLOT = 'tool.call.toolview'
    /** Keyed dispatch value inside that slot: the wire tool name, exact. */
    const KEY = 'render_ui'
    /** Stylesheet element id, so a reload replaces its own stylesheet. */
    const STYLE_ID = 'dsh-super-cards'
    /** Prefix of every class this plugin emits (no global CSS). */
    const PREFIX = 'dsh-sc-'

    /** Host-mirrored caps: the client never renders a bigger payload than the Host accepts. */
    const MAX_BLOCKS = 24
    const MAX_TEXT = 4000
    const MAX_CODE = 8000
    const MAX_TABLE_ROWS = 50
    const MAX_TABLE_COLUMNS = 20
    const MAX_SPARK_VALUES = 120
    const MAX_ACTIONS = 8
    /** Slices one pie can carry; the Host enforces the same bound. */
    const MAX_PIE_SLICES = 8
    /** Container caps mirrored from the Host: nested content stays bounded. */
    const MAX_TREE_NODES = 200
    const MAX_TREE_DEPTH = 4
    const MAX_HEATMAP_CELLS = 371
    const MAX_DIFF_LINES = 400
    const MAX_KANBAN_COLUMNS = 4
    const MAX_KANBAN_CARDS = 8
    const MAX_TABS = 5
    const MAX_TAB_BLOCKS = 6
    /** Columns render side by side; same bounds as the Host enforces. */
    const MAX_COLUMNS = 3
    const MAX_COLUMN_BLOCKS = 6
    /** Inline image source cap, mirrored from the Host (`imageChars`). */
    const MAX_IMAGE_CHARS = 200000
    /** Sandboxed HTML card: source cap and frame height bounds, mirrored from the Host. */
    const MAX_HTML = 20000
    const HTML_MIN_HEIGHT = 120
    const HTML_MAX_HEIGHT = 800
    const HTML_DEFAULT_HEIGHT = 240
    /** Defensive DOM bound for the unbounded item arrays of the other blocks. */
    const MAX_ITEMS = 100

    /** Tone values the spec allows; anything else falls back to `neutral`. */
    const TONE_NAMES = ['neutral', 'brand', 'info', 'success', 'warn', 'error']
    /** Header glyphs the spec allows. */
    const ICON_NAMES = ['sparkle', 'chart', 'check', 'info', 'warning', 'table', 'code', 'list']
    /** Card looks: the same structure at four visual densities. */
    const LOOK_NAMES = ['default', 'compact', 'flat', 'relaxed']
    /** Card lifecycle states the spec allows (neutral is renderer-internal). */
    const STATUS_NAMES = ['running', 'success', 'warn', 'error', 'none']

    /**
     * Motion presets the spec allows. The model names one; this half maps it to
     * an animation the stylesheet already owns, so a card cannot inject CSS and
     * replays identically from the session log. Mirrors `MOTION_EFFECTS` in
     * `lib/shared.js` (the parity test keeps the two lists equal).
     */
    const MOTION_EFFECTS = ['pulse', 'flash', 'reveal', 'sweep', 'draw', 'flow', 'bounce', 'shake']
    /** Motion defaults mirrored from the Host, in milliseconds. */
    const MOTION_DEFAULT_DURATION = 1000
    const MOTION_MIN_DURATION = 200
    const MOTION_MAX_DURATION = 6000
    const MOTION_MAX_DELAY = 4000

    /**
     * Normalize the optional `motion` object of one block. Mirrors
     * `normalizeMotion` in `lib/shared.js`: decorative, so an unusable value
     * renders the block statically instead of dropping the content.
     *
     * @param {unknown} value raw `motion` value.
     * @returns {{ effect: string, duration: number, delay: number, loop: boolean } | null}
     */
    function normalizeMotion(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null
      if (typeof value.effect !== 'string' || MOTION_EFFECTS.indexOf(value.effect) === -1) return null
      const time = (raw, min, max, fallback) => {
        const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
        if (!Number.isFinite(number)) return fallback
        return Math.max(min, Math.min(max, Math.round(number)))
      }
      return {
        effect: value.effect,
        duration: time(value.duration, MOTION_MIN_DURATION, MOTION_MAX_DURATION, MOTION_DEFAULT_DURATION),
        delay: time(value.delay, 0, MOTION_MAX_DELAY, 0),
        loop: value.loop === true,
      }
    }

    /**
     * Single block registry: one entry per block type.
     *
     * `dock` marks the glanceable subset a compact board may carry; `normalize`
     * turns raw spec JSON into a normalized block (null when unusable); `render`
     * turns one normalized block into an element. The functions live further
     * down and are hoisted, so every supported type is visible in one place.
     *
     * Adding a block type is one entry here plus its two functions. The object
     * order is the documented order and drives `BLOCK_ORDER`.
     */
    const BLOCK_IMPL = {
      text: { dock: true, normalize: normalizeTextBlock, render: renderTextBlock },
      heading: { dock: true, normalize: normalizeHeadingBlock, render: renderHeadingBlock },
      callout: { dock: true, normalize: normalizeCalloutBlock, render: renderCalloutBlock },
      stats: { dock: true, normalize: normalizeStatsBlock, render: renderStatsBlock },
      table: { dock: false, normalize: normalizeTableBlock, render: renderTableBlock },
      keyvalue: { dock: false, normalize: normalizeKeyvalueBlock, render: renderKeyvalueBlock },
      list: { dock: true, normalize: normalizeListBlock, render: renderListBlock },
      badges: { dock: true, normalize: normalizeBadgesBlock, render: renderBadgesBlock },
      progress: { dock: true, normalize: normalizeProgressBlock, render: renderProgressBlock },
      bars: { dock: false, normalize: normalizeBarsBlock, render: renderBarsBlock },
      sparkline: { dock: false, normalize: normalizeSparklineBlock, render: renderSparklineBlock },
      pie: { dock: false, normalize: normalizePieBlock, render: renderPieBlock },
      code: { dock: false, normalize: normalizeCodeBlock, render: renderCodeBlock },
      quote: { dock: false, normalize: normalizeQuoteBlock, render: renderQuoteBlock },
      timeline: { dock: false, normalize: normalizeTimelineBlock, render: renderTimelineBlock },
      links: { dock: false, normalize: normalizeLinksBlock, render: renderLinksBlock },
      actions: { dock: false, normalize: normalizeActionsBlock, render: renderActionsBlock },
      divider: { dock: false, normalize: normalizeDividerBlock, render: renderDividerBlock },
      live: { dock: true, normalize: normalizeLiveBlock, render: renderLiveBlock },
      controls: { dock: false, normalize: normalizeControlsBlock, render: renderControlsBlock },
      diagram: { dock: false, normalize: normalizeDiagramBlock, render: renderDiagramBlock },
      tree: { dock: false, normalize: normalizeTreeBlock, render: renderTreeBlock },
      heatmap: { dock: false, normalize: normalizeHeatmapBlock, render: renderHeatmapBlock },
      diff: { dock: false, normalize: normalizeDiffBlock, render: renderDiffBlock },
      kanban: { dock: false, normalize: normalizeKanbanBlock, render: renderKanbanBlock },
      tabs: { dock: false, normalize: normalizeTabsBlock, render: renderTabsBlock },
      columns: { dock: false, normalize: normalizeColumnsBlock, render: renderColumnsBlock },
      image: { dock: false, normalize: normalizeImageBlock, render: renderImageBlock },
      html: { dock: false, normalize: normalizeHtmlBlock, render: renderHtmlBlock },
    }

    /** Documentation order of the built-in block types; later registrations append. */
    const BLOCK_ORDER = Object.keys(BLOCK_IMPL)

    /**
     * Wire-type aliases: a content field name written as a block `type`.
     *
     * Mirrors `BLOCK_ALIASES` in `lib/blocks.js`. The tool description advertises
     * the auto-layout `content` fields, so a model now and then puts one of those
     * names in an explicit block; the material is right and only the name is
     * wrong, so the alias folds it onto the block that renders the same thing.
     * A registered type wins over its alias, because the direct lookup runs
     * first in `resolvedBlockImpl`.
     */
    const BLOCK_ALIASES = new Map([
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

    /** Dock-safe block types in documentation order: the board's allow-list. */
    const DOCK_BLOCK_TYPES = BLOCK_ORDER.filter((type) => BLOCK_IMPL[type].dock === true)

    /** A board is a glance: never more than this many blocks. */
    const DOCK_BLOCK_LIMIT = 4

    /**
     * Synthetic block type standing in for a wire type this Client has no
     * renderer for (a host-side extension whose Client half is missing, or a
     * client older than the card). Such a block renders a small notice instead
     * of vanishing, so a half-registered extension is visible, not silent.
     */
    const UNSUPPORTED_TYPE = '__unsupported'

    /**
     * Single placement registry: how each `place` value is mounted.
     *
     * `groupTree` is the conversation group-tree position the inline row takes —
     * `turn` stays visible in the answer flow, `process` folds away with the
     * work details. `dock` marks the placement that owns the persistent board
     * above the composer, `tail` the card handed back under a completed Turn
     * (next-step suggestions, closing cards). Unknown names fall back to
     * `answer`.
     */
    const PLACEMENTS = {
      answer: { groupTree: 'turn' },
      process: { groupTree: 'process' },
      dock: { groupTree: 'process', dock: true },
      tail: { groupTree: 'turn', tail: true },
    }

    /** Plugin strings, zh. The card's own content comes localized from the model. */
    const zh = {
      'card.label': 'UI 卡片',
      'preparing': '正在生成 UI…',
      'error.title': '卡片生成失败',
      'error.render': 'UI 渲染失败',
      'error.invalid': 'UI 规格无效，无法显示该卡片。',
      'error.emptyArgs': '这次调用没有携带参数，所以没有卡片内容——render_ui 在当前模式下可能需要在 run_code 里调用，也可能参数在记录前就中断了。',
      'error.parseArgs': '调用参数不是合法的 JSON，无法还原这张卡片。',
      'error.emptySpec': '参数里没有可渲染的区块（blocks），所以这张卡片是空的。',
      'error.unknown': '未知错误',
      'error.missingCall': '调用参数已不在会话窗口中，无法恢复该卡片。',
      'empty': '没有可显示的内容。',
      'hint.draft': '已放入输入框，按 Enter 发送',
      'hint.copied': '已复制',
      'hint.copyFailed': '复制失败，请手动选择文本',
      'code.label': '代码',
      'code.show': '展开全部',
      'code.collapse': '收起',
      'spark.label': '趋势图',
      'heatmap.label': '热力图',
      'heatmap.less': '少',
      'heatmap.more': '多',
      'tabs.label': '卡片分区',
      'live.label': '实时',
      'live.empty': '暂无消息',
      'live.user': '你',
      'live.assistant': '助手',
      'live.tool': '工具',
      'dock.title': '任务看板',
      'dock.meta': '{blocks} 项',
      'status.running': '进行中',
      'status.success': '已完成',
      'status.warn': '有异常',
      'status.error': '失败',
      'card.doneMeta': '{items} 项全部完成',
      'controls.applied': '已同步到设置',
      'controls.failed': '设置失败',
      'controls.unavailable': '当前环境不支持该操作',
      'controls.drafted': '已放入输入框，按 Enter 发送',
      'controls.sent': '已发送给助手',
      'close.label': '关闭卡片',
      'copy.label': '复制为 Markdown',
      'card.closed': '已收起',
      'diagram.source': '源码',
      'diagram.chart': '图表',
      'team.title': '子代理进度',
      'team.members': '子代理',
      'team.tasks': '任务完成',
      'team.lastActivity': '最后活动',
      'team.task.pending': '待开始',
      'team.task.in_progress': '进行中',
      'team.task.completed': '完成',
      'team.task.failed': '失败',
      'team.task.cancelled': '已取消',
      'team.member.provisioning': '准备中',
      'team.member.active': '已加入',
      'team.activity.task': '{id} {status}',
      'team.activity.member': '{name} {phase}',
      'team.activity.message': '{from} -> {to}: {excerpt}',
      'team.activity.delivered': '已送达',
      'team.time.justNow': '刚刚',
      'team.time.seconds': '{count} 秒前',
      'team.time.minutes': '{count} 分钟前',
      'team.time.hours': '{count} 小时前',
      'next.question': '接下来做什么？',
      'config.tab': '超级卡片',
      'config.title': '超级卡片配置',
      'config.intro': '这些设置写入插件的行配置，保存后立即生效。',
      'config.summary': '默认位置 {place} · 单卡最多 {blocks} 块 · 自动下一步 {steps} · 任务看板 {dock}',
      'config.summaryEmpty': '尚未读取到配置',
      'config.on': '开',
      'config.off': '关',
      'config.place.answer': '正文',
      'config.place.process': '过程',
      'config.place.dock': '看板',
      'config.place.tail': '结尾',
      'config.nextSteps': '自动生成下一步卡片',
      'config.dock': '常驻任务看板',
      'config.defaultPlace': '默认卡片位置',
      'config.maxBlocks': '单卡最多区块数',
      'config.nextStepsMax': '下一步选项数',
      'config.nextStepsTimeoutMs': '下一步生成超时（毫秒）',
      'config.nextStepsMinChars': '下一步生成最少字符数',
      'config.nextStepsProvider': '下一步生成服务商（可选）',
      'config.nextStepsModel': '下一步生成模型（可选）',
      'config.blocks': '允许的区块类型（逗号分隔）',
      'config.blocksHint': '留空表示不限制',
      'config.save': '保存',
      'config.saving': '保存中…',
      'config.saved': '已保存',
      'config.saveFailed': '保存失败，请重试',
      'config.reset': '恢复默认',
      'config.invalid': '请检查数值范围',
      'config.loading': '正在读取配置…',
      'config.unavailable': '当前环境无法读取该插件的配置。',
      'config.readOnly': '当前配置只读，无法在此修改。',
      'config.unset': '默认',
      'block.missing': '未识别的区块类型 `{type}`',
      'block.missingHint': '这个类型没有渲染器。改用受支持的区块类型（如 `callout`），或由插件通过 superCards.blocks.register 注册。',
      'diagram.label': '图示',
      'card.reopen': '重新打开卡片',
      'dock.closed': '看板已关闭',
      'dock.reopen': '重新打开看板',
      'auto.label': '自动排版',
      'image.label': '图片',
      'image.failed': '图片加载失败',
      'image.open': '打开原图',
      'html.label': '自定义卡片',
      'html.source': '源码',
      'html.preview': '预览',
    }

    /** Plugin strings, en (fallback when no locale face is installed). */
    const en = {
      'card.label': 'UI card',
      'preparing': 'Generating UI…',
      'error.title': 'Could not render the card',
      'error.render': 'UI render failed',
      'error.invalid': 'The UI spec is invalid, so this card cannot be displayed.',
      'error.emptyArgs': 'This call carried no arguments, so there is no card to show — render_ui may need to be called from inside run_code in this mode, or the arguments were cut off before they were recorded.',
      'error.parseArgs': 'The call arguments are not valid JSON, so this card cannot be restored.',
      'error.emptySpec': 'The arguments carry no renderable blocks, so this card is empty.',
      'error.unknown': 'Unknown error',
      'error.missingCall': 'The call arguments are no longer in the session window, so this card cannot be restored.',
      'empty': 'Nothing to display.',
      'hint.draft': 'Added to the input box — press Enter to send',
      'hint.copied': 'Copied',
      'hint.copyFailed': 'Copy failed — select the text manually',
      'code.label': 'Code',
      'code.show': 'Show all',
      'code.collapse': 'Collapse',
      'spark.label': 'Trend chart',
      'tabs.label': 'Card sections',
      'live.label': 'Live',
      'live.empty': 'No messages yet',
      'live.user': 'You',
      'live.assistant': 'Assistant',
      'live.tool': 'Tool',
      'dock.title': 'Task board',
      'dock.meta': '{blocks} items',
      'status.running': 'In progress',
      'status.success': 'Done',
      'status.warn': 'Needs attention',
      'status.error': 'Failed',
      'card.doneMeta': '{items} items completed',
      'controls.applied': 'Synced to settings',
      'controls.failed': 'Could not apply the setting',
      'controls.unavailable': 'Not available in this environment',
      'controls.drafted': 'Added to the input — press Enter to send',
      'controls.sent': 'Sent to the assistant',
      'close.label': 'Close card',
      'copy.label': 'Copy as Markdown',
      'card.closed': 'Closed',
      'diagram.source': 'Source',
      'diagram.chart': 'Chart',
      'team.title': 'Subagent progress',
      'team.members': 'Subagents',
      'team.tasks': 'Tasks done',
      'team.lastActivity': 'Last activity',
      'team.task.pending': 'Pending',
      'team.task.in_progress': 'In progress',
      'team.task.completed': 'Done',
      'team.task.failed': 'Failed',
      'team.task.cancelled': 'Cancelled',
      'team.member.provisioning': 'provisioning',
      'team.member.active': 'joined',
      'team.activity.task': '{id} {status}',
      'team.activity.member': '{name} {phase}',
      'team.activity.message': '{from} -> {to}: {excerpt}',
      'team.activity.delivered': 'delivered',
      'team.time.justNow': 'just now',
      'team.time.seconds': '{count}s ago',
      'team.time.minutes': '{count}m ago',
      'team.time.hours': '{count}h ago',
      'next.question': 'What would you like to do next?',
      'config.tab': 'Super Cards',
      'config.title': 'Super Cards configuration',
      'config.intro': 'These settings write the plugin row config and apply on save.',
      'config.summary': 'Placement {place} · up to {blocks} blocks · auto next steps {steps} · board {dock}',
      'config.summaryEmpty': 'Configuration not loaded yet',
      'config.on': 'on',
      'config.off': 'off',
      'config.place.answer': 'Answer',
      'config.place.process': 'Process',
      'config.place.dock': 'Board',
      'config.place.tail': 'Turn tail',
      'config.nextSteps': 'Auto next-step card',
      'config.dock': 'Persistent task board',
      'config.defaultPlace': 'Default card placement',
      'config.maxBlocks': 'Max blocks per card',
      'config.nextStepsMax': 'Next-step options',
      'config.nextStepsTimeoutMs': 'Next-step timeout (ms)',
      'config.nextStepsMinChars': 'Next-step minimum turn length (chars)',
      'config.nextStepsProvider': 'Next-step provider (optional)',
      'config.nextStepsModel': 'Next-step model (optional)',
      'config.blocks': 'Allowed block types (comma separated)',
      'config.blocksHint': 'Leave empty for no restriction',
      'config.save': 'Save',
      'config.saving': 'Saving…',
      'config.saved': 'Saved',
      'config.saveFailed': 'Save failed — try again',
      'config.reset': 'Reset to defaults',
      'config.invalid': 'Check the number ranges',
      'config.loading': 'Loading configuration…',
      'config.unavailable': 'Configuration is not available in this environment.',
      'config.readOnly': 'This configuration is read-only here.',
      'config.unset': 'Default',
      'block.missing': 'Unrecognised block type `{type}`',
      'block.missingHint': 'No renderer is registered for it. Use a supported block type such as `callout`, or have a plugin register one through superCards.blocks.register.',
      'diagram.label': 'Diagram',
      'card.reopen': 'Reopen card',
      'dock.closed': 'Board closed',
      'dock.reopen': 'Reopen board',
      'auto.label': 'Auto layout',
      'image.label': 'Image',
      'image.failed': 'Image failed to load',
      'image.open': 'Open original',
      'html.label': 'Custom card',
      'html.source': 'Source',
      'html.preview': 'Preview',
    }

    /**
     * Column share rules. The renderer writes `data-ratio` from the block's
     * `weights`, and these rules turn it into fr shares; anything else keeps the
     * auto-fit grid. Generated from one table so the two halves stay in sync.
     */
    const COLUMN_RATIOS = [
      [2, 1], [1, 2], [3, 1], [1, 3], [3, 2], [2, 3], [2, 2], [3, 3],
      [2, 1, 1], [1, 2, 1], [1, 1, 2], [3, 1, 1], [1, 3, 1], [1, 1, 3],
    ]
    const COLUMN_RATIO_CSS = COLUMN_RATIOS.map((weights) => (
      '.dsh-sc-cols[data-ratio="' + weights.join('-') + '"] { grid-template-columns: '
      + weights.map((weight) => 'minmax(0, ' + weight + 'fr)').join(' ') + '; }'
    )).join('\n')

    /**
     * One stylesheet for the whole plugin. Every selector is prefixed with
     * `dsh-sc-`; colors come from `--dsw-alias-*` tokens only (tone accents are
     * passed per block through the `--dsh-sc-tone` custom property), and
     * `color-mix` declarations always have a plain token fallback in front.
     */
    const CSS = `
.dsh-sc-card {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  margin-block: 8px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 13.5px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  /* One reading measure for every prose-shaped block: ~31 CJK characters a
     line. Blocks that can spend spare width (tables, charts, columns) ignore
     it; blocks that cannot (text, keyvalue, list) keep lines comfortable. */
  --dsh-sc-measure: 62ch;
  /* A label/value row sheet spends its first column on labels, so the value
     column keeps the reading measure on its own: the block as a whole may be
     wider without stretching a sentence. */
  --dsh-sc-measure-wide: 76ch;
}
.dsh-sc-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
}
.dsh-sc-head-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-top: -1px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-glyph { display: block; width: 16px; height: 16px; }
.dsh-sc-head-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dsh-sc-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-auto {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.6;
}
.dsh-sc-blocks { display: flex; flex-direction: column; gap: 11px; min-width: 0; container-type: inline-size; }
/* Look variants: the same spec at four densities. Structure never changes, so
   a long report can read compact while a small summary stays relaxed. */
.dsh-sc-card--compact { padding: 12px 14px; font-size: 13px; line-height: 1.45; }
.dsh-sc-card--compact .dsh-sc-head { margin-bottom: 8px; padding-bottom: 8px; }
.dsh-sc-card--compact .dsh-sc-title { font-size: 15px; }
.dsh-sc-card--compact .dsh-sc-blocks { gap: 8px; }
.dsh-sc-card--compact .dsh-sc-stat { padding: 8px 10px; border-radius: 9px; }
.dsh-sc-card--compact .dsh-sc-stat-value { font-size: 19px; }
.dsh-sc-card--compact .dsh-sc-th { padding: 6px 10px; }
.dsh-sc-card--compact .dsh-sc-td { padding: 5px 10px; }
.dsh-sc-card--compact .dsh-sc-callout { padding: 9px 12px; border-radius: 10px; }
.dsh-sc-card--compact .dsh-sc-spark-svg { height: 60px; }
.dsh-sc-card--compact .dsh-sc-spark-block,
.dsh-sc-card--compact .dsh-sc-bars-block,
.dsh-sc-card--compact .dsh-sc-pie { padding: 8px 10px; }
.dsh-sc-card--flat .dsh-sc-stats { gap: 0 18px; }
.dsh-sc-card--flat .dsh-sc-stat { padding: 5px 0; border-color: transparent; background: transparent; }
.dsh-sc-card--flat .dsh-sc-spark-block,
.dsh-sc-card--flat .dsh-sc-bars-block,
.dsh-sc-card--flat .dsh-sc-pie { padding: 0; border-color: transparent; background: transparent; }
.dsh-sc-card--flat .dsh-sc-tablewrap { border-color: transparent; background: transparent; }
.dsh-sc-card--flat .dsh-sc-th { background: transparent; }
.dsh-sc-card--flat .dsh-sc-callout { background: transparent; }
.dsh-sc-card--relaxed { padding: 20px 22px; font-size: 14px; line-height: 1.65; }
.dsh-sc-card--relaxed .dsh-sc-title { font-size: 17px; }
.dsh-sc-card--relaxed .dsh-sc-blocks { gap: 15px; }
.dsh-sc-card--relaxed .dsh-sc-stat { padding: 12px 14px; }
.dsh-sc-card--relaxed .dsh-sc-stat-value { font-size: 24px; }
.dsh-sc-card--relaxed .dsh-sc-th { padding: 9px 12px; }
.dsh-sc-card--relaxed .dsh-sc-td { padding: 10px 12px; }
.dsh-sc-card--relaxed .dsh-sc-callout { padding: 13px 15px; }
.dsh-sc-text {
  margin: 0;
  max-width: var(--dsh-sc-measure, 62ch);
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-muted { color: var(--dsw-alias-label-secondary); }
.dsh-sc-strong { font-weight: 600; color: inherit; }
.dsh-sc-inline-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
}
.dsh-sc-heading { margin: 0; font-weight: 650; line-height: 1.4; color: var(--dsw-alias-label-primary); letter-spacing: -0.005em; }
.dsh-sc-heading-1 {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.012em;
  padding-left: 12px;
  border-left: 3px solid var(--dsw-alias-brand-primary);
}
.dsh-sc-heading-2 { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.dsh-sc-heading-3 {
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-blocks > .dsh-sc-heading-1:not(:first-child) { margin-top: 10px; }
.dsh-sc-blocks > .dsh-sc-heading-2:not(:first-child) { margin-top: 8px; }
.dsh-sc-block-title {
  margin-bottom: 5px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-divider {
  width: 100%;
  height: 1px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
}
.dsh-sc-callout {
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-secondary)) 30%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-secondary)) 8%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-callout-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--dsh-sc-tone, var(--dsw-alias-label-primary));
}
.dsh-sc-callout-title::before {
  content: "";
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.dsh-sc-callout-text { font-size: 13.5px; line-height: 1.55; color: var(--dsw-alias-label-primary); }
.dsh-sc-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 8px;
}
/* KPI rows: the renderer picks a base count that never leaves one tile alone,
   and these fold it back on a narrow card instead of squeezing five numbers
   into phone width. */
.dsh-sc-stats[data-cols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dsh-sc-stats[data-cols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dsh-sc-stats[data-cols="4"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dsh-sc-stats[data-cols="5"] { grid-template-columns: repeat(5, minmax(0, 1fr)); }
@container (max-width: 1080px) {
  .dsh-sc-stats[data-cols="5"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@container (max-width: 860px) {
  .dsh-sc-stats[data-cols="4"],
  .dsh-sc-stats[data-cols="5"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 600px) {
  .dsh-sc-stats[data-cols="3"],
  .dsh-sc-stats[data-cols="4"],
  .dsh-sc-stats[data-cols="5"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* An odd count leaves one tile alone in a two-column row; give it the row
     instead of a hole beside it. */
  .dsh-sc-stats[data-cols] > .dsh-sc-stat:last-child:nth-child(odd) { grid-column: span 2; }
}
@container (max-width: 430px) {
  .dsh-sc-stats[data-cols] { grid-template-columns: minmax(0, 1fr); }
  .dsh-sc-stats[data-cols] > .dsh-sc-stat:last-child:nth-child(odd) { grid-column: auto; }
}
.dsh-sc-stat {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-stat-label { font-size: 11.5px; font-weight: 500; line-height: 1.35; color: var(--dsw-alias-label-secondary); }
.dsh-sc-stat-line { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex-wrap: wrap; }
.dsh-sc-stat-value {
  font-size: 22px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
  /* A value is a datum, not prose: it wraps between its words ("1503 通过")
     instead of splitting a word ("通/过") when the tile is tight. */
  word-break: keep-all;
  overflow-wrap: anywhere;
  min-width: 0;
}
.dsh-sc-stat[data-toned="1"] .dsh-sc-stat-value { color: var(--dsh-sc-tone, var(--dsw-alias-label-primary)); }
.dsh-sc-stat-delta { font-size: 11.5px; color: var(--dsw-alias-label-secondary); word-break: keep-all; }
.dsh-sc-stat[data-toned="1"] .dsh-sc-stat-delta { color: var(--dsh-sc-tone, var(--dsw-alias-label-secondary)); }
.dsh-sc-stat-hint { margin-top: 2px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-tablewrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-sc-table { width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 1.5; }
.dsh-sc-th {
  padding: 8px 12px;
  text-align: left;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  white-space: nowrap;
}
.dsh-sc-td {
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-primary);
  vertical-align: top;
  font-variant-numeric: tabular-nums;
}
.dsh-sc-tbody .dsh-sc-tr:hover .dsh-sc-td { background: color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, transparent); }
.dsh-sc-tr:last-child .dsh-sc-td { border-bottom: 0; }
.dsh-sc-align-left { text-align: left; }
.dsh-sc-align-center { text-align: center; }
.dsh-sc-align-right { text-align: right; }
.dsh-sc-td.dsh-sc-align-right { font-weight: 600; }
.dsh-sc-null { color: var(--dsw-alias-label-secondary); }
.dsh-sc-caption { margin-top: 7px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-sc-kv {
  display: grid;
  /* A tile grid is a spec sheet, not prose: it may spend the card's width, up
     to the point where four facts would drift apart. */
  max-width: min(100%, 84ch);
  gap: 8px 16px;
}
.dsh-sc-kv[data-cols="1"] { grid-template-columns: minmax(0, 1fr); }
.dsh-sc-kv[data-cols="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dsh-sc-kv[data-cols="3"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
/* Long-form facts read as a row sheet: one label column sized to the longest
   key (capped so a long key cannot eat the value), one value column holding
   the whole line. No odd-count hole, no sentence wrapping inside a half tile. */
.dsh-sc-kv[data-layout="rows"] {
  max-width: var(--dsh-sc-measure-wide, 76ch);
  grid-template-columns: fit-content(34%) minmax(0, 1fr);
  gap: 7px 14px;
  align-items: baseline;
}
.dsh-sc-kv[data-layout="rows"] > .dsh-sc-kv-item { display: contents; }
.dsh-sc-kv[data-layout="rows"] .dsh-sc-kv-key { font-size: 12px; line-height: 1.5; }
.dsh-sc-kv[data-layout="rows"] .dsh-sc-kv-value { margin-top: 0; font-weight: 500; }
.dsh-sc-kv-item { min-width: 0; }
.dsh-sc-kv-key { font-size: 11px; line-height: 1.35; color: var(--dsw-alias-label-secondary); }
.dsh-sc-kv-value { margin-top: 1px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
@container (max-width: 600px) {
  .dsh-sc-kv[data-cols="3"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  /* A narrow card stacks the sheet instead: key above value, one pair per
     paragraph, which is the only shape that keeps both readable. */
  .dsh-sc-kv[data-layout="rows"] { grid-template-columns: minmax(0, 1fr); gap: 1px; }
  .dsh-sc-kv[data-layout="rows"] .dsh-sc-kv-value { margin-bottom: 7px; }
}
@container (max-width: 430px) {
  .dsh-sc-kv[data-cols] { grid-template-columns: minmax(0, 1fr); }
}
.dsh-sc-list {
  margin: 0;
  padding-left: 18px;
  max-width: var(--dsh-sc-measure, 62ch);
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
}
/* A list long enough to matter spends the spare width on more columns instead
   of one ragged measure and a hole beside it. The grid chooses the column
   count from its own width, so a list inside a narrow columns cell keeps
   stacking without a second rule; items never get narrower than 21rem. */
.dsh-sc-list[data-flow="1"] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
  gap: 3px 40px;
  max-width: none;
  padding-left: 20px;
}
.dsh-sc-list[data-flow="1"] .dsh-sc-li { break-inside: avoid; }
.dsh-sc-list[data-flow="1"] .dsh-sc-li + .dsh-sc-li { margin-top: 0; }
.dsh-sc-list ::marker { color: var(--dsw-alias-label-secondary); }
.dsh-sc-li { margin: 0; }
.dsh-sc-li + .dsh-sc-li { margin-top: 3px; }
.dsh-sc-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-sc-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border: 1px solid color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-secondary)) 28%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-secondary)) 10%, var(--dsw-alias-bg-layer-1));
  color: var(--dsh-sc-tone, var(--dsw-alias-label-primary));
  font-size: 12px;
  line-height: 1.6;
}
.dsh-sc-progress { display: flex; flex-direction: column; gap: 12px; }
.dsh-sc-progress-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
}
.dsh-sc-progress-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-progress-value {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dsh-sc-progress-track {
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent);
  overflow: hidden;
}
.dsh-sc-progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsh-sc-tone, var(--dsw-alias-brand-primary));
}
.dsh-sc-progress-caption { margin-top: 4px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-bars { display: flex; flex-direction: column; gap: 6px; }
.dsh-sc-bar-row {
  display: grid;
  /* The label column hugs its longest label instead of taking a fixed share:
     three-letter service names should not push the bar half a card to the
     right, and a long label still stops at 30% so the bar keeps the rest. */
  grid-template-columns: fit-content(30%) minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  color: var(--dsh-sc-tone, var(--dsw-alias-state-idle-primary));
}
.dsh-sc-bar-label {
  min-width: 0;
  font-size: 12.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-bar-svg { display: block; width: 100%; height: 10px; overflow: visible; }
.dsh-sc-bar-value {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
/* Vertical columns: the same bar data read left to right, for a short series
   where a ranked list would waste the card's width. */
.dsh-sc-columns {
  display: flex;
  align-items: stretch;
  gap: 10px;
  height: 148px;
  padding-top: 18px;
}
.dsh-sc-column {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--dsh-sc-tone, var(--dsw-alias-label-secondary));
}
.dsh-sc-column-track {
  position: relative;
  flex: 1;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3.5%, transparent);
}
.dsh-sc-column-fill {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(100%, 46px);
  transform: translateX(-50%);
  border-radius: 6px 6px 3px 3px;
  background: currentColor;
}
.dsh-sc-column-value {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-sc-column-label {
  flex: none;
  text-align: center;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Pie / donut: the ring stays unlabelled, the legend carries exact values and
   shares, so the chart reads at a glance and the numbers are exact. */
.dsh-sc-pie {
  display: grid;
  grid-template-columns: 132px minmax(0, auto);
  align-items: center;
  justify-content: center;
  gap: 20px;
}
.dsh-sc-pie-figure { position: relative; width: 132px; height: 132px; }
.dsh-sc-pie-svg { display: block; width: 100%; height: 100%; }
.dsh-sc-pie-track { stroke: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dsh-sc-pie-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  pointer-events: none;
  text-align: center;
}
.dsh-sc-pie-total {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-pie-number {
  position: relative;
  display: inline-block;
  /* digits carry no descender, so the ink sits ~2px low in the line box */
  transform: translateY(-2px);
}
.dsh-sc-pie-unit {
  position: absolute;
  left: 100%;
  bottom: 2px;
  margin-left: 2px;
  font-size: 11px;
  line-height: 1;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-pie-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: max-content;
  max-width: 100%;
  min-width: 0;
}
.dsh-sc-pie-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.dsh-sc-pie-amount { display: inline-flex; align-items: baseline; gap: 6px; }
.dsh-sc-pie-swatch { width: 10px; height: 10px; border-radius: 3px; }
.dsh-sc-pie-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-pie-value { font-weight: 600; font-variant-numeric: tabular-nums; }
.dsh-sc-pie-pct { color: var(--dsw-alias-label-secondary); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.dsh-sc-spark-block { color: var(--dsh-sc-tone, var(--dsw-alias-brand-primary)); }
/* Charts sit in the same quiet frame as the metric cards, so a dashboard reads
   as one row of panels instead of bare shapes floating on the card. */
.dsh-sc-spark-block,
.dsh-sc-bars-block,
.dsh-sc-pie {
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-spark {
  position: relative;
  margin-top: 6px;
  border-radius: 8px;
  cursor: crosshair;
  outline: none;
  touch-action: pan-y;
}
.dsh-sc-spark:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
/* Hover/focus read-out: a hairline guide, the sample dot, and one value bubble. */
.dsh-sc-spark-guide {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 1px;
  transform: translateX(-0.5px);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
  pointer-events: none;
}
.dsh-sc-spark-dot {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-1);
  pointer-events: none;
}
.dsh-sc-spark-tip {
  position: absolute;
  top: 2px;
  transform: translate(-50%, -2px);
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
  border-radius: 7px;
  background: var(--dsw-alias-bg-overlay);
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.dsh-sc-spark-svg { display: block; width: 100%; height: 84px; }
.dsh-sc-spark-labels {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-sc-code {
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-radius: 12px;
  overflow: hidden;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-sc-code-title {
  min-width: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-code-lang {
  flex: none;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-code-toggle {
  flex: none;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.dsh-sc-code-toggle:hover { color: var(--dsw-alias-label-primary); }
.dsh-sc-code-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-sc-code-pre {
  margin: 0;
  padding: 12px 14px;
  max-height: 280px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
  white-space: pre;
  tab-size: 2;
}
.dsh-sc-code-pre--expanded { max-height: none; }
.dsh-sc-code-text { font-family: inherit; }
.dsh-sc-quote {
  padding: 4px 0 4px 16px;
  border-left: 3px solid var(--dsw-alias-brand-primary);
}
.dsh-sc-quote-text { font-size: 15px; line-height: 1.7; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsh-sc-quote-by { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-timeline { display: flex; flex-direction: column; }
.dsh-sc-tl-item { position: relative; padding: 0 0 14px 20px; }
.dsh-sc-tl-item:last-child { padding-bottom: 0; }
.dsh-sc-tl-item::before {
  content: "";
  position: absolute;
  left: 2px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsh-sc-tone, var(--dsw-alias-label-secondary));
}
.dsh-sc-tl-item::after {
  content: "";
  position: absolute;
  /* The rail runs from under one dot into the next item so the steps read as
     one line; the following dot paints over the last few pixels. */
  left: 5px;
  top: 15px;
  bottom: -6px;
  width: 1px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
}
.dsh-sc-tl-item:last-child::after { display: none; }
.dsh-sc-tl-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.dsh-sc-tl-title { font-size: 13px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dsh-sc-tl-time {
  flex: none;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-sc-tl-text { margin-top: 2px; font-size: 12.5px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
/* Tree: nested lists; the hierarchy reads through indentation and connectors. */
.dsh-sc-tree { margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 1.55; }
.dsh-sc-tree .dsh-sc-tree {
  margin-left: 14px;
  padding-left: 12px;
  border-left: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
}
.dsh-sc-tree-node { position: relative; }
.dsh-sc-tree-node + .dsh-sc-tree-node { margin-top: 3px; }
.dsh-sc-tree .dsh-sc-tree .dsh-sc-tree-node::before {
  content: "";
  position: absolute;
  left: -12px;
  top: 9px;
  width: 9px;
  border-top: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
}
.dsh-sc-tree-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dsh-sc-tree-label {
  min-width: 0;
  color: var(--dsh-sc-tone, var(--dsw-alias-label-primary));
  overflow-wrap: anywhere;
}
.dsh-sc-tree-note { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-tree-badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.7;
}
/* Heatmap: a grid of intensity cells plus a less/more scale. */
.dsh-sc-heatmap {
  display: grid;
  grid-template-columns: repeat(var(--dsh-sc-heat-cols, 14), minmax(0, 1fr));
  gap: 3px;
}
.dsh-sc-heat-cell {
  aspect-ratio: 1;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
}
.dsh-sc-heat-cell[data-level='1'] {
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-primary)) 15%, transparent);
}
.dsh-sc-heat-cell[data-level='2'] {
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-primary)) 33%, transparent);
}
.dsh-sc-heat-cell[data-level='3'] {
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-primary)) 56%, transparent);
}
.dsh-sc-heat-cell[data-level='4'] {
  background: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-label-primary)) 82%, transparent);
}
/* One foot line: what the run covers on the left, the color key on the right,
   so neither end of the chart row is wasted. */
.dsh-sc-heatmap-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}
.dsh-sc-heatmap-range {
  min-width: 0;
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-heatmap-legend {
  display: flex;
  align-items: center;
  flex: none;
  justify-content: flex-end;
  gap: 3px;
}
.dsh-sc-heatmap-legend .dsh-sc-heat-cell { width: 10px; flex: none; }
.dsh-sc-heatmap-scale-label {
  margin: 0 3px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary);
}
/* Diff: a patch view with added/removed line tints. */
.dsh-sc-diff-block {
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-radius: 12px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-sc-diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-diff-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
.dsh-sc-diff-stat { flex: none; display: flex; gap: 8px; font-variant-numeric: tabular-nums; }
.dsh-sc-diff-stat-add { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-diff-stat-del { color: var(--dsw-alias-state-error-primary); }
.dsh-sc-diff {
  margin: 0;
  padding: 6px 0;
  max-height: 320px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
}
.dsh-sc-diff-line { display: flex; padding: 0 12px; }
.dsh-sc-diff-line[data-kind='add'] {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent);
}
.dsh-sc-diff-line[data-kind='del'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}
.dsh-sc-diff-sign {
  flex: none;
  width: 12px;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
}
.dsh-sc-diff-line[data-kind='add'] .dsh-sc-diff-sign { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-diff-line[data-kind='del'] .dsh-sc-diff-sign { color: var(--dsw-alias-state-error-primary); }
.dsh-sc-diff-text { white-space: pre; }
/* Kanban: columns scroll horizontally on a narrow card. */
.dsh-sc-kanban { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 2px; }
.dsh-sc-kanban-col {
  flex: 1 0 190px;
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-top: 2px solid var(--dsh-sc-tone, color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent));
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 2%, var(--dsw-alias-bg-layer-1));
}
/* A 190px-minimum column cannot share a narrow card: the board scrolls out of
   sight instead of reading. Under 600px the lanes stack, one per row. */
@container (max-width: 600px) {
  .dsh-sc-kanban { flex-direction: column; overflow-x: visible; }
  .dsh-sc-kanban-col { flex: 0 0 auto; }
}
.dsh-sc-kanban-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 9px;
}
.dsh-sc-kanban-title { min-width: 0; font-size: 12.5px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dsh-sc-kanban-count {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.dsh-sc-kanban-cards { display: flex; flex-direction: column; gap: 8px; }
.dsh-sc-kanban-card {
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-left: 3px solid var(--dsh-sc-tone, color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh-sc-kanban-card-title { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-sc-kanban-card-text { margin-top: 3px; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-sc-kanban-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.dsh-sc-kanban-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 1.7;
}
.dsh-sc-kanban-empty { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
/* Tabs: the shell's SegmentedTabs when it is exported, a matching local row
   otherwise. Either way the pane below is plain block content — no second frame
   around blocks that already draw their own. */
.dsh-sc-tabs-block { display: flex; flex-direction: column; min-width: 0; }
.dsh-sc-tabs-segmented { margin-bottom: 9px; }
.dsh-sc-tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 2px;
  margin-bottom: 9px;
  padding: 2px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sc-tab {
  min-width: 0;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 30px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.dsh-sc-tab:hover { color: var(--dsw-alias-label-primary); }
.dsh-sc-tab--on {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent),
    inset 0 0 0 .5px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
}
.dsh-sc-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sc-tabs-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
/* The host row is a grid of equal segments plus a sliding indicator, which is
   right while every label fits on one line. A narrow card has no room for that:
   the row becomes a wrapping flex line, each tab keeps its label, and the
   selected tab carries the fill itself because the indicator only tracks equal
   segments. The local row follows the same rule. */
@container (max-width: 520px) {
  .dsh-sc-tabs-block > .dsh-sc-tabs-segmented { display: flex; flex-wrap: wrap; gap: 2px; }
  .dsh-sc-tabs-block > .dsh-sc-tabs-segmented > span[aria-hidden='true'] { display: none; }
  .dsh-sc-tabs-block > .dsh-sc-tabs-segmented [role='tab'] {
    flex: 1 1 0;
    min-width: max-content;
    padding: 0 10px;
    line-height: 30px;
    text-align: center;
    white-space: nowrap;
  }
  .dsh-sc-tabs-block > .dsh-sc-tabs-segmented [role='tab'][aria-selected='true'] {
    background: var(--dsw-alias-bg-layer-3);
    box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l3);
  }
  .dsh-sc-tabs { display: flex; flex-wrap: wrap; }
  .dsh-sc-tab { flex: 1 1 0; min-width: max-content; }
}
/* Columns: a row of block groups; the grid auto-fits, so a narrow card folds it
   back to one column without a media query. */
.dsh-sc-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
  gap: 18px;
  align-items: start;
}
/* Asymmetric columns: the weights field sets the fr shares (default equal). */
${COLUMN_RATIO_CSS}
@container (max-width: 560px) {
  .dsh-sc-cols[data-ratio] { grid-template-columns: minmax(0, 1fr); }
}
.dsh-sc-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.dsh-sc-col-label {
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: var(--dsw-alias-label-secondary);
  text-transform: uppercase;
}
/* Inline image: a quiet frame with an optional caption; the frame owns the
   radius and border, so both a plain image and a linked one look identical. */
.dsh-sc-image-block { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.dsh-sc-image-link,
.dsh-sc-image-frame {
  display: block;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sc-image-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-sc-image-media { display: block; width: 100%; max-width: 100%; }
.dsh-sc-image-caption {
  margin: 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-image-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12.5px;
}
.dsh-sc-image-fallback svg { width: 15px; height: 15px; }
/* Links read as tiles, so a list of sources looks like a reference block
   instead of a wall of blue text. */
.dsh-sc-links {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.dsh-sc-link-row {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 2%, var(--dsw-alias-bg-layer-1));
  transition: border-color 140ms ease, background-color 140ms ease;
}
.dsh-sc-link-row:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-link {
  max-width: 100%;
  border-radius: 4px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.dsh-sc-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.dsh-sc-link:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-sc-link-plain { color: var(--dsw-alias-label-primary); }
.dsh-sc-link-desc { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-sc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-sc-action {
  padding: 7px 14px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, transform 90ms ease;
}
.dsh-sc-action:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-action:active { transform: translateY(1px); }
.dsh-sc-action:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsh-sc-action[data-tone="primary"] {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dsh-sc-action[data-tone="primary"]:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-bg-base));
}
.dsh-sc-hint {
  flex: 1 0 100%;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--dsw-alias-state-success-primary);
  animation: dsh-sc-hint-fade 3.2s ease-out both;
}
.dsh-sc-hint[data-ok="0"] { color: var(--dsw-alias-state-warn-primary); }
@keyframes dsh-sc-hint-fade {
  0% { opacity: 0; }
  6% { opacity: 1; }
  82% { opacity: 1; }
  100% { opacity: 0; }
}
.dsh-sc-card--skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
}
.dsh-sc-sk-line {
  position: relative;
  display: block;
  height: 10px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}
.dsh-sc-sk-title { height: 14px; width: 42%; }
.dsh-sc-sk-short { width: 64%; }
.dsh-sc-sk-line::after {
  content: "";
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, var(--dsw-alias-border-l2), transparent);
  animation: dsh-sc-shimmer 1.5s ease-in-out infinite;
}
@keyframes dsh-sc-shimmer {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
.dsh-sc-card--notice {
  border-color: var(--dsw-alias-border-l1);
  border-color: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-state-error-primary)) 35%, var(--dsw-alias-border-l1));
}
.dsh-sc-notice-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsh-sc-tone, var(--dsw-alias-state-error-primary));
}
.dsh-sc-notice-icon { flex: none; display: inline-flex; width: 16px; height: 16px; }
.dsh-sc-notice-title { font-size: 13px; font-weight: 600; }
.dsh-sc-notice-detail {
  margin-top: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.9;
  overflow-wrap: anywhere;
}
.dsh-sc-notice-text {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-sc-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 520px) {
  .dsh-sc-card { padding: 15px; border-radius: 14px; }
  .dsh-sc-kv[data-cols],
  .dsh-sc-kv[data-layout="rows"] { grid-template-columns: 1fr; }
  .dsh-sc-kv[data-layout="rows"] .dsh-sc-kv-value { margin-bottom: 7px; }
  .dsh-sc-links { grid-template-columns: 1fr; }
  .dsh-sc-pie { grid-template-columns: 104px minmax(0, 1fr); gap: 12px; }
  .dsh-sc-pie-figure { width: 104px; height: 104px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-sc-sk-line::after { animation: none; opacity: 0; }
  .dsh-sc-hint { animation: none; }
  .dsh-sc-status--running .dsh-sc-status-dot,
  .dsh-sc-dock-head[data-status='running'] .dsh-sc-dock-icon { animation: none; }
}
.dsh-sc-tail-card { margin-block: 6px 2px; }
/* Next-step cards (the tail placement): a stack of ordinary cards as the Turn's
   coda. They sit above the Turn action row, so they need the row's own rhythm
   and one gap between neighbours rather than none. */
.dsh-sc-tail-card--next {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-block: 8px 4px;
}
.dsh-sc-tail-card--next:empty { display: none; }
/* Card lifecycle states: a tinted surface, an inset accent bar, and a solid
   status chip — a state change must be obvious at a glance, not a hairline. */
.dsh-sc-card {
  transition: background-color 220ms ease, border-color 220ms ease, box-shadow 220ms ease;
}
.dsh-sc-card[data-status='success'] {
  border-color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-bg-layer-1);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, var(--dsw-alias-bg-layer-1));
  box-shadow: inset 3px 0 0 var(--dsw-alias-state-success-primary);
}
.dsh-sc-card[data-status='success'] .dsh-sc-progress-fill { background: var(--dsw-alias-state-success-primary); }
.dsh-sc-card[data-status='success'] .dsh-sc-status {
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-bg-base);
}
.dsh-sc-status {
  gap: 5px;
  padding: 2px 8px 2px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  font-weight: 600;
}
.dsh-sc-status--running { color: var(--dsw-alias-brand-primary); }
.dsh-sc-status--success { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-status--warn { color: var(--dsw-alias-state-warn-primary); }
.dsh-sc-status--error { color: var(--dsw-alias-state-error-primary); }
.dsh-sc-status--success .dsh-sc-status-dot,
.dsh-sc-status--success .dsh-sc-status-glyph { display: none; }
.dsh-sc-status--warn .dsh-sc-status-dot,
.dsh-sc-status--error .dsh-sc-status-dot { background: currentColor; }
.dsh-sc-status--warn .dsh-sc-status-glyph,
.dsh-sc-status--error .dsh-sc-status-glyph { color: inherit; }
.dsh-sc-status-glyph { display: inline-flex; }
.dsh-sc-status-glyph svg { width: 11px; height: 11px; }
.dsh-sc-progress-check { display: inline-flex; margin-left: 4px; vertical-align: -1px; color: var(--dsw-alias-state-success-primary); }
.dsh-sc-progress-check svg { width: 12px; height: 12px; }
/* Card header corner actions: copy + close, pinned to the top-right corner so
   they read like window controls and never shift the title baseline. */
.dsh-sc-head--actions { padding-right: 62px; }
/* The actions-only header: no rule, no padding, no bottom margin — just the
   vertical band the floating corner buttons occupy, so a title-less card
   (a next-step card, a plain table) reads as one continuous surface. */
/* The compact look re-adds header padding; the second selector wins by order
   and keeps a title-less card rule-free in every look. */
.dsh-sc-head--float,
.dsh-sc-card--compact .dsh-sc-head--float {
  min-height: 22px;
  margin: 0;
  padding: 0;
  border-bottom: 0;
}
.dsh-sc-head-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 1;
}
.dsh-sc-head-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  opacity: 0.66;
  transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
}
.dsh-sc-card:hover .dsh-sc-head-action { opacity: 1; }
.dsh-sc-head-action:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-sc-head-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; opacity: 1; }
.dsh-sc-head-action--done,
.dsh-sc-head-action--done:hover { color: var(--dsw-alias-state-success-primary); opacity: 1; }
.dsh-sc-head-action svg { width: 14px; height: 14px; }
/* Close affordance on a card header. */
.dsh-sc-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: -2px -4px -2px 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-sc-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-sc-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sc-head-actions .dsh-sc-close { width: 24px; height: 24px; margin: 0; }
/* A dismissed card rests as one muted line; clicking it reopens. */
.dsh-sc-card--closed {
  padding: 7px 12px;
  border-style: dashed;
  background: var(--dsw-alias-bg-layer-1);
  opacity: 0.92;
}
.dsh-sc-line-icon--muted { color: var(--dsw-alias-label-secondary); }
.dsh-sc-line-meta--muted {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
/* Dock header: toggle button plus its own close button. */
.dsh-sc-dock-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 5px 4px 5px 10px;
  border: 0;
  border-radius: 10px 0 0 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
}
.dsh-sc-dock-toggle:focus-visible,
.dsh-sc-dock-close:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dsh-sc-dock-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  margin-right: 3px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-sc-dock-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-sc-dock-head--closed {
  padding: 5px 10px;
  border-style: dashed;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-sc-dock-icon--muted { color: var(--dsw-alias-label-secondary); }
/* Interactive controls: bound setting segments and action buttons. */
.dsh-sc-controls { display: flex; flex-direction: column; gap: 8px; }
.dsh-sc-controls-title { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-sc-control { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-sc-control-label { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
/* A settings row is not a tab set, so it keeps a plain group of pressed
   toggles rather than the host SegmentedControl's tab/tabpanel pair. It borrows
   that control's geometry instead — the tinted tray, the raised indicator, the
   same metrics — so a card and the settings page read as one product. */
.dsh-sc-segments {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent));
}
.dsh-sc-segment {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease;
}
.dsh-sc-segment:hover { color: var(--dsw-alias-label-primary); }
.dsh-sc-segment--on {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: var(--dsw-elevation-soft, 0 0 0 .5px var(--dsw-alias-border-l2));
}
.dsh-sc-control-button {
  align-self: flex-start;
  padding: 5px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  cursor: pointer;
}
.dsh-sc-control-button:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-sc-segment:focus-visible,
.dsh-sc-control-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sc-controls-feedback { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-controls-feedback[data-ok='1'] { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-controls-feedback[data-ok='0'] { color: var(--dsw-alias-state-error-primary); }
/* Configuration forms: the Plugins page card and the Settings tab. */
.dsh-sc-config { display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
.dsh-sc-config-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-sc-config-intro { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-config-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 10px;
}
.dsh-sc-config-label { color: var(--dsw-alias-label-secondary); line-height: 1.45; }
.dsh-sc-config-control { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsh-sc-config-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12.5px;
}
.dsh-sc-config-check { accent-color: var(--dsw-alias-brand-primary); }
.dsh-sc-config-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-config-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
.dsh-sc-config-button {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  cursor: pointer;
}
.dsh-sc-config-button[data-variant='primary'] {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-layer-1);
  font-weight: 600;
}
.dsh-sc-config-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-sc-config-button[data-variant='primary']:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.9; }
.dsh-sc-config-button:disabled { cursor: default; opacity: 0.55; }
.dsh-sc-config-button:focus-visible,
.dsh-sc-config-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-sc-config-status { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-config-status[data-ok='1'] { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-config-status[data-ok='0'] { color: var(--dsw-alias-state-error-primary); }
.dsh-sc-config-muted { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-config-summary { font-size: 12.5px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
/* Completed cards with several items fold to one checked line. */
.dsh-sc-card--line { padding: 8px 12px; }
.dsh-sc-line-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-sc-line-head:focus-visible {
  outline: 2px solid var(--dsw-alias-state-success-primary);
  outline-offset: 2px;
  border-radius: 6px;
}
.dsh-sc-line-icon { display: inline-flex; flex: none; color: var(--dsw-alias-state-success-primary); }
.dsh-sc-line-title {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-line-meta {
  flex: none;
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-bg-base);
  font-size: 12px;
  font-weight: 600;
}
.dsh-sc-line-chevron { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-sc-card--line .dsh-sc-blocks { margin-top: 10px; }
.dsh-sc-card[data-status='warn'] { border-color: var(--dsw-alias-state-warn-primary); }
.dsh-sc-card[data-status='error'] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-sc-status,
.dsh-sc-status-label { display: inline-flex; align-items: center; }
.dsh-sc-status {
  gap: 5px;
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-status-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-sc-status-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--dsw-alias-label-secondary);
}
.dsh-sc-status--running .dsh-sc-status-dot {
  background: var(--dsw-alias-brand-primary);
}
.dsh-sc-status--success .dsh-sc-status-dot { background: var(--dsw-alias-state-success-primary); }
.dsh-sc-status--warn .dsh-sc-status-dot { background: var(--dsw-alias-state-warn-primary); }
.dsh-sc-status--error .dsh-sc-status-dot { background: var(--dsw-alias-state-error-primary); }
/* Persistent dock board: same width as the composer card, centered, and
   deliberately small. The header is always one compact line; the body is
   collapsed by default on demand and capped so it never pushes the composer. */
.dsh-sc-dock {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  max-width: var(--dsh-composer-card-max-width, 760px);
  margin-block: 4px;
  margin-inline: auto;
}
.dsh-sc-dock-head {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
}
.dsh-sc-dock-head:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsh-sc-dock-icon { display: inline-flex; flex: none; color: var(--dsw-alias-brand-primary); }
.dsh-sc-dock-head[data-status='success'] {
  border-color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-bg-layer-1);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, var(--dsw-alias-bg-layer-1));
  box-shadow: inset 3px 0 0 var(--dsw-alias-state-success-primary);
}
.dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-meta {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-bg-base);
  font-weight: 600;
}
.dsh-sc-dock-head[data-status='warn'] {
  background: var(--dsw-alias-bg-layer-1);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-dock-head[data-status='error'] {
  background: var(--dsw-alias-bg-layer-1);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, var(--dsw-alias-bg-layer-1));
}
.dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-icon { color: var(--dsw-alias-state-success-primary); }
.dsh-sc-dock-head[data-status='warn'] { border-color: var(--dsw-alias-state-warn-primary); }
.dsh-sc-dock-head[data-status='warn'] .dsh-sc-dock-icon { color: var(--dsw-alias-state-warn-primary); }
.dsh-sc-dock-head[data-status='error'] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-sc-dock-head[data-status='error'] .dsh-sc-dock-icon { color: var(--dsw-alias-state-error-primary); }
.dsh-sc-dock-title {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-dock-meta { margin-left: auto; flex: none; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-dock-chevron { display: inline-flex; flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-sc-dock-body {
  width: 100%;
  max-height: 32vh;
  margin-top: 4px;
  overflow-y: auto;
}
/* The board body is compact: no card header, tighter rhythm. */
.dsh-sc-card--dock {
  margin-block: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
}
.dsh-sc-card--dock .dsh-sc-blocks { gap: 8px; }
/* Blocks flow on a 12-column grid: compact blocks share a row when the card
   has the width, long-form blocks always take the full row. */
.dsh-sc-blocks {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.dsh-sc-blocks > * { grid-column: 1 / -1; min-width: 0; }
.dsh-sc-blocks > .dsh-sc-live { grid-column: span 6; }
.dsh-sc-blocks > .dsh-sc-live[data-field='last-message'] { grid-column: 1 / -1; }
@media (max-width: 560px) {
  .dsh-sc-blocks > .dsh-sc-live { grid-column: 1 / -1; }
}
/* Live block: counters and a short feed of later messages. */
.dsh-sc-live {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-sc-live-head { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-live-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dsh-sc-live-feed { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dsh-sc-live-line { display: flex; gap: 6px; min-width: 0; font-size: 12.5px; }
.dsh-sc-live-role { flex: none; color: var(--dsw-alias-label-secondary); }
.dsh-sc-live-text {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-live-empty { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
/* A block type without a renderer: visible, fixable, never silently dropped. */
.dsh-sc-unsupported {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 11px;
  border: 1px dashed var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.dsh-sc-unsupported-icon { display: inline-flex; flex: none; margin-top: 1px; color: var(--dsw-alias-state-warn-primary); }
.dsh-sc-unsupported-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-sc-unsupported-title { margin: 0; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
.dsh-sc-unsupported-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
/* Diagram block: pure SVG, theme tokens only, responsive viewBox. */
.dsh-sc-diagram { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dsh-sc-diagram-title { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-sc-diagram-viewport { max-height: 520px; overflow: auto; border-radius: 8px; }
.dsh-sc-diagram-svg {
  display: block;
  max-width: none;
  height: auto;
  margin-inline: auto;
  font-family: inherit;
}
.dsh-sc-diagram-shape {
  fill: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-border-l1)) 12%, var(--dsw-alias-bg-layer-2));
  stroke: var(--dsh-sc-tone, var(--dsw-alias-border-l1));
  stroke-width: 1.2;
}
.dsh-sc-diagram-node[data-shape='note'] .dsh-sc-diagram-shape,
.dsh-sc-diagram-node[data-shape='diamond'] .dsh-sc-diagram-shape { fill: var(--dsw-alias-bg-layer-2); }
.dsh-sc-diagram-label { fill: var(--dsw-alias-label-primary); font-size: 12.5px; }
.dsh-sc-diagram-detail { fill: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dsh-sc-diagram-edge { fill: none; stroke: var(--dsw-alias-label-secondary); stroke-width: 1.2; }
.dsh-sc-diagram-edge--dashed { stroke-dasharray: 5 4; }
.dsh-sc-diagram-arrow { fill: var(--dsw-alias-label-secondary); stroke: none; }
.dsh-sc-diagram-edge-label { fill: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dsh-sc-diagram-edge-label-bg { fill: var(--dsw-alias-bg-layer-1); stroke: none; }
.dsh-sc-diagram-lifeline { stroke: var(--dsw-alias-border-l1); stroke-width: 1; stroke-dasharray: 4 4; }
.dsh-sc-diagram-participant .dsh-sc-diagram-shape,
.dsh-sc-diagram-entity .dsh-sc-diagram-shape {
  fill: color-mix(in srgb, var(--dsh-sc-tone, var(--dsw-alias-border-l1)) 10%, var(--dsw-alias-bg-layer-2));
}
.dsh-sc-diagram-message-arrow { fill: none; stroke: var(--dsw-alias-label-secondary); stroke-width: 1.2; }
.dsh-sc-diagram-separator { stroke: var(--dsw-alias-border-l1); stroke-width: 1; }
.dsh-sc-diagram-relation { fill: none; stroke: var(--dsw-alias-label-secondary); stroke-width: 1.2; }
.dsh-sc-diagram-entity-title { font-size: 13px; font-weight: 600; }
.dsh-sc-diagram-entity-field, .dsh-sc-diagram-entity-method { font-size: 11.5px; }
/* Cards auto-converted from fenced mermaid blocks beside the visible source. */
.dsh-sc-auto { display: flex; flex-direction: column; gap: 10px; margin-block: 6px; }
.dsh-sc-auto > * { min-width: 0; }
/* Chart / source toggle for a diagram block. */
.dsh-sc-diagram-bar { display: flex; justify-content: flex-end; }
.dsh-sc-diagram-toggle {
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
}
.dsh-sc-diagram-toggle:hover { color: var(--dsw-alias-label-primary); }
.dsh-sc-diagram-toggle[aria-pressed='true'] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsh-sc-diagram-source {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow-wrap: normal;
}
/* Sandboxed HTML card: the agent's own document in an isolated frame. */
.dsh-sc-html { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.dsh-sc-html-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.dsh-sc-html-title {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-sc-html-toggle {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 1.4;
  cursor: pointer;
}
.dsh-sc-html-toggle:hover { color: var(--dsw-alias-label-primary); }
.dsh-sc-html-toggle[aria-pressed='true'] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsh-sc-html-frame {
  display: block;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
  color-scheme: light dark;
}
.dsh-sc-html-source {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  overflow-wrap: normal;
}
.dsh-sc-html-caption { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
/* Motion: one arrival, then only what changed moves.
   A card fades and lifts in once — React keeps the node across updates, so a
   later status change never replays the entrance — and its blocks follow in
   reading order. After that, motion is limited to the parts that carry new
   information: a progress fill, a status chip, a chevron, a swapped diagram
   view. Everything animates transform/opacity or a theme-token color, so no
   frame triggers layout, and the reduced-motion block at the end of this sheet
   removes the lot. */
@keyframes dsh-sc-card-in {
  from { opacity: 0; transform: translateY(6px) scale(.995); }
  to { opacity: 1; transform: none; }
}
@keyframes dsh-sc-block-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes dsh-sc-view-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
@keyframes dsh-sc-fold-in {
  from { opacity: .45; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
}
@keyframes dsh-sc-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.09); }
  100% { transform: scale(1); }
}
@keyframes dsh-sc-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}
@keyframes dsh-sc-ring {
  0% { opacity: .7; transform: scale(.6); }
  70%, 100% { opacity: 0; transform: scale(2.1); }
}
@keyframes dsh-sc-grow-x {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.dsh-sc-card {
  animation: dsh-sc-card-in 240ms cubic-bezier(.22,.78,.28,1) both;
}
/* A card that folds to its completed line keeps the same DOM node, so the
   change of shape gets its own animation name: adding the line modifier
   restarts it, which reads as the card settling into one checked line. */
.dsh-sc-card.dsh-sc-card--line {
  animation: dsh-sc-fold-in 220ms cubic-bezier(.22,.78,.28,1) both;
}
.dsh-sc-blocks > * {
  animation: dsh-sc-block-in 200ms cubic-bezier(.22,.78,.28,1) both;
}
/* A short stagger, capped at eight blocks: enough to read as a sequence,
   short enough that a card is legible within a quarter second. */
.dsh-sc-blocks > :nth-child(2) { animation-delay: 24ms; }
.dsh-sc-blocks > :nth-child(3) { animation-delay: 48ms; }
.dsh-sc-blocks > :nth-child(4) { animation-delay: 72ms; }
.dsh-sc-blocks > :nth-child(5) { animation-delay: 96ms; }
.dsh-sc-blocks > :nth-child(6) { animation-delay: 120ms; }
.dsh-sc-blocks > :nth-child(7) { animation-delay: 144ms; }
.dsh-sc-blocks > :nth-child(8) { animation-delay: 168ms; }
/* The dock board rises into place with the composer; its body reveals when
   the reader opens it, and the card under it fades in separately. */
.dsh-sc-dock {
  animation: dsh-sc-card-in 260ms cubic-bezier(.22,.78,.28,1) both;
}
.dsh-sc-dock-body {
  animation: dsh-sc-view-in 200ms cubic-bezier(.22,.78,.28,1) both;
}
/* The header node is replaced when the board is dismissed or reopened, so the
   closing line and the restored header both fade instead of snapping. */
.dsh-sc-dock-head {
  animation: dsh-sc-view-in 180ms ease-out both;
}
.dsh-sc-dock-toggle { transition: background-color 140ms ease; }
/* State changes cross-fade instead of snapping: the success tint, its chip,
   and the dock header all interpolate through theme tokens. */
.dsh-sc-status,
.dsh-sc-dock-head,
.dsh-sc-dock-meta,
.dsh-sc-line-meta {
  transition: background-color 220ms ease, border-color 220ms ease, color 220ms ease, box-shadow 220ms ease;
}
.dsh-sc-card[data-status='success'] .dsh-sc-status,
.dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-meta,
.dsh-sc-card[data-status='warn'] .dsh-sc-status,
.dsh-sc-card[data-status='error'] .dsh-sc-status {
  animation: dsh-sc-pop 320ms cubic-bezier(.34,1.4,.64,1) both;
}
/* A running chip breathes; the dot also emits one slow expanding ring, which
   reads as "still working" without the flicker of an opacity blink. */
.dsh-sc-status-dot { position: relative; }
.dsh-sc-status--running .dsh-sc-status-dot {
  animation: dsh-sc-breathe 2.2s ease-in-out infinite;
}
.dsh-sc-status--running .dsh-sc-status-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border: 1px solid currentColor;
  border-radius: inherit;
  color: var(--dsw-alias-brand-primary);
  animation: dsh-sc-ring 1.8s cubic-bezier(.3,.6,.4,1) infinite;
}
.dsh-sc-dock-head[data-status='running'] .dsh-sc-dock-icon {
  animation: dsh-sc-breathe 2.2s ease-in-out infinite;
}
/* The board swaps its sparkle for a check when it finishes: pop the new glyph
   so the change is noticed above the composer. */
.dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-icon svg {
  animation: dsh-sc-pop 320ms cubic-bezier(.34,1.4,.64,1) both;
}
/* Values that change while the card is on screen animate on the property that
   changed: a progress bar grows into its new width, a finished row pops its
   check, a bar chart draws itself once. */
.dsh-sc-progress-fill {
  transition: width 460ms cubic-bezier(.22,.78,.28,1), background-color 240ms ease;
}
.dsh-sc-progress-check {
  transform-origin: center;
  animation: dsh-sc-pop 300ms cubic-bezier(.34,1.4,.64,1) both;
}
.dsh-sc-bar-fill {
  transform-box: fill-box;
  transform-origin: left center;
  animation: dsh-sc-grow-x 480ms cubic-bezier(.22,.78,.28,1) both;
}
.dsh-sc-spark-svg { animation: dsh-sc-view-in 260ms ease-out both; }
.dsh-sc-line-icon svg { animation: dsh-sc-pop 320ms cubic-bezier(.34,1.4,.64,1) both; }
/* A swapped diagram view fades; the chevron turns instead of flipping paths. */
.dsh-sc-diagram-svg,
.dsh-sc-diagram-source { animation: dsh-sc-view-in 200ms ease-out both; }
.dsh-sc-line-chevron svg,
.dsh-sc-dock-chevron svg {
  transition: transform 200ms cubic-bezier(.22,.78,.28,1), color 140ms ease;
}
.dsh-sc-line-head:hover .dsh-sc-line-chevron { color: var(--dsw-alias-label-primary); }
/* Pressable things answer back: a 90ms colour transition and a small press. */
.dsh-sc-action,
.dsh-sc-segment,
.dsh-sc-control-button,
.dsh-sc-diagram-toggle,
.dsh-sc-code-toggle,
.dsh-sc-close,
.dsh-sc-dock-close {
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 90ms ease;
}
.dsh-sc-action:active,
.dsh-sc-segment:active,
.dsh-sc-control-button:active,
.dsh-sc-diagram-toggle:active,
.dsh-sc-code-toggle:active,
.dsh-sc-close:active,
.dsh-sc-dock-close:active { transform: scale(.96); }
.dsh-sc-tr { transition: background-color 140ms ease; }
@media (hover: hover) {
  .dsh-sc-tr:hover .dsh-sc-td { background: var(--dsw-alias-bg-layer-2); }
}
/* Agent motion: the model names one preset per block; this sheet owns the
   keyframes. The envelope is a grid child like any other block, so layout does
   not change; effects that need a part of the block (a fill, a line) target the
   matching descendant, and an effect a block cannot use animates nothing. */
.dsh-sc-motion-wrap { min-width: 0; }
.dsh-sc-motion-wrap--live { grid-column: span 6; }
@media (max-width: 560px) {
  .dsh-sc-motion-wrap--live { grid-column: 1 / -1; }
}
/* Effects that move the block as a whole. They take over the envelope's own
   animation, so every one of them must name its own duration/delay/count. */
.dsh-sc-motion--flash,
.dsh-sc-motion--reveal,
.dsh-sc-motion--bounce,
.dsh-sc-motion--shake {
  animation-duration: var(--dsh-sc-motion-duration, 1000ms);
  animation-delay: var(--dsh-sc-motion-delay, 0ms);
  animation-iteration-count: var(--dsh-sc-motion-iterations, 1);
  animation-fill-mode: both;
  animation-timing-function: ease-in-out;
}
.dsh-sc-motion--flash {
  border-radius: 14px;
  outline: 2px solid transparent;
  outline-offset: 3px;
  animation-name: dsh-sc-motion-flash;
}
.dsh-sc-motion--reveal {
  animation-name: dsh-sc-motion-reveal;
  animation-timing-function: cubic-bezier(.22,.78,.28,1);
}
.dsh-sc-motion--bounce { animation-name: dsh-sc-motion-bounce; }
.dsh-sc-motion--shake { animation-name: dsh-sc-motion-shake; }
@keyframes dsh-sc-motion-flash {
  0%, 100% { outline-color: transparent; }
  18%, 42% { outline-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent); }
}
@keyframes dsh-sc-motion-reveal {
  from { clip-path: inset(0 100% 0 0); }
  /* Slightly outside the box at the end: an exact 0 inset would clip shadows
     and focus rings for the rest of the card's life. */
  to { clip-path: inset(-32px); }
}
@keyframes dsh-sc-motion-bounce {
  0%, 100% { transform: translateY(0); }
  28% { transform: translateY(-5px); }
  52% { transform: translateY(0); }
  74% { transform: translateY(-2px); }
}
@keyframes dsh-sc-motion-shake {
  0%, 100% { transform: translateX(0); }
  14% { transform: translateX(-3px); }
  28% { transform: translateX(3px); }
  42% { transform: translateX(-2px); }
  56% { transform: translateX(2px); }
  70% { transform: translateX(-1px); }
}
/* Effects that move the block's content. A block's direct children are its
   items, so the child selector is the generic case; a stats grid is one child,
   so its cards pulse instead of the whole grid. */
.dsh-sc-motion--pulse > * {
  animation: dsh-sc-motion-pulse var(--dsh-sc-motion-duration, 1000ms) ease-in-out var(--dsh-sc-motion-delay, 0ms) var(--dsh-sc-motion-iterations, 1) both;
}
.dsh-sc-motion--pulse[data-block='stats'] > * { animation: none; }
.dsh-sc-motion--pulse[data-block='stats'] .dsh-sc-stat {
  animation: dsh-sc-motion-pulse var(--dsh-sc-motion-duration, 1000ms) ease-in-out var(--dsh-sc-motion-delay, 0ms) var(--dsh-sc-motion-iterations, 1) both;
}
.dsh-sc-motion--pulse[data-block='stats'] .dsh-sc-stat:nth-child(3n + 2) { animation-delay: calc(var(--dsh-sc-motion-delay, 0ms) + 90ms); }
.dsh-sc-motion--pulse[data-block='stats'] .dsh-sc-stat:nth-child(3n) { animation-delay: calc(var(--dsh-sc-motion-delay, 0ms) + 180ms); }
@keyframes dsh-sc-motion-pulse {
  0%, 100% { transform: scale(1); }
  45% { transform: scale(1.035); }
}
.dsh-sc-motion--sweep .dsh-sc-progress-fill,
.dsh-sc-motion--sweep .dsh-sc-bar-fill {
  transform-origin: left center;
  animation: dsh-sc-motion-sweep var(--dsh-sc-motion-duration, 1000ms) cubic-bezier(.22,.78,.28,1) var(--dsh-sc-motion-delay, 0ms) var(--dsh-sc-motion-iterations, 1) both;
}
@keyframes dsh-sc-motion-sweep {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
/* Lines are normalized with pathLength=100 in the renderers, so one keyframe
   draws any edge and 6/4 dashes stay dashes on any path. */
.dsh-sc-motion--draw .dsh-sc-diagram-edge,
.dsh-sc-motion--draw .dsh-sc-diagram-relation,
.dsh-sc-motion--draw .dsh-sc-diagram-message-arrow,
.dsh-sc-motion--draw .dsh-sc-spark-line {
  stroke-dasharray: 100;
  animation: dsh-sc-motion-draw var(--dsh-sc-motion-duration, 1000ms) linear var(--dsh-sc-motion-delay, 0ms) var(--dsh-sc-motion-iterations, 1) both;
}
@keyframes dsh-sc-motion-draw {
  from { stroke-dashoffset: 100; }
  to { stroke-dashoffset: 0; }
}
.dsh-sc-motion--flow .dsh-sc-diagram-edge,
.dsh-sc-motion--flow .dsh-sc-diagram-relation,
.dsh-sc-motion--flow .dsh-sc-diagram-message-arrow {
  /* No fill mode: without loop the edges must return to the style they were
     authored with (a solid edge means "sync", a dashed one has meaning here).
     The dash pattern therefore lives in the keyframes, not in this rule. */
  animation: dsh-sc-motion-flow var(--dsh-sc-motion-duration, 1000ms) linear var(--dsh-sc-motion-delay, 0ms) var(--dsh-sc-motion-iterations, 1);
}
@keyframes dsh-sc-motion-flow {
  from { stroke-dasharray: 6 4; stroke-dashoffset: 0; }
  to { stroke-dasharray: 6 4; stroke-dashoffset: -20; }
}
/* Keep this block last: it has to out-order every animation declared above,
   including the ones inherited from the earlier reduced-motion block. */
@media (prefers-reduced-motion: reduce) {
  .dsh-sc-card,
  .dsh-sc-dock,
  .dsh-sc-blocks > *,
  .dsh-sc-dock-body,
  .dsh-sc-dock-head,
  .dsh-sc-line-icon svg,
  .dsh-sc-spark-svg,
  .dsh-sc-bar-fill,
  .dsh-sc-progress-check,
  .dsh-sc-diagram-svg,
  .dsh-sc-diagram-source,
  .dsh-sc-card[data-status='success'] .dsh-sc-status,
  .dsh-sc-card[data-status='warn'] .dsh-sc-status,
  .dsh-sc-card[data-status='error'] .dsh-sc-status,
  .dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-meta,
  .dsh-sc-status--running .dsh-sc-status-dot,
  .dsh-sc-status--running .dsh-sc-status-dot::after,
  .dsh-sc-dock-head[data-status='running'] .dsh-sc-dock-icon,
  .dsh-sc-dock-head[data-status='success'] .dsh-sc-dock-icon svg,
  .dsh-sc-sk-line::after { animation: none !important; }

  /* Agent motion is decoration: with reduced motion the card renders still. */
  .dsh-sc-motion-wrap,
  .dsh-sc-motion-wrap * { animation: none !important; }

  .dsh-sc-card,
  .dsh-sc-dock-head,
  .dsh-sc-dock-meta,
  .dsh-sc-dock-toggle,
  .dsh-sc-status,
  .dsh-sc-line-meta,
  .dsh-sc-line-head,
  .dsh-sc-progress-fill,
  .dsh-sc-tr,
  .dsh-sc-line-chevron svg,
  .dsh-sc-dock-chevron svg,
  .dsh-sc-action,
  .dsh-sc-segment,
  .dsh-sc-control-button,
  .dsh-sc-diagram-toggle,
  .dsh-sc-code-toggle,
  .dsh-sc-tab,
  .dsh-sc-head-action,
  .dsh-sc-close,
  .dsh-sc-dock-close { transition: none !important; }

  .dsh-sc-action:active,
  .dsh-sc-segment:active,
  .dsh-sc-control-button:active,
  .dsh-sc-diagram-toggle:active,
  .dsh-sc-code-toggle:active,
  .dsh-sc-close:active,
  .dsh-sc-dock-close:active { transform: none !important; }
}
`

    /** Elements with a decorative glyph; `aria-hidden` stays on the svg itself. */
    const ICON_GLYPHS = {
      sparkle: { paths: ['M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4z'] },
      chart: { paths: ['M3 13V8', 'M8 13V4', 'M13 13V6'] },
      check: { paths: ['M3.5 8.5l3 3 6-7'] },
      info: { paths: ['M8 7v6'], dots: [[8, 4.4, 0.9]] },
      warning: { paths: ['M8 2.6l6 10.9H2z', 'M8 6.6v3.4'], dots: [[8, 12.2, 0.9]] },
      table: { paths: ['M2.5 3.5h11v9h-11z', 'M2.5 7h11', 'M7 3.5v9'] },
      code: { paths: ['M6 4L2.5 8 6 12', 'M10 4l3.5 4-3.5 4'] },
      list: { paths: ['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'] },
    }

    /** Accent token per tone (used for text/borders/dots). */
    const TONE_ACCENT = {
      neutral: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      info: 'var(--dsw-alias-brand-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const WARNED = new Set()

    /**
     * @param {unknown} value
     * @returns {number | null} a finite number, or null.
     */
    function finiteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    }

    /** @param {unknown} value @returns {number} clamped to 0..1, non-numbers become 0. */
    function clamp01(value) {
      const number = finiteNumber(value)
      if (number === null) return 0
      return Math.min(1, Math.max(0, number))
    }

    /**
     * Read one string field: non-strings are undefined, text is capped and
     * trimmed at both ends (an empty field reads as '').
     *
     * @param {unknown} value - candidate field.
     * @param {number} [max] - character cap (defaults to MAX_TEXT).
     * @returns {string | undefined}
     */
    function readText(value, max) {
      if (typeof value !== 'string') return undefined
      const limit = typeof max === 'number' && max > 0 ? max : MAX_TEXT
      const sliced = value.length > limit ? value.slice(0, limit) : value
      return sliced.trim()
    }

    /**
     * @param {unknown} value - candidate field.
     * @param {number} [max] - character cap.
     * @returns {string | undefined} the text, or undefined when absent/blank.
     */
    function optionalText(value, max) {
      const text = readText(value, max)
      return text === undefined || text === '' ? undefined : text
    }

    /**
     * Read a scalar (stats value, table cell, key/value value) as display text.
     *
     * @param {unknown} value
     * @returns {string | undefined} finite numbers stringified, strings capped.
     */
    function readScalar(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
      const text = readText(value)
      return text === undefined || text === '' ? undefined : text
    }

    /**
     * @param {unknown} value @returns {'neutral'|'brand'|'info'|'success'|'warn'|'error'}
     */
    function normalizeTone(value) {
      return typeof value === 'string' && TONE_NAMES.indexOf(value) !== -1 ? value : 'neutral'
    }

    /**
     * @param {unknown} value @returns {number} display-friendly number text
     */
    function formatNumber(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      if (Number.isInteger(value)) return String(value)
      return String(Math.round(value * 100) / 100)
    }

    /** @param {unknown} error @returns {string} one-line description */
    function describeError(error) {
      if (error && typeof error === 'object' && typeof error.message === 'string') return error.message
      return String(error)
    }

    /**
     * Report one installation problem once per page, without throwing.
     *
     * @param {string} key - deduplication key.
     * @param {string} message - already-formatted message.
     */
    function warnOnce(key, message) {
      if (WARNED.has(key)) return
      WARNED.add(key)
      if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(message)
    }

    /**
     * Fill `{name}` placeholders in a localized template.
     *
     * @param {string} text
     * @param {Record<string, unknown> | undefined} vars
     * @returns {string}
     */
    function interpolate(text, vars) {
      if (typeof text !== 'string' || !vars) return text
      return text.replace(/\{(\w+)\}/gu, (match, name) =>
        vars[name] === undefined ? match : String(vars[name]),
      )
    }

    /**
     * Resolve a translator through the Client locale service, with a local
     * dictionary fallback so a missing locale never removes the plugin's copy.
     *
     * @param {any} ctx - Client plugin context.
     * @returns {(key: string, vars?: Record<string, unknown>) => string}
     */
    function makeTranslator(ctx) {
      const dictionaries = { zh, en }
      let locale
      try {
        locale = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      } catch {
        locale = undefined
      }
      let bound = null
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        try {
          ctx.effect(() => locale.register(NS, dictionaries), NS + '.locale')
          bound = locale.bind(NS)
        } catch {
          bound = null
        }
      }
      return (key, vars) => {
        let text
        if (bound) {
          try {
            text = bound(key, vars)
          } catch {
            text = undefined
          }
        }
        if (typeof text !== 'string' || text === key) {
          const snapshot = locale && typeof locale.getLocale === 'function' ? locale.getLocale() : null
          const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
          const table = active.indexOf('zh') === 0 ? zh : en
          text = table[key] ?? en[key] ?? key
        }
        return interpolate(text, vars)
      }
    }

    /** Translator used only when the slot did not hand one down (miswired assembly). */
    function fallbackT(key, vars) {
      return interpolate(en[key] !== undefined ? en[key] : key, vars)
    }

    /**
     * @param {any} props @returns {(key: string, vars?: Record<string, unknown>) => string}
     */
    function resolveT(props) {
      return props && typeof props.t === 'function' ? props.t : fallbackT
    }

    /**
     * Put one tone accent on a block as the `--dsh-sc-tone` custom property.
     *
     * @param {string} token - a `var(--dsw-alias-*)` expression, never a literal color.
     * @returns {Record<string, string>} inline style object.
     */
    function toneStyle(token) {
      return { '--dsh-sc-tone': token }
    }

    /** @param {string} tone @returns {string} accent token for text/border usage. */
    function accentVar(tone) {
      return TONE_ACCENT[normalizeTone(tone)]
    }

    /** @param {string} tone @returns {string} fill token for progress bars. */
    function progressVar(tone) {
      return normalizeTone(tone) === 'neutral' ? 'var(--dsw-alias-brand-primary)' : accentVar(tone)
    }

    /**
     * Strip inline marks for accessible strings (aria-label/aria-valuetext):
     * screen readers should not read `**` or backticks.
     *
     * @param {unknown} text
     * @returns {string}
     */
    function plainInline(text) {
      if (typeof text !== 'string') return ''
      return text
        .replace(/\*\*([\s\S]+?)\*\*/gu, '$1')
        .replace(/`([^`]+)`/gu, '$1')
    }

    /** @param {string} tone @returns {string} fill token for bar charts. */
    function barVar(tone) {
      // A bar chart without a tone uses the brand ink: bars read as a shape,
      // not as a disabled control.
      return normalizeTone(tone) === 'neutral' ? 'var(--dsw-alias-brand-primary)' : accentVar(tone)
    }

    /**
     * Split one line into inline marks: `**bold**` and `` `code` `` only.
     *
     * Text that does not match stays a literal `text` token, so arbitrary
     * strings (including HTML) are always rendered as text by React — there is
     * no HTML injection path. Nested marks are not parsed; unmatched markers
     * stay literal.
     *
     * @param {string} text - one line of text (newlines are split by the caller).
     * @returns {Array<{ kind: 'text' | 'bold' | 'code', text: string }>}
     */
    function parseInline(text) {
      const source = typeof text === 'string' ? text : ''
      if (source === '') return []
      const pattern = /\*\*([\s\S]+?)\*\*|`([^`]+)`/g
      const parts = []
      let index = 0
      let match
      while ((match = pattern.exec(source)) !== null) {
        if (match.index > index) parts.push({ kind: 'text', text: source.slice(index, match.index) })
        if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] })
        else parts.push({ kind: 'code', text: match[2] })
        index = match.index + match[0].length
      }
      if (index < source.length) parts.push({ kind: 'text', text: source.slice(index) })
      return parts
    }

    /**
     * Build React children for one text field: inline marks plus `<br>` for
     * newlines. Plain text is passed as a string child, never as HTML.
     *
     * @param {string} text - normalized (already capped) text.
     * @param {string} keyPrefix - stable prefix for child keys.
     * @returns {Array<any>} React children.
     */
    function richChildren(text, keyPrefix) {
      const source = typeof text === 'string' ? text : ''
      if (source === '') return []
      const children = []
      const lines = source.split('\n')
      lines.forEach((line, lineIndex) => {
        if (lineIndex > 0) children.push(h('br', { key: keyPrefix + '.br' + lineIndex }))
        const parts = parseInline(line)
        parts.forEach((part, partIndex) => {
          const key = keyPrefix + '.' + lineIndex + '.' + partIndex
          if (part.kind === 'bold') children.push(h('strong', { key, className: PREFIX + 'strong' }, part.text))
          else if (part.kind === 'code') children.push(h('code', { key, className: PREFIX + 'inline-code' }, part.text))
          else children.push(part.text)
        })
      })
      return children
    }

    /**
     * Build one decorative header/notice glyph. Always `aria-hidden`: the
     * adjacent text carries the meaning.
     *
     * @param {string} name - one of ICON_NAMES.
     * @returns {any} svg element.
     */
    function iconGlyph(name) {
      const glyph = ICON_GLYPHS[name] || ICON_GLYPHS.sparkle
      const children = glyph.paths.map((d, index) =>
        h('path', {
          key: 'p' + index,
          d,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
      if (glyph.dots) {
        glyph.dots.forEach((dot, index) =>
          children.push(h('circle', { key: 'd' + index, cx: dot[0], cy: dot[1], r: dot[2], fill: 'currentColor' })),
        )
      }
      return h(
        'svg',
        {
          className: PREFIX + 'glyph',
          viewBox: '0 0 16 16',
          width: '16',
          height: '16',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    /**
     * Allow only http(s)/mailto links; anything else renders as plain text.
     *
     * @param {unknown} href
     * @returns {string | null} the trimmed safe href, or null.
     */
    function safeHref(href) {
      if (typeof href !== 'string') return null
      const value = href.trim()
      if (value === '') return null
      // Control characters could smuggle a second scheme past naive checks.
      if (/[\u0000-\u001f\u007f]/u.test(value)) return null
      return /^(?:https?:\/\/|mailto:)/iu.test(value) ? value : null
    }

    /**
     * Join the text of a ToolResultNode `content` array (the tool error text).
     *
     * @param {unknown} content
     * @returns {string} joined text, capped at MAX_TEXT.
     */
    function contentText(content) {
      if (!Array.isArray(content)) return ''
      const pieces = []
      for (const item of content) {
        if (typeof item === 'string') pieces.push(item)
        else if (item && typeof item === 'object' && typeof item.text === 'string') pieces.push(item.text)
        if (pieces.length > 0 && pieces.join('\n').length > MAX_TEXT) break
      }
      return pieces.join('\n').trim().slice(0, MAX_TEXT)
    }

    /**
     * Parse one `argsRaw` JSON string without throwing.
     *
     * @param {unknown} raw
     * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
     */
    function parseSpecJson(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, error: 'empty arguments' }
      try {
        return { ok: true, value: JSON.parse(raw) }
      } catch (error) {
        return { ok: false, error: describeError(error) }
      }
    }

    /**
     * Normalize one item array: cap the count, drop invalid entries, never throw.
     *
     * @template T
     * @param {unknown} source
     * @param {(entry: unknown) => T | null | undefined} mapper
     * @param {number} max
     * @returns {T[]}
     */
    function readItems(source, mapper, max) {
      const items = []
      if (!Array.isArray(source)) return items
      for (const entry of source) {
        if (items.length >= max) break
        let normalized
        try {
          normalized = mapper(entry)
        } catch {
          normalized = null
        }
        if (normalized !== null && normalized !== undefined) items.push(normalized)
      }
      return items
    }

    /**
     * Normalize one spec block, applying the host caps and dropping anything
     * unrecognized or unusable (forward compatibility: never crash).
     *
     * @param {unknown} raw
     * @returns {Record<string, any> | null}
     */
    /**
     * Normalize one `live` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeLiveBlock(raw) {
      return normalizeLive(raw)
    }

    /**
     * Normalize one `controls` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeControlsBlock(raw) {
      return normalizeControls(raw)
    }

    /**
     * Normalize one `text` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeTextBlock(raw) {
      const text = readText(raw.text)
      if (!text) return null
      return { type: 'text', text, muted: raw.muted === true }
    }

    /**
     * Normalize one `heading` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeHeadingBlock(raw) {
      const text = readText(raw.text)
      if (!text) return null
      const level = raw.level === 1 || raw.level === 3 ? raw.level : 2
      return { type: 'heading', text, level }
    }

    /**
     * Normalize one `callout` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeCalloutBlock(raw) {
      const text = readText(raw.text)
      if (!text) return null
      return {
        type: 'callout',
        tone: normalizeTone(raw.tone),
        title: optionalText(raw.title),
        text,
      }
    }

    /**
     * Normalize one `stats` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeStatsBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          const value = readScalar(entry.value)
          if (label === undefined || value === undefined) return null
          return {
            label,
            value,
            hint: optionalText(entry.hint),
            delta: optionalText(entry.delta),
            tone: normalizeTone(entry.tone),
          }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      return { type: 'stats', items }
    }

    /**
     * Normalize one `table` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeTableBlock(raw) {
      const columnSource = Array.isArray(raw.columns) ? raw.columns : null
      if (columnSource === null) return null
      const columns = []
      for (const column of columnSource) {
        if (columns.length >= MAX_TABLE_COLUMNS) break
        const text = readText(column)
        if (text) columns.push(text)
      }
      if (columns.length === 0) return null
      const rows = []
      if (Array.isArray(raw.rows)) {
        for (const row of raw.rows) {
          if (rows.length >= MAX_TABLE_ROWS) break
          if (!Array.isArray(row)) continue
          const cells = []
          for (let index = 0; index < columns.length; index += 1) {
            const cell = row[index]
            if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(String(cell))
            else if (typeof cell === 'string') cells.push(readText(cell) ?? '')
            else cells.push(null)
          }
          rows.push(cells)
        }
      }
      const align = []
      const alignSource = Array.isArray(raw.align) ? raw.align : []
      for (let index = 0; index < columns.length; index += 1) {
        const value = alignSource[index]
        align.push(value === 'left' || value === 'center' || value === 'right' ? value : undefined)
      }
      return { type: 'table', columns, rows, align, caption: optionalText(raw.caption) }
    }

    /**
     * Normalize one `keyvalue` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeKeyvalueBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const key = optionalText(entry.key)
          const value = readScalar(entry.value)
          if (key === undefined || value === undefined) return null
          return { key, value }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      // `columns` is a request, not a default: without it the renderer picks
      // tiles or rows from the sheet's own shape (`kvLayout`).
      const block = { type: 'keyvalue', items }
      if (raw.columns === 1 || raw.columns === 2) block.columns = raw.columns
      return block
    }

    /**
     * Normalize one `list` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeListBlock(raw) {
      const items = readItems(raw.items, (entry) => optionalText(entry), MAX_ITEMS)
      if (items.length === 0) return null
      return { type: 'list', ordered: raw.ordered === true, items }
    }

    /**
     * Normalize one `badges` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeBadgesBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          if (label === undefined) return null
          return { label, tone: normalizeTone(entry.tone) }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      return { type: 'badges', items }
    }

    /**
     * Normalize one `progress` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeProgressBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          const value = finiteNumber(entry.value)
          if (label === undefined || value === null) return null
          return {
            label,
            value,
            caption: optionalText(entry.caption),
            tone: normalizeTone(entry.tone),
          }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      return { type: 'progress', items }
    }

    /**
     * Normalize one `bars` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeBarsBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          const value = finiteNumber(entry.value)
          if (label === undefined || value === null) return null
          return { label, value, tone: normalizeTone(entry.tone) }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      const max = finiteNumber(raw.max)
      return {
        type: 'bars',
        title: optionalText(raw.title),
        items,
        direction: raw.direction === 'vertical' ? 'vertical' : undefined,
        max: max !== null && max > 0 ? max : undefined,
        unit: optionalText(raw.unit, 40),
      }
    }

    /**
     * Normalize one `pie` block: slices of their own total, negative values
     * dropped, and an all-zero payload renders nothing (a card must not show an
     * empty chart).
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizePieBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          const value = finiteNumber(entry.value)
          if (label === undefined || value === null || value < 0) return null
          return { label, value, tone: normalizeTone(entry.tone) }
        },
        MAX_PIE_SLICES,
      )
      const total = items.reduce((sum, item) => sum + item.value, 0)
      if (items.length === 0 || total <= 0) return null
      return {
        type: 'pie',
        title: optionalText(raw.title),
        items,
        unit: optionalText(raw.unit, 40),
        donut: raw.donut !== false,
      }
    }

    /**
     * Normalize one `tree` block: a bounded hierarchy of labels.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeTreeBlock(raw) {
      let count = 0
      const walk = (list, depth) => {
        const out = []
        if (!Array.isArray(list)) return out
        for (const entry of list) {
          if (count >= MAX_TREE_NODES) break
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
          const label = optionalText(entry.label)
          if (label === undefined) continue
          count += 1
          const node = { label, tone: normalizeTone(entry.tone) }
          const note = optionalText(entry.note, 200)
          const badge = optionalText(entry.badge, 40)
          if (note !== undefined) node.note = note
          if (badge !== undefined) node.badge = badge
          if (depth < MAX_TREE_DEPTH) {
            const children = walk(entry.children, depth + 1)
            if (children.length > 0) node.children = children
          }
          out.push(node)
        }
        return out
      }
      const nodes = walk(raw.nodes, 0)
      if (nodes.length === 0) return null
      return { type: 'tree', title: optionalText(raw.title), nodes }
    }

    /**
     * Normalize one `heatmap` block: labelled values laid out row-major.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeHeatmapBlock(raw) {
      const items = readItems(raw.items, (entry) => {
        if (!entry || typeof entry !== 'object') return null
        const value = finiteNumber(entry.value)
        if (value === null) return null
        const item = { value: Math.max(0, value), tone: normalizeTone(entry.tone) }
        const label = optionalText(entry.label, 40)
        if (label !== undefined) item.label = label
        return item
      }, MAX_HEATMAP_CELLS)
      if (items.length === 0) return null
      const columns = finiteNumber(raw.columns)
      const max = finiteNumber(raw.max)
      return {
        type: 'heatmap',
        title: optionalText(raw.title),
        unit: optionalText(raw.unit, 40),
        items,
        columns: columns !== null && columns >= 1 ? Math.min(53, Math.trunc(columns)) : undefined,
        max: max !== null && max > 0 ? max : undefined,
      }
    }

    /** Diff line kinds; an unknown kind renders as context. */
    const DIFF_KINDS = ['add', 'del', 'ctx']

    /**
     * Normalize one `diff` block.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeDiffBlock(raw) {
      const lines = readItems(raw.lines, (entry) => {
        if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') return null
        return {
          kind: DIFF_KINDS.indexOf(entry.kind) === -1 ? 'ctx' : entry.kind,
          text: entry.text.slice(0, MAX_TEXT),
        }
      }, MAX_DIFF_LINES)
      if (lines.length === 0) return null
      return {
        type: 'diff',
        title: optionalText(raw.title),
        path: optionalText(raw.path, 240),
        language: optionalText(raw.language, 40),
        lines,
      }
    }

    /**
     * Normalize one `kanban` block.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeKanbanBlock(raw) {
      const columns = readItems(raw.columns, (columnRaw) => {
        if (!columnRaw || typeof columnRaw !== 'object') return null
        const title = optionalText(columnRaw.title)
        if (title === undefined) return null
        const cards = readItems(columnRaw.cards, (cardRaw) => {
          if (!cardRaw || typeof cardRaw !== 'object') return null
          const cardTitle = optionalText(cardRaw.title)
          if (cardTitle === undefined) return null
          const card = { title: cardTitle, tone: normalizeTone(cardRaw.tone) }
          const text = optionalText(cardRaw.text, 600)
          if (text !== undefined) card.text = text
          const badges = readItems(cardRaw.badges, (badgeRaw) => optionalText(badgeRaw, 40), 4)
          if (badges.length > 0) card.badges = badges
          return card
        }, MAX_KANBAN_CARDS)
        return { title, cards, tone: normalizeTone(columnRaw.tone) }
      }, MAX_KANBAN_COLUMNS)
      if (columns.length === 0) return null
      return { type: 'kanban', title: optionalText(raw.title), columns }
    }

    /** Container types a tab may not nest: one level only. */
    const TAB_NO_NEST = ['tabs', 'columns']

    /**
     * Normalize one `tabs` block: panes carrying regular blocks, one level deep.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeTabsBlock(raw) {
      const items = readItems(raw.items, (itemRaw) => {
        if (!itemRaw || typeof itemRaw !== 'object') return null
        const label = optionalText(itemRaw.label, 60)
        if (label === undefined) return null
        const inner = []
        for (const innerRaw of Array.isArray(itemRaw.blocks) ? itemRaw.blocks : []) {
          if (inner.length >= MAX_TAB_BLOCKS) break
          if (!innerRaw || typeof innerRaw !== 'object' || Array.isArray(innerRaw)) continue
          if (typeof innerRaw.type !== 'string' || TAB_NO_NEST.indexOf(innerRaw.type) !== -1) continue
          const normalized = normalizeBlock(innerRaw)
          if (normalized !== null) inner.push(normalized)
        }
        if (inner.length === 0) return null
        return { label, blocks: inner }
      }, MAX_TABS)
      if (items.length === 0) return null
      return { type: 'tabs', title: optionalText(raw.title), items }
    }

    /**
     * Normalize one `columns` block: two or three groups of blocks rendered side
     * by side. Mirrors `normalizeColumns` in `lib/blocks.js`; nesting stays one
     * level deep (no tab or column inside a column).
     *
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeColumnsBlock(raw) {
      const items = readItems(raw.items, (itemRaw) => {
        if (!itemRaw || typeof itemRaw !== 'object') return null
        const inner = []
        for (const innerRaw of Array.isArray(itemRaw.blocks) ? itemRaw.blocks : []) {
          if (inner.length >= MAX_COLUMN_BLOCKS) break
          if (!innerRaw || typeof innerRaw !== 'object' || Array.isArray(innerRaw)) continue
          if (typeof innerRaw.type !== 'string' || TAB_NO_NEST.indexOf(innerRaw.type) !== -1) continue
          const normalized = normalizeBlock(innerRaw)
          if (normalized !== null) inner.push(normalized)
        }
        if (inner.length === 0) return null
        const column = { blocks: inner }
        const label = optionalText(itemRaw.label, 60)
        if (label !== undefined) column.label = label
        return column
      }, MAX_COLUMNS)
      if (items.length === 0) return null
      const block = { type: 'columns', title: optionalText(raw.title), items }
      const rawWeights = Array.isArray(raw.weights) ? raw.weights : []
      if (rawWeights.length === items.length) {
        block.weights = rawWeights.map((value) => {
          const number = finiteNumber(value)
          return number === null ? 1 : Math.max(1, Math.min(3, Math.round(number)))
        })
      }
      return block
    }

    /**
     * Accept one image source: an http(s) URL or an inline `data:image/*` URI.
     * Mirrors `imageSource` in `lib/blocks.js`; every other scheme is refused,
     * so a recorded spec cannot smuggle javascript:/file:/blob: into `<img>`.
     *
     * @param {unknown} value - raw source.
     * @returns {string | undefined}
     */
    function readImageSource(value) {
      if (typeof value !== 'string') return undefined
      const src = value.trim()
      if (src === '' || src.length > MAX_IMAGE_CHARS) return undefined
      if (/^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/iu.test(src)) return src
      if (/^data:image\/svg\+xml,[^\s]+$/iu.test(src)) return src
      if (/^https?:\/\/[^\s]+$/iu.test(src)) return src
      return undefined
    }

    /**
     * Normalize one `image` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeImageBlock(raw) {
      const src = readImageSource(raw.src)
      if (src === undefined) return null
      const caption = optionalText(raw.caption, 300)
      const alt = optionalText(raw.alt, 300)
      const height = finiteNumber(raw.height)
      return {
        type: 'image',
        src,
        alt: alt === undefined ? caption : alt,
        caption,
        height: height === null ? 240 : Math.max(80, Math.min(640, Math.round(height))),
        fit: raw.fit === 'cover' ? 'cover' : 'contain',
      }
    }

    /**
     * Normalize one `sparkline` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeSparklineBlock(raw) {
      const valueSource = Array.isArray(raw.values) ? raw.values : []
      const labelSource = Array.isArray(raw.labels) ? raw.labels : []
      const values = []
      const labels = []
      for (let index = 0; index < valueSource.length; index += 1) {
        if (values.length >= MAX_SPARK_VALUES) break
        const value = finiteNumber(valueSource[index])
        if (value === null) continue
        values.push(value)
        labels.push(optionalText(labelSource[index], 60))
      }
      if (values.length === 0) return null
      return {
        type: 'sparkline',
        title: optionalText(raw.title),
        values,
        labels: labels.some((label) => label !== undefined) ? labels : undefined,
        unit: optionalText(raw.unit, 40),
        tone: normalizeTone(raw.tone),
      }
    }

    /**
     * Normalize one `code` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeCodeBlock(raw) {
      const code = readText(raw.code, MAX_CODE)
      if (!code) return null
      return {
        type: 'code',
        code,
        language: optionalText(raw.language, 80),
        title: optionalText(raw.title),
      }
    }

    /**
     * Normalize one `quote` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeQuoteBlock(raw) {
      const text = readText(raw.text)
      if (!text) return null
      return { type: 'quote', text, by: optionalText(raw.by) }
    }

    /**
     * Normalize one `timeline` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeTimelineBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const title = optionalText(entry.title)
          if (title === undefined) return null
          return {
            title,
            text: optionalText(entry.text),
            time: optionalText(entry.time, 60),
            tone: normalizeTone(entry.tone),
          }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      return { type: 'timeline', items }
    }

    /**
     * Normalize one `links` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeLinksBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          if (label === undefined) return null
          const href = readText(entry.href, 2000)
          if (!href) return null
          return { label, href, description: optionalText(entry.description) }
        },
        MAX_ITEMS,
      )
      if (items.length === 0) return null
      return { type: 'links', items }
    }

    /**
     * Normalize one `actions` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeActionsBlock(raw) {
      const items = readItems(
        raw.items,
        (entry) => {
          if (!entry || typeof entry !== 'object') return null
          const label = optionalText(entry.label)
          const prompt = readText(entry.prompt)
          if (label === undefined || !prompt) return null
          return { label, prompt, tone: entry.tone === 'primary' ? 'primary' : 'default' }
        },
        MAX_ACTIONS,
      )
      if (items.length === 0) return null
      return { type: 'actions', items }
    }

    /**
     * Normalize one `divider` block. Extracted into the BLOCK_IMPL registry.
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null | undefined} normalized block, or null when unusable.
     */
    function normalizeDividerBlock(raw) {
      return { type: 'divider' }
    }

    // -------------------------------------------------------------------------
    // Diagram block: pure-SVG flowcharts, state machines, sequence, class, ER
    // -------------------------------------------------------------------------

    /** Diagram kinds the renderer understands; anything else renders a flowchart. */
    const DIAGRAM_KINDS = ['flowchart', 'sequence', 'class', 'state', 'er']
    /** Node shapes a graph diagram may request. */
    const DIAGRAM_SHAPES = ['box', 'round', 'diamond', 'circle', 'cylinder', 'note']
    /** Edge line styles and arrow ends. */
    const DIAGRAM_EDGE_STYLES = ['solid', 'dashed']
    const DIAGRAM_ARROWS = ['end', 'both', 'none']
    /** Message styles a sequence diagram may request. */
    const DIAGRAM_MESSAGE_STYLES = ['sync', 'return', 'async']
    /** Diagram caps; the Host normalizer declares the same numbers. */
    const DIAGRAM_CAPS = Object.freeze({
      nodes: 24,
      edges: 48,
      participants: 8,
      messages: 24,
      fields: 12,
      label: 60,
      detail: 80,
    })
    /** Diagram geometry in viewBox units. Deterministic: no DOM measurement. */
    const DIAGRAM_GEOMETRY = Object.freeze({
      margin: 10,
      nodeWidthMin: 80,
      nodeWidthMax: 200,
      nodeHeight: 28,
      /** Horizontal gap between LR layers: wide enough for an edge label. */
      layerGap: 56,
      /** Vertical gap between TB layers: labels sit beside a short edge. */
      rowGap: 30,
      crossGap: 12,
      headerHeight: 26,
      compartmentLine: 16,
      messageGap: 20,
      lifelineGap: 40,
    })

    /** Monotonic marker-id suffix so several diagrams on one page never collide. */
    let DIAGRAM_UID = 0

    /**
     * Read one diagram text field the way the Host does: strings are capped but
     * not trimmed, finite numbers and booleans are stringified, everything else
     * is absent. Keeping this identical to `toText` in `lib/shared.js` means a
     * recorded call normalizes to the same model on both halves.
     *
     * @param {unknown} value - candidate field.
     * @param {number} max - character cap.
     * @returns {string} text, possibly empty.
     */
    function diagramHostText(value, max) {
      const limit = typeof max === 'number' && max > 0 ? max : MAX_TEXT
      if (typeof value === 'string') return value.slice(0, limit)
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value === 'boolean') return String(value)
      return ''
    }

    /**
     * @param {unknown} value - candidate field.
     * @param {number} max - character cap.
     * @returns {string | undefined} host-normalized text, or undefined when blank.
     */
    function diagramHostOptionalText(value, max) {
      const text = diagramHostText(value, max)
      return text === '' ? undefined : text
    }

    /**
     * @param {unknown} value - candidate tone.
     * @returns {string | undefined} a known tone, or undefined when absent/invalid.
     */
    function diagramTone(value) {
      return typeof value === 'string' && TONE_NAMES.indexOf(value) !== -1 ? value : undefined
    }

    /**
     * Approximate rendered width of one label; deterministic and cheap (no DOM).
     * CJK code points count as one em, everything else as ~0.58 em.
     *
     * @param {unknown} text - label text.
     * @param {number} [fontPx] - font size in viewBox units.
     * @returns {number} estimated width.
     */
    function diagramTextWidth(text, fontPx) {
      const size = typeof fontPx === 'number' && fontPx > 0 ? fontPx : 12.5
      const source = typeof text === 'string' ? text : ''
      let width = 0
      for (const char of source) {
        width += char.codePointAt(0) > 0x2e7f ? size : size * 0.58
      }
      return width
    }

    /**
     * Fit one label into a width budget, adding a single ellipsis when cut.
     *
     * @param {unknown} text - label text.
     * @param {number} maxWidth - available width in viewBox units.
     * @param {number} [fontPx] - font size.
     * @returns {{ text: string, truncated: boolean }}
     */
    function fitDiagramText(text, maxWidth, fontPx) {
      const source = typeof text === 'string' ? text : ''
      if (diagramTextWidth(source, fontPx) <= maxWidth) return { text: source, truncated: false }
      let cut = source
      while (cut.length > 1 && diagramTextWidth(cut + '…', fontPx) > maxWidth) {
        cut = cut.slice(0, -1)
      }
      return { text: cut + '…', truncated: true }
    }

    /**
     * One truncated SVG text element. The full text is the `<title>` child when
     * the visible label had to be cut, so hovering and assistive tech keep it.
     *
     * @param {string} key - React key.
     * @param {unknown} value - label text.
     * @param {{ x: number, y: number, maxWidth: number, fontPx?: number, anchor?: string, className?: string }} options
     * @returns {any}
     */
    function diagramSvgText(key, value, options) {
      const opts = options || {}
      const fontPx = typeof opts.fontPx === 'number' ? opts.fontPx : 12.5
      const fitted = fitDiagramText(value, typeof opts.maxWidth === 'number' ? opts.maxWidth : 140, fontPx)
      const className = PREFIX + 'diagram-label' + (opts.className ? ' ' + opts.className : '')
      return h(
        'text',
        {
          key,
          x: opts.x,
          y: opts.y,
          className,
          textAnchor: opts.anchor || 'middle',
          dominantBaseline: 'middle',
        },
        fitted.truncated ? h('title', null, String(value)) : null,
        fitted.text,
      )
    }

    /**
     * Arrow marker id for one card: the React key sanitized to an id-safe
     * string, so the same recorded call always builds the same ids. The counter
     * only covers a key that sanitizes to nothing.
     *
     * @param {unknown} key - React key of the block.
     * @returns {string} marker id.
     */
    function diagramMarkerId(key, block) {
      const safe = String(key === undefined || key === null ? '' : key).replace(/[^A-Za-z0-9_-]/g, '-')
      if (safe !== '') return PREFIX + 'diagram-arrow-' + safe + '-' + diagramContentHash(block)
      DIAGRAM_UID += 1
      return PREFIX + 'diagram-arrow-fallback-' + DIAGRAM_UID
    }

    /**
     * Stable short hash of one normalized block, used to keep marker ids unique
     * between two cards that happen to share the same React key.
     *
     * @param {any} block - normalized diagram block.
     * @returns {string} base-36 hash.
     */
    function diagramContentHash(block) {
      let text = ''
      try {
        text = JSON.stringify(block)
      } catch {
        text = ''
      }
      let hash = 2166136261
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return (hash >>> 0).toString(36)
    }

    /**
     * Arrowhead marker referenced by edges.
     * @param {string} id - marker id.
     * @returns {any} `<marker>` element.
     */
    function diagramMarker(id) {
      return h(
        'marker',
        {
          key: 'marker',
          id,
          viewBox: '0 0 8 6',
          refX: 7,
          refY: 3,
          markerWidth: 7,
          markerHeight: 6,
          markerUnits: 'userSpaceOnUse',
          orient: 'auto',
        },
        h('path', { className: PREFIX + 'diagram-arrow', d: 'M0,0 L8,3 L0,6 Z' }),
      )
    }

    /**
     * @param {{ x: number, y: number, w: number, h: number }} rect - node box.
     * @returns {{ x: number, y: number }} box center.
     */
    function diagramCenter(rect) {
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
    }

    /**
     * Point where the line from one box center to `toward` leaves the box border.
     *
     * @param {{ x: number, y: number, w: number, h: number }} rect - source box.
     * @param {{ x: number, y: number }} toward - target point.
     * @returns {{ x: number, y: number }} border point.
     */
    function diagramBorderPoint(rect, toward) {
      const center = diagramCenter(rect)
      const dx = toward.x - center.x
      const dy = toward.y - center.y
      if (dx === 0 && dy === 0) return center
      const scale = Math.max(Math.abs(dx) / Math.max(1, rect.w / 2), Math.abs(dy) / Math.max(1, rect.h / 2))
      return { x: center.x + dx / scale, y: center.y + dy / scale }
    }

    /**
     * One point on a cubic bezier.
     * @param {{ x: number, y: number }} p0 - start.
     * @param {{ x: number, y: number }} p1 - control one.
     * @param {{ x: number, y: number }} p2 - control two.
     * @param {{ x: number, y: number }} p3 - end.
     * @param {number} t - 0..1.
     * @returns {{ x: number, y: number }}
     */
    function diagramCubicPoint(p0, p1, p2, p3, t) {
      const mt = 1 - t
      const a = mt * mt * mt
      const b = 3 * mt * mt * t
      const c = 3 * mt * t * t
      const d = t * t * t
      return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
      }
    }

    /**
     * Draw one node shape inside its bounding box.
     *
     * @param {{ shape?: string, tone?: string }} node - normalized node.
     * @param {{ x: number, y: number, w: number, h: number }} rect - bounding box.
     * @param {string} key - React key.
     * @param {string} shape - resolved shape name.
     * @param {string} [extraClass] - additional CSS class.
     * @returns {any} SVG shape element.
     */
    function diagramShapeElement(node, rect, key, shape, extraClass) {
      const className = PREFIX + 'diagram-shape' + (extraClass ? ' ' + extraClass : '')
      const x = rect.x
      const y = rect.y
      const w = rect.w
      const height = rect.h
      const common = { key, className, 'data-shape': shape }
      if (shape === 'round') return h('rect', Object.assign({}, common, { x, y, width: w, height, rx: height / 2 }))
      if (shape === 'diamond') {
        return h('path', Object.assign({}, common, {
          d: 'M ' + (x + w / 2) + ',' + y + ' L ' + (x + w) + ',' + (y + height / 2) + ' L ' + (x + w / 2) + ',' + (y + height) + ' L ' + x + ',' + (y + height / 2) + ' Z',
        }))
      }
      if (shape === 'circle') {
        return h('ellipse', Object.assign({}, common, { cx: x + w / 2, cy: y + height / 2, rx: w / 2, ry: height / 2 }))
      }
      if (shape === 'cylinder') {
        const radius = 8
        return h('path', Object.assign({}, common, {
          d: 'M ' + x + ',' + (y + radius)
            + ' A ' + (w / 2) + ',' + radius + ' 0 0 1 ' + (x + w) + ',' + (y + radius)
            + ' L ' + (x + w) + ',' + (y + height - radius)
            + ' A ' + (w / 2) + ',' + radius + ' 0 0 1 ' + x + ',' + (y + height - radius) + ' Z',
        }))
      }
      if (shape === 'note') {
        const fold = 12
        return h('path', Object.assign({}, common, {
          d: 'M ' + x + ',' + y + ' L ' + (x + w - fold) + ',' + y + ' L ' + (x + w) + ',' + (y + fold)
            + ' L ' + (x + w) + ',' + (y + height) + ' L ' + x + ',' + (y + height) + ' Z',
        }))
      }
      return h('rect', Object.assign({}, common, { x, y, width: w, height, rx: 8 }))
    }

    /**
     * One graph node: shape + label (+ optional detail line).
     *
     * @param {{ node: any, index: number, x: number, y: number, w: number, h: number }} entry - placed node.
     * @param {string} key - React key.
     * @param {string} defaultShape - shape when the node does not set one.
     * @returns {any}
     */
    function diagramNodeElement(entry, key, defaultShape) {
      const node = entry.node
      const rect = { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
      const center = diagramCenter(rect)
      const shape = DIAGRAM_SHAPES.indexOf(node.shape) !== -1 ? node.shape : defaultShape
      const hasDetail = typeof node.detail === 'string' && node.detail !== ''
      const children = [diagramShapeElement(node, rect, 'shape', shape)]
      children.push(diagramSvgText('label', node.label, {
        x: center.x,
        y: hasDetail ? center.y - 5 : center.y,
        maxWidth: rect.w - 20,
        fontPx: 12,
      }))
      if (hasDetail) {
        children.push(diagramSvgText('detail', node.detail, {
          x: center.x,
          y: center.y + 7,
          maxWidth: rect.w - 20,
          fontPx: 10,
          className: PREFIX + 'diagram-detail',
        }))
      }
      return h('g', {
        key,
        className: PREFIX + 'diagram-node',
        'data-tone': node.tone || 'neutral',
        'data-shape': shape,
        style: toneStyle(accentVar(node.tone)),
      }, children)
    }

    /**
     * One edge between two placed boxes: smooth curve, optional arrow ends and
     * label; self edges loop out of the right border, back edges dip below.
     *
     * @param {{ from: string, to: string, label?: string, style?: string, arrow?: string }} edge - normalized edge.
     * @param {any} a - source box.
     * @param {any} b - target box.
     * @param {number} index - edge index (keys and label ids).
     * @param {string} markerId - arrow marker id.
     * @param {'LR' | 'TB'} direction - layout direction.
     * @param {Map<string, number>} [depth] - layer per node id (back-edge routing).
     * @param {string} [pathClass] - CSS class for the path.
     * @returns {any} edge group.
     */
    function diagramEdgeElement(edge, a, b, index, markerId, direction, depth, pathClass) {
      const self = edge.from === edge.to
      let start
      let end
      let c1
      let c2
      let midpoint
      if (self) {
        const cx = a.x + a.w
        const cy = a.y + a.h / 2
        start = { x: cx, y: cy - 7 }
        end = { x: cx, y: cy + 7 }
        c1 = { x: cx + 28, y: cy - 22 }
        c2 = { x: cx + 28, y: cy + 22 }
        midpoint = { x: cx + 20, y: cy }
      } else {
        const back = depth !== undefined && depth.get(edge.to) <= depth.get(edge.from)
        const aCenter = diagramCenter(a)
        const bCenter = diagramCenter(b)
        if (back) {
          const below = Math.max(a.y + a.h, b.y + b.h) + 34
          start = { x: a.x + a.w, y: a.y + a.h / 2 }
          end = { x: b.x + b.w / 2, y: b.y + b.h }
          c1 = { x: a.x + a.w + 36, y: below }
          c2 = { x: end.x, y: below }
        } else {
          start = diagramBorderPoint(a, bCenter)
          end = diagramBorderPoint(b, aCenter)
          if (direction === 'TB') {
            const bend = Math.max(28, Math.abs(end.y - start.y) * 0.45)
            c1 = { x: start.x, y: start.y + bend }
            c2 = { x: end.x, y: end.y - bend }
          } else {
            const bend = Math.max(28, Math.abs(end.x - start.x) * 0.45)
            c1 = { x: start.x + bend, y: start.y }
            c2 = { x: end.x - bend, y: end.y }
          }
        }
        midpoint = diagramCubicPoint(start, c1, c2, end, 0.5)
      }
      const dashed = edge.style === 'dashed'
      const arrow = edge.arrow === 'both' || edge.arrow === 'none' ? edge.arrow : 'end'
      const attrs = {
        key: 'edge-' + index,
        className: (pathClass || PREFIX + 'diagram-edge') + (dashed ? ' ' + PREFIX + 'diagram-edge--dashed' : ''),
        d: 'M ' + start.x + ',' + start.y + ' C ' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + end.x + ',' + end.y,
        fill: 'none',
        // Normalized path length: the `draw` and `flow` motion presets animate
        // stroke-dashoffset in percent of the edge, whatever its real length.
        pathLength: 100,
        'data-arrow': arrow,
      }
      if (arrow === 'end' || arrow === 'both') attrs.markerEnd = 'url(#' + markerId + ')'
      if (arrow === 'both') attrs.markerStart = 'url(#' + markerId + ')'
      const children = [h('path', attrs)]
      if (typeof edge.label === 'string' && edge.label !== '') {
        const fitted = fitDiagramText(edge.label, 160, 10.5)
        const labelWidth = diagramTextWidth(fitted.text, 10.5) + 8
        const labelX = midpoint.x
        const labelY = midpoint.y - 9
        children.push(h('rect', {
          key: 'edge-bg-' + index,
          className: PREFIX + 'diagram-edge-label-bg',
          x: labelX - labelWidth / 2,
          y: labelY - 8,
          width: labelWidth,
          height: 15,
          rx: 3,
        }))
        children.push(diagramSvgText('edge-label-' + index, edge.label, {
          x: labelX,
          y: labelY,
          maxWidth: 160,
          fontPx: 10,
          className: PREFIX + 'diagram-edge-label',
        }))
      }
      return h('g', { key: 'edge-group-' + index, className: PREFIX + 'diagram-edge-group' }, children)
    }

    /**
     * Layered layout for flowchart and state diagrams: longest-path layering,
     * LR columns separated by `layerGap`, TB rows by `rowGap`; node boxes
     * 80-200 x 28.
     *
     * @param {any} block - normalized diagram block.
     * @param {string} markerId - arrow marker id.
     * @returns {{ width: number, height: number, direction: string, children: any[] }}
     */
    function layoutDiagramLayered(block, markerId) {
      const g = DIAGRAM_GEOMETRY
      const nodes = block.nodes || []
      const direction = block.direction === 'TB' ? 'TB' : 'LR'
      const entries = new Map()
      const placed = nodes.map((node, index) => {
        const labelWidth = diagramTextWidth(node.label, 12.5)
        const detailWidth = node.detail ? diagramTextWidth(node.detail, 10.5) : 0
        const width = Math.max(
          g.nodeWidthMin,
          Math.min(g.nodeWidthMax, Math.ceil(Math.max(labelWidth, detailWidth) + 20)),
        )
        const entry = { node, index, x: 0, y: 0, w: width, h: g.nodeHeight }
        entries.set(node.id, entry)
        return entry
      })
      const edges = (block.edges || []).filter((edge) => entries.has(edge.from) && entries.has(edge.to))
      const depth = new Map(placed.map((entry) => [entry.node.id, 0]))
      for (let pass = 0; pass <= placed.length; pass += 1) {
        let changed = false
        for (const edge of edges) {
          if (edge.from === edge.to) continue
          const candidate = depth.get(edge.from) + 1
          if (candidate < placed.length && depth.get(edge.to) < candidate) {
            depth.set(edge.to, candidate)
            changed = true
          }
        }
        if (!changed) break
      }
      const layers = []
      for (const entry of placed) {
        const level = depth.get(entry.node.id)
        if (!Array.isArray(layers[level])) layers[level] = []
        layers[level].push(entry)
      }
      const rows = layers.filter((layer) => Array.isArray(layer) && layer.length > 0)
      const selfLoop = edges.some((edge) => edge.from === edge.to)
      const backEdge = edges.some((edge) => edge.from !== edge.to && depth.get(edge.to) <= depth.get(edge.from))
      let width = g.margin * 2
      let height = g.margin * 2
      if (direction === 'TB') {
        const rowWidths = rows.map((row) => row.reduce((sum, entry) => sum + entry.w, 0) + g.crossGap * (row.length - 1))
        const contentWidth = Math.max.apply(null, rowWidths.concat([0]))
        let cursorY = g.margin
        rows.forEach((row, rowIndex) => {
          const rowWidth = rowWidths[rowIndex]
          const rowHeight = Math.max.apply(null, row.map((entry) => entry.h))
          let cursorX = g.margin + (contentWidth - rowWidth) / 2
          for (const entry of row) {
            entry.x = cursorX
            entry.y = cursorY + (rowHeight - entry.h) / 2
            cursorX += entry.w + g.crossGap
          }
          cursorY += rowHeight + g.rowGap
        })
        width = g.margin * 2 + contentWidth
        height = cursorY - g.rowGap + g.margin
      } else {
        const layerHeights = rows.map((row) => row.reduce((sum, entry) => sum + entry.h, 0) + g.crossGap * (row.length - 1))
        const contentHeight = Math.max.apply(null, layerHeights.concat([0]))
        let cursorX = g.margin
        rows.forEach((row, rowIndex) => {
          const layerHeight = layerHeights[rowIndex]
          const layerWidth = Math.max.apply(null, row.map((entry) => entry.w))
          let cursorY = g.margin + (contentHeight - layerHeight) / 2
          for (const entry of row) {
            entry.x = cursorX + (layerWidth - entry.w) / 2
            entry.y = cursorY
            cursorY += entry.h + g.crossGap
          }
          cursorX += layerWidth + g.layerGap
        })
        width = cursorX - g.layerGap + g.margin
        height = g.margin * 2 + contentHeight
      }
      if (!Number.isFinite(width) || width < g.margin * 2) width = g.margin * 2
      if (!Number.isFinite(height) || height < g.margin * 2) height = g.margin * 2
      if (selfLoop) width += 30
      if (backEdge) {
        // Back edges dip below the graph and bow out to the right of their
        // source; both extensions must stay inside the computed viewBox.
        width += 44
        height += 44
      }
      const defaultShape = block.kind === 'state' ? 'round' : 'box'
      const children = []
      for (const entry of placed) children.push(diagramNodeElement(entry, 'node-' + entry.index, defaultShape))
      edges.forEach((edge, index) => {
        children.push(diagramEdgeElement(
          edge,
          entries.get(edge.from),
          entries.get(edge.to),
          index,
          markerId,
          direction,
          depth,
        ))
      })
      return { width: Math.ceil(width), height: Math.ceil(height), direction, children }
    }

    /**
     * Participant header of a sequence diagram.
     *
     * @param {any} entry - `{ node, x, y, w, h }` header box.
     * @param {number} centerX - lifeline x.
     * @param {number} index - participant index.
     * @returns {any}
     */
    function diagramParticipantElement(entry, centerX, index) {
      const rect = { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
      const children = [
        diagramShapeElement(entry.node, rect, 'shape', 'box'),
        diagramSvgText('label', entry.node.label, {
          x: centerX,
          y: rect.y + rect.h / 2,
          maxWidth: rect.w - 18,
          fontPx: 13,
        }),
      ]
      return h('g', {
        key: 'participant-' + index,
        className: PREFIX + 'diagram-participant',
        'data-tone': entry.node.tone || 'neutral',
        style: toneStyle(accentVar(entry.node.tone)),
      }, children)
    }

    /**
     * One sequence message: a horizontal arrow between lifelines (self messages
     * loop out to the right); return and async messages are dashed.
     *
     * @param {{ message: any, from: any, to: any, y: number }} row - placed message.
     * @param {number} index - message index.
     * @param {string} markerId - arrow marker id.
     * @returns {any}
     */
    function diagramMessageElement(row, index, markerId) {
      const message = row.message
      const dashed = message.style === 'return' || message.style === 'async'
      const className = PREFIX + 'diagram-message-arrow' + (dashed ? ' ' + PREFIX + 'diagram-edge--dashed' : '')
      const children = []
      if (row.from === row.to) {
        const x0 = row.from.x + 10
        const loop = 'M ' + x0 + ',' + (row.y - 6)
          + ' L ' + (x0 + 30) + ',' + (row.y - 6)
          + ' L ' + (x0 + 30) + ',' + (row.y + 6)
          + ' L ' + x0 + ',' + (row.y + 6)
        children.push(h('path', {
          key: 'm',
          className,
          d: loop,
          fill: 'none',
          pathLength: 100,
          markerEnd: 'url(#' + markerId + ')',
        }))
        if (message.label) {
          children.push(diagramSvgText('label', message.label, {
            x: x0 + 38,
            y: row.y - 2,
            maxWidth: 150,
            fontPx: 10,
            anchor: 'start',
            className: PREFIX + 'diagram-edge-label',
          }))
        }
      } else {
        children.push(h('path', {
          key: 'm',
          className,
          d: 'M ' + row.from.x + ',' + row.y + ' L ' + row.to.x + ',' + row.y,
          fill: 'none',
          pathLength: 100,
          markerEnd: 'url(#' + markerId + ')',
        }))
        if (message.label) {
          const midX = (row.from.x + row.to.x) / 2
          const budget = Math.max(40, Math.abs(row.to.x - row.from.x) - 12)
          const fitted = fitDiagramText(message.label, budget, 10.5)
          const labelWidth = diagramTextWidth(fitted.text, 10.5) + 6
          children.push(h('rect', {
            key: 'bg',
            className: PREFIX + 'diagram-edge-label-bg',
            x: midX - labelWidth / 2,
            y: row.y - 24,
            width: labelWidth,
            height: 15,
            rx: 3,
          }))
          children.push(diagramSvgText('label', message.label, {
            x: midX,
            y: row.y - 16,
            maxWidth: budget,
            fontPx: 10,
            className: PREFIX + 'diagram-edge-label',
          }))
        }
      }
      return h('g', {
        key: 'message-' + index,
        className: PREFIX + 'diagram-message',
        'data-style': message.style || 'sync',
      }, children)
    }

    /**
     * Sequence layout: participant headers across the top, dashed lifelines, and
     * one message row per 34 units.
     *
     * @param {any} block - normalized diagram block.
     * @param {string} markerId - arrow marker id.
     * @returns {{ width: number, height: number, children: any[] }}
     */
    function layoutDiagramSequence(block, markerId) {
      const g = DIAGRAM_GEOMETRY
      const participants = block.participants || []
      const messages = block.messages || []
      const columns = []
      let cursorX = g.margin
      for (const participant of participants) {
        const width = Math.max(120, Math.min(220, Math.ceil(diagramTextWidth(participant.label, 13) + 30)))
        columns.push({ node: participant, x: cursorX + width / 2, w: width })
        cursorX += width + g.lifelineGap
      }
      const byId = new Map(columns.map((column) => [column.node.id, column]))
      const headerTop = g.margin
      const headerBottom = headerTop + g.headerHeight
      const firstMessageY = headerBottom + 34
      const rows = []
      let width = cursorX - g.lifelineGap + g.margin
      messages.forEach((message, index) => {
        const from = byId.get(message.from)
        const to = byId.get(message.to)
        if (from === undefined || to === undefined) return
        const y = firstMessageY + index * g.messageGap
        if (from === to) {
          // A self message loops to the right of its lifeline; its label sits
          // beside the loop, so the canvas must grow with the label too.
          const labelWidth = message.label ? diagramTextWidth(message.label, 10.5) + 8 : 0
          width = Math.max(width, from.x + 40 + labelWidth + g.margin)
        }
        rows.push({ message, from, to, y })
      })
      const lastY = rows.length > 0 ? rows[rows.length - 1].y : firstMessageY
      const height = lastY + g.margin + 18
      if (!Number.isFinite(width) || width < g.margin * 2) width = g.margin * 2
      const children = []
      columns.forEach((column, index) => {
        children.push(h('line', {
          key: 'lifeline-' + index,
          className: PREFIX + 'diagram-lifeline',
          x1: column.x,
          y1: headerBottom + 6,
          x2: column.x,
          y2: height - g.margin + 2,
        }))
      })
      columns.forEach((column, index) => {
        children.push(diagramParticipantElement({
          node: column.node,
          x: column.x - column.w / 2,
          y: headerTop,
          w: column.w,
          h: g.headerHeight,
        }, column.x, index))
      })
      rows.forEach((row, index) => children.push(diagramMessageElement(row, index, markerId)))
      return { width: Math.ceil(width), height: Math.ceil(height), children }
    }

    /**
     * One class/ER entity: header compartment, fields, methods, separated by
     * hairlines.
     *
     * @param {any} entity - placed entity `{ node, fields, methods, x, y, w, h, headerH, fieldH }`.
     * @param {number} index - entity index.
     * @returns {any}
     */
    function diagramEntityElement(entity, index) {
      const rect = { x: entity.x, y: entity.y, w: entity.w, h: entity.h }
      const headerHeight = entity.headerH
      const lineStep = DIAGRAM_GEOMETRY.compartmentLine
      const children = [
        diagramShapeElement(entity.node, rect, 'shape', 'box', PREFIX + 'diagram-entity-shape'),
        diagramSvgText('name', entity.node.label, {
          x: rect.x + 12,
          y: rect.y + headerHeight / 2,
          maxWidth: rect.w - 24,
          fontPx: 13,
          anchor: 'start',
          className: PREFIX + 'diagram-entity-title',
        }),
      ]
      let cursorY = rect.y + headerHeight
      if (entity.fields.length > 0) {
        children.push(h('line', {
          key: 'separator-fields',
          className: PREFIX + 'diagram-separator',
          x1: rect.x,
          y1: cursorY,
          x2: rect.x + rect.w,
          y2: cursorY,
        }))
        entity.fields.forEach((line, lineIndex) => {
          children.push(diagramSvgText('field-' + lineIndex, line, {
            x: rect.x + 12,
            y: cursorY + 14 + lineIndex * lineStep,
            maxWidth: rect.w - 24,
            fontPx: 11.5,
            anchor: 'start',
            className: PREFIX + 'diagram-entity-field',
          }))
        })
        cursorY += entity.fieldH
      }
      if (entity.methods.length > 0) {
        children.push(h('line', {
          key: 'separator-methods',
          className: PREFIX + 'diagram-separator',
          x1: rect.x,
          y1: cursorY,
          x2: rect.x + rect.w,
          y2: cursorY,
        }))
        entity.methods.forEach((line, lineIndex) => {
          children.push(diagramSvgText('method-' + lineIndex, line, {
            x: rect.x + 12,
            y: cursorY + 14 + lineIndex * lineStep,
            maxWidth: rect.w - 24,
            fontPx: 11.5,
            anchor: 'start',
            className: PREFIX + 'diagram-entity-method',
          }))
        })
      }
      return h('g', {
        key: 'entity-' + index,
        className: PREFIX + 'diagram-entity',
        'data-tone': entity.node.tone || 'neutral',
        style: toneStyle(accentVar(entity.node.tone)),
      }, children)
    }

    /**
     * Class / ER layout: entity boxes in a column-major two-column grid, with
     * straight relations between box borders.
     *
     * @param {any} block - normalized diagram block.
     * @param {string} markerId - arrow marker id.
     * @returns {{ width: number, height: number, children: any[] }}
     */
    function layoutDiagramEntities(block, markerId) {
      const g = DIAGRAM_GEOMETRY
      const gapX = 28
      const gapY = 24
      const nodes = block.nodes || []
      const entities = nodes.map((node, index) => {
        const fields = Array.isArray(node.fields) ? node.fields : []
        const methods = Array.isArray(node.methods) ? node.methods : []
        const headWidth = diagramTextWidth(node.label, 13) + 28
        let bodyWidth = 0
        for (const line of fields.concat(methods)) {
          bodyWidth = Math.max(bodyWidth, diagramTextWidth(line, 11.5) + 24)
        }
        const width = Math.max(160, Math.min(320, Math.ceil(Math.max(headWidth, bodyWidth))))
        const headerH = g.headerHeight - 2
        const fieldH = fields.length > 0 ? fields.length * g.compartmentLine + 8 : 0
        const methodH = methods.length > 0 ? methods.length * g.compartmentLine + 8 : 0
        return { node, index, fields, methods, x: 0, y: 0, w: width, h: headerH + fieldH + methodH, headerH, fieldH, methodH }
      })
      const byId = new Map(entities.map((entity) => [entity.node.id, entity]))
      const columns = entities.length > 1 ? 2 : 1
      const rows = Math.max(1, Math.ceil(entities.length / columns))
      const columnWidths = new Array(columns).fill(0)
      const rowHeights = new Array(rows).fill(0)
      entities.forEach((entity, index) => {
        const column = Math.floor(index / rows)
        const row = index % rows
        columnWidths[column] = Math.max(columnWidths[column], entity.w)
        rowHeights[row] = Math.max(rowHeights[row], entity.h)
      })
      let canvasWidth = g.margin * 2 + columnWidths.reduce((sum, value) => sum + value, 0) + gapX * (columns - 1)
      let canvasHeight = g.margin * 2 + rowHeights.reduce((sum, value) => sum + value, 0) + gapY * (rows - 1)
      const columnX = []
      let cursorX = g.margin
      for (let column = 0; column < columns; column += 1) {
        columnX.push(cursorX)
        cursorX += columnWidths[column] + gapX
      }
      const rowY = []
      let cursorY = g.margin
      for (let row = 0; row < rows; row += 1) {
        rowY.push(cursorY)
        cursorY += rowHeights[row] + gapY
      }
      entities.forEach((entity, index) => {
        const column = Math.floor(index / rows)
        const row = index % rows
        entity.x = columnX[column] + (columnWidths[column] - entity.w) / 2
        entity.y = rowY[row]
      })
      const edges = (block.edges || []).filter((edge) => byId.has(edge.from) && byId.has(edge.to))
      const children = []
      entities.forEach((entity, index) => children.push(diagramEntityElement(entity, index)))
      edges.forEach((edge, index) => {
        const source = byId.get(edge.from)
        const target = byId.get(edge.to)
        if (source === target) {
          children.push(diagramEdgeElement(edge, source, source, index, markerId, 'LR', undefined, PREFIX + 'diagram-relation'))
          canvasWidth = Math.max(canvasWidth, source.x + source.w + 56 + g.margin)
          return
        }
        const start = diagramBorderPoint(source, diagramCenter(target))
        const end = diagramBorderPoint(target, diagramCenter(source))
        const dashed = edge.style === 'dashed'
        const arrow = edge.arrow === 'both' || edge.arrow === 'none' ? edge.arrow : 'end'
        const attrs = {
          key: 'relation-' + index,
          className: PREFIX + 'diagram-relation' + (dashed ? ' ' + PREFIX + 'diagram-edge--dashed' : ''),
          d: 'M ' + start.x + ',' + start.y + ' L ' + end.x + ',' + end.y,
          fill: 'none',
          pathLength: 100,
        }
        if (arrow === 'end' || arrow === 'both') attrs.markerEnd = 'url(#' + markerId + ')'
        if (arrow === 'both') attrs.markerStart = 'url(#' + markerId + ')'
        const groupChildren = [h('path', attrs)]
        if (typeof edge.label === 'string' && edge.label !== '') {
          const midX = (start.x + end.x) / 2
          const midY = (start.y + end.y) / 2
          const fitted = fitDiagramText(edge.label, 160, 10.5)
          const labelWidth = diagramTextWidth(fitted.text, 10.5) + 8
          groupChildren.push(h('rect', {
            key: 'relation-bg-' + index,
            className: PREFIX + 'diagram-edge-label-bg',
            x: midX - labelWidth / 2,
            y: midY - 16,
            width: labelWidth,
            height: 15,
            rx: 3,
          }))
          groupChildren.push(diagramSvgText('relation-label-' + index, edge.label, {
            x: midX,
            y: midY - 8,
            maxWidth: 160,
            fontPx: 10,
            className: PREFIX + 'diagram-edge-label',
          }))
        }
        children.push(h('g', { key: 'relation-group-' + index, className: PREFIX + 'diagram-edge-group' }, groupChildren))
      })
      return { width: Math.ceil(canvasWidth), height: Math.ceil(canvasHeight), children }
    }

    /**
     * Normalize one `diagram` block: mirrors the Host normalizer exactly, so a
     * recorded call and a replayed card produce the same model.
     *
     * @param {Record<string, any>} raw - raw block from the spec.
     * @returns {Record<string, any> | null} normalized block, or null when unusable.
     */
    function normalizeDiagramBlock(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const kind = DIAGRAM_KINDS.indexOf(raw.kind) === -1 ? 'flowchart' : raw.kind
      const block = { type: 'diagram', kind, direction: raw.direction === 'TB' ? 'TB' : 'LR' }
      const title = diagramHostOptionalText(raw.title, DIAGRAM_CAPS.detail)
      if (title !== undefined) block.title = title
      // Original mermaid text, when the caller has it (auto-converted cards do).
      if (typeof raw.source === 'string' && raw.source.trim() !== '') {
        block.source = raw.source.slice(0, MAX_CODE)
      }
      const readCompartment = (source) => {
        const lines = []
        if (!Array.isArray(source)) return lines
        for (const line of source.slice(0, DIAGRAM_CAPS.fields)) {
          const text = diagramHostOptionalText(line, 48)
          if (text !== undefined) lines.push(text)
        }
        return lines
      }
      const nodeIds = new Set()
      const nodes = []
      const rawNodes = Array.isArray(raw.nodes) ? raw.nodes.slice(0, DIAGRAM_CAPS.nodes) : []
      for (const entry of rawNodes) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const label = diagramHostOptionalText(entry.label, DIAGRAM_CAPS.label)
        if (label === undefined) continue
        let id = diagramHostOptionalText(entry.id, 40) || 'n' + nodes.length
        if (nodeIds.has(id)) id = id + '_' + nodes.length
        nodeIds.add(id)
        const node = { id, label }
        if (DIAGRAM_SHAPES.indexOf(entry.shape) !== -1) node.shape = entry.shape
        const tone = diagramTone(entry.tone)
        if (tone !== undefined) node.tone = tone
        const detail = diagramHostOptionalText(entry.detail, DIAGRAM_CAPS.detail)
        if (detail !== undefined) node.detail = detail
        const fields = readCompartment(entry.fields)
        const methods = readCompartment(entry.methods)
        if (fields.length > 0) node.fields = fields
        if (methods.length > 0) node.methods = methods
        nodes.push(node)
      }
      const knownNodeIds = new Set(nodes.map((node) => node.id))
      const edges = []
      const rawEdges = Array.isArray(raw.edges) ? raw.edges.slice(0, DIAGRAM_CAPS.edges) : []
      for (const entry of rawEdges) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const from = diagramHostOptionalText(entry.from, 40)
        const to = diagramHostOptionalText(entry.to, 40)
        if (from === undefined || to === undefined) continue
        if (!knownNodeIds.has(from) || !knownNodeIds.has(to)) continue
        const edge = { from, to }
        const label = diagramHostOptionalText(entry.label, 40)
        if (label !== undefined) edge.label = label
        if (DIAGRAM_EDGE_STYLES.indexOf(entry.style) !== -1) edge.style = entry.style
        if (DIAGRAM_ARROWS.indexOf(entry.arrow) !== -1) edge.arrow = entry.arrow
        edges.push(edge)
      }
      const participantIds = new Set()
      const participants = []
      const rawParticipants = Array.isArray(raw.participants)
        ? raw.participants.slice(0, DIAGRAM_CAPS.participants)
        : []
      for (const entry of rawParticipants) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const label = diagramHostOptionalText(entry.label, DIAGRAM_CAPS.label)
        if (label === undefined) continue
        let id = diagramHostOptionalText(entry.id, 40) || 'p' + participants.length
        if (participantIds.has(id)) id = id + '_' + participants.length
        participantIds.add(id)
        const participant = { id, label }
        const tone = diagramTone(entry.tone)
        if (tone !== undefined) participant.tone = tone
        participants.push(participant)
      }
      const messages = []
      const rawMessages = Array.isArray(raw.messages) ? raw.messages.slice(0, DIAGRAM_CAPS.messages) : []
      for (const entry of rawMessages) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
        const from = diagramHostOptionalText(entry.from, 40)
        const to = diagramHostOptionalText(entry.to, 40)
        if (from === undefined || to === undefined) continue
        if (!participantIds.has(from) || !participantIds.has(to)) continue
        const message = { from, to }
        const label = diagramHostOptionalText(entry.label, DIAGRAM_CAPS.label)
        if (label !== undefined) message.label = label
        message.style = DIAGRAM_MESSAGE_STYLES.indexOf(entry.style) !== -1 ? entry.style : 'sync'
        messages.push(message)
      }
      if (kind === 'sequence') {
        if (participants.length === 0 || messages.length === 0) return null
        block.participants = participants
        block.messages = messages
        return block
      }
      if (nodes.length === 0) return null
      block.nodes = nodes
      if (edges.length > 0) block.edges = edges
      return block
    }

    /**
     * Cap reconstructed mermaid for display.
     *
     * @param {string[]} lines - source lines.
     * @returns {string} joined and capped source.
     */
    function capMermaid(lines) {
      const text = lines.join('\n')
      return text.length > MAX_CODE ? text.slice(0, MAX_CODE) : text
    }

    /**
     * Rebuild mermaid text from a normalized diagram block.
     *
     * The chart is the source of truth; this is what the source toggle shows
     * when the block did not carry its original text (auto-converted cards do
     * carry it in `source`). Display only: the output is capped.
     *
     * @param {any} block - normalized diagram block.
     * @returns {string} mermaid source, '' when nothing can be rebuilt.
     */
    function diagramToMermaid(block) {
      if (!block || typeof block !== 'object') return ''
      const kind = block.kind === 'sequence' || block.kind === 'class' || block.kind === 'er' || block.kind === 'state'
        ? block.kind
        : 'flowchart'
      const lines = []
      const text = (value) => String(value === undefined || value === null ? '' : value)
      const labelOf = (node) => {
        const label = text(node.label === undefined ? node.id : node.label)
        return label
      }
      const nodeRef = (node) => {
        const id = text(node.id)
        const label = labelOf(node)
        switch (node.shape) {
          case 'circle': return id + '((' + label + '))'
          case 'round': return id + '(' + label + ')'
          case 'diamond': return id + '{' + label + '}'
          case 'cylinder': return id + '[(' + label + ')]'
          case 'note': return id + '>' + label + ']'
          default: return id + '[' + label + ']'
        }
      }
      if (kind === 'sequence') {
        lines.push('sequenceDiagram')
        for (const participant of block.participants || []) {
          const label = text(participant.label === undefined ? participant.id : participant.label)
          lines.push('  participant ' + text(participant.id) + (label === text(participant.id) ? '' : ' as ' + label))
        }
        for (const message of block.messages || []) {
          const dashed = message.style === 'return' || message.style === 'async'
          lines.push('  ' + text(message.from) + (dashed ? '-->>' : '->>') + text(message.to) + ': ' + text(message.label))
        }
        return capMermaid(lines)
      }
      if (kind === 'class' || kind === 'er') {
        lines.push('classDiagram')
        const nameOf = (id) => {
          const node = (block.nodes || []).find((candidate) => candidate.id === id)
          return text(node && node.label !== undefined ? node.label : id)
        }
        for (const node of block.nodes || []) {
          lines.push('  class ' + nameOf(node.id) + ' {')
          for (const field of node.fields || []) lines.push('    ' + text(field))
          for (const method of node.methods || []) lines.push('    ' + text(method))
          lines.push('  }')
        }
        for (const edge of block.edges || []) {
          const label = text(edge.label)
          lines.push('  ' + nameOf(edge.from) + ' --> ' + nameOf(edge.to) + (label === '' ? '' : ' : ' + label))
        }
        return capMermaid(lines)
      }
      const isState = kind === 'state'
      lines.push(isState ? 'stateDiagram-v2' : 'flowchart ' + (block.direction === 'TB' ? 'TB' : 'LR'))
      const endpoint = (id) => {
        if (!isState) return text(id)
        if (id === '__start' || id === '__end') return '[*]'
        return text(id)
      }
      for (const node of block.nodes || []) {
        if (isState && (node.id === '__start' || node.id === '__end')) continue
        if (isState && node.label !== undefined && text(node.label) !== text(node.id)) {
          lines.push('  state "' + text(node.label).replace(/"/g, "'") + '" as ' + text(node.id))
        } else {
          lines.push('  ' + nodeRef(node))
        }
      }
      for (const edge of block.edges || []) {
        const arrow = edge.style === 'dashed' ? '-.->' : '-->'
        const label = text(edge.label)
        if (isState) lines.push('  ' + endpoint(edge.from) + ' ' + arrow + ' ' + endpoint(edge.to) + (label === '' ? '' : ' : ' + label))
        else lines.push('  ' + endpoint(edge.from) + ' ' + arrow + (label === '' ? '' : '|' + label + '|') + ' ' + endpoint(edge.to))
      }
      return capMermaid(lines)
    }

    /**
     * Build the diagram figure for one resolved view mode.
     *
     * Pure so a test can exercise both the chart and the source view without
     * hook state.
     *
     * @param {any} block - normalized diagram block.
     * @param {{ t?: Function, blockKey?: string, showSource?: boolean, onToggle?: Function }} options - view options.
     * @returns {any} figure element.
     */
    function renderDiagramFigure(block, options) {
      const settings = options && typeof options === 'object' ? options : {}
      const t = typeof settings.t === 'function' ? settings.t : fallbackT
      const blockKey = typeof settings.blockKey === 'string' ? settings.blockKey : ''
      const showSource = settings.showSource === true
      const kind = DIAGRAM_KINDS.indexOf(block.kind) === -1 ? 'flowchart' : block.kind
      const stored = typeof block.source === 'string' && block.source.trim() !== '' ? block.source : ''
      const rebuilt = stored === '' ? diagramToMermaid(block) : ''
      const sourceText = stored !== '' ? stored : rebuilt
      const label = block.title || (t('diagram.label') + ' · ' + kind)
      const children = []
      if (sourceText !== '') {
        children.push(
          h(
            'div',
            { key: 'bar', className: PREFIX + 'diagram-bar' },
            h('button', {
              key: 'toggle',
              type: 'button',
              className: PREFIX + 'diagram-toggle',
              'aria-pressed': showSource ? 'true' : 'false',
              'aria-label': showSource ? t('diagram.chart') : t('diagram.source'),
              onClick: typeof settings.onToggle === 'function' ? settings.onToggle : undefined,
            }, showSource ? t('diagram.chart') : t('diagram.source')),
          ),
        )
      }
      if (block.title) {
        children.push(h('figcaption', { key: 'caption', className: PREFIX + 'diagram-title' }, block.title))
      }
      if (showSource) {
        children.push(h('pre', { key: 'source', className: PREFIX + 'diagram-source' }, sourceText))
      } else {
        const markerId = diagramMarkerId(blockKey, block)
        let layout
        if (kind === 'sequence') layout = layoutDiagramSequence(block, markerId)
        else if (kind === 'class' || kind === 'er') layout = layoutDiagramEntities(block, markerId)
        else layout = layoutDiagramLayered(block, markerId)
        const svgChildren = [
          h('title', { key: 'accessible-title' }, label),
          h('defs', { key: 'markers' }, diagramMarker(markerId)),
        ].concat(layout.children)
        // Natural size is the ceiling: a tall chart is never stretched to the
        // card width (that is what made diagrams 1200px tall). A wide chart may
        // shrink at most 15%, then it scrolls instead of dropping to 8px text.
        const natural = layout.width + 'px'
        const width = 'max(' + Math.round(layout.width * 0.85) + 'px, min(100%, ' + natural + '))'
        children.push(h(
          'div',
          { key: 'viewport', className: PREFIX + 'diagram-viewport' },
          h('svg', {
            key: 'svg',
            className: PREFIX + 'diagram-svg',
            style: { width },
            viewBox: '0 0 ' + layout.width + ' ' + layout.height,
            role: 'img',
            'aria-label': label,
            preserveAspectRatio: 'xMidYMid meet',
            xmlns: 'http://www.w3.org/2000/svg',
          }, svgChildren),
        ))
      }
      return h(
        'figure',
        {
          key: blockKey === '' ? undefined : blockKey,
          className: PREFIX + 'diagram',
          'data-kind': kind,
          'data-direction': block.direction || 'LR',
          'data-view': showSource ? 'source' : 'chart',
        },
        children,
      )
    }

    /**
     * Diagram block with the chart/source toggle. The chart is the default view;
     * the button switches to a scrollable source view and back.
     *
     * @param {any} props - `{ block, blockKey, t }`.
     * @returns {any}
     */
    function DiagramBlock(props) {
      const t = resolveT(props)
      const [showSource, setShowSource] = React.useState(false)
      return renderDiagramFigure(props.block, {
        t,
        blockKey: props.blockKey,
        showSource,
        onToggle: () => setShowSource((current) => !(current === true)),
      })
    }

    /**
     * Render one `diagram` block: a responsive, pure-SVG figure with a small
     * chart/source toggle. Layout is computed in JS from a deterministic
     * text-width estimate, so there is no DOM measurement, no canvas, and the
     * same call always draws the same card.
     *
     * @param {any} block - normalized diagram block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    function renderDiagramBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(DiagramBlock, { key, blockKey: key, block, t })
    }

    /**
     * Render one `tree` block: nested lists; the connectors live in CSS, so the
     * markup stays a plain list and survives narrow cards.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    function renderTreeBlock(block, key, context) {
      const nodes = (list, prefix) => h(
        'ul',
        { className: PREFIX + 'tree' },
        list.map((node, index) => h(
          'li',
          { key: prefix + 'i' + index, className: PREFIX + 'tree-node' },
          h(
            'div',
            { className: PREFIX + 'tree-row' },
            h(
              'span',
              {
                className: PREFIX + 'tree-label',
                style: node.tone === 'neutral' ? undefined : toneStyle(accentVar(node.tone)),
              },
              richChildren(node.label, prefix + 'l' + index),
            ),
            node.note ? h('span', { className: PREFIX + 'tree-note' }, richChildren(node.note, prefix + 'n' + index)) : null,
            node.badge ? h('span', { className: PREFIX + 'tree-badge' }, node.badge) : null,
          ),
          node.children && node.children.length > 0 ? nodes(node.children, prefix + index + '-') : null,
        )),
      )
      return h(
        'div',
        { key, className: PREFIX + 'tree-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 'tt')) : null,
        nodes(block.nodes, key + '-'),
      )
    }

    /**
     * Intensity bucket of one heat cell: 0 for no activity, 1..4 by quartile.
     *
     * @param {number} value - cell value.
     * @param {number} max - scale maximum.
     * @returns {number} bucket in 0..4.
     */
    function heatLevel(value, max) {
      if (!(max > 0) || !(value > 0)) return 0
      const ratio = Math.min(1, value / max)
      if (ratio <= 0.25) return 1
      if (ratio <= 0.5) return 2
      if (ratio <= 0.75) return 3
      return 4
    }

    /**
     * Render one `heatmap` block: a row-major grid of intensity cells plus a
     * less/more scale. Each cell carries its own tooltip text.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    /**
     * Join a number and its unit the way a person writes it: `%`, `°`, and CJK
     * units attach directly, Latin units take a space ("7 ms" but "7次").
     *
     * @param {string} text - already formatted number or range.
     * @param {string} [unit] - unit from the block, possibly padded.
     * @returns {string} the joined text.
     */
    function withUnit(text, unit) {
      const suffix = typeof unit === 'string' ? unit.trim() : ''
      if (suffix === '') return text
      return /^[%°％]$/u.test(suffix) || /[\u3000-\u9fff]/u.test(suffix) ? text + suffix : text + ' ' + suffix
    }

    function renderHeatmapBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const max = typeof block.max === 'number' && block.max > 0
        ? block.max
        : block.items.reduce((top, item) => Math.max(top, item.value), 0) || 1
      const columns = block.columns || Math.min(14, Math.max(1, block.items.length))
      const unit = block.unit || ''
      const total = block.items.reduce((sum, item) => sum + item.value, 0)
      // Only the ends matter on one foot line; the cells keep the full label in
      // their own title attribute.
      const labelled = block.items
        .map((item) => (typeof item.label === 'string' ? item.label : ''))
        .filter((label) => label !== '')
      const totalText = withUnit(formatNumber(total), unit)
      const rangeText = labelled.length === 0
        ? undefined
        : (labelled.length === 1 ? labelled[0] : labelled[0] + ' – ' + labelled[labelled.length - 1])
          + ' · ' + totalText
      return h(
        'div',
        { key, className: PREFIX + 'heatmap-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 't')) : null,
        h(
          'div',
          {
            className: PREFIX + 'heatmap',
            style: { '--dsh-sc-heat-cols': String(columns) },
            role: 'img',
            'aria-label': t('heatmap.label') + ' · ' + block.items.length + ' · ' + withUnit(formatNumber(total), unit),
          },
          block.items.map((item, index) => h('span', {
            key: index,
            className: PREFIX + 'heat-cell',
            'data-level': String(heatLevel(item.value, max)),
            style: item.tone === 'neutral' ? undefined : toneStyle(accentVar(item.tone)),
            title: (item.label ? item.label + ' · ' : '') + withUnit(formatNumber(item.value), unit),
          })),
        ),
        h(
          'div',
          { className: PREFIX + 'heatmap-foot' },
          // Fourteen anonymous cells say nothing: name the range and the total
          // on the left of the foot line, where the legend leaves room.
          rangeText === undefined
            ? null
            : h('span', { className: PREFIX + 'heatmap-range' }, rangeText),
          h(
            'div',
            { className: PREFIX + 'heatmap-legend', 'aria-hidden': 'true' },
            h('span', { className: PREFIX + 'heatmap-scale-label' }, t('heatmap.less')),
            [0, 1, 2, 3, 4].map((level) => h('span', {
              key: level,
              className: PREFIX + 'heat-cell',
              'data-level': String(level),
            })),
            h('span', { className: PREFIX + 'heatmap-scale-label' }, t('heatmap.more')),
          ),
        ),
      )
    }

    /**
     * Render one `diff` block: a patch view with added/removed line tints and a
     * +n/−n summary. No syntax highlighting, so it stays theme-neutral.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    function renderDiffBlock(block, key, context) {
      const added = block.lines.filter((line) => line.kind === 'add').length
      const removed = block.lines.filter((line) => line.kind === 'del').length
      return h(
        'div',
        { key, className: PREFIX + 'diff-block' },
        h(
          'div',
          { className: PREFIX + 'diff-head' },
          h('span', { className: PREFIX + 'diff-path' }, block.path || block.title || ''),
          h(
            'span',
            { className: PREFIX + 'diff-stat' },
            h('span', { className: PREFIX + 'diff-stat-add' }, '+' + added),
            h('span', { className: PREFIX + 'diff-stat-del' }, '−' + removed),
          ),
        ),
        h(
          'pre',
          { className: PREFIX + 'diff', tabIndex: 0, 'aria-label': block.title || block.path || '' },
          block.lines.map((line, index) => h(
            'span',
            { key: index, className: PREFIX + 'diff-line', 'data-kind': line.kind },
            h('span', { className: PREFIX + 'diff-sign' }, line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '),
            h('span', { className: PREFIX + 'diff-text' }, line.text),
          )),
        ),
      )
    }

    /**
     * Render one `kanban` block: horizontally scrollable columns of cards.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    function renderKanbanBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'kanban-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 't')) : null,
        h(
          'div',
          { className: PREFIX + 'kanban' },
          block.columns.map((column, columnIndex) => h(
            'div',
            {
              key: columnIndex,
              className: PREFIX + 'kanban-col',
              style: column.tone === 'neutral' ? undefined : toneStyle(accentVar(column.tone)),
            },
            h(
              'div',
              { className: PREFIX + 'kanban-head' },
              h('span', { className: PREFIX + 'kanban-title' }, richChildren(column.title, key + 'c' + columnIndex)),
              h('span', { className: PREFIX + 'kanban-count' }, String(column.cards.length)),
            ),
            h(
              'div',
              { className: PREFIX + 'kanban-cards' },
              column.cards.map((card, cardIndex) => h(
                'div',
                {
                  key: cardIndex,
                  className: PREFIX + 'kanban-card',
                  style: card.tone === 'neutral' ? undefined : toneStyle(accentVar(card.tone)),
                },
                h('div', { className: PREFIX + 'kanban-card-title' }, richChildren(card.title, key + 'k' + columnIndex + '-' + cardIndex)),
                card.text
                  ? h('div', { className: PREFIX + 'kanban-card-text' }, richChildren(card.text, key + 'x' + columnIndex + '-' + cardIndex))
                  : null,
                card.badges && card.badges.length > 0
                  ? h(
                      'div',
                      { className: PREFIX + 'kanban-badges' },
                      card.badges.map((badge, badgeIndex) => h(
                        'span',
                        { key: badgeIndex, className: PREFIX + 'kanban-badge' },
                        badge,
                      )),
                    )
                  : null,
              )),
              column.cards.length === 0 ? h('div', { className: PREFIX + 'kanban-empty' }, '—') : null,
            ),
          )),
        ),
      )
    }

    /**
     * Build the local half of the tab row: only used when the shell does not
     * expose `SegmentedTabs`. It mirrors the host markup (`role="tablist"`, one
     * `role="tab"` per label, roving `tabIndex`) and the host look, so a card
     * reads the same on an older shell.
     *
     * A plain builder rather than a component: it holds no state, and building
     * the row inline keeps the tree flat for the card's own renderers.
     *
     * @param {{ items: any[], index: number, onSelect: Function, label?: string }} props
     * @returns {any}
     */
    function localTabRow(props) {
      const { items, index, onSelect, label } = props
      const count = items.length
      const select = (next) => onSelect(((next % count) + count) % count)
      const handleKey = (event) => {
        const name = event.key
        if (name === 'ArrowRight') {
          event.preventDefault()
          select(index + 1)
        } else if (name === 'ArrowLeft') {
          event.preventDefault()
          select(index - 1)
        } else if (name === 'Home') {
          event.preventDefault()
          select(0)
        } else if (name === 'End') {
          event.preventDefault()
          select(count - 1)
        }
      }
      return h(
        'div',
        { className: PREFIX + 'tabs', role: 'tablist', 'aria-label': label, onKeyDown: handleKey },
        items.map((entry, entryIndex) => h(
          'button',
          {
            key: entryIndex,
            type: 'button',
            role: 'tab',
            'aria-selected': entryIndex === index ? 'true' : 'false',
            tabIndex: entryIndex === index ? 0 : -1,
            className: PREFIX + 'tab' + (entryIndex === index ? ' ' + PREFIX + 'tab--on' : ''),
            onClick: () => onSelect(entryIndex),
          },
          entry.label,
        )),
      )
    }

    /**
     * Local tab selection. Panes are rendered by the same block registry, so a
     * tab is a view of ordinary content, not a new kind of card.
     *
     * The row itself is the shell's `SegmentedTabs` when the frozen module table
     * carries it: the host control owns the sliding indicator, the roving
     * tabindex and the arrow keys, and a card then switches tabs exactly like
     * the rest of the app. The card still owns the pane, because a pane is just
     * more blocks.
     *
     * @param {{ block: any, t: Function, context: any }} props - block, translator, render context.
     * @returns {any}
     */
    function TabsBlock(props) {
      const { block, t, context } = props
      const [active, setActive] = React.useState(0)
      const count = block.items.length
      const index = typeof active === 'number' && active >= 0 && active < count ? active : 0
      const item = block.items[index]
      const select = (next) => setActive(((next % count) + count) % count)
      const HostTabs = PRIMITIVES && typeof PRIMITIVES.SegmentedTabs === 'function' ? PRIMITIVES.SegmentedTabs : null
      const label = block.title || (typeof t === 'function' ? t('tabs.label') : undefined)
      const row = HostTabs === null
        ? localTabRow({ items: block.items, index, onSelect: setActive, label })
        : h(HostTabs, {
            className: PREFIX + 'tabs-segmented',
            label,
            size: 'sm',
            value: index,
            onChange: (value) => select(typeof value === 'number' ? value : index),
            items: block.items.map((entry, entryIndex) => ({ value: entryIndex, label: entry.label })),
          })
      return h(
        'div',
        { className: PREFIX + 'tabs-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, 'tabsTitle')) : null,
        row,
        h(
          'div',
          { className: PREFIX + 'tabs-panel', role: 'tabpanel' },
          item.blocks.map((innerBlock, innerIndex) => {
            const node = renderBlock(innerBlock, 'tab' + innerIndex, context)
            return node === null ? null : withMotion(node, innerBlock)
          }),
        ),
      )
    }

    /**
     * Render one `tabs` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderTabsBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(TabsBlock, { key, block, t, context })
    }

    /**
     * A row of block groups rendered side by side. The grid auto-fits, so the
     * same spec folds back to one column on a narrow card.
     *
     * @param {{ block: any, context: any }} props - block and render context.
     * @returns {any}
     */
    function ColumnsBlock(props) {
      const { block, context } = props
      const weights = Array.isArray(block.weights) && block.weights.length === block.items.length
        ? block.weights
        : null
      return h(
        'div',
        {
          className: PREFIX + 'cols',
          'data-cols': String(block.items.length),
          'data-ratio': weights === null ? undefined : weights.join('-'),
        },
        block.items.map((column, columnIndex) => h(
          'div',
          { key: columnIndex, className: PREFIX + 'col' },
          column.label
            ? h('div', { className: PREFIX + 'col-label' }, richChildren(column.label, 'collabel' + columnIndex))
            : null,
          column.blocks.map((innerBlock, innerIndex) => {
            const node = renderBlock(innerBlock, 'col' + columnIndex + '-' + innerIndex, context)
            return node === null ? null : withMotion(node, innerBlock)
          }),
        )),
      )
    }

    /**
     * Render one `columns` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderColumnsBlock(block, key, context) {
      return h(ColumnsBlock, { key, block, context })
    }

    /**
     * Inline image: a fixed-height frame, lazy load without a referrer, and a
     * readable fallback tile when the source cannot be fetched. A remote source
     * links to the original; an inline data URI does not.
     *
     * @param {{ block: any, t: Function }} props - block and translator.
     * @returns {any}
     */
    function ImageBlock(props) {
      const { block, t } = props
      const [failed, setFailed] = React.useState(false)
      const height = typeof block.height === 'number' ? block.height : 240
      const alt = block.alt || block.caption || t('image.label')
      const media = failed
        ? h(
            'div',
            { className: PREFIX + 'image-fallback', style: { height: height + 'px' }, role: 'img', 'aria-label': alt },
            iconGlyph('warning'),
            h('span', { className: PREFIX + 'image-fallback-text' }, t('image.failed')),
          )
        : h('img', {
            className: PREFIX + 'image-media',
            src: block.src,
            alt,
            loading: 'lazy',
            decoding: 'async',
            referrerPolicy: 'no-referrer',
            draggable: false,
            style: { height: height + 'px', objectFit: block.fit === 'cover' ? 'cover' : 'contain' },
            onError: () => setFailed(true),
          })
      const remote = /^https?:/i.test(block.src)
      const children = [
        remote
          ? h(
              'a',
              {
                key: 'link',
                className: PREFIX + 'image-link',
                href: block.src,
                target: '_blank',
                rel: 'noreferrer noopener',
                'aria-label': t('image.open'),
                title: t('image.open'),
              },
              media,
            )
          : h('div', { key: 'frame', className: PREFIX + 'image-frame' }, media),
      ]
      if (block.caption) {
        children.push(
          h('figcaption', { key: 'caption', className: PREFIX + 'image-caption' }, richChildren(block.caption, 'imgcap')),
        )
      }
      return h('figure', { className: PREFIX + 'image-block' }, children)
    }

    /**
     * Render one `image` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context.
     * @returns {any}
     */
    function renderImageBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(ImageBlock, { key, block, t })
    }

    // -----------------------------------------------------------------------
    // Sandboxed HTML card (`html` block)
    // -----------------------------------------------------------------------

    /**
     * Theme tokens copied into a sandboxed frame. A sandboxed iframe has its own
     * document, so `--dsw-alias-*` cannot cascade in; these names are read from
     * the host document at render time and rewritten into the frame's `:root`.
     */
    const HTML_TOKEN_NAMES = [
      '--dsw-alias-bg-base',
      '--dsw-alias-bg-layer-1',
      '--dsw-alias-bg-layer-2',
      '--dsw-alias-bg-overlay',
      '--dsw-alias-border-l1',
      '--dsw-alias-border-l2',
      '--dsw-alias-brand-primary',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
      '--dsw-alias-state-success-primary',
      '--dsw-alias-state-warn-primary',
      '--dsw-alias-state-error-primary',
      '--dsw-alias-state-idle-primary',
    ]

    /**
     * Read the live theme token values for a sandboxed frame.
     *
     * Guarded for a DOM-less load (tests, SSR): it yields an empty map and the
     * frame simply falls back to `canvastext` and the browser color scheme.
     *
     * @returns {Record<string, string>} token name -> value.
     */
    function readThemeTokens() {
      const tokens = {}
      try {
        if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return tokens
        const probe = document.body || document.documentElement
        if (!probe) return tokens
        const style = getComputedStyle(probe)
        for (const name of HTML_TOKEN_NAMES) {
          const value = style.getPropertyValue(name).trim()
          if (value !== '') tokens[name] = value
        }
      } catch {
        return tokens
      }
      return tokens
    }

    /**
     * Compose the sandboxed document for one `html` block.
     *
     * Policy, in order: a CSP meta that blocks every network origin while still
     * allowing inline styles and scripts, a base stylesheet that defines the
     * theme tokens plus the host's system font stack, a transparent background,
     * and a reduced-motion rule. The agent fragment is embedded as the body (or
     * injected into its own `<head>` when it is a full document). Scripts are
     * allowed only because the frame is sandboxed without `allow-same-origin`.
     *
     * @param {string} source agent-supplied HTML/CSS/SVG.
     * @param {Record<string, string>} [tokens] theme token values.
     * @returns {string} the complete `srcdoc` document.
     */
    function composeHtmlDocument(source, tokens) {
      const values = tokens && typeof tokens === 'object' ? tokens : {}
      const declarations = HTML_TOKEN_NAMES
        .map((name) => (typeof values[name] === 'string' && values[name] !== '' ? name + ':' + values[name] + ';' : ''))
        .join('')
      const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'\">"
      const base = '<style>'
        + ':root{color-scheme:light dark;' + declarations + '}'
        + 'html,body{margin:0;padding:0;background:transparent;color:var(--dsw-alias-label-primary,canvastext);'
        + 'font:13.5px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
        + '*,*::before,*::after{box-sizing:border-box}'
        + 'img,svg,canvas,video{max-width:100%}'
        + '@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none !important;transition:none !important}}'
        + '</style>'
      const head = '<meta charset="utf-8"><meta name="color-scheme" content="light dark">' + csp + base
      if (/<!doctype\s+html|<html[\s>]/i.test(source)) {
        if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, '<head$1>' + head)
        if (/<html([^>]*)>/i.test(source)) return source.replace(/<html([^>]*)>/i, '<html$1>' + head)
        return head + source
      }
      return '<!doctype html><html><head>' + head + '</head><body>' + source + '</body></html>'
    }

    /**
     * Normalize one `html` block: the source is the card, kept verbatim up to
     * the transport cap; the frame height is clamped.
     *
     * @param {Record<string, any>} raw - raw block.
     * @returns {Record<string, any> | null}
     */
    function normalizeHtmlBlock(raw) {
      const html = typeof raw.html === 'string' ? raw.html.slice(0, MAX_HTML) : ''
      if (html.trim() === '') return null
      const height = typeof raw.height === 'number' && Number.isFinite(raw.height)
        ? Math.max(HTML_MIN_HEIGHT, Math.min(HTML_MAX_HEIGHT, Math.round(raw.height)))
        : HTML_DEFAULT_HEIGHT
      const block = { type: 'html', html, height }
      const title = optionalText(raw.title)
      const caption = optionalText(raw.caption)
      if (title !== undefined) block.title = title
      if (caption !== undefined) block.caption = caption
      return block
    }

    /**
     * Render one `html` block: the agent's own HTML/CSS/SVG document inside a
     * sandboxed frame, with a preview/source toggle so the reader can check what
     * actually runs.
     *
     * @param {any} block - normalized `html` block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any}
     */
    function renderHtmlBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(HtmlBlock, { key, block, t })
    }

    /**
     * The sandboxed frame. `sandbox="allow-scripts"` without
     * `allow-same-origin` gives the document an opaque origin: it can animate,
     * but it cannot read the app, storage, or cookies; the CSP in `srcdoc`
     * blocks every network origin, so replay stays deterministic.
     */
    function HtmlBlock(props) {
      const { block, t } = props
      const [showSource, setShowSource] = React.useState(false)
      const srcdoc = React.useMemo(
        () => composeHtmlDocument(block.html, readThemeTokens()),
        [block.html],
      )
      const label = block.title || t('html.label')
      const children = [
        h(
          'div',
          { key: 'bar', className: PREFIX + 'html-bar' },
          h('span', { className: PREFIX + 'html-title' }, block.title || t('html.label')),
          h('button', {
            key: 'toggle',
            type: 'button',
            className: PREFIX + 'html-toggle',
            'aria-pressed': showSource ? 'true' : 'false',
            'aria-label': showSource ? t('html.preview') : t('html.source'),
            onClick: () => setShowSource((value) => !value),
          }, showSource ? t('html.preview') : t('html.source')),
        ),
      ]
      children.push(showSource
        ? h('pre', { key: 'source', className: PREFIX + 'html-source' }, block.html)
        : h('iframe', {
          key: 'frame',
          className: PREFIX + 'html-frame',
          title: label,
          sandbox: 'allow-scripts',
          referrerPolicy: 'no-referrer',
          loading: 'lazy',
          srcDoc: srcdoc,
          style: { height: block.height + 'px' },
          'data-dsh-super-cards': '1',
        }))
      if (block.caption) {
        children.push(h('figcaption', { key: 'caption', className: PREFIX + 'html-caption' }, richChildren(block.caption, 'htmlcap')))
      }
      return h('figure', { className: PREFIX + 'html' }, children)
    }

    // -----------------------------------------------------------------------
    // Auto layout: derive blocks from a `content` spec.
    //
    // Mirrors `lib/content.js`: the card is rebuilt from the recorded call
    // arguments, so this half must make the same choices the Host made when it
    // accepted the call. The host/client parity test pins both sides together.
    // -----------------------------------------------------------------------

    /**
     * Blocks that need the wider share inside a section row (mirrors the Host):
     * charts scale with their frame, so they stay at one share.
     */
    const WIDE_TYPES = ['table', 'heatmap', 'kanban', 'diagram', 'code', 'image', 'html', 'tree', 'tabs']

    /** Copy `value` onto `target[key]` only when it is defined. */
    function cput(target, key, value) {
      if (value !== undefined) target[key] = value
    }

    /** Whether a value is a plain JSON object. */
    function cplain(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /** Coerce a scalar to bounded text, mirroring `toText` in the Host. */
    function ctext(value, max) {
      const limit = typeof max === 'number' && max > 0 ? max : MAX_TEXT
      if (typeof value === 'string') return value.slice(0, limit)
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value === 'boolean') return String(value)
      return ''
    }

    /** Coerce a scalar to optional text, mirroring `toOptionalText` in the Host. */
    function coptional(value, max) {
      const text = ctext(value, max)
      return text === '' ? undefined : text
    }

    /** Coerce a number, mirroring `toNumber` in the Host. */
    function cnumber(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed === '') return undefined
        const parsed = Number(trimmed)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return undefined
    }

    /** Coerce a tone, mirroring `toTone` in the Host. */
    function ctone(value) {
      return typeof value === 'string' && TONE_NAMES.indexOf(value) !== -1 ? value : undefined
    }

    /** Read labeled items from an array of objects or a plain label→value map. */
    function citems(value, labelKey) {
      if (Array.isArray(value)) return value.filter(cplain)
      if (cplain(value)) {
        const items = []
        for (const label of Object.keys(value)) items.push({ [labelKey]: label, value: value[label] })
        return items
      }
      return []
    }

    /** Read a numeric series with optional point labels. */
    function cseries(value) {
      const values = []
      const labels = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (cplain(raw)) {
          const number = cnumber(raw.value)
          if (number === undefined) continue
          values.push(number)
          labels.push(ctext(raw.label, 60))
          continue
        }
        const number = cnumber(raw)
        if (number === undefined) continue
        values.push(number)
        labels.push('')
      }
      return { values, labels }
    }

    /**
     * Derive the block list of a content spec (mirror of `deriveContent`).
     *
     * @param {unknown} content - raw `content` object.
     * @param {string} [layout] - `'auto' | 'stack'`.
     * @param {number} [depth] - `sections` recursion guard.
     * @returns {Array<Record<string, any>>} raw blocks.
     */
    function deriveContent(content, layout, depth) {
      if (!cplain(content)) return []
      const mode = layout === 'stack' ? 'stack' : 'auto'
      const level = typeof depth === 'number' && depth > 0 ? depth : 0
      const entries = []
      for (const key of Object.keys(content)) {
        const value = content[key]
        if (value === undefined || value === null) continue
        const blocks = deriveContentField(key, value, { layout: mode, depth: level })
        if (blocks.length > 0) entries.push({ key, blocks })
      }
      if (entries.length === 0) return []
      const head = []
      const body = []
      const tail = []
      for (const entry of entries) {
        if (entry.key === 'summary') head.push.apply(head, entry.blocks)
        else if (entry.key === 'actions') tail.push.apply(tail, entry.blocks)
        else body.push.apply(body, entry.blocks)
      }
      // Blocks stack in reading order; only `sections` (or an explicit
      // `columns` inside `blocks`) becomes a side-by-side row. Mirrors the Host:
      // auto-pairing unrelated blocks read as two disconnected panels.
      return head.concat(body, tail)
    }

    /**
     * Share each section column receives: a section that carries a wide block
     * takes two shares. Mirrors `sectionWeights` in `lib/content.js`.
     * @param {{ blocks: Array<Record<string, any>> }[]} sections - laid-out sections.
     * @returns {number[]|undefined} weights, or undefined for equal columns.
     */
    function contentSectionWeights(sections) {
      const weights = sections.map((section) => (
        section.blocks.some((block) => WIDE_TYPES.indexOf(block.type) !== -1) ? 2 : 1
      ))
      return weights.some((weight) => weight > 1) ? weights : undefined
    }

    /** Rough block heights used to keep a section row balanced (mirrors the Host). */
    const CONTENT_BLOCK_HEIGHT = {
      text: 44, heading: 28, callout: 64, stats: 92, badges: 34, sparkline: 118,
      pie: 176, quote: 64, actions: 40, divider: 1, live: 60, controls: 84,
      diagram: 176, heatmap: 96, diff: 120, kanban: 132, tabs: 148, columns: 140, html: 200,
    }

    /** Estimate the rendered height of one raw block. */
    function contentBlockHeight(block) {
      const type = typeof block.type === 'string' ? block.type : ''
      switch (type) {
        case 'table': return 34 + (Array.isArray(block.rows) ? block.rows.length : 0) * 26
        case 'keyvalue': {
          const items = Array.isArray(block.items) ? block.items.length : 0
          const layout = kvLayout(block.items, block.columns)
          // A row sheet is one line per fact; a tile grid is a tile per fact
          // over the columns it actually gets.
          if (layout.layout === 'rows') return items * 27
          return Math.ceil(items / Math.max(1, layout.cols)) * 38
        }
        case 'list': return (Array.isArray(block.items) ? block.items.length : 0) * 24 + 4
        case 'progress': return (Array.isArray(block.items) ? block.items.length : 0) * 30
        case 'bars': return (Array.isArray(block.items) ? block.items.length : 0) * 26
        case 'timeline': return (Array.isArray(block.items) ? block.items.length : 0) * 34
        case 'links': return (Array.isArray(block.items) ? block.items.length : 0) * 44
        case 'tree': return Math.min(10, contentTreeNodes(block.nodes)) * 24 + 8
        case 'code': return 40 + Math.min(14, String(block.code || '').split('\n').length) * 17
        case 'image': return typeof block.height === 'number' ? block.height : 240
        default: return CONTENT_BLOCK_HEIGHT[type] === undefined ? 60 : CONTENT_BLOCK_HEIGHT[type]
      }
    }

    /** Count tree nodes, bounded. */
    function contentTreeNodes(nodes) {
      let count = 0
      const walk = (list) => {
        for (const raw of Array.isArray(list) ? list : []) {
          if (count >= 10) return
          if (!cplain(raw)) continue
          count += 1
          walk(raw.children)
        }
      }
      walk(nodes)
      return count
    }

    /**
     * Whether the sections have comparable heights: a tall column beside a short
     * one leaves a hole that reads worse than a full-width stack.
     * @param {{ blocks: Array<Record<string, any>> }[]} sections - laid-out sections.
     * @returns {boolean}
     */
    function contentSectionsCanSplit(sections) {
      if (sections.length < 2) return false
      const heights = sections.map((section) => {
        let total = 0
        for (const block of section.blocks) total += contentBlockHeight(block)
        return total + Math.max(0, section.blocks.length - 1) * 11
      })
      const max = Math.max.apply(null, heights)
      const min = Math.min.apply(null, heights)
      if (max <= 0) return false
      return max / Math.max(1, min) <= 2.2
    }

    /**
     * Derive the blocks of one content field.
     * @param {string} key - field name.
     * @param {unknown} value - field value.
     * @param {{ layout: string, depth: number }} context - derivation context.
     * @returns {Array<Record<string, any>>} raw blocks.
     */
    function deriveContentField(key, value, context) {
      switch (key) {
        case 'summary': return singleBlock(contentCallout(value, 'info'))
        case 'note': return singleBlock(contentCallout(value, 'warn'))
        case 'metrics': return contentMetrics(value)
        case 'series': return contentSeries(value)
        case 'breakdown': return contentBreakdown(value)
        case 'table': return contentTable(value)
        case 'steps': return contentSteps(value)
        case 'items': return contentBullets(value)
        case 'facts': return contentFacts(value)
        case 'tags': return contentTags(value)
        case 'code': return contentCode(value)
        case 'quote': return contentQuote(value)
        case 'links': return contentLinks(value)
        case 'image': return contentImage(value)
        case 'tree': return contentTree(value)
        case 'flow': return contentFlow(value)
        case 'sections': return contentSections(value, context)
        case 'blocks': return contentManual(value)
        case 'actions': return contentActions(value)
        default: return []
      }
    }

    /** Wrap one optional raw block into a list. */
    function singleBlock(block) {
      return block === null ? [] : [block]
    }

    /** Build a callout from a string or `{text, title?, tone?}`. */
    function contentCallout(value, defaultTone) {
      if (typeof value === 'string' || typeof value === 'number') {
        const body = coptional(value)
        return body === undefined ? null : { type: 'callout', text: body, tone: defaultTone }
      }
      if (!cplain(value)) return null
      const body = coptional(value.text)
      if (body === undefined) return null
      const block = { type: 'callout', text: body }
      cput(block, 'title', coptional(value.title))
      const tone = ctone(value.tone)
      block.tone = tone === undefined ? defaultTone : tone
      return block
    }

    /** Build the metric grid. */
    function contentMetrics(value) {
      const items = []
      for (const raw of citems(value, 'label')) {
        const label = coptional(raw.label, 60)
        if (label === undefined) continue
        const item = { label, value: raw.value }
        cput(item, 'hint', coptional(raw.hint))
        cput(item, 'delta', coptional(raw.delta))
        cput(item, 'tone', ctone(raw.tone))
        items.push(item)
      }
      return items.length === 0 ? [] : [{ type: 'stats', items }]
    }

    /** Build a trend line or columns from a series. */
    function contentSeries(value) {
      const spec = Array.isArray(value) ? { values: value } : cplain(value) ? value : null
      if (spec === null) return []
      const read = cseries(spec.values)
      if (read.values.length === 0) return []
      const labels = Array.isArray(spec.labels) && spec.labels.length === read.values.length
        ? spec.labels.map((label) => ctext(label, 60))
        : read.labels
      const hasLabels = labels.some((label) => label !== '')
      const explicit = spec.kind === 'compare' || spec.kind === 'bars'
        ? 'compare'
        : spec.kind === 'trend' || spec.kind === 'line'
          ? 'trend'
          : undefined
      const trend = explicit === undefined ? read.values.length >= 6 || !hasLabels : explicit === 'trend'
      if (trend) {
        const block = { type: 'sparkline', values: read.values }
        if (hasLabels) block.labels = labels
        cput(block, 'title', coptional(spec.title))
        cput(block, 'unit', coptional(spec.unit, 40))
        cput(block, 'tone', ctone(spec.tone))
        return [block]
      }
      const items = read.values.map((number, index) => {
        const label = labels[index] !== undefined && labels[index] !== '' ? labels[index] : String(index + 1)
        return { label, value: number }
      })
      const block = { type: 'bars', items }
      if (items.length <= 8) block.direction = 'vertical'
      cput(block, 'title', coptional(spec.title))
      cput(block, 'unit', coptional(spec.unit, 40))
      return [block]
    }

    /** Build a donut (or bars beyond the slice cap) from share items. */
    function contentBreakdown(value) {
      const spec = Array.isArray(value) ? { items: value } : cplain(value) ? value : null
      if (spec === null) return []
      const numeric = []
      for (const raw of citems(spec.items, 'label')) {
        const number = cnumber(raw.value)
        if (number === undefined || number < 0) continue
        const label = coptional(raw.label, 60)
        if (label === undefined) continue
        const item = { label, value: number }
        cput(item, 'tone', ctone(raw.tone))
        numeric.push(item)
      }
      if (numeric.length === 0) return []
      const wantsPie = spec.kind !== 'bars' && spec.kind !== 'columns'
      if (wantsPie && numeric.length <= MAX_PIE_SLICES) {
        const block = { type: 'pie', items: numeric }
        cput(block, 'title', coptional(spec.title))
        cput(block, 'unit', coptional(spec.unit, 40))
        return [block]
      }
      const block = { type: 'bars', items: numeric }
      cput(block, 'title', coptional(spec.title))
      cput(block, 'unit', coptional(spec.unit, 40))
      return [block]
    }

    /** Build the table block. */
    function contentTable(value) {
      if (!cplain(value)) return []
      const columns = []
      for (const raw of Array.isArray(value.columns) ? value.columns : []) {
        const column = ctext(raw).trim()
        if (column !== '') columns.push(column)
      }
      if (columns.length === 0) return []
      const block = { type: 'table', columns, rows: Array.isArray(value.rows) ? value.rows : [] }
      if (Array.isArray(value.align)) block.align = value.align
      cput(block, 'caption', coptional(value.caption))
      return [block]
    }

    /** Build a timeline from steps. */
    function contentSteps(value) {
      const items = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (cplain(raw)) {
          const title = coptional(raw.title, 120)
          if (title === undefined) continue
          const item = { title }
          cput(item, 'text', coptional(raw.text))
          cput(item, 'time', coptional(raw.time, 40))
          cput(item, 'tone', ctone(raw.tone))
          items.push(item)
          continue
        }
        const title = coptional(raw, 120)
        if (title !== undefined) items.push({ title })
      }
      return items.length === 0 ? [] : [{ type: 'timeline', items }]
    }

    /** Build bullets from strings. */
    function contentBullets(value) {
      const items = []
      for (const raw of Array.isArray(value) ? value : []) {
        const body = cplain(raw) ? coptional(raw.text) : coptional(raw)
        if (body !== undefined) items.push(body)
      }
      return items.length === 0 ? [] : [{ type: 'list', items }]
    }

    /** Build the spec sheet; `kvLayout` picks tiles or rows from its shape. */
    function contentFacts(value) {
      const items = []
      for (const raw of citems(value, 'key')) {
        const key = coptional(raw.key, 60)
        if (key === undefined) continue
        items.push({ key, value: ctext(raw.value) })
      }
      if (items.length === 0) return []
      return [{ type: 'keyvalue', items }]
    }

    /** Build badges from strings or `{label, tone?}` items. */
    function contentTags(value) {
      const items = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (cplain(raw)) {
          const label = coptional(raw.label, 40)
          if (label === undefined) continue
          const item = { label }
          cput(item, 'tone', ctone(raw.tone))
          items.push(item)
          continue
        }
        const label = coptional(raw, 40)
        if (label !== undefined) items.push({ label })
      }
      return items.length === 0 ? [] : [{ type: 'badges', items }]
    }

    /** Build the code block. */
    function contentCode(value) {
      if (typeof value === 'string') {
        return value.slice(0, MAX_CODE) === '' ? [] : [{ type: 'code', code: value.slice(0, MAX_CODE) }]
      }
      if (!cplain(value)) return []
      const code = typeof value.code === 'string' ? value.code : typeof value.source === 'string' ? value.source : ''
      if (code === '') return []
      const block = { type: 'code', code: code.slice(0, MAX_CODE) }
      cput(block, 'language', coptional(value.language, 80))
      cput(block, 'title', coptional(value.title))
      return [block]
    }

    /** Build the pull quote. */
    function contentQuote(value) {
      if (typeof value === 'string') {
        const body = coptional(value)
        return body === undefined ? [] : [{ type: 'quote', text: body }]
      }
      if (!cplain(value)) return []
      const body = coptional(value.text)
      if (body === undefined) return []
      const block = { type: 'quote', text: body }
      cput(block, 'by', coptional(value.by, 120))
      return [block]
    }

    /** Build link tiles. */
    function contentLinks(value) {
      const items = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (!cplain(raw)) continue
        const label = coptional(raw.label, 120)
        const href = coptional(raw.href, 2000)
        if (label === undefined || href === undefined) continue
        const item = { label, href }
        cput(item, 'description', coptional(raw.description))
        items.push(item)
      }
      return items.length === 0 ? [] : [{ type: 'links', items }]
    }

    /** Build the inline image block. */
    function contentImage(value) {
      if (typeof value === 'string') return value.trim() === '' ? [] : [{ type: 'image', src: value }]
      if (!cplain(value)) return []
      const block = { type: 'image', src: value.src }
      cput(block, 'alt', coptional(value.alt, 300))
      cput(block, 'caption', coptional(value.caption, 300))
      if (typeof value.height === 'number') block.height = value.height
      if (value.fit === 'cover' || value.fit === 'contain') block.fit = value.fit
      return [block]
    }

    /** Build the hierarchy tree. */
    function contentTree(value) {
      const spec = Array.isArray(value) ? { nodes: value } : cplain(value) ? value : null
      if (spec === null) return []
      const block = { type: 'tree', nodes: Array.isArray(spec.nodes) ? spec.nodes : [] }
      cput(block, 'title', coptional(spec.title))
      return [block]
    }

    /** Build the flow diagram. */
    function contentFlow(value) {
      if (!cplain(value)) return []
      const block = { type: 'diagram' }
      if (typeof value.kind === 'string' && value.kind !== '') block.kind = value.kind
      cput(block, 'title', coptional(value.title))
      cput(block, 'direction', coptional(value.direction, 2))
      if (Array.isArray(value.nodes)) block.nodes = value.nodes
      if (Array.isArray(value.edges)) block.edges = value.edges
      if (Array.isArray(value.participants)) block.participants = value.participants
      if (Array.isArray(value.messages)) block.messages = value.messages
      return [block]
    }

    /** Pass explicit blocks through (the escape hatch inside a content spec). */
    function contentManual(value) {
      const blocks = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (cplain(raw) && typeof raw.type === 'string' && raw.type !== '') blocks.push(raw)
      }
      return blocks
    }

    /** Build the next-step buttons. */
    function contentActions(value) {
      const items = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (!cplain(raw)) continue
        const label = coptional(raw.label, 80)
        const prompt = coptional(raw.prompt)
        if (label === undefined || prompt === undefined) continue
        const item = { label, prompt }
        if (raw.tone === 'primary') item.tone = 'primary'
        items.push(item)
      }
      return items.length === 0 ? [] : [{ type: 'actions', items }]
    }

    /**
     * Lay out named sections: two or three become columns, four or five become
     * tabs, more than that stacks under their own headings.
     *
     * @param {unknown} value - section array.
     * @param {{ layout: string, depth: number }} context - derivation context.
     * @returns {Array<Record<string, any>>} raw blocks.
     */
    function contentSections(value, context) {
      const sections = []
      for (const raw of Array.isArray(value) ? value : []) {
        if (!cplain(raw)) continue
        const heading = coptional(raw.heading) || coptional(raw.title) || coptional(raw.label) || 'Section ' + (sections.length + 1)
        const inner = {}
        for (const key of Object.keys(raw)) {
          if (key === 'heading' || key === 'title' || key === 'label') continue
          inner[key] = raw[key]
        }
        const blocks = context.depth >= 2 ? [] : deriveContent(inner, 'stack', context.depth + 1)
        if (blocks.length === 0) continue
        sections.push({ heading, blocks })
      }
      if (sections.length === 0) return []
      if (context.layout === 'auto' && sections.length >= 2 && sections.length <= MAX_COLUMNS
        && contentSectionsCanSplit(sections)) {
        const columns = {
          type: 'columns',
          items: sections.map((section) => ({ label: section.heading, blocks: section.blocks })),
        }
        const weights = contentSectionWeights(sections)
        if (weights !== undefined) columns.weights = weights
        return [columns]
      }
      if (context.layout === 'auto' && sections.length > MAX_COLUMNS && sections.length <= MAX_TABS) {
        return [{
          type: 'tabs',
          items: sections.map((section) => ({ label: section.heading.slice(0, 60), blocks: section.blocks })),
        }]
      }
      const blocks = []
      for (const section of sections) {
        blocks.push({ type: 'heading', text: section.heading, level: 2 })
        blocks.push.apply(blocks, section.blocks)
      }
      return blocks
    }

    /**
     * Normalize one spec block through the registry, applying the host caps and
     * dropping anything unrecognized or unusable (forward compatibility: never crash).
     *
     * @param {unknown} raw
     * @returns {Record<string, any> | null}
     */
    function normalizeBlock(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      try {
        const alias = typeof raw.type === 'string' ? BLOCK_ALIASES.get(raw.type) : undefined
        const impl = alias === undefined ? blockImpl(raw.type) : blockImpl(alias.type)
        if (impl === undefined) return null
        const source = alias !== undefined && alias.tone !== undefined && raw.tone === undefined
          ? Object.assign({}, raw, { tone: alias.tone })
          : raw
        const normalized = impl.normalize(source)
        if (normalized === undefined) return null
        const motion = normalizeMotion(raw.motion)
        return motion === null ? normalized : Object.assign({}, normalized, { motion })
      } catch {
        return null
      }
    }

    /**
     * Normalize a whole UI spec: validate the envelope, mirror the host caps,
     * skip unknown/invalid blocks silently.
     *
     * @param {unknown} raw - parsed `argsRaw` value.
     * @returns {{ title?: string, subtitle?: string, icon?: string, blocks: Array<Record<string, any>> } | null}
     *   null when the value is not a spec object with a `blocks` array.
     */
    function normalizeSpec(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const derived = cplain(raw.content) ? deriveContent(raw.content, raw.layout) : []
      const explicit = Array.isArray(raw.blocks) ? raw.blocks : null
      // `blocks: []` is a valid (if empty) card; a spec with neither field is not.
      if (explicit === null && derived.length === 0) return null
      const source = explicit === null ? derived : derived.concat(explicit)
      const blocks = []
      let auto = 0
      for (let index = 0; index < source.length; index += 1) {
        if (blocks.length >= MAX_BLOCKS) break
        const block = source[index]
        const normalized = normalizeBlock(block)
        if (normalized !== null) {
          blocks.push(normalized)
          if (index < derived.length) auto += 1
          continue
        }
        // A well-typed wire block this Client cannot render is kept as a visible
        // placeholder; malformed blocks of known types (and folded aliases) are
        // still dropped, because the Host reports those as unusable content.
        if (block && typeof block === 'object' && typeof block.type === 'string'
          && block.type !== '' && resolvedBlockImpl(block.type) === undefined) {
          blocks.push({ type: UNSUPPORTED_TYPE, missingType: block.type })
        }
      }
      const icon = typeof raw.icon === 'string' && ICON_NAMES.indexOf(raw.icon) !== -1 ? raw.icon : undefined
      const status = typeof raw.status === 'string' && STATUS_NAMES.indexOf(raw.status) !== -1 ? raw.status : undefined
      const look = typeof raw.look === 'string' && LOOK_NAMES.indexOf(raw.look) !== -1 ? raw.look : undefined
      return {
        title: optionalText(raw.title),
        subtitle: optionalText(raw.subtitle),
        icon,
        status,
        look,
        auto: auto > 0,
        blocks,
      }
    }

    /**
     * Extract the card material from one recorded Tool stage — and from nothing
     * else. Pure, never throws; the renderer's outcome depends only on the
     * recorded call material, so replay/resume rebuilds the same card.
     *
     * @param {unknown} phase - `'preparing' | 'start' | 'result'` (recorded stage).
     * @param {any} block - the stage's block (ToolCallBlock / ToolResultNode).
     * @returns {{ kind: 'preparing' }
     *   | { kind: 'ready', spec: object }
     *   | { kind: 'tool-error', text: string }
     *   | { kind: 'missing-call' }
     *   | { kind: 'invalid', detail: string }}
     */
    /**
     * Explain why a recorded call cannot become a card. A call rejected before
     * dispatch (an unknown tool, a mode where only `run_code` is callable) still
     * reaches the row with `arguments: {}`, and a truncated call keeps an
     * incomplete string; saying which one happened is more useful than a
     * blanket "invalid spec".
     *
     * @param {unknown} raw - recorded argument text.
     * @param {{ ok: boolean, error?: string, value?: unknown }} parsed - parse result.
     * @returns {{ kind: string, reason: string, detail?: string }} extract result.
     */
    function invalidExtract(raw, parsed) {
      if (typeof raw !== 'string' || raw.trim() === '') return { kind: 'invalid', reason: 'empty' }
      if (!parsed.ok) return { kind: 'invalid', reason: 'parse', detail: parsed.error }
      const value = parsed.value
      if (value === null || value === undefined) return { kind: 'invalid', reason: 'empty' }
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        return { kind: 'invalid', reason: 'empty' }
      }
      return { kind: 'invalid', reason: 'shape' }
    }

    function extractSpec(phase, block) {
      try {
        if (phase === 'preparing') return { kind: 'preparing' }
        if (!block || typeof block !== 'object') return { kind: 'invalid', detail: 'missing block' }
        if (phase === 'start') {
          const parsed = parseSpecJson(block.argsRaw)
          if (!parsed.ok) return invalidExtract(block.argsRaw, parsed)
          const spec = normalizeSpec(parsed.value)
          if (spec === null) return invalidExtract(block.argsRaw, parsed)
          return { kind: 'ready', spec }
        }
        if (phase === 'result') {
          if (block.isError === true) return { kind: 'tool-error', text: contentText(block.content) }
          const call = block.call && typeof block.call === 'object' ? block.call : null
          if (call === null || typeof call.argsRaw !== 'string') return { kind: 'missing-call' }
          const parsed = parseSpecJson(call.argsRaw)
          if (!parsed.ok) return invalidExtract(call.argsRaw, parsed)
          const spec = normalizeSpec(parsed.value)
          if (spec === null) return invalidExtract(call.argsRaw, parsed)
          return { kind: 'ready', spec }
        }
        // Unknown stage: derive from the recorded shape rather than throwing.
        if (typeof block.argsRaw === 'string') return extractSpec('start', block)
        if (block.call || block.isError === true) return extractSpec('result', block)
        return { kind: 'invalid', detail: 'unknown stage ' + String(phase) }
      } catch (error) {
        return { kind: 'invalid', detail: describeError(error) }
      }
    }

    /**
     * Build the accessible label summarizing a bar chart.
     *
     * @param {any} block - normalized bars block.
     * @returns {string}
     */
    function barsSummary(block) {
      const parts = block.items
        .slice(0, 8)
        .map((item) => plainInline(item.label) + ' ' + formatNumber(item.value) + (block.unit || ''))
      const suffix = block.items.length > 8 ? ', …' : ''
      return (block.title ? plainInline(block.title) + ': ' : '') + parts.join(', ') + suffix
    }

    /**
     * Build the accessible label summarizing a sparkline.
     *
     * @param {any} block - normalized sparkline block.
     * @returns {string}
     */
    function sparkSummary(block) {
      const values = block.values
      const unit = block.unit || ''
      const min = Math.min.apply(null, values)
      const max = Math.max.apply(null, values)
      const last = values[values.length - 1]
      return (
        (block.title ? plainInline(block.title) + ': ' : '') +
        'min ' + formatNumber(min) + unit +
        ', max ' + formatNumber(max) + unit +
        ', last ' + formatNumber(last) + unit
      )
    }

    /**
     * Render one normalized block.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {{ t: (key: string, vars?: Record<string, unknown>) => string, inputActions?: any }} context
     * @returns {any | null} React element, or null for an unknown type.
     */
    /**
     * Render one `text` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderTextBlock(block, key, context) {
      return h(
        'p',
        { key, className: PREFIX + 'text' + (block.muted ? ' ' + PREFIX + 'muted' : '') },
        richChildren(block.text, key),
      )
    }

    /**
     * Render one `heading` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderHeadingBlock(block, key, context) {
      const tag = block.level === 1 ? 'h3' : block.level === 3 ? 'h5' : 'h4'
      return h(
        tag,
        { key, className: PREFIX + 'heading ' + PREFIX + 'heading-' + (block.level || 2) },
        richChildren(block.text, key),
      )
    }

    /**
     * Render one `callout` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderCalloutBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(
        'div',
        { key, className: PREFIX + 'callout', style: toneStyle(accentVar(block.tone)) },
        block.title ? h('div', { className: PREFIX + 'callout-title' }, richChildren(block.title, key + 't')) : null,
        h('div', { className: PREFIX + 'callout-text' }, richChildren(block.text, key + 'x')),
      )
    }

    /**
     * How many KPI tiles share a row at the widest card the stylesheet allows.
     * The count is picked so the last row is never a single lonely tile — six
     * metrics read 3+3 rather than 5+1 — while a row of two to four keeps its
     * natural shape. Narrow cards fold this base count back down in CSS.
     *
     * @param {number} count - number of stat items.
     * @returns {number} base column count (1..5).
     */
    function statColumns(count) {
      if (!Number.isFinite(count) || count < 1) return 1
      const total = Math.trunc(count)
      if (total === 1) return 1
      if (total <= 4) return total
      const widest = Math.min(5, Math.ceil(total / 2))
      for (let cols = widest; cols >= 2; cols -= 1) {
        const rest = total % cols
        if (rest === 0 || rest * 2 >= cols) return cols
      }
      return Math.min(total, 5)
    }

    /**
     * Render one `stats` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderStatsBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'stats', 'data-cols': String(statColumns(block.items.length)) },
        block.items.map((item, index) =>
          h(
            'div',
            {
              key: index,
              className: PREFIX + 'stat',
              'data-toned': item.tone === 'neutral' ? undefined : '1',
              style: toneStyle(accentVar(item.tone)),
            },
            h('div', { className: PREFIX + 'stat-label' }, richChildren(item.label, key + 'l' + index)),
            h(
              'div',
              { className: PREFIX + 'stat-line' },
              h('span', { className: PREFIX + 'stat-value' }, richChildren(item.value, key + 'v' + index)),
              item.delta
                ? h('span', { className: PREFIX + 'stat-delta' }, richChildren(item.delta, key + 'd' + index))
                : null,
            ),
            item.hint ? h('div', { className: PREFIX + 'stat-hint' }, richChildren(item.hint, key + 'h' + index)) : null,
          ),
        ),
      )
    }

    /**
     * Render one `table` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderTableBlock(block, key, context) {
      const alignClass = (index) => {
        const align = block.align ? block.align[index] : undefined
        return align ? ' ' + PREFIX + 'align-' + align : ''
      }
      return h(
        'div',
        { key, className: PREFIX + 'table-block' },
        h(
          'div',
          { className: PREFIX + 'tablewrap' },
          h(
            'table',
            { className: PREFIX + 'table' },
            h(
              'thead',
              { className: PREFIX + 'thead' },
              h(
                'tr',
                { className: PREFIX + 'tr' },
                block.columns.map((column, index) =>
                  h(
                    'th',
                    { key: index, scope: 'col', className: PREFIX + 'th' + alignClass(index) },
                    richChildren(column, key + 'h' + index),
                  ),
                ),
              ),
            ),
            block.rows.length > 0
              ? h(
                  'tbody',
                  { className: PREFIX + 'tbody' },
                  block.rows.map((row, rowIndex) =>
                    h(
                      'tr',
                      { key: rowIndex, className: PREFIX + 'tr' },
                      row.map((cell, cellIndex) =>
                        h(
                          'td',
                          { key: cellIndex, className: PREFIX + 'td' + alignClass(cellIndex) },
                          cell === null
                            ? h('span', { className: PREFIX + 'null' }, '—')
                            : richChildren(cell, key + 'r' + rowIndex + 'c' + cellIndex),
                        ),
                      ),
                    ),
                  ),
                )
              : null,
          ),
        ),
        block.caption ? h('div', { className: PREFIX + 'caption' }, richChildren(block.caption, key + 'cap')) : null,
      )
    }

    /** Facts a tile grid still holds; past this the sheet becomes rows. */
    const KV_TILE_MAX_ITEMS = 6
    /** Longest key a tile still holds on one line without squeezing its value. */
    const KV_TILE_MAX_KEY = 16
    /** Longest value a tile still holds before it reads as a sentence. */
    const KV_TILE_MAX_VALUE = 28

    /**
     * Choose how a `keyvalue` block lays its facts out.
     *
     * A fact sheet is two different shapes. Up to four short facts are a tile
     * grid — key above value, three across or two by two — which fills a wide
     * card without turning it into a form. Anything longer (a value that reads
     * as a sentence, a long key, more than four facts) is a row sheet: one
     * label column sized to the longest key, one value column holding the whole
     * line. That keeps a sentence out of a half-width tile and leaves an odd
     * count without a hole beside it.
     *
     * @param {Array<{ key: string, value: any }>} items - normalized items.
     * @param {1|2} [columns] - the block's explicit `columns` request.
     * @returns {{ layout: 'tiles' | 'rows', cols: number }}
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
      // Balanced tiles: two facts sit side by side, three fill one row, four
      // make a 2x2, five or six read 3+2 and 3+3, one fact takes the line.
      const cols = list.length === 4 ? 2 : list.length >= 5 ? 3 : Math.max(1, list.length)
      return { layout: 'tiles', cols }
    }

    /**
     * Render one `keyvalue` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderKeyvalueBlock(block, key, context) {
      const layout = kvLayout(block.items, block.columns)
      return h(
        'div',
        {
          key,
          className: PREFIX + 'kv',
          'data-layout': layout.layout,
          'data-cols': String(layout.cols),
        },
        block.items.map((item, index) =>
          h(
            'div',
            { key: index, className: PREFIX + 'kv-item' },
            h('div', { className: PREFIX + 'kv-key' }, richChildren(item.key, key + 'k' + index)),
            h('div', { className: PREFIX + 'kv-value' }, richChildren(item.value, key + 'v' + index)),
          ),
        ),
      )
    }

    /**
     * Items a list needs before it spends spare width on extra columns. Shorter
     * lists read better as one block; six is where the second column starts to
     * carry its own weight.
     */
    const LIST_FLOW_MIN_ITEMS = 6
    /**
     * Longest item a list still accepts before it stacks. A bullet that is
     * really a paragraph wants one wide-enough column, not three narrow ones.
     */
    const LIST_FLOW_MAX_ITEM = 220

    /**
     * Whether a `list` block flows into columns on a wide card. The card picks
     * the column count from its own width, so this only decides whether the
     * block is allowed to flow at all.
     *
     * @param {string[]} items - normalized items.
     * @returns {boolean}
     */
    function listFlows(items) {
      if (!Array.isArray(items) || items.length < LIST_FLOW_MIN_ITEMS) return false
      let longest = 0
      for (const item of items) {
        const length = typeof item === 'string' ? item.length : 0
        if (length > longest) longest = length
      }
      return longest <= LIST_FLOW_MAX_ITEM
    }

    /**
     * Render one `list` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderListBlock(block, key, context) {
      return h(
        block.ordered ? 'ol' : 'ul',
        { key, className: PREFIX + 'list', 'data-flow': listFlows(block.items) ? '1' : undefined },
        block.items.map((item, index) =>
          h('li', { key: index, className: PREFIX + 'li' }, richChildren(item, key + 'i' + index)),
        ),
      )
    }

    /**
     * Render one `badges` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderBadgesBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'badges' },
        block.items.map((item, index) =>
          h(
            'span',
            { key: index, className: PREFIX + 'badge', style: toneStyle(accentVar(item.tone)) },
            richChildren(item.label, key + 'b' + index),
          ),
        ),
      )
    }

    /**
     * Render one `progress` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderProgressBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'progress' },
        block.items.map((item, index) => {
          const clamped = clamp01(item.value)
          const percent = Math.round(clamped * 100)
          return h(
            'div',
            { key: index, className: PREFIX + 'progress-row' },
            h(
              'div',
              { className: PREFIX + 'progress-head' },
              h('span', { className: PREFIX + 'progress-label' }, richChildren(item.label, key + 'l' + index)),
              h(
                'span',
                { className: PREFIX + 'progress-value' },
                percent + '%',
                percent >= 100
                  ? h('span', { className: PREFIX + 'progress-check', 'aria-hidden': 'true' }, iconGlyph('check'))
                  : null,
              ),
            ),
            h(
              'div',
              {
                className: PREFIX + 'progress-track',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 1,
                'aria-valuenow': Math.round(clamped * 1000) / 1000,
                'aria-valuetext': percent + '%',
                style: toneStyle(progressVar(item.tone)),
              },
              h('span', { className: PREFIX + 'progress-fill', style: { width: percent + '%' } }),
            ),
            // A caption that only repeats the percentage the row already
            // prints is noise, not information.
            item.caption !== undefined && item.caption.trim() !== percent + '%'
              ? h('div', { className: PREFIX + 'progress-caption' }, richChildren(item.caption, key + 'c' + index))
              : null,
          )
        }),
      )
    }

    /**
     * Render one `bars` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderBarsBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const max = typeof block.max === 'number' && block.max > 0
        ? block.max
        : block.items.reduce((top, item) => Math.max(top, item.value), 0) || 1
      if (block.direction === 'vertical') {
        // Columns for a short series: same values as rows, read left to right.
        return h(
          'div',
          { key, className: PREFIX + 'bars-block' },
          block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 't')) : null,
          h(
            'div',
            { className: PREFIX + 'columns', role: 'img', 'aria-label': barsSummary(block) },
            block.items.map((item, index) => {
              const ratio = clamp01(max > 0 ? item.value / max : 0)
              const height = ratio === 0 ? 0 : Math.max(ratio * 100, 2)
              const value = formatNumber(item.value) + (block.unit || '')
              return h(
                'div',
                {
                  key: index,
                  className: PREFIX + 'column',
                  style: toneStyle(barVar(item.tone)),
                  title: item.label + ' · ' + value,
                },
                h(
                  'span',
                  { className: PREFIX + 'column-track' },
                  h('span', {
                    className: PREFIX + 'column-value',
                    style: { bottom: 'calc(' + formatNumber(height) + '% + 4px)' },
                  }, value),
                  h('span', { className: PREFIX + 'column-fill', style: { height: formatNumber(height) + '%' } }),
                ),
                h('span', { className: PREFIX + 'column-label' }, item.label),
              )
            }),
          ),
        )
      }
      return h(
        'div',
        { key, className: PREFIX + 'bars-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 't')) : null,
        h(
          'div',
          { className: PREFIX + 'bars', role: 'img', 'aria-label': barsSummary(block) },
          block.items.map((item, index) => {
            const ratio = clamp01(max > 0 ? item.value / max : 0)
            const width = Math.max(ratio * 100, ratio > 0 ? 1 : 0)
            return h(
              'div',
              { key: index, className: PREFIX + 'bar-row', style: toneStyle(barVar(item.tone)) },
              h('span', { className: PREFIX + 'bar-label', title: item.label }, item.label),
              h(
                'svg',
                {
                  className: PREFIX + 'bar-svg',
                  viewBox: '0 0 100 8',
                  preserveAspectRatio: 'none',
                  'aria-hidden': 'true',
                  focusable: 'false',
                },
                h('rect', { x: 0, y: 0, width: 100, height: 8, rx: 4, fill: 'currentColor', opacity: 0.14 }),
                h('rect', {
                  x: 0,
                  y: 0,
                  width: formatNumber(width),
                  height: 8,
                  rx: 4,
                  fill: 'currentColor',
                  className: PREFIX + 'bar-fill',
                }),
              ),
              h('span', { className: PREFIX + 'bar-value' }, formatNumber(item.value) + (block.unit || '')),
            )
          }),
        ),
      )
    }

    /**
     * Render one `sparkline` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    /**
     * Map a horizontal ratio (0..1) onto the nearest sample index.
     *
     * @param {number} ratio - pointer x as a fraction of the chart width.
     * @param {number} count - number of samples.
     * @returns {number} index in `0..count-1`, or -1 for an empty series.
     */
    function sparkIndexAt(ratio, count) {
      if (!(count > 0)) return -1
      if (count === 1) return 0
      const value = typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : 0
      const clamped = Math.min(1, Math.max(0, value))
      return Math.min(count - 1, Math.max(0, Math.round(clamped * (count - 1))))
    }

    /**
     * Interactive trend line: hovering (or focusing and pressing the arrow keys)
     * reads one sample with a guide, a dot and a value bubble. The line itself
     * stays a plain SVG, so a card that is never touched looks unchanged.
     *
     * @param {{ block: any, t: Function }} props - normalized block and translator.
     * @returns {any}
     */
    function SparklineBlock(props) {
      const { block, t } = props
      const [active, setActive] = React.useState(null)
      const values = block.values
      const min = Math.min.apply(null, values)
      const max = Math.max.apply(null, values)
      const span = max - min
      const points = values.map((value, index) => {
        const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100
        const y = span === 0 ? 50 : 100 - ((value - min) / span) * 100
        return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]
      })
      const line = points
        .map((point, index) => (index === 0 ? 'M' : 'L') + point[0] + ' ' + point[1])
        .join(' ')
      const area =
        'M' + points[0][0] + ' 100 ' +
        points.map((point) => 'L' + point[0] + ' ' + point[1]).join(' ') +
        ' L' + points[points.length - 1][0] + ' 100 Z'
      const labels = block.labels
      const firstLabel = labels && labels.length > 0 ? labels[0] : undefined
      const lastLabel = labels && labels.length > 1 ? labels[labels.length - 1] : undefined
      const index = typeof active === 'number' && active >= 0 && active < values.length ? active : null
      const point = index === null ? null : points[index]
      const label = index !== null && labels ? labels[index] : undefined
      const unit = block.unit || ''
      const read = index === null
        ? ''
        : (label === undefined || label === '' ? '' : label + ' · ') + formatNumber(values[index]) + unit
      const readIndex = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect || rect.width <= 0) return
        setActive(sparkIndexAt((event.clientX - rect.left) / rect.width, values.length))
      }
      const handleKey = (event) => {
        const name = event.key
        if (name === 'ArrowRight' || name === 'ArrowLeft') {
          event.preventDefault()
          const from = index === null ? (name === 'ArrowRight' ? -1 : values.length) : index
          const next = from + (name === 'ArrowRight' ? 1 : -1)
          setActive(Math.min(values.length - 1, Math.max(0, next)))
          return
        }
        if (name === 'Home' || name === 'End') {
          event.preventDefault()
          setActive(name === 'Home' ? 0 : values.length - 1)
          return
        }
        if (name === 'Escape') setActive(null)
      }
      return h(
        'div',
        {
          className: PREFIX + 'spark-block',
          // No explicit tone: let the stylesheet's brand ink apply instead of
          // the neutral gray a missing tone would otherwise resolve to.
          style: block.tone && block.tone !== 'neutral' ? toneStyle(accentVar(block.tone)) : undefined,
        },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, 'sparkTitle')) : null,
        h(
          'div',
          {
            className: PREFIX + 'spark' + (index === null ? '' : ' ' + PREFIX + 'spark--active'),
            role: 'img',
            'aria-label': sparkSummary(block),
            tabIndex: 0,
            onPointerMove: readIndex,
            onPointerLeave: () => setActive(null),
            onFocus: () => {
              if (index === null) setActive(values.length - 1)
            },
            onBlur: () => setActive(null),
            onKeyDown: handleKey,
          },
          h(
            'svg',
            {
              className: PREFIX + 'spark-svg',
              viewBox: '0 0 100 100',
              preserveAspectRatio: 'none',
              'aria-hidden': 'true',
              focusable: 'false',
            },
            h('path', { d: area, fill: 'currentColor', opacity: 0.16, stroke: 'none' }),
            h('path', {
              className: PREFIX + 'spark-line',
              d: line,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              pathLength: 100,
              vectorEffect: 'non-scaling-stroke',
            }),
          ),
          point === null
            ? null
            : h('span', {
                className: PREFIX + 'spark-guide',
                style: { left: point[0] + '%' },
                'aria-hidden': 'true',
              }),
          point === null
            ? null
            : h('span', {
                className: PREFIX + 'spark-dot',
                style: { left: point[0] + '%', top: point[1] + '%' },
                'aria-hidden': 'true',
              }),
          point === null
            ? null
            : h(
                'div',
                {
                  className: PREFIX + 'spark-tip',
                  style: { left: Math.min(88, Math.max(12, point[0])) + '%' },
                  'aria-hidden': 'true',
                },
                read,
              ),
        ),
        firstLabel !== undefined || lastLabel !== undefined
          ? h(
              'div',
              { className: PREFIX + 'spark-labels' },
              h('span', null, firstLabel || ''),
              h('span', null, lastLabel || ''),
            )
          : null,
        h('span', { className: PREFIX + 'sr', 'aria-live': 'polite' }, read),
      )
    }

    /**
     * Render one `sparkline` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderSparklineBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(SparklineBlock, { key, block, t })
    }

    /** Categorical ramp for slices without a tone: token-derived, theme-safe. */
    const PIE_RAMP = [86, 66, 50, 37, 27, 19, 12, 7]

    /**
     * Colour one slice: an explicit tone wins; otherwise a neutral shade of the
     * theme's text colour, so the chart reads in light and dark alike.
     *
     * @param {any} item - normalized slice.
     * @param {number} index - slice index.
     * @returns {string} CSS colour.
     */
    function pieSliceColor(item, index) {
      if (item && item.tone && item.tone !== 'neutral') return accentVar(item.tone)
      const weight = PIE_RAMP[Math.min(index, PIE_RAMP.length - 1)]
      return 'color-mix(in srgb, var(--dsw-alias-label-primary) ' + weight + '%, var(--dsw-alias-bg-layer-1))'
    }

    /**
     * One percentage with at most one decimal: 62% / 12.5%.
     *
     * @param {number} value - slice value.
     * @param {number} total - sum of all slices.
     * @returns {string} percentage label.
     */
    function percentLabel(value, total) {
      const percent = total > 0 ? (Math.max(value, 0) / total) * 100 : 0
      const rounded = Math.round(percent * 10) / 10
      return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + '%'
    }

    /**
     * Accessible one-line summary of a pie: "api 62% · web 27%".
     *
     * @param {any} block - normalized pie block.
     * @returns {string} summary text.
     */
    function pieSummary(block) {
      const total = block.items.reduce((sum, item) => sum + Math.max(item.value, 0), 0)
      return block.items.map((item) => item.label + ' ' + percentLabel(item.value, total)).join(' · ')
    }

    /**
     * Render one `pie` block: a donut (default) or a filled pie, with the legend
     * carrying the exact numbers so the chart itself can stay unlabelled.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderPieBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const items = block.items
      const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0) || 1
      const donut = block.donut !== false
      // A donut is a ring at radius 46; a filled pie is the same circle drawn
      // with a stroke as wide as the ring's diameter, so both share one centre.
      const radius = donut ? 46 : 23
      const stroke = donut ? 15 : 46
      const circumference = 2 * Math.PI * radius
      let offset = 0
      const slices = items.map((item, index) => {
        const fraction = Math.max(item.value, 0) / total
        const length = fraction * circumference
        const circle = h('circle', {
          key: 'slice' + index,
          className: PREFIX + 'pie-slice',
          cx: 60,
          cy: 60,
          r: radius,
          fill: 'none',
          strokeWidth: stroke,
          strokeDasharray: formatNumber(length) + ' ' + formatNumber(Math.max(circumference - length, 0.01)),
          strokeDashoffset: formatNumber(-offset),
          style: { stroke: pieSliceColor(item, index) },
        })
        offset += length
        return circle
      })
      return h(
        'div',
        { key, className: PREFIX + 'pie-block' },
        block.title ? h('div', { className: PREFIX + 'block-title' }, richChildren(block.title, key + 't')) : null,
        h(
          'div',
          { className: PREFIX + 'pie' + (donut ? '' : ' ' + PREFIX + 'pie--filled'), role: 'img', 'aria-label': pieSummary(block) },
          h(
            'div',
            { className: PREFIX + 'pie-figure' },
            h(
              'svg',
              { className: PREFIX + 'pie-svg', viewBox: '0 0 120 120', 'aria-hidden': 'true', focusable: 'false' },
              h(
                'g',
                { transform: 'rotate(-90 60 60)' },
                donut
                  ? h('circle', { className: PREFIX + 'pie-track', cx: 60, cy: 60, r: radius, fill: 'none', strokeWidth: stroke })
                  : null,
                slices,
              ),
            ),
            donut
              ? h(
                  'div',
                  { className: PREFIX + 'pie-center' },
                  // The number is what must sit on the ring's centre: it stays
                  // in flow and is centred, while the unit is an out-of-flow
                  // suffix so its width never pushes the digits off-centre.
                  h(
                    'span',
                    { className: PREFIX + 'pie-number' },
                    h('span', { className: PREFIX + 'pie-total' }, formatNumber(total)),
                    block.unit ? h('span', { className: PREFIX + 'pie-unit' }, block.unit) : null,
                  ),
                )
              : null,
          ),
          h(
            'div',
            { className: PREFIX + 'pie-legend' },
            items.map((item, index) => h(
              'div',
              { key: 'l' + index, className: PREFIX + 'pie-row' },
              h('span', {
                className: PREFIX + 'pie-swatch',
                style: { background: pieSliceColor(item, index) },
                'aria-hidden': 'true',
              }),
              h('span', { className: PREFIX + 'pie-label', title: item.label }, item.label),
              h(
                'span',
                { className: PREFIX + 'pie-amount' },
                h('span', { className: PREFIX + 'pie-value' }, formatNumber(item.value) + (block.unit || '')),
                block.unit === '%' ? null : h('span', { className: PREFIX + 'pie-pct' }, percentLabel(item.value, total)),
              ),
            )),
          ),
        ),
      )
    }

    /**
     * Render one `code` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderCodeBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(CodeBlock, { key, block, t })
    }

    /**
     * Render one `quote` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderQuoteBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'quote' },
        h('div', { className: PREFIX + 'quote-text' }, richChildren(block.text, key + 'x')),
        block.by
          ? h('div', { className: PREFIX + 'quote-by' }, '— ', richChildren(block.by, key + 'by'))
          : null,
      )
    }

    /**
     * Render one `timeline` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderTimelineBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      return h(
        'div',
        { key, className: PREFIX + 'timeline' },
        block.items.map((item, index) =>
          h(
            'div',
            { key: index, className: PREFIX + 'tl-item', style: toneStyle(accentVar(item.tone)) },
            h(
              'div',
              { className: PREFIX + 'tl-head' },
              h('span', { className: PREFIX + 'tl-title' }, richChildren(item.title, key + 't' + index)),
              item.time ? h('span', { className: PREFIX + 'tl-time' }, item.time) : null,
            ),
            item.text ? h('div', { className: PREFIX + 'tl-text' }, richChildren(item.text, key + 'x' + index)) : null,
          ),
        ),
      )
    }

    /**
     * Render one `links` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderLinksBlock(block, key, context) {
      return h(
        'div',
        { key, className: PREFIX + 'links' },
        block.items.map((item, index) => {
          const href = safeHref(item.href)
          return h(
            'div',
            { key: index, className: PREFIX + 'link-row' },
            href !== null
              ? h(
                  'a',
                  {
                    className: PREFIX + 'link',
                    href,
                    target: '_blank',
                    rel: 'noreferrer noopener',
                  },
                  richChildren(item.label, key + 'l' + index),
                )
              : h(
                  'span',
                  { className: PREFIX + 'link ' + PREFIX + 'link-plain' },
                  richChildren(item.label, key + 'l' + index),
                ),
            item.description
              ? h('span', { className: PREFIX + 'link-desc' }, richChildren(item.description, key + 'd' + index))
              : null,
          )
        }),
      )
    }

    /**
     * Render one `actions` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderActionsBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const inputActions = context ? context.inputActions : undefined
      return h(ActionsBlock, { key, block, t, inputActions })
    }

    /**
     * Render one `live` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderLiveBlock(block, key, context) {
      return renderLiveFeed(block, key, context)
    }

    /**
     * Render one `controls` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderControlsBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const inputActions = context ? context.inputActions : undefined
      return h(ControlsBlock, {
        key,
        block,
        t,
        inputActions,
        bindings: context ? context.bindings : undefined,
      })
    }

    /**
     * Render one `divider` block. Extracted into the BLOCK_IMPL registry.
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `inputActions`, `live`, `bindings`).
     * @returns {any}
     */
    function renderDividerBlock(block, key, context) {
      return h('div', { key, className: PREFIX + 'divider', role: 'separator' })
    }

    /**
     * Render one normalized block through the registry.
     *
     * @param {any} block - normalized block.
     * @param {string} key - React key.
     * @param {{ t: (key: string, vars?: Record<string, unknown>) => string, inputActions?: any }} context
     * @returns {any | null} React element, or null for an unknown type.
     */
    function renderBlock(block, key, context) {
      if (!block || typeof block !== 'object') return null
      if (block.type === UNSUPPORTED_TYPE) return renderUnsupportedBlock(block, key, context)
      const impl = blockImpl(block.type)
      if (impl === undefined || typeof impl.render !== 'function') return null
      return impl.render(block, key, context)
    }

    /**
     * Wrap one rendered block in its motion envelope.
     *
     * Motion is a property of the block's own box, so every preset works from
     * one thin wrapper instead of reaching into twenty renderers: the wrapper is
     * a normal grid child (same column rules, same entrance stagger), it carries
     * the effect class, and it forwards duration/delay/loop as custom properties.
     * The stylesheet owns every keyframe, so a card cannot inject CSS, and the
     * wrapper is what the session log makes deterministic.
     *
     * @param {any} node - the rendered block element.
     * @param {any} block - normalized block, possibly carrying `motion`.
     * @returns {any} the block, wrapped when it carries motion.
     */
    function withMotion(node, block) {
      const motion = block && block.motion ? block.motion : null
      if (motion === null) return node
      const classes = [PREFIX + 'motion-wrap', PREFIX + 'motion--' + motion.effect]
      if (block.type === 'live') classes.push(PREFIX + 'motion-wrap--live')
      return h(
        'div',
        {
          key: node ? node.key : undefined,
          className: classes.join(' '),
          'data-dsh-super-cards': '1',
          'data-block': block.type,
          'data-motion': motion.effect,
          style: {
            '--dsh-sc-motion-duration': motion.duration + 'ms',
            '--dsh-sc-motion-delay': motion.delay + 'ms',
            '--dsh-sc-motion-iterations': motion.loop ? 'infinite' : '1',
          },
        },
        node,
      )
    }

    /**
     * Notice for a wire block type this Client cannot render. One muted box per
     * block: the type name plus how to fix the pairing.
     *
     * @param {any} block - `{ type: '__unsupported', missingType }`.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`).
     * @returns {any} notice element.
     */
    function renderUnsupportedBlock(block, key, context) {
      const t = context && typeof context.t === 'function' ? context.t : fallbackT
      const missing = typeof block.missingType === 'string' ? block.missingType : '?'
      return h(
        'div',
        { key, className: PREFIX + 'unsupported', 'data-block-type': missing },
        h('span', { className: PREFIX + 'unsupported-icon', 'aria-hidden': 'true' }, iconGlyph('warning')),
        h(
          'div',
          { className: PREFIX + 'unsupported-text' },
          h('p', { className: PREFIX + 'unsupported-title' }, t('block.missing', { type: missing })),
          h('p', { className: PREFIX + 'unsupported-hint' }, t('block.missingHint')),
        ),
      )
    }

    /**
     * Read the current value of every setting a controls block binds.
     *
     * @param {any} block - normalized controls block.
     * @param {any} bindings - client settings face.
     * @returns {Record<string, string>} setting key -> current value.
     */
    function readControlValues(block, bindings) {
      const values = {}
      for (const item of block.items) {
        if (item.kind !== 'setting') continue
        const face = bindings ? bindings[item.setting] : undefined
        try {
          const current = face && typeof face.get === 'function' ? face.get() : ''
          values[item.setting] = typeof current === 'string' ? current : ''
        } catch {
          values[item.setting] = ''
        }
      }
      return values
    }

    /**
     * Controls block: a bound setting segment (theme/locale, synced to the DSH
     * service) and action buttons. A button either applies a setting or hands a
     * prompt to the agent — `send: true` submits it, which is how a card asks
     * the agent to change a file with its normal tools and approvals.
     *
     * @param {any} props - `{ block, t, inputActions, bindings }`.
     * @returns {any}
     */
    function ControlsBlock(props) {
      const { block, t, inputActions, bindings } = props
      const [values, setValues] = React.useState(readControlValues(block, bindings))
      const [feedback, setFeedback] = React.useState(null)
      const show = (text, ok) => setFeedback({ text, ok })
      const apply = (setting, value) => {
        const face = bindings ? bindings[setting] : undefined
        if (!face || typeof face.set !== 'function') {
          show(t('controls.unavailable'), false)
          return
        }
        try {
          face.set(value)
          setValues((previous) => ({ ...previous, [setting]: value }))
          show(t('controls.applied'), true)
        } catch (error) {
          show(t('controls.failed'), false)
        }
      }
      const run = (action) => {
        if (action.kind === 'setting') {
          apply(action.setting, action.value)
          return
        }
        if (!inputActions || typeof inputActions.setDraft !== 'function') {
          show(t('controls.unavailable'), false)
          return
        }
        inputActions.setDraft(action.prompt)
        if (action.send === true && typeof inputActions.submit === 'function') inputActions.submit()
        show(action.send === true ? t('controls.sent') : t('controls.drafted'), true)
      }
      return h(
        'div',
        { className: PREFIX + 'controls' },
        block.title ? h('div', { className: PREFIX + 'controls-title' }, richChildren(block.title, 'ct')) : null,
        block.items.map((item, index) => {
          if (item.kind === 'setting') {
            const current = values[item.setting]
            return h(
              'div',
              { key: index, className: PREFIX + 'control' },
              item.label
                ? h('span', { className: PREFIX + 'control-label' }, richChildren(item.label, 'cl' + index))
                : null,
              h(
                'div',
                {
                  className: PREFIX + 'segments',
                  role: 'group',
                  'aria-label': item.label || item.setting,
                },
                item.options.map((option) => h(
                  'button',
                  {
                    key: option.value,
                    type: 'button',
                    className: PREFIX + 'segment' + (current === option.value ? ' ' + PREFIX + 'segment--on' : ''),
                    'aria-pressed': current === option.value ? 'true' : 'false',
                    onClick: () => apply(item.setting, option.value),
                  },
                  richChildren(option.label || option.value, 'co' + index + option.value),
                )),
              ),
            )
          }
          return h(
            'button',
            {
              key: index,
              type: 'button',
              className: PREFIX + 'control-button',
              onClick: () => run(item.action),
            },
            richChildren(item.label, 'cb' + index),
          )
        }),
        feedback
          ? h(
              'div',
              { className: PREFIX + 'controls-feedback', 'data-ok': feedback.ok ? '1' : '0', role: 'status' },
              feedback.text,
            )
          : null,
      )
    }

    /**
     * Actions block: buttons put their prompt into the composer draft and let
     * the user press Enter; they never submit. Without `setDraft` the prompt is
     * copied to the clipboard instead.
     *
     * @param {{ block: any, t: Function, inputActions?: any }} props
     * @returns {any}
     */
    function ActionsBlock(props) {
      const { block, t, inputActions } = props
      const [hint, setHint] = React.useState(null)

      const showHint = (text, ok) => {
        setHint((previous) => ({ text, ok, seq: previous ? previous.seq + 1 : 1 }))
      }

      const useDraft = (prompt) => {
        if (!inputActions || typeof inputActions.setDraft !== 'function') return false
        try {
          inputActions.setDraft(prompt)
          return true
        } catch {
          return false
        }
      }

      const copyPrompt = (prompt) => {
        let pending = null
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            pending = navigator.clipboard.writeText(prompt)
          }
        } catch {
          pending = null
        }
        if (pending && typeof pending.then === 'function') {
          pending.then(
            () => showHint(t('hint.copied'), true),
            () => showHint(t('hint.copyFailed'), false),
          )
        } else {
          showHint(t('hint.copyFailed'), false)
        }
      }

      const onAction = (item) => {
        if (useDraft(item.prompt)) {
          showHint(t('hint.draft'), true)
          return
        }
        copyPrompt(item.prompt)
      }

      return h(
        'div',
        { className: PREFIX + 'actions' },
        block.items.map((item, index) =>
          h(
            'button',
            {
              key: index,
              type: 'button',
              className: PREFIX + 'action',
              'data-tone': item.tone === 'primary' ? 'primary' : 'default',
              onClick: () => onAction(item),
            },
            richChildren(item.label, 'act' + index),
          ),
        ),
        hint
          ? h(
              'span',
              {
                key: 'hint-' + hint.seq,
                className: PREFIX + 'hint',
                'data-ok': hint.ok ? '1' : '0',
                role: 'status',
                'aria-live': 'polite',
              },
              hint.text,
            )
          : null,
      )
    }

    /**
     * Code block: monospace, own scroll, collapsed to a bounded height until the
     * reader asks for all of it.
     *
     * @param {{ block: any, t: Function }} props
     * @returns {any}
     */
    function CodeBlock(props) {
      const { block, t } = props
      const [expanded, setExpanded] = React.useState(false)
      const lines = block.code.split('\n').length
      const collapsible = lines > 14
      const showHead = Boolean(block.title || block.language || collapsible)
      return h(
        'div',
        { className: PREFIX + 'code' },
        showHead
          ? h(
              'div',
              { className: PREFIX + 'code-head' },
              block.title
                ? h('span', { className: PREFIX + 'code-title' }, richChildren(block.title, 'codetitle'))
                : h('span', { className: PREFIX + 'code-title' }, t('code.label')),
              h(
                'span',
                { className: PREFIX + 'code-lang' },
                block.language || '',
              ),
              collapsible
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: PREFIX + 'code-toggle',
                      'aria-expanded': expanded ? 'true' : 'false',
                      onClick: () => setExpanded((value) => !value),
                    },
                    expanded ? t('code.collapse') : t('code.show'),
                  )
                : null,
            )
          : null,
        h(
          'pre',
          {
            className: PREFIX + 'code-pre' + (expanded ? ' ' + PREFIX + 'code-pre--expanded' : ''),
            tabIndex: 0,
            'aria-label': block.title || block.language || t('code.label'),
          },
          h(CodeText, { code: block.code, lang: block.language }),
        ),
      )
    }

    /**
     * Code body for a shell that seeds the host highlighter.
     *
     * The tokens come from the same shiki instance the transcript highlights
     * with, under the theme's `--shiki-*` variables, so a card's code matches
     * the code in the answer above it. The shape is the plugin's own: one
     * `<code>` of inline colored spans, no header, no copy button, no extra
     * chrome — the block around it already owns those.
     *
     * A language the host has not loaded yet returns no tokens; the plain text
     * renders instead, and the highlighter store re-renders when the language
     * chunk arrives.
     *
     * @param {{ code: string, lang?: string }} props block code and language.
     * @returns {any} React element.
     */
    function HighlightedCodeText(props) {
      const highlight = useHostHighlighter(props.lang)
      const lines = highlight ? highlight(props.code) : undefined
      if (!Array.isArray(lines) || lines.length === 0) return h(PlainCodeText, props)
      const children = []
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (lineIndex > 0) children.push('\n')
        const line = Array.isArray(lines[lineIndex]) ? lines[lineIndex] : []
        for (let tokenIndex = 0; tokenIndex < line.length; tokenIndex += 1) {
          const token = line[tokenIndex]
          if (!token || typeof token.text !== 'string') continue
          children.push(h('span', { key: lineIndex + ':' + tokenIndex, style: token.style }, token.text))
        }
      }
      return h('code', { className: PREFIX + 'code-text ' + PREFIX + 'code-text--tokens' }, children)
    }

    /**
     * Code body for every other shell: the text exactly as written.
     * @param {{ code: string }} props block code.
     * @returns {any} React element.
     */
    function PlainCodeText(props) {
      return h('code', { className: PREFIX + 'code-text' }, props.code)
    }

    /** The code body this shell can render: the host's tokens, or plain text. */
    const CodeText = useHostHighlighter === null ? PlainCodeText : HighlightedCodeText

    /**
     * Card header: leading glyph + title + one-line subtitle, with the card
     * actions (copy, close) pinned to the top-right corner.
     *
     * Copy is offered on every card that carries content; close only on a card
     * that has something to dismiss.
     *
     * @param {{ title?: string, subtitle?: string, icon?: string, auto?: boolean }} spec
     * @param {string} [status]
     * @param {Function} t - translator.
     * @param {{ onClose?: Function, onCopy?: Function, copied?: boolean, onCopyReset?: Function }} [handlers]
     * @returns {any | null}
     */
    function renderHeader(spec, status, t, handlers) {
      const settings = handlers && typeof handlers === 'object' ? handlers : {}
      const onClose = typeof settings.onClose === 'function' ? settings.onClose : undefined
      const onCopy = typeof settings.onCopy === 'function' ? settings.onCopy : undefined
      const resetCopy = typeof settings.onCopyReset === 'function' ? settings.onCopyReset : undefined
      const copied = settings.copied === true
      const title = spec.title
      const subtitle = spec.subtitle
      const icon = spec.icon
      // `none` (display card) and `neutral` (retired board) carry no pill.
      const state = status && status !== 'neutral' && status !== 'none' ? status : undefined
      const hasActions = onClose !== undefined || onCopy !== undefined
      const hasHead = Boolean(title || subtitle || icon) || state !== undefined
      if (!hasHead && !hasActions) return null
      // A card with no title, icon, or status has no header bar: its corner
      // actions float in the card's own top padding instead of drawing an empty
      // divider line across the card. The floating band still reserves the
      // actions' row so the first block never runs underneath them.
      const classes = PREFIX + 'head'
        + (hasHead ? '' : ' ' + PREFIX + 'head--float')
        + (hasActions ? ' ' + PREFIX + 'head--actions' : '')
      return h(
        'div',
        { className: classes },
        icon ? h('span', { className: PREFIX + 'head-icon' }, iconGlyph(icon)) : null,
        title || subtitle
          ? h(
              'div',
              { className: PREFIX + 'head-text' },
              title ? h('h3', { className: PREFIX + 'title' }, richChildren(title, 'title')) : null,
              subtitle ? h('p', { className: PREFIX + 'subtitle' }, richChildren(subtitle, 'subtitle')) : null,
              spec.auto === true ? h('span', { className: PREFIX + 'auto' }, t('auto.label')) : null,
            )
          : null,
        state === undefined
          ? null
          : h(
              'span',
              { className: PREFIX + 'status ' + PREFIX + 'status--' + state, 'aria-label': t('status.' + state) },
              h('span', { className: PREFIX + 'status-dot', 'aria-hidden': 'true' }),
              h('span', { className: PREFIX + 'status-glyph', 'aria-hidden': 'true' }, iconGlyph(state === 'success' ? 'check' : 'warning')),
              h('span', { className: PREFIX + 'status-label' }, t('status.' + state)),
            ),
        hasActions
          ? h(
              'div',
              { className: PREFIX + 'head-actions' },
              onCopy === undefined
                ? null
                : h(
                    'button',
                    {
                      key: 'copy',
                      type: 'button',
                      className: PREFIX + 'head-action' + (copied ? ' ' + PREFIX + 'head-action--done' : ''),
                      'aria-label': copied ? t('hint.copied') : t('copy.label'),
                      title: copied ? t('hint.copied') : t('copy.label'),
                      onClick: onCopy,
                      onPointerLeave: resetCopy,
                      onBlur: resetCopy,
                    },
                    copied ? iconGlyph('check') : copyGlyph(),
                  ),
              onClose === undefined
                ? null
                : h(
                    'button',
                    {
                      key: 'close',
                      type: 'button',
                      className: PREFIX + 'close ' + PREFIX + 'head-action',
                      'aria-label': t('close.label'),
                      title: t('close.label'),
                      onClick: onClose,
                    },
                    closeGlyph(),
                  ),
              h(
                'span',
                { className: PREFIX + 'sr', role: 'status', 'aria-live': 'polite' },
                copied ? t('hint.copied') : '',
              ),
            )
          : null,
      )
    }

    /** Skeleton shown while the tool call is still preparing its arguments. */
    function SkeletonCard(props) {
      const t = resolveT(props)
      return h(
        'section',
        {
          className: PREFIX + 'card ' + PREFIX + 'card--skeleton',
          role: 'status',
          'aria-live': 'polite',
          'aria-label': t('preparing'),
          'data-dsh-super-cards': '1',
        },
        h('span', { className: PREFIX + 'sr' }, t('preparing')),
        h('span', { className: PREFIX + 'sk-line ' + PREFIX + 'sk-title' }),
        h('span', { className: PREFIX + 'sk-line' }),
        h('span', { className: PREFIX + 'sk-line ' + PREFIX + 'sk-short' }),
        h('span', { className: PREFIX + 'sk-line ' + PREFIX + 'sk-short' }),
      )
    }

    /**
     * Small notice card used for tool errors, missing calls, invalid specs and
     * the ErrorBoundary fallback. The slot must never blank.
     *
     * @param {{ t: Function, title: string, text?: string, tone?: 'error' | 'warn', isError?: boolean }} props
     * @returns {any}
     */
    function NoticeCard(props) {
      const { t, title, text, tone, isError, detail } = props
      const role = isError === true ? 'alert' : 'status'
      return h(
        'section',
        {
          className: PREFIX + 'card ' + PREFIX + 'card--notice',
          role,
          'aria-label': title,
          'data-dsh-super-cards': '1',
          style: toneStyle(tone === 'error' ? accentVar('error') : accentVar('warn')),
        },
        h(
          'div',
          { className: PREFIX + 'notice-head' },
          h('span', { className: PREFIX + 'notice-icon' }, iconGlyph(tone === 'error' ? 'warning' : 'info')),
          h('span', { className: PREFIX + 'notice-title' }, title),
        ),
        text ? h('div', { className: PREFIX + 'notice-text' }, text) : null,
        typeof detail === 'string' && detail !== ''
          ? h('div', { className: PREFIX + 'notice-detail' }, detail.slice(0, 160))
          : null,
      )
    }

    /**
     * @param {{ type: string }} block - normalized block.
     * @returns {boolean} whether the block belongs on a compact dock board.
     */
    function isDockBlock(block) {
      const impl = block && typeof block === 'object' ? blockImpl(block.type) : undefined
      return impl !== undefined && impl.dock === true
    }

    /**
     * The card itself: header plus every normalized block. Reads the spec only
     * through `extractSpec`; the ErrorBoundary above it keeps a failure from
     * blanking the transcript row.
     *
     * @param {any} props - slot props (`phase`, `block`, `t`, `inputActions`).
     * @returns {any}
     */
    function RenderUiCard(props) {
      const t = resolveT(props)
      const phase = props ? props.phase : undefined
      const block = props ? props.block : undefined
      // Registry revision: a replaced block renderer re-renders every mounted
      // card, and a replaced normalizer re-normalizes the recorded spec.
      const [registryRevision, setRegistryRevision] = React.useState(0)
      React.useEffect(() => subscribeRegistry(() => setRegistryRevision((value) => value + 1)), [])
      // A `start` card reads only the recorded argument string, and every row
      // hands in a fresh `{ argsRaw }` object on each render. Keying that memo on
      // the string (not on the object) keeps a re-render of an unchanged card
      // from re-parsing and re-normalizing the same thousands of bytes.
      const argsRaw = block && typeof block.argsRaw === 'string' ? block.argsRaw : ''
      const startExtracted = React.useMemo(
        () => (phase === 'start' ? extractSpec(phase, block) : null),
        [phase, argsRaw, registryRevision],
      )
      // Other stages read more of the block (error text, the settled call), so
      // they stay keyed on the block object itself.
      const otherExtracted = React.useMemo(
        () => (phase === 'start' ? null : extractSpec(phase, block)),
        [phase, block, registryRevision],
      )
      const extracted = startExtracted !== null ? startExtracted : otherExtracted
      // Completed cards with several items fold to a single checked line; the
      // manual choice wins after the user opens or closes it.
      const [manualOpen, setManualOpen] = React.useState(null)
      // Dismissed cards rest as one muted line that reopens on click.
      const [closed, setClosed] = React.useState(false)
      // Copy feedback lives on the button itself; no timer, so it resets when
      // the pointer leaves or the button loses focus.
      const [copied, setCopied] = React.useState(false)

      if (extracted.kind === 'preparing') return h(SkeletonCard, { t })
      if (extracted.kind === 'tool-error') {
        return h(NoticeCard, {
          t,
          title: t('error.title'),
          text: extracted.text || t('error.unknown'),
          tone: 'error',
          isError: true,
        })
      }
      if (extracted.kind === 'missing-call') {
        return h(NoticeCard, { t, title: t('error.title'), text: t('error.missingCall'), tone: 'warn' })
      }
      if (extracted.kind === 'invalid') {
        const key = extracted.reason === 'empty' ? 'error.emptyArgs'
          : extracted.reason === 'parse' ? 'error.parseArgs'
            : extracted.reason === 'shape' ? 'error.emptySpec' : 'error.invalid'
        return h(NoticeCard, { t, title: t('error.title'), text: t(key), detail: extracted.detail, tone: 'warn' })
      }

      const spec = extracted.spec
      const dock = props && props.variant === 'dock'
      const context = {
        t,
        inputActions: props ? props.inputActions : undefined,
        live: props ? props.live : undefined,
        bindings: props ? props.bindings : undefined,
      }
      // A dock board is a glance, not a document: keep it to the four most
      // useful blocks and drop long-form blocks the model should not use there.
      const blocks = dock ? spec.blocks.filter(isDockBlock).slice(0, DOCK_BLOCK_LIMIT) : spec.blocks
      const children = []
      blocks.forEach((item, index) => {
        const node = renderBlock(item, 'blk' + index, context)
        if (node !== null) children.push(withMotion(node, item))
      })
      if (children.length === 0) {
        children.push(h('p', { key: 'empty', className: PREFIX + 'text ' + PREFIX + 'muted' }, t('empty')))
      }
      const derived = resolveStatus(spec)
      // A retired board handed back at the Turn tail is no longer "running".
      const status = props && props.completed === true && derived === 'running' ? 'neutral' : derived
      // Only a card with something to dismiss may show a close button: it either
      // tracks real work (a lifecycle status) or carries interaction/dynamic
      // content. A purely static display card is read-only and keeps no close
      // affordance, so a converted diagram never shows one.
      const interactive = blocks.some((block) => block && (
        block.type === 'controls' || block.type === 'actions' || block.type === 'live'
      ))
      const dismissible = derived !== 'none' || interactive
      // An explicit `look` wins; otherwise the card picks a density from its shape.
      const look = spec.look === undefined ? detectLook(blocks) : spec.look
      if (closed) return h(ClosedCard, { t, title: spec.title, onReopen: () => setClosed(false) })
      const totalItems = countItems(blocks)
      const foldable = !dock && status === 'success' && totalItems >= 3
      const open = foldable ? manualOpen === true : true
      if (foldable) {
        const title = spec.title ? plainInline(spec.title) : t('status.success')
        const toggle = () => setManualOpen((previous) => !(previous === true))
        return h(
          'section',
          {
            className: PREFIX + 'card ' + PREFIX + 'card--line',
            'aria-label': title + ' · ' + t('card.doneMeta', { items: String(totalItems) }),
            'data-dsh-super-cards': '1',
            'data-status': status,
          },
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'line-head',
              'aria-expanded': open ? 'true' : 'false',
              onClick: toggle,
            },
            h('span', { className: PREFIX + 'line-icon', 'aria-hidden': 'true' }, iconGlyph('check')),
            h('span', { className: PREFIX + 'line-title' }, richChildren(title, 'lineTitle')),
            h('span', { className: PREFIX + 'line-meta' }, t('card.doneMeta', { items: String(totalItems) })),
            h('span', { className: PREFIX + 'line-chevron', 'aria-hidden': 'true' }, chevronGlyph(open)),
          ),
          open ? h('div', { className: PREFIX + 'blocks' }, children) : null,
        )
      }
      return h(
        'section',
        {
          className: PREFIX + 'card' + (dock ? ' ' + PREFIX + 'card--dock' : '')
            + (look !== 'default' ? ' ' + PREFIX + 'card--' + look : ''),
          'aria-label': (spec.title ? plainInline(spec.title) : '') || t('card.label'),
          'data-dsh-super-cards': '1',
          'data-status': status,
        },
        dock ? null : renderHeader(spec, status, t, {
          onClose: dismissible ? () => setClosed(true) : undefined,
          onCopy: blocks.length > 0 ? () => copyCard(spec, blocks, setCopied) : undefined,
          copied,
          onCopyReset: () => setCopied(false),
        }),
        h('div', { className: PREFIX + 'blocks' }, children),
      )
    }

    /**
     * A dismissed card in its resting state: one muted line; the line itself
     * reopens the card (the close button is how a card is put away).
     *
     * @param {any} props - `{ t, title, onReopen }`.
     * @returns {any}
     */
    function ClosedCard(props) {
      const t = resolveT(props)
      const title = props && props.title ? plainInline(props.title) : t('card.label')
      const reopen = props && typeof props.onReopen === 'function' ? props.onReopen : () => {}
      return h(
        'section',
        {
          className: PREFIX + 'card ' + PREFIX + 'card--closed',
          'data-dsh-super-cards': '1',
          'data-status': 'neutral',
        },
        h(
          'button',
          {
            type: 'button',
            className: PREFIX + 'line-head',
            'aria-label': t('card.reopen'),
            onClick: reopen,
          },
          h('span', { className: PREFIX + 'line-icon ' + PREFIX + 'line-icon--muted', 'aria-hidden': 'true' }, iconGlyph('list')),
          h('span', { className: PREFIX + 'line-title' }, title),
          h('span', { className: PREFIX + 'line-meta ' + PREFIX + 'line-meta--muted' }, t('card.closed')),
          h('span', { className: PREFIX + 'line-chevron', 'aria-hidden': 'true' }, chevronGlyph(false)),
        ),
      )
    }

    /** Minimal localized failure card for the ErrorBoundary. */
    function failureCard(t) {
      return h(
        'section',
        {
          className: PREFIX + 'card ' + PREFIX + 'card--notice',
          role: 'alert',
          'aria-label': t('error.render'),
          'data-dsh-super-cards': '1',
          style: toneStyle(accentVar('error')),
        },
        h(
          'div',
          { className: PREFIX + 'notice-head' },
          h('span', { className: PREFIX + 'notice-icon' }, iconGlyph('warning')),
          h('span', { className: PREFIX + 'notice-title' }, t('error.render')),
        ),
      )
    }

    /**
     * Catch a rendering failure inside the card so the slot blanks the card
     * instead of the whole Tool row.
     */
    class RenderErrorBoundary extends ReactComponent {
      /** @param {any} props */
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      /** @returns {{ failed: boolean }} */
      static getDerivedStateFromError() {
        return { failed: true }
      }

      /** @param {unknown} error */
      componentDidCatch(error) {
        warnOnce('render', '[' + NS + '] card render failed: ' + describeError(error))
      }

      /** @returns {any} */
      render() {
        if (this.state && this.state.failed) return failureCard(resolveT(this.props))
        return this.props ? this.props.children : null
      }
    }

    /** Fallback selector for mounts without a Chat hook (never subscribes). */
    const EMPTY_CHAT_SELECTOR = () => ''

    /**
     * Normalize one `live` block: a counter or a short feed of later messages.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block.
     */
    function normalizeLive(raw) {
      const field = raw.field === 'tools' || raw.field === 'last-message' ? raw.field : 'messages'
      const limit = typeof raw.limit === 'number' && Number.isFinite(raw.limit)
        ? Math.max(1, Math.min(10, Math.trunc(raw.limit)))
        : 3
      return { type: 'live', field, limit, label: optionalText(raw.label) }
    }

    /**
     * Resolve the card's lifecycle state: explicit when the model set one,
     * otherwise derived — every progress bar at 100% completes the card.
     *
     * @param {any} spec - normalized spec.
     * @returns {'running' | 'success' | 'warn' | 'error'} resolved state.
     */
    function resolveStatus(spec) {
      if (spec && typeof spec.status === 'string' && STATUS_NAMES.indexOf(spec.status) !== -1) return spec.status
      const blocks = spec && Array.isArray(spec.blocks) ? spec.blocks : []
      // No explicit status: only real progress gives the card a lifecycle.
      // A card with nothing to complete is a plain display card (`none`): no
      // status pill, no tint, no completion folding.
      const progress = blocks.filter((block) => block && block.type === 'progress')
      if (progress.length === 0) return 'none'
      if (progress.every((block) => block.items.every(
        (item) => typeof item.value === 'number' && item.value >= 1,
      ))) return 'success'
      return 'running'
    }

    // -----------------------------------------------------------------------
    // Markdown export: one card -> one copyable document.
    //
    // The card is the answer, so a reader may want it as text in another tool.
    // Every block maps to the closest Markdown shape; interactive-only blocks
    // (actions, controls, live) are UI scaffolding and are left out.
    // -----------------------------------------------------------------------

    /**
     * Wrap one source string in a fenced code block.
     * @param {string} [language] - info string.
     * @param {string} source - code text.
     * @returns {string}
     */
    function mdFence(language, source) {
      return '```' + (language || '') + '\n' + source + '\n```'
    }

    /**
     * Escape one table cell: a pipe ends the cell, a newline ends the table.
     * @param {unknown} value - cell value.
     * @returns {string}
     */
    function mdCell(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, '<br>')
    }

    /**
     * Render a markdown table.
     * @param {string[]} columns - header labels.
     * @param {unknown[][]} rows - cell rows.
     * @returns {string}
     */
    function mdTable(columns, rows) {
      const head = '| ' + columns.map(mdCell).join(' | ') + ' |'
      const rule = '| ' + columns.map(() => '---').join(' | ') + ' |'
      const body = rows.map((row) => '| ' + row.map(mdCell).join(' | ') + ' |')
      return [head, rule].concat(body).join('\n')
    }

    /**
     * One list indent level.
     * @param {number} depth - nesting depth.
     * @returns {string}
     */
    function mdIndent(depth) {
      return '  '.repeat(Math.max(0, depth))
    }

    /**
     * Render one normalized block as Markdown.
     * @param {any} block - normalized block.
     * @param {number} [level] - nesting depth (tabs/columns/tree).
     * @returns {string} Markdown, or '' for a block with no text form.
     */
    function mdBlock(block, level) {
      const depth = typeof level === 'number' ? level : 0
      const pad = mdIndent(depth)
      if (!block || typeof block !== 'object') return ''
      switch (block.type) {
        case 'text':
          return block.text
        case 'heading': {
          const hashes = block.level === 1 ? '###' : block.level === 3 ? '#####' : '####'
          return hashes + ' ' + block.text
        }
        case 'callout': {
          const lines = []
          if (block.title) lines.push('> **' + block.title + '**')
          for (const line of String(block.text).split('\n')) lines.push('> ' + line)
          return lines.join('\n')
        }
        case 'stats':
          return block.items.map((item) => pad + '- **' + item.label + '**: ' + item.value
            + (item.delta ? ' (' + item.delta + ')' : '')
            + (item.hint ? ' — ' + item.hint : '')).join('\n')
        case 'table':
          return mdTable(block.columns, block.rows)
        case 'keyvalue':
          return block.items.map((item) => pad + '- **' + item.key + '**: ' + item.value).join('\n')
        case 'list':
          return block.items.map((item, index) => pad + (block.ordered ? (index + 1) + '. ' : '- ') + item).join('\n')
        case 'badges':
          return block.items.map((item) => '`' + item.label + '`').join(' · ')
        case 'progress':
          return block.items.map((item) => pad + '- **' + item.label + '**: ' + Math.round(item.value * 100) + '%'
            + (item.caption ? ' (' + item.caption + ')' : '')).join('\n')
        case 'bars':
          return (block.title ? '**' + block.title + '**\n\n' : '')
            + block.items.map((item) => pad + '- ' + item.label + ': ' + formatNumber(item.value) + (block.unit || '')).join('\n')
        case 'sparkline': {
          const head = block.title
            ? '**' + block.title + '**' + (block.unit ? '（' + block.unit + '）' : '') + '\n\n'
            : ''
          return head + block.values.join(', ')
        }
        case 'pie': {
          const total = block.items.reduce((sum, item) => sum + item.value, 0)
          const head = block.title ? '**' + block.title + '**\n\n' : ''
          return head + block.items.map((item) => {
            const share = total > 0 ? Math.round((item.value / total) * 100) : 0
            return pad + '- ' + item.label + ': ' + formatNumber(item.value) + (block.unit || '') + ' (' + share + '%)'
          }).join('\n')
        }
        case 'code':
          return (block.title ? '**' + block.title + '**\n\n' : '') + mdFence(block.language, block.code)
        case 'quote':
          return '> ' + String(block.text).split('\n').join('\n> ') + (block.by ? '\n>\n> — ' + block.by : '')
        case 'timeline':
          return block.items.map((item, index) => pad + (index + 1) + '. **' + item.title + '**'
            + (item.time ? ' (' + item.time + ')' : '')
            + (item.text ? ' — ' + item.text : '')).join('\n')
        case 'links':
          return block.items.map((item) => pad + '- [' + item.label + '](' + item.href + ')'
            + (item.description ? ' — ' + item.description : '')).join('\n')
        case 'divider':
          return '---'
        case 'diagram': {
          const source = diagramToMermaid(block)
          return source === '' ? '' : mdFence('mermaid', source)
        }
        case 'tree': {
          const walk = (nodes, nest) => nodes.map((node) => {
            const line = mdIndent(nest) + '- ' + node.label
              + (node.note ? ' — ' + node.note : '')
              + (node.badge ? ' `' + node.badge + '`' : '')
            const children = Array.isArray(node.children) ? walk(node.children, nest + 1) : ''
            return children === '' ? line : line + '\n' + children
          }).join('\n')
          return (block.title ? '**' + block.title + '**\n\n' : '') + walk(block.nodes, depth)
        }
        case 'diff': {
          const body = block.lines.map((line) => (line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ') + line.text).join('\n')
          const head = block.title || block.path
            ? '**' + (block.title || block.path) + '**'
              + (block.title && block.path ? ' · `' + block.path + '`' : '') + '\n\n'
            : ''
          return head + mdFence('diff', body)
        }
        case 'kanban': {
          const parts = []
          if (block.title) parts.push('**' + block.title + '**')
          for (const column of block.columns) {
            parts.push('### ' + column.title)
            const cards = column.cards.map((card) => '- **' + card.title + '**'
              + (Array.isArray(card.badges) && card.badges.length > 0 ? ' `' + card.badges.join('` `') + '`' : '')
              + (card.text ? ' — ' + card.text : ''))
            if (cards.length > 0) parts.push(cards.join('\n'))
          }
          return parts.join('\n\n')
        }
        case 'tabs': {
          const parts = []
          if (block.title) parts.push('**' + block.title + '**')
          for (const item of block.items) {
            parts.push('#### ' + item.label)
            for (const inner of item.blocks) {
              const text = mdBlock(inner, depth)
              if (text !== '') parts.push(text)
            }
          }
          return parts.join('\n\n')
        }
        case 'columns': {
          const parts = []
          for (const column of block.items) {
            if (column.label) parts.push('**' + column.label + '**')
            for (const inner of column.blocks) {
              const text = mdBlock(inner, depth)
              if (text !== '') parts.push(text)
            }
          }
          return parts.join('\n\n')
        }
        case 'image':
          return '![' + (block.alt || '') + '](' + block.src + ')'
            + (block.caption ? '\n\n*' + block.caption + '*' : '')
        case 'html':
          return mdFence('html', block.html)
        default:
          return ''
      }
    }

    /**
     * Serialize one card as Markdown: title, subtitle, then every block whose
     * text form exists (interactive-only blocks are left out).
     *
     * @param {{ title?: string, subtitle?: string, blocks?: any[] }} spec - card spec.
     * @param {any[]} [blocks] - blocks to serialize (defaults to `spec.blocks`).
     * @returns {string}
     */
    function cardToMarkdown(spec, blocks) {
      const list = Array.isArray(blocks) ? blocks : Array.isArray(spec && spec.blocks) ? spec.blocks : []
      const parts = []
      if (spec && spec.title) parts.push('## ' + spec.title)
      if (spec && spec.subtitle) parts.push('_' + spec.subtitle + '_')
      for (const block of list) {
        const text = mdBlock(block)
        if (text !== '') parts.push(text)
      }
      return parts.join('\n\n')
    }

    /**
     * Write one card's Markdown to the clipboard and report success through
     * `setCopied`. Never throws: a denied or unavailable clipboard simply
     * leaves the button in its idle state.
     *
     * @param {any} spec - card spec.
     * @param {any[]} blocks - normalized blocks.
     * @param {(value: boolean) => void} setCopied - feedback setter.
     * @returns {void}
     */
    function copyCard(spec, blocks, setCopied) {
      const text = cardToMarkdown(spec, blocks)
      if (text === '') return
      let pending = null
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          pending = navigator.clipboard.writeText(text)
        }
      } catch {
        pending = null
      }
      if (pending && typeof pending.then === 'function') {
        pending.then(() => setCopied(true), () => setCopied(false))
        return
      }
      setCopied(false)
    }

    /** Block types that are data, not prose: a card made only of these is a dashboard. */
    const DATA_TYPES = ['stats', 'table', 'keyvalue', 'progress', 'bars', 'sparkline', 'pie', 'heatmap', 'kanban', 'diff', 'diagram', 'image', 'live']

    /**
     * Pick the visual density of a card that did not name one.
     *
     * The rules are deliberately blunt: long cards compress, dashboards lose
     * their panel chrome, and a two-block conclusion gets more air. An explicit
     * `look` on the spec always wins over this.
     *
     * @param {any[]} blocks - normalized blocks.
     * @returns {'default' | 'compact' | 'flat' | 'relaxed'}
     */
    function detectLook(blocks) {
      let items = 0
      let prose = 0
      let data = 0
      let longTable = false
      for (const block of blocks) {
        if (!block) continue
        if (Array.isArray(block.items)) items += block.items.length
        if (Array.isArray(block.rows)) {
          items += block.rows.length
          if (block.rows.length >= 10) longTable = true
        }
        if (block.type === 'text' || block.type === 'callout' || block.type === 'quote' || block.type === 'list') prose += 1
        if (DATA_TYPES.indexOf(block.type) !== -1) data += 1
      }
      if (blocks.length >= 6 || items >= 24 || longTable) return 'compact'
      if (blocks.length <= 2 && prose > 0) return 'relaxed'
      if (data >= 2 && prose === 0) return 'flat'
      return 'default'
    }

    /**
     * Count the glanceable items one card carries (item arrays, table rows,
     * or the block itself), used to decide whether completion can collapse.
     *
     * @param {any[]} blocks - normalized blocks.
     * @returns {number} item count.
     */
    function countItems(blocks) {
      let total = 0
      for (const block of blocks) {
        if (!block) continue
        if (Array.isArray(block.items)) total += block.items.length
        else if (Array.isArray(block.rows)) total += block.rows.length
        else total += 1
      }
      return total
    }

    /**
     * Read one compact message brief from a Chat node (for live feeds).
     *
     * @param {any} node - Chat target node.
     * @returns {{ role: string, text: string } | null}
     */
    function messageBrief(node) {
      if (!node || typeof node !== 'object') return null
      if (node.kind === 'user') {
        const text = contentText(node.data ? node.data.content : undefined)
        return text === '' ? { role: 'user', text: '…' } : { role: 'user', text: summarize(text) }
      }
      if (node.kind === 'assistant-step') {
        const blocks = node.data && Array.isArray(node.data.blocks) ? node.data.blocks : []
        const text = blocks.filter((block) => block && block.kind === 'text').map((block) => block.text).join(' ')
        return text.trim() === '' ? null : { role: 'assistant', text: summarize(text) }
      }
      if (node.kind === 'tool-call') {
        const root = node.data ? node.data.root : undefined
        const name = root && typeof root.name === 'string' ? root.name : 'tool'
        return { role: 'tool', text: name }
      }
      return null
    }

    /** @param {string} text @returns {string} one compact line */
    function summarize(text) {
      const flat = String(text).replace(/\s+/gu, ' ').trim()
      return flat.length <= 120 ? flat : flat.slice(0, 119) + '…'
    }

    /**
     * Per-snapshot selector index.
     *
     * Every Turn footer mounts its own chat selector, and each selector used to
     * walk the whole node list: with T Turn footers and N nodes that is O(T×N)
     * work on every store commit — measured at 21 ms per event for 400 Turns /
     * 2400 nodes, which is a lost frame for a single session event. A chat
     * snapshot is immutable per commit (the store updates through `produce`), so
     * one WeakMap-keyed pass answers every Turn on that snapshot in O(N), and
     * the entry disappears together with the snapshot object. The stored order
     * length and last key are re-checked on a hit, so a snapshot that was
     * appended to in place is indexed again instead of read stale.
     *
     * @type {WeakMap<object, object>}
     */
    const SNAPSHOT_INDEX = new WeakMap()

    /**
     * Build (once per snapshot) the per-Turn facts the chat selectors read.
     *
     * @param {any} snapshot - Chat target snapshot (`order` + `nodes`).
     * @returns {object|undefined} index, or undefined when the snapshot is unusable.
     */
    function snapshotIndexOf(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return undefined
      const order = snapshot.order
      if (!Array.isArray(order)) return undefined
      const nodes = snapshot.nodes
      if (!nodes || typeof nodes.get !== 'function') return undefined
      const cached = SNAPSHOT_INDEX.get(snapshot)
      if (cached !== undefined && cached.orderLength === order.length
        && cached.lastKey === order[order.length - 1]) {
        return cached
      }
      const index = {
        orderLength: order.length,
        lastKey: order[order.length - 1],
        latestTurn: undefined,
        tails: new Map(),
        next: new Map(),
        dock: new Map(),
        answer: new Set(),
        dockArgs: '',
        dockTurn: undefined,
        live: { messageCount: 0, toolCount: 0, messages: [] },
      }
      for (const key of order) {
        if (typeof key !== 'string' || key === '') continue
        let node
        try {
          node = nodes.get(key)
        } catch {
          node = undefined
        }
        if (!node) continue
        if (node.kind === 'tool-call') index.live.toolCount += 1
        if (node.kind === 'user' || node.kind === 'assistant-step') index.live.messageCount += 1
        const candidate = tailNodeTurn(node)
        if (typeof candidate === 'number'
          && (typeof index.latestTurn !== 'number' || candidate > index.latestTurn)) {
          index.latestTurn = candidate
        }
        const brief = messageBrief(node)
        if (brief !== null) {
          index.live.messages.push(brief)
          if (index.live.messages.length > 8) index.live.messages.shift()
        }
        const data = node.data
        if (node.kind === NEXT_KIND) {
          if (!data || !Array.isArray(data.options) || data.options.length === 0) continue
          const nextTurn = tailNodeTurn(node)
          if (typeof nextTurn === 'number') index.next.set(nextTurn, data)
          continue
        }
        if (node.kind !== NODE_KIND || !data || typeof data.argsRaw !== 'string' || data.argsRaw === '') continue
        const location = node.location
        const turn = location && location.turn && typeof location.turn.turn === 'number'
          ? location.turn.turn
          : undefined
        if (isDockPlacement(data.place)) {
          // The dock board is global: remember the newest one in document order,
          // plus which Turn it belongs to (unknown until the location resolves).
          index.dockArgs = data.argsRaw
          index.dockTurn = typeof turn === 'number' ? turn : undefined
          if (typeof turn === 'number') index.dock.set(turn, data.argsRaw)
          continue
        }
        if (typeof turn !== 'number') continue
        if (isTailPlacement(data.place)) {
          const cards = index.tails.get(turn)
          if (cards === undefined) index.tails.set(turn, [data.argsRaw])
          else if (cards.indexOf(data.argsRaw) === -1 && cards.length < TAIL_CARD_LIMIT) cards.push(data.argsRaw)
          continue
        }
        if (placementDef(data.place).groupTree === 'turn') index.answer.add(turn)
      }
      SNAPSHOT_INDEX.set(snapshot, index)
      return index
    }

    /**
     * Chat selector: the newest dock card spec plus the live facts it listens to.
     *
     * @param {any} snapshot - Chat target snapshot (`order` + `nodes`).
     * @returns {string} JSON fingerprint, empty when no dock card exists yet.
     */
    function selectDockCard(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.order)) return ''
      const index = snapshotIndexOf(snapshot)
      if (index === undefined || index.dockArgs === '') return ''
      // A board belongs to the Turn that created it: once that Turn closes the
      // board is retired (the answer keeps any card the model emitted itself).
      const turn = index.dockTurn
      const timeline = snapshot.timeline
      const record = typeof turn === 'number' && timeline && timeline.turns && typeof timeline.turns.get === 'function'
        ? timeline.turns.get(turn)
        : undefined
      if (record && record.status === 'closed') return ''
      return JSON.stringify({
        spec: index.dockArgs,
        live: index.live,
      })
    }

    /**
     * Live block: counters and short message feeds for a persistent dock card.
     * A card rendered in the transcript has no live source and renders nothing.
     *
     * @param {any} block - normalized live block.
     * @param {string} key - React key.
     * @param {any} context - render context (`t`, `live`).
     * @returns {any}
     */
    function renderLiveFeed(block, key, context) {
      const live = context ? context.live : undefined
      if (!live) return null
      const t = context.t || ((token) => token)
      const label = block.label || t('live.label')
      if (block.field === 'last-message') {
        const items = Array.isArray(live.messages) ? live.messages.slice(-block.limit) : []
        return h(
          'div',
          { key, className: PREFIX + 'live', 'data-field': block.field },
          h('div', { className: PREFIX + 'live-head' }, label),
          items.length === 0
            ? h('div', { className: PREFIX + 'live-empty' }, t('live.empty'))
            : h('div', { className: PREFIX + 'live-feed' },
              items.map((item, index) => h(
                'div',
                { key: 'm' + index, className: PREFIX + 'live-line' },
                h('span', { className: PREFIX + 'live-role' }, t(item.role === 'assistant' ? 'live.assistant' : item.role === 'tool' ? 'live.tool' : 'live.user')),
                h('span', { className: PREFIX + 'live-text' }, item.text),
              )),
            ),
        )
      }
      const value = block.field === 'tools' ? live.toolCount : live.messageCount
      return h(
        'div',
        { key, className: PREFIX + 'live', 'data-field': block.field },
        h('div', { className: PREFIX + 'live-head' }, label),
        h('div', { className: PREFIX + 'live-value' }, String(typeof value === 'number' ? value : 0)),
      )
    }

    /** Custom Chat row kind: one inline card per recorded `render_ui` call. */
    const NODE_KIND = 'super-cards'
    /** Chat node kind for cards auto-converted from fenced mermaid blocks. */
    const AUTO_KIND = 'super-cards-auto'
    /** Chat node kind for the automatic subagent progress card. */
    const TEAM_KIND = 'super-cards-team'
    /** Chat node kind for the host-generated next-step card. */
    const NEXT_KIND = 'super-cards-next'
    /** Session event type carrying the host-generated next-step card. */
    const NEXT_EVENT = 'super-cards/next-steps'
    /** Character cap for the optional next-step summary. */
    const NEXT_SUMMARY_LIMIT = 240
    /** Task status → progress bar value. */
    const TEAM_TASK_VALUES = { pending: 0, in_progress: 0.5, completed: 1, failed: 0, cancelled: 0 }
    /** Progress rows a progress card may show; the rest stays in the counts. */
    const TEAM_PROGRESS_LIMIT = 12
    /** Activity entries the team card remembers; only the newest few are shown. */
    const TEAM_TRAIL_LIMIT = 6
    /** Activity lines the team card shows under the progress bars. */
    const TEAM_TRAIL_VISIBLE = 3
    /** Characters of a queued message kept as its activity line. */
    const TEAM_MESSAGE_EXCERPT = 60
    /** Relative times of a live team card refresh at this interval. */
    const TEAM_TICK_MS = 1000
    /** Fence info strings that trigger auto-conversion. */
    const MERMAID_LANGS = ['mermaid', 'mmd']
    /** Chat flow slot that renders keyed row kinds. */
    const NODE_SLOT = 'conversation.chat.node'
    /** Persistent card seat above the composer (below the transcript). */
    const DOCK_SLOT = 'conversation.input.dock'
    /** Completed-turn footer: where a retired board is handed back as a card. */
    const TAIL_SLOT = 'conversation.chat.turnTail'
    /** Set once the inline Chat row is installed; the tool row then stays a marker. */
    let INLINE_PLACEMENT = false

    /**
     * Session events that can carry one `render_ui` invocation.
     *
     * A model may call the Tool directly (`tool/call`), or from inside a
     * `run_code` script: the Host records that nested call as a PTC dispatch
     * (a start event, then the settled event carrying its arguments). Both are
     * the same card, so the row matches every shape — a card must never depend
     * on which of the two ways the model reached the Tool.
     */
    const RENDER_UI_EVENT_TYPES = ['tool/call', 'tool/ptc-dispatch-start', 'tool/ptc-dispatch']

    /**
     * Whether one session event is a shape that can carry a `render_ui` call.
     *
     * @param {any} event - session event.
     * @returns {boolean} true for a direct call or a PTC dispatch.
     */
    function isRenderUiEvent(event) {
      return Boolean(event) && RENDER_UI_EVENT_TYPES.indexOf(event.type) !== -1
    }

    /**
     * Read the recorded argument JSON from one call event payload.
     *
     * @param {any} event - a session event; a direct call or a PTC dispatch.
     * @returns {string} argument JSON, empty when the event is not our call.
     */
    function renderUiCallArgs(event) {
      if (!isRenderUiEvent(event) || !event.data) return ''
      const data = event.data
      if (data.name !== KEY) return ''
      const args = data.arguments
      if (typeof args === 'string') return args
      if (args && typeof args === 'object') {
        try {
          return JSON.stringify(args)
        } catch {
          return ''
        }
      }
      return ''
    }

    /**
     * Read the identity one card row is keyed by: the call id of a direct call,
     * or the sub-call id of a PTC dispatch (unique inside its `run_code`).
     *
     * @param {any} event - a session event; a direct call or a PTC dispatch.
     * @returns {string} stable call identity, empty when absent.
     */
    function renderUiCallId(event) {
      if (!isRenderUiEvent(event) || !event.data) return ''
      const data = event.data
      const id = event.type === 'tool/call' ? data.callId : data.subCallId
      return typeof id === 'string' ? id : ''
    }

    /**
     * Normalize one `controls` block: setting segments and action buttons.
     *
     * @param {any} raw - raw block from the spec.
     * @returns {any} normalized block, or null when nothing usable remains.
     */
    function normalizeControls(raw) {
      const items = []
      const source = Array.isArray(raw.items) ? raw.items.slice(0, 8) : []
      for (const item of source) {
        if (!item || typeof item !== 'object') continue
        if (item.kind === 'setting') {
          const setting = item.setting === 'theme' || item.setting === 'locale' ? item.setting : undefined
          if (setting === undefined) continue
          const options = []
          for (const option of Array.isArray(item.options) ? item.options.slice(0, 6) : []) {
            if (!option || typeof option !== 'object') continue
            if (typeof option.value !== 'string' || option.value === '') continue
            options.push({ value: option.value, label: optionalText(option.label) })
          }
          if (options.length === 0) continue
          items.push({ kind: 'setting', setting, label: optionalText(item.label), options })
          continue
        }
        if (item.kind !== 'button') continue
        const label = optionalText(item.label)
        const action = item.action && typeof item.action === 'object' ? item.action : null
        if (label === undefined || action === null) continue
        if (action.kind === 'setting') {
          const setting = action.setting === 'theme' || action.setting === 'locale' ? action.setting : undefined
          if (setting === undefined || typeof action.value !== 'string' || action.value === '') continue
          items.push({ kind: 'button', label, action: { kind: 'setting', setting, value: action.value } })
          continue
        }
        if (action.kind !== 'prompt') continue
        const prompt = optionalText(action.prompt)
        if (prompt === undefined) continue
        items.push({ kind: 'button', label, action: { kind: 'prompt', prompt, send: action.send === true } })
      }
      if (items.length === 0) return null
      return { type: 'controls', title: optionalText(raw.title), items }
    }

    /**
     * Read the requested placement from recorded arguments.
     *
     * @param {string} argsRaw - recorded argument JSON.
     * @returns {string} placement name; anything unrecognized is the answer.
     */
    function readPlacement(argsRaw) {
      const parsed = parseSpecJson(argsRaw)
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return 'answer'
      const place = parsed.value.place
      return registryOwn(PLACEMENTS, place) ? place : 'answer'
    }

    /**
     * Match one event shape into the card row context. The settled PTC dispatch
     * reuses the same id, so it lands as an update of the start event's row.
     *
     * @param {any} event - direct call or PTC dispatch event.
     * @returns {{ id: string, role: 'start' } | null} match, or null when the
     *   event is not a `render_ui` call.
     */
    function matchInlineCard(event) {
      const argsRaw = renderUiCallArgs(event)
      if (argsRaw === '') return null
      const callId = renderUiCallId(event)
      if (callId === '') return null
      return { id: callId, role: 'start' }
    }

    /**
     * Business Definition for one inline card row per `render_ui` call.
     *
     * The row stands at the `turn` group-tree position — outside the folded
     * process disclosure — and anchors at the call's own seq, so the card is
     * interleaved with the answer text exactly where the model placed it.
     *
     * Three event shapes feed this one row: a direct `tool/call`, and the two
     * PTC dispatch events recorded when the model calls the Tool from inside a
     * `run_code` script. Without the PTC shapes the row never existed for such
     * a session, while the keyed Tool view stayed suppressed — the card then
     * vanished entirely.
     */
    const inlineCardDefinition = {
      kind: NODE_KIND,
      target: 'chat',
      match: {
        'tool/call': matchInlineCard,
        'tool/ptc-dispatch-start': matchInlineCard,
        'tool/ptc-dispatch': matchInlineCard,
      },
      start: (_context, match) => {
        const argsRaw = renderUiCallArgs(match.event)
        return {
          argsRaw,
          callId: renderUiCallId(match.event),
          seq: typeof match.event.seq === 'number' ? match.event.seq : 0,
          place: readPlacement(argsRaw),
        }
      },
      update: (context, match) => {
        const state = context.state
        if (!state) return state
        // The settled PTC dispatch carries the final arguments. Refresh the
        // recorded spec in place: the row keeps its seq and its call identity.
        const argsRaw = renderUiCallArgs(match.event)
        if (argsRaw === '' || argsRaw === state.argsRaw) return state
        return {
          argsRaw,
          callId: state.callId,
          seq: state.seq,
          place: readPlacement(argsRaw),
        }
      },
      publication: () => 'immediate',
      buildViewNode: (context) => {
        const state = context.state
        if (!state || typeof state.argsRaw !== 'string' || state.argsRaw === '') return null
        return {
          key: context.key,
          kind: NODE_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.seq,
          location: context.start ? context.start.location : { kind: 'unresolved' },
          visibility: 'visible',
          // `answer` sits outside the folded process; `process` is part of it,
          // so collapsing the work details hides that progress card again.
          groupTree: placementDef(state.place).groupTree,
          data: { argsRaw: state.argsRaw, callId: state.callId, place: state.place },
        }
      },
    }

    // --- fenced mermaid auto-conversion ------------------------------------
    // The model may answer with a fenced ```mermaid block instead of calling
    // `render_ui`. The markdown renderer keeps showing that fence (we cannot
    // intercept it), so this row adds the converted card beside it: one chat row
    // per assistant message, one card per fence, and a code-block card when the
    // subset parser cannot read the source.

    /**
     * Collect the text of one assistant message.
     *
     * @param {any} event - `assistant/message` session event.
     * @returns {string} concatenated text blocks, '' when none.
     */
    function assistantMessageText(event) {
      const message = event && event.data ? event.data.message : undefined
      const content = message ? message.content : undefined
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
          parts.push(block.text)
        }
      }
      return parts.join('\n')
    }

    /**
     * Extract fenced code blocks whose info string marks mermaid.
     *
     * @param {string} text - assistant message text.
     * @returns {Array<{ code: string, lang: string }>} fences in reading order.
     */
    function extractFences(text) {
      if (typeof text !== 'string' || text === '') return []
      const lines = text.split('\n')
      const fences = []
      for (let index = 0; index < lines.length; index += 1) {
        const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[index])
        if (!open) continue
        const marker = open[1][0]
        const lang = open[2].toLowerCase()
        if (MERMAID_LANGS.indexOf(lang) === -1) continue
        const body = []
        let cursor = index + 1
        const close = new RegExp('^\\s*' + (marker === '`' ? '`' : '~') + '{3,}\\s*$')
        for (; cursor < lines.length; cursor += 1) {
          if (close.test(lines[cursor])) break
          body.push(lines[cursor])
        }
        fences.push({ lang, code: body.join('\n') })
        index = cursor
      }
      return fences
    }

    /**
     * Parse one flowchart line segment: node refs joined by arrows.
     *
     * @param {string} segment - one statement (lines may be `;`-separated).
     * @param {(id: string, label?: string, shape?: string) => void} addNode - node sink.
     * @param {(from: string, to: string, label?: string, style?: string, arrow?: string) => void} addEdge - edge sink.
     * @returns {boolean} whether at least one edge was parsed.
     */
    function parseFlowSegment(segment, addNode, addEdge) {
      let rest = segment
      let previous = null
      let pending = null
      let parsed = false
      while (rest !== '') {
        const nodeMatch = /^\s*([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(\(\(([^)]*)\)\)|\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})?/.exec(rest)
        if (!nodeMatch) return parsed
        const id = nodeMatch[1]
        let label
        let shape
        if (nodeMatch[3] !== undefined) {
          label = nodeMatch[3].trim()
          shape = 'circle'
        } else if (nodeMatch[4] !== undefined) {
          label = nodeMatch[4].trim()
          shape = 'round'
        } else if (nodeMatch[5] !== undefined) {
          label = nodeMatch[5].trim()
          shape = 'box'
        } else if (nodeMatch[6] !== undefined) {
          label = nodeMatch[6].trim()
          shape = 'diamond'
        }
        addNode(id, label, shape)
        if (previous !== null) {
          addEdge(previous, id, pending ? pending.label : undefined, pending ? pending.style : undefined, pending ? pending.arrow : undefined)
          parsed = true
        }
        previous = id
        rest = rest.slice(nodeMatch[0].length)
        const arrowMatch = /^\s*(-\.-+>|--+>|==+>|---+|==+|--+|-?\.-+)\s*(\|([^|]*)\|)?/.exec(rest)
        if (!arrowMatch) break
        const arrowText = arrowMatch[1]
        pending = {
          label: arrowMatch[3] === undefined ? undefined : arrowMatch[3].trim(),
          style: arrowText.indexOf('-.') === 0 ? 'dashed' : undefined,
          arrow: arrowText.indexOf('>') === -1 ? 'none' : undefined,
        }
        rest = rest.slice(arrowMatch[0].length)
      }
      return parsed
    }

    /**
     * Parse a `flowchart`/`graph` fence.
     *
     * @param {string[]} lines - body lines, header removed.
     * @param {string} header - the original header line.
     * @param {string} [title] - fence comment used as the card title.
     * @returns {{block: any, title?: string} | null} parsed diagram or null.
     */
    function parseMermaidFlowchart(lines, header, title) {
      const token = (header.split(/\s+/)[1] || '').toUpperCase()
      const direction = token === 'LR' || token === 'RL' ? 'LR' : 'TB'
      const nodes = []
      const nodeIds = new Set()
      const edges = []
      const addNode = (id, label, shape) => {
        if (nodeIds.has(id)) return
        nodeIds.add(id)
        const node = { id, label: label === undefined || label === '' ? id : label }
        if (shape !== undefined) node.shape = shape
        nodes.push(node)
      }
      const addEdge = (from, to, label, style, arrow) => {
        const edge = { from, to }
        if (label !== undefined && label !== '') edge.label = label
        if (style === 'dashed') edge.style = 'dashed'
        if (arrow === 'none') edge.arrow = 'none'
        edges.push(edge)
      }
      let parsed = false
      for (const line of lines) {
        if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/.test(line)) continue
        for (const segment of line.split(';')) {
          const text = segment.trim()
          if (text === '') continue
          if (parseFlowSegment(text, addNode, addEdge)) parsed = true
        }
      }
      if (!parsed || nodes.length === 0) return null
      return { block: { type: 'diagram', kind: 'flowchart', direction, nodes, edges }, title }
    }

    /**
     * Parse a `sequenceDiagram` fence.
     *
     * @param {string[]} lines - body lines, header removed.
     * @param {string} [title] - fence comment used as the card title.
     * @returns {{block: any, title?: string} | null} parsed diagram or null.
     */
    function parseMermaidSequence(lines, title) {
      const participants = []
      const participantIds = new Set()
      const messages = []
      const ensure = (id, label) => {
        if (participantIds.has(id)) return
        participantIds.add(id)
        const participant = { id, label: label === undefined || label === '' ? id : label }
        participants.push(participant)
      }
      let parsed = false
      for (const line of lines) {
        const declared = /^(?:participant|actor)\s+([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)(?:\s+as\s+(.+))?$/.exec(line)
        if (declared) {
          ensure(declared[1], declared[2] === undefined ? undefined : declared[2].trim())
          parsed = true
          continue
        }
        const message = /^([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(-{1,2}>>?|-{1,2}>)\s*([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*:\s*(.*)$/.exec(line)
        if (message) {
          ensure(message[1])
          ensure(message[3])
          const messageStyle = message[2].indexOf('--') === 0 ? 'return' : 'sync'
          messages.push({ from: message[1], to: message[3], label: message[4].trim(), style: messageStyle })
          parsed = true
        }
        // Notes, loops, activations and other directives are ignored.
      }
      if (!parsed || messages.length === 0) return null
      return { block: { type: 'diagram', kind: 'sequence', participants, messages }, title }
    }

    /**
     * Parse a `classDiagram` fence.
     *
     * @param {string[]} lines - body lines, header removed.
     * @param {string} [title] - fence comment used as the card title.
     * @returns {{block: any, title?: string} | null} parsed diagram or null.
     */
    function parseMermaidClass(lines, title) {
      const nodes = []
      const byId = new Map()
      const edges = []
      const ensure = (id) => {
        const existing = byId.get(id)
        if (existing !== undefined) return existing
        const node = { id, label: id, fields: [], methods: [] }
        byId.set(id, node)
        nodes.push(node)
        return node
      }
      const readMember = (line) => {
        const text = line.replace(/^[+\-#~]\s*/, '').trim()
        if (text === '') return null
        const method = /\)\s*$/.test(text)
        return { method, text }
      }
      let current = null
      let parsed = false
      for (const line of lines) {
        const open = /^class\s+([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*\{$/.exec(line)
        if (open) {
          current = ensure(open[1])
          parsed = true
          continue
        }
        if (line === '}') {
          current = null
          continue
        }
        if (current !== null) {
          const member = readMember(line)
          if (member !== null) {
            ;(member.method ? current.methods : current.fields).push(member.text)
            parsed = true
          }
          continue
        }
        const relation = /^([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(<\|--|--\|>|\*--|o--|\.\.>|-->|--\*|--o|--)\s*([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(?::\s*(.*))?$/.exec(line)
        if (relation) {
          ensure(relation[1])
          ensure(relation[3])
          const edge = { from: relation[1], to: relation[3] }
          if (relation[4] !== undefined && relation[4].trim() !== '') edge.label = relation[4].trim()
          edges.push(edge)
          parsed = true
          continue
        }
        const memberLine = /^([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*:\s*(.+)$/.exec(line)
        if (memberLine) {
          const member = readMember(memberLine[2])
          if (member !== null) {
            const node = ensure(memberLine[1])
            ;(member.method ? node.methods : node.fields).push(member.text)
            parsed = true
          }
        }
      }
      if (!parsed || nodes.length === 0) return null
      for (const node of nodes) {
        if (node.fields.length === 0) delete node.fields
        if (node.methods.length === 0) delete node.methods
      }
      return { block: { type: 'diagram', kind: 'class', nodes, edges }, title }
    }

    /**
     * Parse a `stateDiagram`/`stateDiagram-v2` fence.
     *
     * @param {string[]} lines - body lines, header removed.
     * @param {string} [title] - fence comment used as the card title.
     * @returns {{block: any, title?: string} | null} parsed diagram or null.
     */
    function parseMermaidState(lines, title) {
      const START = '__start'
      const END = '__end'
      const nodes = []
      const nodeIds = new Set()
      const edges = []
      const add = (id, label, shape, tone) => {
        if (nodeIds.has(id)) return
        nodeIds.add(id)
        const node = { id, label: label === undefined || label === '' ? id : label }
        if (shape !== undefined) node.shape = shape
        if (tone !== undefined) node.tone = tone
        nodes.push(node)
      }
      let parsed = false
      for (const line of lines) {
        if (/^state\s+.*\{\s*$/.test(line) || line === '}') continue
        const transition = /^(\[\*\]|[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*-->\s*(\[\*\]|[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)\s*(?::\s*(.*))?$/.exec(line)
        if (!transition) continue
        let from
        if (transition[1] === '[*]') {
          add(START, '开始', 'circle', 'success')
          from = START
        } else {
          add(transition[1])
          from = transition[1]
        }
        let to
        if (transition[2] === '[*]') {
          add(END, '结束', 'circle')
          to = END
        } else {
          add(transition[2])
          to = transition[2]
        }
        const edge = { from, to }
        if (transition[3] !== undefined && transition[3].trim() !== '') edge.label = transition[3].trim()
        edges.push(edge)
        parsed = true
      }
      if (!parsed || nodes.length === 0) return null
      return { block: { type: 'diagram', kind: 'state', direction: 'LR', nodes, edges }, title }
    }

    /**
     * Parse a mermaid source into a diagram block.
     *
     * Supported subset: `flowchart`/`graph`, `sequenceDiagram`, `classDiagram`,
     * `stateDiagram`/`stateDiagram-v2`. A first `%%` comment becomes the title.
     * Anything the subset cannot draw returns null, so the caller can fall back
     * to the source itself.
     *
     * @param {string} code - fenced source.
     * @returns {{ block: any, title?: string } | null} parsed diagram or null.
     */
    function parseMermaid(code) {
      if (typeof code !== 'string' || code.trim() === '') return null
      let title
      const lines = []
      for (const raw of code.split('\n')) {
        const text = raw.trim()
        if (text === '' || /^%%\{/.test(text)) continue
        if (/^%%/.test(text)) {
          if (title === undefined) {
            const body = text.replace(/^%%+/, '').trim()
            if (body !== '') title = body
          }
          continue
        }
        lines.push(text)
      }
      if (lines.length === 0) return null
      const header = lines[0].toLowerCase()
      const body = lines.slice(1)
      let parsed = null
      if (/^(graph|flowchart)\b/.test(header)) parsed = parseMermaidFlowchart(body, lines[0], title)
      else if (/^sequencediagram\b/.test(header)) parsed = parseMermaidSequence(body, title)
      else if (/^classdiagram\b/.test(header)) parsed = parseMermaidClass(body, title)
      else if (/^statediagram(-v2)?\b/.test(header)) parsed = parseMermaidState(body, title)
      if (parsed === null) return null
      const block = normalizeDiagramBlock(parsed.block)
      if (block === null) return null
      return { block, title: parsed.title }
    }

    /**
     * Turn assistant text into card specs: one per mermaid fence, with the raw
     * source as a code card when the subset parser cannot read it.
     *
     * @param {string} text - assistant message text.
     * @returns {any[]} card specs.
     */
    function buildAutoSpecs(text) {
      const specs = []
      for (const fence of extractFences(text)) {
        const parsed = parseMermaid(fence.code)
        if (parsed === null) {
          specs.push({ title: '图表源码（自动转换）', blocks: [{ type: 'code', language: 'mermaid', code: fence.code }] })
          continue
        }
        const diagram = Object.assign({}, parsed.block, { source: fence.code.slice(0, MAX_CODE) })
        const spec = { blocks: [diagram] }
        if (parsed.title !== undefined) spec.title = parsed.title
        specs.push(spec)
      }
      return specs
    }

    /**
     * Business Definition for one auto-converted row per assistant message that
     * contains mermaid fences.
     */
    const autoCardDefinition = {
      kind: AUTO_KIND,
      target: 'chat',
      match: {
        'assistant/message': (event) => {
          const text = assistantMessageText(event)
          if (text === '' || extractFences(text).length === 0) return null
          const seq = typeof event.seq === 'number' ? event.seq : 0
          return { id: 'auto-' + seq, role: 'start' }
        },
      },
      start: (_context, match) => {
        const seq = typeof match.event.seq === 'number' ? match.event.seq : 0
        return { seq, specs: buildAutoSpecs(assistantMessageText(match.event)) }
      },
      update: (context) => context.state,
      publication: () => 'immediate',
      buildViewNode: (context) => {
        const state = context.state
        if (!state || !Array.isArray(state.specs) || state.specs.length === 0) return null
        const start = context.start
        const location = start && start.location ? start.location : { kind: 'unresolved' }
        return {
          key: context.key,
          kind: AUTO_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.seq,
          location,
          visibility: 'visible',
          groupTree: 'turn',
          data: { specs: state.specs, seq: state.seq },
        }
      },
    }

    /**
     * Chat row for auto-converted mermaid: one card per fence, rendered beside
     * the still-visible source fence.
     *
     * @param {any} props - Chat node props; `node.data` carries the specs.
     * @returns {any}
     */
    function AutoCardRow(props) {
      const t = resolveT(props)
      const node = props ? props.node : undefined
      const data = node ? node.data : undefined
      const specs = data && Array.isArray(data.specs) ? data.specs : []
      if (specs.length === 0) return null
      const cards = []
      for (let index = 0; index < specs.length; index += 1) {
        cards.push(
          h(
            RenderErrorBoundary,
            { key: 'auto' + index, t },
            h(RenderUiCard, {
              phase: 'start',
              block: { argsRaw: JSON.stringify(specs[index]) },
              t,
              inputActions: props ? props.inputActions : undefined,
              bindings: BINDINGS,
            }),
          ),
        )
      }
      return h('div', { className: PREFIX + 'auto', 'data-dsh-super-cards': '1' }, cards)
    }

// --- subagent progress card -------------------------------------------
    // `team/member`, `team/task`, `team/message/queued` and
    // `team/message/delivered` are durable session events: a card can be
    // derived from them and replayed. One row per team; every event updates the
    // same context, so the card follows provisioning, task progress, messages
    // between subagents, and completion without a single model call. While the
    // run is live the row refreshes its relative times with one local interval
    // — the documented exception to the plugin's "cards are inert" rule: time
    // text only, no network, no storage, and the interval is always cleared.

    /** Task status → locale key of its human label. */
    const TEAM_STATUS_KEYS = {
      pending: 'team.task.pending',
      in_progress: 'team.task.in_progress',
      completed: 'team.task.completed',
      failed: 'team.task.failed',
      cancelled: 'team.task.cancelled',
    }

    /**
     * Default translator for the activity text recorded by the pure merge.
     * The merge runs in the Conversation engine, where no locale face is
     * available, so the plugin's primary copy (zh) is used with the en table as
     * fallback; the recorded text is the durable fact. `teamSpec` localizes the
     * labels and times it renders itself.
     *
     * @param {string} key - locale key.
     * @param {Record<string, unknown>} [vars] - interpolation values.
     * @returns {string}
     */
    function teamText(key, vars) {
      const template = zh[key] !== undefined ? zh[key] : en[key] !== undefined ? en[key] : key
      return interpolate(template, vars)
    }

    /**
     * Localized label of one task status.
     *
     * @param {string} status - task status.
     * @param {Function} t - translator.
     * @returns {string}
     */
    function teamStatusLabel(status, t) {
      const key = TEAM_STATUS_KEYS[status]
      return key === undefined ? String(status) : t(key)
    }

    /**
     * Localized relative time of a past instant. A missing timestamp or a clock
     * that moved backwards reads as "just now", so a negative time is never
     * rendered.
     *
     * @param {number} now - reference epoch ms.
     * @param {number} then - past epoch ms.
     * @param {Function} [t] - translator; defaults to the plugin zh copy.
     * @returns {string} '刚刚' | 'N 秒前' | 'N 分钟前' | 'N 小时前', localized.
     */
    function relativeTime(now, then, t) {
      const translate = typeof t === 'function' ? t : teamText
      const current = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
      const past = typeof then === 'number' && Number.isFinite(then) ? then : current
      const seconds = Math.floor(Math.max(0, current - past) / 1000)
      if (seconds < 5) return translate('team.time.justNow')
      if (seconds < 60) return translate('team.time.seconds', { count: seconds })
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return translate('team.time.minutes', { count: minutes })
      return translate('team.time.hours', { count: Math.floor(minutes / 60) })
    }

    /**
     * Localized one-line description of one activity entry.
     *
     * @param {any} entry - trail entry (`{ time, kind, text }` plus its fields).
     * @param {Function} [t] - translator; defaults to the plugin zh copy.
     * @returns {string}
     */
    function teamActivityText(entry, t) {
      const translate = typeof t === 'function' ? t : teamText
      if (!entry || typeof entry !== 'object') return ''
      if (entry.kind === 'task') {
        return translate('team.activity.task', {
          id: entry.taskId,
          status: teamStatusLabel(entry.status, translate),
        })
      }
      if (entry.kind === 'member') {
        const phaseKey = 'team.member.' + entry.phase
        const phase = zh[phaseKey] !== undefined || en[phaseKey] !== undefined
          ? translate(phaseKey)
          : String(entry.phase)
        return translate('team.activity.member', { name: entry.name, phase })
      }
      if (entry.kind === 'message') {
        return translate('team.activity.message', {
          from: entry.senderName,
          to: entry.targetId,
          excerpt: entry.excerpt,
        })
      }
      return typeof entry.text === 'string' ? entry.text : ''
    }

    /**
     * First 60 characters of a queued message's text, on one line.
     *
     * @param {any} message - queued team message payload.
     * @returns {string}
     */
    function teamMessageExcerpt(message) {
      const text = message && typeof message === 'object' ? contentText(message.content) : ''
      return text.replace(/\s+/gu, ' ').trim().slice(0, TEAM_MESSAGE_EXCERPT)
    }

    /**
     * Build one activity entry; `text` is recorded so the trail is replayable
     * even without a locale face.
     *
     * @param {'member'|'task'|'message'} kind - activity kind.
     * @param {number|null} time - event epoch ms, null when absent.
     * @param {Record<string, unknown>} fields - kind-specific fields.
     * @returns {{ time: number|null, kind: string, text: string }}
     */
    function teamActivityEntry(kind, time, fields) {
      const entry = Object.assign({
        time: typeof time === 'number' && Number.isFinite(time) ? time : null,
        kind,
      }, fields)
      entry.text = teamActivityText(entry)
      return entry
    }

    /**
     * Prepend one activity and keep only the newest `TEAM_TRAIL_LIMIT`.
     *
     * @param {any[]} trail - current trail, newest first.
     * @param {any} entry - new activity, or null to leave the trail as is.
     * @returns {any[]} bounded trail.
     */
    function pushTeamActivity(trail, entry) {
      const list = Array.isArray(trail) ? trail.slice() : []
      if (entry !== null && entry !== undefined) list.unshift(entry)
      return list.slice(0, TEAM_TRAIL_LIMIT)
    }

    /**
     * Read the payload of one team event.
     *
     * @param {any} event - session event.
     * @returns {{ type: string, teamId: string, time: number|null, member?: any, task?: any, message?: any, messageId?: string } | null}
     *   parsed payload, or null when the event is not a usable team event.
     */
    function teamEventData(event) {
      if (!event || !event.data) return null
      const teamId = typeof event.data.teamId === 'string' ? event.data.teamId : ''
      const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : null
      if (event.type === 'team/member') {
        const member = event.data.member
        if (!member || typeof member.id !== 'string' || member.id === '') return null
        return { type: 'member', teamId, time, member }
      }
      if (event.type === 'team/task') {
        const task = event.data.task
        if (!task || typeof task.id !== 'string' || task.id === '') return null
        return { type: 'task', teamId, time, task }
      }
      if (event.type === 'team/message/queued') {
        const message = event.data.message
        if (!message || typeof message.id !== 'string' || message.id === '') return null
        return { type: 'message-queued', teamId, time, message }
      }
      if (event.type === 'team/message/delivered') {
        const messageId = typeof event.data.messageId === 'string' ? event.data.messageId : ''
        if (messageId === '') return null
        return { type: 'message-delivered', teamId, time, messageId }
      }
      return null
    }

    /**
     * Merge one team event into the accumulated card state (pure).
     *
     * @param {any} state - previous state (`{ seq, members, tasks, trail }`) or null.
     * @param {any} event - session event.
     * @returns {any} next state; the same shape, never null for a usable event.
     */
    function mergeTeamEvent(state, event) {
      const parsed = teamEventData(event)
      if (parsed === null) return state
      const next = {
        seq: state && typeof state.seq === 'number' ? state.seq : (typeof event.seq === 'number' ? event.seq : 0),
        members: state && Array.isArray(state.members) ? state.members.slice() : [],
        tasks: state && Array.isArray(state.tasks) ? state.tasks.slice() : [],
        trail: state && Array.isArray(state.trail) ? state.trail.slice() : [],
      }
      if (parsed.type === 'member') {
        const phase = typeof parsed.member.phase === 'string' ? parsed.member.phase : 'active'
        const member = {
          id: parsed.member.id,
          name: typeof parsed.member.name === 'string' ? parsed.member.name : parsed.member.id,
          description: typeof parsed.member.description === 'string' ? parsed.member.description.slice(0, 200) : '',
          phase,
        }
        const activity = teamActivityEntry('member', parsed.time, {
          memberId: member.id,
          name: member.name,
          phase,
        })
        member.lastActivity = { kind: 'member', text: activity.text, time: activity.time }
        const index = next.members.findIndex((item) => item.id === member.id)
        if (index === -1) next.members.push(member)
        else next.members[index] = Object.assign({}, next.members[index], member)
        next.trail = pushTeamActivity(next.trail, activity)
        return next
      }
      if (parsed.type === 'task') {
        const task = {
          id: parsed.task.id,
          subject: typeof parsed.task.subject === 'string' ? parsed.task.subject : parsed.task.id,
          status: typeof parsed.task.status === 'string' ? parsed.task.status : 'pending',
          ownerId: typeof parsed.task.ownerId === 'string' ? parsed.task.ownerId : '',
          time: parsed.time,
        }
        const activity = teamActivityEntry('task', parsed.time, {
          taskId: task.id,
          status: task.status,
        })
        const index = next.tasks.findIndex((item) => item.id === task.id)
        if (index === -1) next.tasks.push(task)
        else next.tasks[index] = Object.assign({}, next.tasks[index], task)
        next.trail = pushTeamActivity(next.trail, activity)
        return next
      }
      if (parsed.type === 'message-queued') {
        const message = parsed.message
        const senderName = typeof message.senderName === 'string' && message.senderName !== ''
          ? message.senderName
          : (typeof message.senderId === 'string' ? message.senderId : '?')
        const activity = teamActivityEntry('message', parsed.time, {
          messageId: message.id,
          senderName,
          targetId: typeof message.targetId === 'string' ? message.targetId : '?',
          excerpt: teamMessageExcerpt(message),
          delivered: false,
        })
        next.trail = pushTeamActivity(next.trail, activity)
        return next
      }
      // Delivered marks the recorded line; it is not a new activity.
      next.trail = next.trail.map((entry) => (
        entry && entry.kind === 'message' && entry.messageId === parsed.messageId
          ? Object.assign({}, entry, { delivered: true })
          : entry
      ))
      return next
    }

    /**
     * Derive the card status from the tasks: all completed → success; a failure
     * with nothing in progress → error (or a single-failure run → warn); any
     * other state is still running.
     *
     * @param {Array<{ id: string, status: string }>} tasks - merged tasks.
     * @returns {'running' | 'success' | 'error' | 'warn'} card status.
     */
    function deriveTeamStatus(tasks, members) {
      const list = Array.isArray(tasks) ? tasks : []
      if (list.length === 0) {
        // No tasks yet: the run is live while a member is starting or active.
        const active = (Array.isArray(members) ? members : []).some(
          (member) => member.phase === 'provisioning' || member.phase === 'active',
        )
        return active ? 'running' : 'success'
      }
      const completed = list.filter((task) => task.status === 'completed').length
      if (completed === list.length) return 'success'
      const inProgress = list.filter((task) => task.status === 'in_progress').length
      const failed = list.filter((task) => task.status === 'failed').length
      const cancelled = list.filter((task) => task.status === 'cancelled').length
      if (failed + cancelled > 0 && inProgress === 0) return failed > 1 ? 'error' : 'warn'
      return 'running'
    }

    /**
     * Resolve the card status: an explicit status on the node wins, otherwise
     * it is derived from the tasks and member phases.
     *
     * @param {any} data - `{ status, tasks, members }`.
     * @returns {'running' | 'success' | 'warn' | 'error'} card status.
     */
    function teamCardStatus(data) {
      const explicit = data && data.status
      if (explicit === 'running' || explicit === 'success' || explicit === 'warn' || explicit === 'error') {
        return explicit
      }
      return deriveTeamStatus(data ? data.tasks : undefined, data ? data.members : undefined)
    }

    /**
     * Whether one team card should run its relative-time ticker.
     *
     * @param {string} status - card status.
     * @param {boolean} [folded] - the card is folded to its completed line.
     * @returns {boolean} true only while a live run renders as an open card.
     */
    function shouldTickTeamCard(status, folded) {
      return status === 'running' && folded !== true
    }

    /**
     * Ticker decision for one team node (pure; the row only executes it).
     *
     * @param {any} data - `{ status, tasks, members }` from the node.
     * @param {boolean} [folded] - the card is folded to its completed line.
     * @returns {{ status: string, active: boolean, intervalMs: number }}
     */
    function teamTicker(data, folded) {
      const status = teamCardStatus(data)
      return { status, active: shouldTickTeamCard(status, folded), intervalMs: TEAM_TICK_MS }
    }

    /**
     * Newest recorded activity time of one team state.
     *
     * @param {any} data - `{ tasks, trail }` from the node.
     * @returns {number|null} epoch ms, or null when nothing is timed yet.
     */
    function teamLastActivityTime(data) {
      let newest = null
      const consider = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return
        if (newest === null || value > newest) newest = value
      }
      const trail = data && Array.isArray(data.trail) ? data.trail : []
      for (const entry of trail) consider(entry ? entry.time : undefined)
      const tasks = data && Array.isArray(data.tasks) ? data.tasks : []
      for (const task of tasks) consider(task ? task.time : undefined)
      return newest
    }

    /**
     * Caption of one progress row: its status plus the relative time of the
     * last change that touched it.
     *
     * @param {any} task - merged task.
     * @param {number} now - reference epoch ms.
     * @param {Function} t - translator.
     * @returns {string}
     */
    function teamTaskCaption(task, now, t) {
      const label = teamStatusLabel(task.status, t)
      if (typeof task.time !== 'number' || !Number.isFinite(task.time)) return label
      return label + ' · ' + relativeTime(now, task.time, t)
    }

    /**
     * The newest activity lines shown under the progress bars. An entry without
     * a recorded timestamp is skipped: the line has no relative time to show.
     *
     * @param {any} data - `{ trail }` from the node.
     * @param {number} now - reference epoch ms.
     * @param {Function} t - translator.
     * @returns {string[]} at most `TEAM_TRAIL_VISIBLE` lines, newest first.
     */
    function teamTrailLines(data, now, t) {
      const trail = data && Array.isArray(data.trail) ? data.trail : []
      const lines = []
      for (const entry of trail) {
        if (lines.length >= TEAM_TRAIL_VISIBLE) break
        if (!entry || typeof entry.time !== 'number' || !Number.isFinite(entry.time)) continue
        let line = teamActivityText(entry, t)
        if (entry.delivered === true) line += ' · ' + t('team.activity.delivered')
        line += ' · ' + relativeTime(now, entry.time, t)
        lines.push(line)
      }
      return lines
    }

    /**
     * Build the card spec for one accumulated team state.
     *
     * @param {any} data - `{ members, tasks, trail }` from the node.
     * @param {Function} t - translator.
     * @param {number} [now] - reference epoch ms (defaults to Date.now()).
     * @returns {any} card spec, or null when there is nothing to show.
     */
    function teamSpec(data, t, now) {
      const members = data && Array.isArray(data.members) ? data.members : []
      const tasks = data && Array.isArray(data.tasks) ? data.tasks : []
      if (members.length === 0 && tasks.length === 0) return null
      const timestamp = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
      const completed = tasks.filter((task) => task.status === 'completed').length
      const stats = [
        { label: t('team.members'), value: String(members.length) },
        { label: t('team.tasks'), value: completed + '/' + tasks.length },
      ]
      const last = teamLastActivityTime(data)
      if (last !== null) stats.push({ label: t('team.lastActivity'), value: relativeTime(timestamp, last, t) })
      const blocks = [{ type: 'stats', items: stats }]
      if (tasks.length > 0) {
        const items = tasks.slice(0, TEAM_PROGRESS_LIMIT).map((task) => {
          const subject = typeof task.subject === 'string' && task.subject !== '' ? task.subject : task.id
          const item = {
            label: subject,
            value: TEAM_TASK_VALUES[task.status] === undefined ? 0 : TEAM_TASK_VALUES[task.status],
            caption: teamTaskCaption(task, timestamp, t),
          }
          if (task.status === 'failed') item.tone = 'error'
          return item
        })
        blocks.push({ type: 'progress', items })
      }
      const trail = teamTrailLines(data, timestamp, t)
      if (trail.length > 0) blocks.push({ type: 'list', items: trail })
      return { title: t('team.title'), status: teamCardStatus(data), blocks }
    }

    /** Business Definition for the automatic subagent progress card. */
    const teamCardDefinition = {
      kind: TEAM_KIND,
      target: 'chat',
      match: (event) => {
        const parsed = teamEventData(event)
        if (parsed === null) return null
        return { id: 'team-' + (parsed.teamId === '' ? 'local' : parsed.teamId), role: 'start' }
      },
      start: (_context, match) => mergeTeamEvent(null, match.event),
      update: (context, match) => mergeTeamEvent(context.state, match.event),
      publication: () => 'immediate',
      buildViewNode: (context) => {
        const state = context.state
        if (!state || (state.members.length === 0 && state.tasks.length === 0)) return null
        const start = context.start
        const location = start && start.location ? start.location : { kind: 'unresolved' }
        return {
          key: context.key,
          kind: TEAM_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.seq,
          location,
          visibility: 'visible',
          groupTree: 'turn',
          data: {
            seq: state.seq,
            members: state.members,
            tasks: state.tasks,
            trail: state.trail,
            status: deriveTeamStatus(state.tasks, state.members),
          },
        }
      },
    }

    /**
     * Chat row for the subagent progress card: a stats summary, one progress bar
     * per task, and the newest activity lines. Completion reuses the card's own
     * folding, so a finished run rests as a single checked line.
     *
     * The relative times are refreshed by one component-local interval that
     * runs only while the card status is `running`; the effect cleanup clears
     * it, and the element tree carries `data-team-tick` so the decision can be
     * asserted without a real timer.
     *
     * @param {any} props - Chat node props; `node.data` carries members/tasks.
     * @returns {any}
     */
    function TeamCardRow(props) {
      const t = resolveT(props)
      const node = props ? props.node : undefined
      const data = node ? node.data : undefined
      const ticker = teamTicker(data)
      const [clock, setClock] = React.useState(Date.now())
      const now = typeof clock === 'number' && Number.isFinite(clock) ? clock : Date.now()
      React.useEffect(() => {
        if (!ticker.active || typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => setClock(Date.now()), TEAM_TICK_MS)
        return () => clearInterval(timer)
      }, [ticker.active])
      const spec = teamSpec(data, t, now)
      if (spec === null) return null
      return h(
        RenderErrorBoundary,
        {
          t,
          'data-team-tick': ticker.active ? '1' : '0',
          'data-team-interval': String(TEAM_TICK_MS),
        },
        h(RenderUiCard, {
          phase: 'start',
          block: { argsRaw: JSON.stringify(spec) },
          t,
          inputActions: props ? props.inputActions : undefined,
          bindings: BINDINGS,
        }),
      )
    }

    // --- generated next-step card -----------------------------------------
    // The Host appends one `super-cards/next-steps` event after `turn/end`:
    // questions the user is most likely to ask next, generated from the
    // finished Turn. The card renders in the Turn tail only, so the row itself
    // stays empty and `selectTailCards` reads this node from the snapshot.

    /**
     * Read and validate the payload of one generated next-step event.
     *
     * @param {any} event - session event.
     * @returns {{ turn: number, text: string, options: Array<{ label: string, prompt: string }>, summary?: string } | null}
     *   parsed payload, or null when the event carries no usable options.
     *   `summary` is present only when the Host sent a non-empty one.
     */
    function nextStepsEventData(event) {
      if (!event || event.type !== NEXT_EVENT || !event.data) return null
      const data = event.data
      if (typeof data.turn !== 'number' || !Number.isInteger(data.turn) || data.turn < 0) return null
      const source = Array.isArray(data.options) ? data.options : []
      const options = []
      for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue
        if (typeof entry.label !== 'string' || typeof entry.prompt !== 'string') continue
        const label = entry.label.trim()
        const prompt = entry.prompt.trim()
        if (label === '' || prompt === '') continue
        options.push({ label: label.slice(0, 240), prompt: prompt.slice(0, MAX_TEXT) })
        if (options.length >= MAX_ACTIONS) break
      }
      if (options.length === 0) return null
      const text = typeof data.text === 'string' ? data.text.trim().slice(0, MAX_TEXT) : ''
      const summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, NEXT_SUMMARY_LIMIT) : ''
      const parsed = { turn: data.turn, text, options }
      // Optional and backward compatible: an older Host sends no summary at all.
      if (summary !== '') parsed.summary = summary
      return parsed
    }

    /**
     * Merge one next-step event into the accumulated card state (pure). The
     * Turn keeps one card, so the latest event replaces the content; the anchor
     * stays at the first event that created the node.
     *
     * @param {any} state - previous state (`{ seq, turn, text, options }`) or null.
     * @param {any} event - session event.
     * @returns {any} next state; the same shape, unchanged for an unusable event.
     */
    function mergeNextStepsEvent(state, event) {
      const parsed = nextStepsEventData(event)
      if (parsed === null) return state
      const seq = state && typeof state.seq === 'number'
        ? state.seq
        : (typeof event.seq === 'number' ? event.seq : 0)
      return {
        seq,
        turn: parsed.turn,
        text: parsed.text,
        options: parsed.options,
        summary: parsed.summary === undefined ? '' : parsed.summary,
      }
    }

    /**
     * Build the tail card spec for one generated next-step node. The card reads
     * like a hand-written close: an optional one-paragraph summary of the Turn,
     * then the question, then the option buttons.
     *
     * @param {any} data - node data (`{ text, options, summary }`).
     * @param {(key: string, vars?: Record<string, unknown>) => string} [t] - translator.
     * @returns {string | null} JSON card spec, or null without a usable option.
     */
    function nextStepsSpec(data, t) {
      const translate = typeof t === 'function' ? t : fallbackT
      const source = data && Array.isArray(data.options) ? data.options : []
      const items = []
      for (const option of source) {
        if (!option || typeof option !== 'object') continue
        const label = typeof option.label === 'string' ? option.label.trim() : ''
        const prompt = typeof option.prompt === 'string' ? option.prompt.trim() : ''
        if (label === '' || prompt === '') continue
        const item = { label, prompt }
        if (items.length === 0) item.tone = 'primary'
        items.push(item)
        if (items.length >= MAX_ACTIONS) break
      }
      if (items.length === 0) return null
      const summary = data && typeof data.summary === 'string'
        ? data.summary.trim().slice(0, NEXT_SUMMARY_LIMIT)
        : ''
      const question = data && typeof data.text === 'string' && data.text.trim() !== ''
        ? data.text.trim().slice(0, MAX_TEXT)
        : translate('next.question')
      const blocks = []
      // Two separate paragraphs: the summary is not merged into the question.
      if (summary !== '') blocks.push({ type: 'text', text: summary })
      blocks.push({ type: 'text', text: question })
      blocks.push({ type: 'actions', items })
      return JSON.stringify({ look: 'relaxed', blocks })
    }

    /**
     * Business Definition for the host-generated next-step card. The event is
     * appended after `turn/end`; the Conversation location index resolves its
     * Turn from the payload's `turn`, so `start.location` is kept as-is.
     */
    const nextStepsDefinition = {
      kind: NEXT_KIND,
      target: 'chat',
      match: (event) => {
        const parsed = nextStepsEventData(event)
        if (parsed === null) return null
        return { id: 'next-' + parsed.turn, role: 'start' }
      },
      start: (_context, match) => mergeNextStepsEvent(null, match.event),
      update: (context, match) => mergeNextStepsEvent(context.state, match.event),
      publication: () => 'immediate',
      buildViewNode: (context) => {
        const state = context.state
        if (!state || !Array.isArray(state.options) || state.options.length === 0) return null
        const start = context.start
        const location = start && start.location ? start.location : { kind: 'unresolved' }
        return {
          key: context.key,
          kind: NEXT_KIND,
          id: context.id,
          target: 'chat',
          anchorSeq: state.seq,
          location,
          visibility: 'visible',
          groupTree: 'turn',
          data: { seq: state.seq, turn: state.turn, text: state.text, summary: state.summary, options: state.options },
        }
      },
    }

    /**
     * Inline row for the generated next-step node. The card belongs to the Turn
     * tail only, so the row renders nothing at the node's own position — the
     * same rule the dock and model `place: "tail"` placements follow.
     *
     * @returns {any} always null.
     */
    function NextStepsCardRow() {
      return null
    }

    /**
     * Inline answer row: the card for one `render_ui` call, placed in the flow.
     *
     * @param {any} props - Chat node props; `node.data` carries the arguments.
     * @returns {any}
     */
    function InlineCardRow(props) {
      const t = resolveT(props)
      const node = props ? props.node : undefined
      const data = node ? node.data : undefined
      const argsRaw = data && typeof data.argsRaw === 'string' ? data.argsRaw : ''
      if (argsRaw === '' || (data && (isDockPlacement(data.place) || isTailPlacement(data.place)))) return null
      return h(
        RenderErrorBoundary,
        { t },
        h(RenderUiCard, {
          phase: 'start',
          block: { argsRaw },
          t,
          inputActions: props ? props.inputActions : undefined,
          bindings: BINDINGS,
        }),
      )
    }

    /**
     * Tool row inside the collapsed process: a compact marker only. The card
     * itself renders in the Turn tail so it is visible without expanding work
     * details. Failures keep a small localized notice for diagnosis.
     *
     * @param {any} props - Tool view props.
     * @returns {any}
     */
    /**
     * Chat selector: hand a retired dock board back as a card at the end of its
     * Turn, unless the model already emitted an answer card for that Turn.
     *
     * @param {any} snapshot - Chat target snapshot.
     * @param {number} turnNumber - Turn whose tail is being rendered.
     * @returns {string} JSON fingerprint, empty when nothing converts.
     */
    function selectBoardConversion(snapshot, turnNumber) {
      if (typeof turnNumber !== 'number') return ''
      const index = snapshotIndexOf(snapshot)
      if (index === undefined) return ''
      const dockArgs = index.dock.get(turnNumber)
      if (dockArgs === undefined || index.answer.has(turnNumber)) return ''
      return JSON.stringify({
        spec: dockArgs,
        live: index.live,
      })
    }

    /**
     * Turn-tail card: the retired board, rendered as a normal card under the
     * answer so the information survives after the live board closes.
     *
     * @param {any} props - turn-tail props (`turn`, `useChat`).
     * @returns {any}
     */
    function TurnTailBoard(props) {
      const t = resolveT(props)
      const turn = props ? props.turn : undefined
      const turnNumber = turn && typeof turn.turn === 'number' ? turn.turn : undefined
      const useChat = props && typeof props.useChat === 'function' ? props.useChat : EMPTY_CHAT_SELECTOR
      // Unconditional call: the fallback keeps the hook order stable.
      const fingerprint = useChat((snapshot) => selectBoardConversion(snapshot, turnNumber))
      if (typeof fingerprint !== 'string' || fingerprint === '') return null
      let data
      try {
        data = JSON.parse(fingerprint)
      } catch {
        return null
      }
      if (!data || typeof data.spec !== 'string' || data.spec === '') return null
      return h(
        'div',
        { className: PREFIX + 'tail-card', 'data-dsh-super-cards': '1' },
        h(RenderErrorBoundary, { t }, h(RenderUiCard, {
          phase: 'start',
          block: { argsRaw: data.spec },
          t,
          inputActions: props ? props.inputActions : undefined,
          live: data.live,
          completed: true,
          bindings: BINDINGS,
        })),
      )
    }

    /** How many tail cards one Turn footer may show; the rest stay in the log. */
    const TAIL_CARD_LIMIT = 4

    /**
     * Resolve the Turn number a chat node belongs to. The generated next-step
     * event is appended after `turn/end`; until the location index resolves it,
     * the payload's own `turn` names the same coordinate.
     *
     * @param {any} node - Chat target node.
     * @returns {number | undefined} turn number, or undefined when unknown.
     */
    function tailNodeTurn(node) {
      if (!node || typeof node !== 'object') return undefined
      const location = node.location
      const locationTurn = location && location.turn && typeof location.turn.turn === 'number'
        ? location.turn.turn
        : undefined
      if (typeof locationTurn === 'number') return locationTurn
      if (node.kind === NEXT_KIND && node.data && typeof node.data.turn === 'number') return node.data.turn
      return undefined
    }

    /**
     * Chat selector: the cards the Turn tail shows, in call order. Model cards
     * placed with `place: "tail"` come first; when the Turn placed none, the
     * Host-generated next-step card for that Turn is emitted instead. The
     * model's own closing card always wins over the generated one.
     *
     * A tail card is a hint for the Turn it closes: once the session moved on
     * to a newer Turn, this selector hides the older Turn's tail cards. The
     * retired-board footer (`selectBoardConversion`) is long-lived and unaffected.
     *
     * @param {any} snapshot - Chat target snapshot.
     * @param {number} turnNumber - Turn whose tail is being rendered.
     * @param {(key: string, vars?: Record<string, unknown>) => string} [t] - translator.
     * @returns {string} JSON fingerprint `{ cards: string[] }`, empty when the Turn placed none.
     */
    function selectTailCards(snapshot, turnNumber, t) {
      if (typeof turnNumber !== 'number') return ''
      const index = snapshotIndexOf(snapshot)
      if (index === undefined) return ''

      // Hide older Turns' tail cards once a newer Turn has started.
      if (typeof index.latestTurn === 'number' && index.latestTurn > turnNumber) return ''

      const translate = typeof t === 'function' ? t : fallbackT
      const cards = []
      const own = index.tails.get(turnNumber)
      if (own !== undefined) for (const argsRaw of own) cards.push(argsRaw)
      if (cards.length === 0) {
        const generated = index.next.get(turnNumber)
        if (generated !== undefined) {
          const spec = nextStepsSpec(generated, translate)
          if (spec !== null) cards.push(spec)
        }
      }
      if (cards.length === 0) return ''
      return JSON.stringify({ cards })
    }

    /**
     * Turn-tail cards: everything the Turn tail shows — the model's own `place:
     * "tail"` cards, or the Host-generated next-step card when the model placed
     * none. Each is an ordinary card — blocks, `look`, and `actions` all work —
     * stacked under the reply, so a "next step" card ends the Turn the way the
     * model intended.
     *
     * @param {any} props - turn-tail props (`turn`, `useChat`, `inputActions`).
     * @returns {any}
     */
    function TurnTailCards(props) {
      const t = resolveT(props)
      const turn = props ? props.turn : undefined
      const turnNumber = turn && typeof turn.turn === 'number' ? turn.turn : undefined
      const useChat = props && typeof props.useChat === 'function' ? props.useChat : EMPTY_CHAT_SELECTOR
      // Unconditional call: the fallback keeps the hook order stable.
      const fingerprint = useChat((snapshot) => selectTailCards(snapshot, turnNumber, t))
      if (typeof fingerprint !== 'string' || fingerprint === '') return null
      let data
      try {
        data = JSON.parse(fingerprint)
      } catch {
        return null
      }
      const cards = data && Array.isArray(data.cards) ? data.cards : []
      if (cards.length === 0) return null
      return h(
        'div',
        { className: PREFIX + 'tail-card ' + PREFIX + 'tail-card--next', 'data-dsh-super-cards': '1', 'data-place': 'tail' },
        cards.map((argsRaw, index) =>
          h(
            RenderErrorBoundary,
            { key: 'tail' + index, t },
            h(RenderUiCard, {
              phase: 'start',
              block: { argsRaw },
              t,
              inputActions: props ? props.inputActions : undefined,
              completed: true,
              bindings: BINDINGS,
            }),
          ),
        ),
      )
    }

    /**
     * Persistent dock card: pinned below the transcript, above the composer.
     * It listens to the Chat snapshot, so `live` blocks refresh as messages
     * arrive without the model calling the tool again.
     *
     * @param {any} props - dock slot props (`useChat`).
     * @returns {any}
     */
    function DockCard(props) {
      const t = resolveT(props)
      const useChat = props && typeof props.useChat === 'function' ? props.useChat : EMPTY_CHAT_SELECTOR
      // Unconditional call: the fallback keeps the hook order stable.
      const fingerprint = useChat(selectDockCard)
      // Runner-up: a completed board collapses by itself; the user can still
      // expand it (the manual choice then wins for the rest of the mount).
      const [manualCollapsed, setManualCollapsed] = React.useState(null)
      // A dismissed board rests as one line above the composer.
      const [dismissed, setDismissed] = React.useState(false)
      if (typeof fingerprint !== 'string' || fingerprint === '') return null
      let data
      try {
        data = JSON.parse(fingerprint)
      } catch {
        return null
      }
      if (!data || typeof data.spec !== 'string' || data.spec === '') return null
      const parsed = parseSpecJson(data.spec)
      const title = parsed.ok && parsed.value && typeof parsed.value.title === 'string' && parsed.value.title !== ''
        ? parsed.value.title
        : t('dock.title')
      const blocks = parsed.ok && parsed.value && Array.isArray(parsed.value.blocks) ? parsed.value.blocks.length : 0
      const status = parsed.ok && parsed.value ? resolveStatus(parsed.value) : 'running'
      const collapsed = manualCollapsed === null ? status === 'success' : manualCollapsed
      const toggle = () => setManualCollapsed((previous) => !(previous === null ? status === 'success' : previous))
      if (dismissed) {
        return h(
          'div',
          { className: PREFIX + 'dock', 'data-dsh-super-cards': '1' },
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'dock-head ' + PREFIX + 'dock-head--closed',
              'aria-expanded': 'false',
              'aria-label': t('dock.reopen'),
              onClick: () => setDismissed(false),
            },
            h('span', { className: PREFIX + 'dock-icon ' + PREFIX + 'dock-icon--muted', 'aria-hidden': 'true' }, iconGlyph('list')),
            h('span', { className: PREFIX + 'dock-title' }, t('dock.closed')),
            h('span', { className: PREFIX + 'dock-chevron', 'aria-hidden': 'true' }, chevronGlyph(false)),
          ),
        )
      }
      return h(
        'div',
        { className: PREFIX + 'dock', 'data-dsh-super-cards': '1', 'data-status': status },
        h(
          'div',
          { className: PREFIX + 'dock-head', 'data-status': status },
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'dock-toggle',
              'aria-expanded': collapsed ? 'false' : 'true',
              'aria-label': title + (status === 'none' || status === 'neutral' ? '' : ' · ' + t('status.' + status)),
              onClick: toggle,
            },
            h('span', { className: PREFIX + 'dock-icon', 'aria-hidden': 'true' }, iconGlyph(status === 'success' ? 'check' : 'sparkle')),
            h('span', { className: PREFIX + 'dock-title' }, title),
            status === 'none' || status === 'neutral'
              ? null
              : h('span', { className: PREFIX + 'dock-meta' }, t('status.' + status)),
            h('span', { className: PREFIX + 'dock-chevron', 'aria-hidden': 'true' }, chevronGlyph(!collapsed)),
          ),
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'dock-close',
              'aria-label': t('close.label'),
              onClick: () => setDismissed(true),
            },
            closeGlyph(),
          ),
        ),
        collapsed
          ? null
          : h(
            'div',
            { className: PREFIX + 'dock-body' },
            h(RenderErrorBoundary, { t }, h(RenderUiCard, {
              phase: 'start',
              block: { argsRaw: data.spec },
              t,
              inputActions: props ? props.inputActions : undefined,
              live: data.live,
              variant: 'dock',
              bindings: BINDINGS,
            })),
          ),
      )
    }

    // --- configuration surfaces -------------------------------------------
    // Two seats for the plugin's row config: the bundle's own page in the
    // Plugins screen (`plugins.bundle.config`, keyed) with the basic knobs, and
    // a tab inside Settings -> Built-in plugins (`settings.plugins.tab`, list)
    // with the full set. The page entry is handed a host-owned form by the
    // Plugins page; the Settings tab has no owner props, so it reads the same
    // values from the optional `configForms` client service and subscribes to
    // its changes. Everything here degrades to a muted line instead of throwing.

    /** Keyed slot carrying one bundle's configuration on its Plugins page. */
    const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config'
    /** List slot carrying the tabs of Settings -> Built-in plugins. */
    const PLUGINS_TAB_SLOT = 'settings.plugins.tab'
    /** The bundle package name: the keyed slot's key and the config namespace stem. */
    const BUNDLE_KEY = 'dsh-super-cards'
    /** The Settings tab id. */
    const PLUGINS_TAB_ID = 'super-cards'
    /** Placement names the select offers, in display order. */
    const CONFIG_PLACES = ['answer', 'process', 'dock', 'tail']
    /** Settings namespaces the tab accepts: any id that ends with this stem. */
    const CONFIG_NS_SUFFIX = 'super-cards'

    /**
     * Editable row-config fields, one row each. `scope` decides which surface
     * renders it: the bundle page shows `basic`, the Settings tab shows all.
     */
    const CONFIG_FIELDS = [
      { key: 'nextSteps', type: 'boolean', scope: 'basic', label: 'config.nextSteps' },
      { key: 'dock', type: 'boolean', scope: 'basic', label: 'config.dock' },
      { key: 'defaultPlace', type: 'select', scope: 'basic', label: 'config.defaultPlace' },
      { key: 'maxBlocks', type: 'number', scope: 'basic', label: 'config.maxBlocks', min: 1, max: MAX_BLOCKS },
      { key: 'nextStepsMax', type: 'number', scope: 'full', label: 'config.nextStepsMax', min: 1, max: 4 },
      { key: 'nextStepsTimeoutMs', type: 'number', scope: 'full', label: 'config.nextStepsTimeoutMs', min: 1000, max: 60000 },
      { key: 'nextStepsMinChars', type: 'number', scope: 'full', label: 'config.nextStepsMinChars', min: 0, max: 2000 },
      { key: 'nextStepsProvider', type: 'text', scope: 'full', label: 'config.nextStepsProvider' },
      { key: 'nextStepsModel', type: 'text', scope: 'full', label: 'config.nextStepsModel' },
      { key: 'blocks', type: 'list', scope: 'full', label: 'config.blocks', hint: 'config.blocksHint' },
    ]

    /**
     * The editable fields one surface shows.
     *
     * @param {string} scope - `'basic'` for the bundle page, `'full'` for the tab.
     * @returns {Array<any>} field specs in display order.
     */
    function configFields(scope) {
      if (scope === 'full') return CONFIG_FIELDS.slice()
      return CONFIG_FIELDS.filter((field) => field.scope === 'basic')
    }

    /**
     * Split a comma-separated block list into unique type names.
     *
     * @param {unknown} raw - text control value, or an array from the Host.
     * @returns {string[]} trimmed, non-empty, unique names.
     */
    function configBlockList(raw) {
      const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
      const list = []
      for (const part of parts) {
        if (typeof part !== 'string') continue
        const name = part.trim()
        if (name === '' || list.indexOf(name) !== -1) continue
        list.push(name)
      }
      return list
    }

    /**
     * Read the numeric draft value for one field.
     *
     * @param {any} field - field spec with `min`/`max`.
     * @param {unknown} raw - draft value (typed text or a number).
     * @returns {number | undefined} an integer inside the field range.
     */
    function configNumber(field, raw) {
      const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
      if (text === '') return undefined
      const number = Number(text)
      if (!Number.isFinite(number) || !Number.isInteger(number)) return undefined
      if (number < field.min || number > field.max) return undefined
      return number
    }

    /**
     * Seed a draft from the accepted values: booleans stay booleans, numbers and
     * lists become text control values, optional text stays a string.
     *
     * @param {any} state - ConfigFormSnapshot.
     * @returns {Record<string, any>} draft keyed by field name.
     */
    function configDraft(state) {
      const value = state && state.value && typeof state.value === 'object' ? state.value : {}
      const draft = {}
      for (const field of CONFIG_FIELDS) {
        const current = value[field.key]
        if (field.type === 'boolean') draft[field.key] = current === true
        else if (field.type === 'number') draft[field.key] = typeof current === 'number' ? String(current) : ''
        else if (field.type === 'list') draft[field.key] = Array.isArray(current) ? current.join(', ') : ''
        else draft[field.key] = typeof current === 'string' ? current : ''
      }
      return draft
    }

    /**
     * Whether a draft holds a value no control can submit.
     *
     * @param {Record<string, any>} draft - draft keyed by field name.
     * @returns {boolean} true when a required number is empty or out of range.
     */
    function configInvalid(draft) {
      for (const field of CONFIG_FIELDS) {
        const raw = draft ? draft[field.key] : undefined
        if (field.type === 'number' && configNumber(field, raw) === undefined) return true
      }
      return false
    }

    /**
     * Build the write ops for the fields that differ from the accepted values.
     * A cleared optional text or list becomes `unset`, so the field inherits the
     * Host default again.
     *
     * @param {Record<string, any>} draft - draft keyed by field name.
     * @param {any} state - ConfigFormSnapshot the draft was read against.
     * @returns {Array<{ op: string, path: string[], value?: any }>} ordered ops.
     */
    function configOps(draft, state) {
      const value = state && state.value && typeof state.value === 'object' ? state.value : {}
      const ops = []
      for (const field of CONFIG_FIELDS) {
        const raw = draft ? draft[field.key] : undefined
        const current = value[field.key]
        if (field.type === 'boolean') {
          const next = raw === true
          if (current !== next) ops.push({ op: 'set', path: [field.key], value: next })
          continue
        }
        if (field.type === 'number') {
          const next = configNumber(field, raw)
          if (next !== undefined && current !== next) ops.push({ op: 'set', path: [field.key], value: next })
          continue
        }
        if (field.type === 'select') {
          if (CONFIG_PLACES.indexOf(raw) === -1) continue
          if (current !== raw) ops.push({ op: 'set', path: [field.key], value: raw })
          continue
        }
        if (field.type === 'list') {
          const next = configBlockList(raw)
          const base = configBlockList(current)
          if (next.length === 0) {
            if (base.length > 0) ops.push({ op: 'unset', path: [field.key] })
            continue
          }
          if (next.join(',') !== base.join(',')) ops.push({ op: 'set', path: [field.key], value: next })
          continue
        }
        // Optional text: blank clears the override, anything else writes it.
        const next = typeof raw === 'string' ? raw.trim() : ''
        if (next === '') {
          if (typeof current === 'string' && current !== '') ops.push({ op: 'unset', path: [field.key] })
          continue
        }
        if (next !== current) ops.push({ op: 'set', path: [field.key], value: next })
      }
      return ops
    }

    /**
     * Reset ops: clear every field the user layer holds so each inherits the
     * Host defaults again.
     *
     * @param {any} state - ConfigFormSnapshot.
     * @returns {Array<{ op: 'unset', path: string[] }>} ordered unset ops.
     */
    function configResetOps(state) {
      const user = state && state.user && typeof state.user === 'object' && !Array.isArray(state.user) ? state.user : {}
      const ops = []
      for (const field of CONFIG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(user, field.key)) ops.push({ op: 'unset', path: [field.key] })
      }
      return ops
    }

    /**
     * One-line summary of the accepted values for the card view.
     *
     * @param {any} state - ConfigFormSnapshot.
     * @param {(key: string, vars?: Record<string, unknown>) => string} [t] - translator.
     * @returns {string} localized summary, or the empty notice when no values are held.
     */
    function configSummaryText(state, t) {
      const translate = typeof t === 'function' ? t : fallbackT
      const value = state && state.value && typeof state.value === 'object' ? state.value : undefined
      if (!value) return translate('config.summaryEmpty')
      const place = CONFIG_PLACES.indexOf(value.defaultPlace) === -1 ? 'answer' : value.defaultPlace
      return translate('config.summary', {
        place: translate('config.place.' + place),
        blocks: typeof value.maxBlocks === 'number' ? String(value.maxBlocks) : '?',
        steps: value.nextSteps === true ? translate('config.on') : translate('config.off'),
        dock: value.dock === true ? translate('config.on') : translate('config.off'),
      })
    }

    /**
     * Pick the settings namespace the tab edits: the settings entry whose id
     * ends with the plugin's package stem. Falls back to the plain stem when the
     * describe snapshot is not readable yet.
     *
     * @param {any} service - the optional `configForms` client service.
     * @returns {string} settings namespace id.
     */
    function configNamespace(service) {
      try {
        const describe = service && typeof service.describe === 'function' ? service.describe() : undefined
        const snapshot = describe && typeof describe.getSnapshot === 'function' ? describe.getSnapshot() : undefined
        const namespaces = snapshot && snapshot.view && Array.isArray(snapshot.view.namespaces)
          ? snapshot.view.namespaces
          : []
        for (const entry of namespaces) {
          if (entry && typeof entry.ns === 'string' && entry.ns.slice(-CONFIG_NS_SUFFIX.length) === CONFIG_NS_SUFFIX) {
            return entry.ns
          }
        }
      } catch {
        // An unavailable service or describe face means the plain stem.
      }
      return CONFIG_NS_SUFFIX
    }

    /**
     * Resolve the form face for one surface: the owner-supplied form when the
     * slot hands one down, otherwise the optional `configForms` service entry.
     *
     * @param {any} props - slot props (`form` is the owner's ConfigPageForm).
     * @param {Function | undefined} getForms - lazy `configForms` reader.
     * @returns {{ snapshot?: any, mutate?: Function } | undefined} form face.
     */
    function configFormFace(props, getForms) {
      const external = props ? props.form : undefined
      if (external && external.state) {
        return {
          snapshot: external.state,
          mutate: typeof external.mutate === 'function' ? external.mutate : undefined,
        }
      }
      let service
      try {
        service = typeof getForms === 'function' ? getForms() : undefined
      } catch {
        service = undefined
      }
      if (!service || typeof service.get !== 'function') return undefined
      let form
      try {
        form = service.get(configNamespace(service))
      } catch {
        form = undefined
      }
      if (!form) return undefined
      let snapshot
      try {
        snapshot = typeof form.getSnapshot === 'function' ? form.getSnapshot() : undefined
      } catch {
        snapshot = undefined
      }
      if (!snapshot) return undefined
      const mutate = typeof form.mutate === 'function'
        ? (ops, revision) => form.mutate(ops, revision)
        : undefined
      return { form, snapshot, mutate }
    }

    /**
     * Re-render whenever the optional config form publishes a new snapshot.
     * Mount-only: the form controller exists for the plugin's lifetime, and an
     * owner-supplied form is already a live snapshot on each render.
     *
     * @param {any} props - slot props.
     * @param {Function | undefined} getForms - lazy `configForms` reader.
     * @returns {void}
     */
    function useConfigFormSubscription(props, getForms) {
      const [version, setVersion] = React.useState(0)
      void version
      React.useEffect(() => {
        if (props && props.form) return undefined
        let form
        try {
          const service = typeof getForms === 'function' ? getForms() : undefined
          form = service && typeof service.get === 'function' ? service.get(configNamespace(service)) : undefined
        } catch {
          form = undefined
        }
        if (!form || typeof form.subscribe !== 'function') return undefined
        try {
          const off = form.subscribe(() => setVersion((previous) => previous + 1))
          return typeof off === 'function' ? off : undefined
        } catch {
          return undefined
        }
      }, [])
      return undefined
    }

    /**
     * Render one field's control: checkbox, number, select, or text input.
     *
     * @param {any} field - field spec.
     * @param {Record<string, any>} draft - current draft.
     * @param {Function} t - translator.
     * @param {Function} onChange - change handler for this field.
     * @param {boolean} disabled - while a save is in flight.
     * @returns {any}
     */
    function configControl(field, draft, t, onChange, disabled) {
      const value = draft ? draft[field.key] : ''
      if (field.type === 'boolean') {
        return h('input', {
          type: 'checkbox',
          className: PREFIX + 'config-check',
          checked: value === true,
          disabled,
          onChange,
        })
      }
      if (field.type === 'number') {
        return h('input', {
          type: 'number',
          className: PREFIX + 'config-input',
          value: typeof value === 'string' ? value : '',
          min: String(field.min),
          max: String(field.max),
          step: '1',
          disabled,
          onChange,
        })
      }
      if (field.type === 'select') {
        const current = typeof value === 'string' ? value : ''
        const options = CONFIG_PLACES.map((place) => h('option', { key: place, value: place }, t('config.place.' + place)))
        // A resolved value outside the known placements still shows a choice.
        if (CONFIG_PLACES.indexOf(current) === -1) options.unshift(h('option', { key: 'unset', value: '' }, t('config.unset')))
        return h(
          'select',
          {
            className: PREFIX + 'config-input',
            value: current,
            disabled,
            onChange,
          },
          options,
        )
      }
      return h('input', {
        type: 'text',
        className: PREFIX + 'config-input',
        value: typeof value === 'string' ? value : '',
        placeholder: field.hint ? t(field.hint) : undefined,
        disabled,
        onChange,
      })
    }

    /**
     * The configuration form body: one row per field, a save action that submits
     * only the changed fields, and a reset action that clears the user layer.
     *
     * @param {any} props - `{ state, save, scope, draft?, t? }`.
     * @returns {any}
     */
    function ConfigFormPanel(props) {
      const t = resolveT(props)
      const state = props ? props.state : undefined
      const scope = props && props.scope === 'full' ? 'full' : 'basic'
      const fields = configFields(scope)
      const initial = props && props.draft !== undefined ? props.draft : configDraft(state)
      const [draft, setDraft] = React.useState(initial)
      const [saving, setSaving] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)
      // A new Host revision replaces the draft: the page is the Host's view now.
      React.useEffect(() => {
        setDraft(configDraft(state))
        setFeedback(null)
      }, [state && state.revision])
      const status = state && typeof state.status === 'string' ? state.status : 'loading'
      const writable = state ? state.writable !== false : false
      const editable = status === 'ready' && writable
      const invalid = configInvalid(draft)
      const changed = configOps(draft, state)
      const resetOps = configResetOps(state)
      const busy = saving === true
      const update = (key) => (event) => {
        const target = event && event.target ? event.target : {}
        const next = Object.assign({}, draft)
        if (Object.prototype.hasOwnProperty.call(target, 'checked')) next[key] = target.checked === true
        else next[key] = typeof target.value === 'string' ? target.value : ''
        setDraft(next)
        setFeedback(null)
      }
      const run = (ops) => {
        if (typeof props.save !== 'function' || ops.length === 0) return
        setSaving(true)
        setFeedback(null)
        let result
        try {
          result = props.save(ops, state ? state.revision : undefined)
        } catch {
          setSaving(false)
          setFeedback(false)
          return
        }
        if (result && typeof result.then === 'function') {
          result.then(
            (ok) => {
              setSaving(false)
              setFeedback(ok === false ? false : true)
            },
            () => {
              setSaving(false)
              setFeedback(false)
            },
          )
          return
        }
        setSaving(false)
        setFeedback(result === false ? false : true)
      }
      if (!state || status === 'loading') {
        return h('p', { className: PREFIX + 'config-muted' }, t('config.loading'))
      }
      if (status === 'unavailable') {
        return h('p', { className: PREFIX + 'config-muted' }, t('config.unavailable'))
      }
      if (!writable) return h('p', { className: PREFIX + 'config-muted' }, t('config.readOnly'))
      const rows = fields.map((field) => h(
        'label',
        { key: field.key, className: PREFIX + 'config-row' },
        h('span', { className: PREFIX + 'config-label' }, t(field.label)),
        h(
          'span',
          { className: PREFIX + 'config-control' },
          configControl(field, draft, t, update(field.key), busy),
        ),
      ))
      return h(
        'div',
        { className: PREFIX + 'config' },
        h('div', { className: PREFIX + 'config-title' }, t('config.title')),
        h('p', { className: PREFIX + 'config-intro' }, t('config.intro')),
        rows,
        invalid ? h('span', { className: PREFIX + 'config-hint' }, t('config.invalid')) : null,
        h(
          'div',
          { className: PREFIX + 'config-actions' },
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'config-button',
              'data-variant': 'primary',
              disabled: busy || !editable || invalid || changed.length === 0,
              onClick: () => run(changed),
            },
            busy ? t('config.saving') : t('config.save'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: PREFIX + 'config-button',
              disabled: busy || !editable || resetOps.length === 0,
              onClick: () => run(resetOps),
            },
            t('config.reset'),
          ),
          feedback === true
            ? h('span', { className: PREFIX + 'config-status', 'data-ok': '1', role: 'status' }, t('config.saved'))
            : null,
          feedback === false
            ? h('span', { className: PREFIX + 'config-status', 'data-ok': '0', role: 'status' }, t('config.saveFailed'))
            : null,
        ),
      )
    }

    /**
     * The bundle's configuration entry on the Plugins page: `summary` is the
     * card's one-liner, `page` the basic form.
     *
     * @param {any} props - `{ view, form?, getForms?, draft?, t? }`.
     * @returns {any}
     */
    function ConfigBundleCard(props) {
      const t = resolveT(props)
      const getForms = props ? props.getForms : undefined
      useConfigFormSubscription(props, getForms)
      const face = configFormFace(props, getForms)
      if (props && props.view === 'summary') {
        return h('span', { className: PREFIX + 'config-summary' }, configSummaryText(face ? face.snapshot : undefined, t))
      }
      if (!face || !face.mutate) {
        return h('p', { className: PREFIX + 'config-muted' }, t(face ? 'config.readOnly' : 'config.unavailable'))
      }
      return h(ConfigFormPanel, {
        state: face.snapshot,
        save: face.mutate,
        scope: 'basic',
        draft: props ? props.draft : undefined,
        t,
      })
    }

    /**
     * The Settings -> Built-in plugins tab: the full config, read from the
     * optional `configForms` service because the tab receives no owner props. A
     * missing service or namespace renders a muted line instead of throwing.
     *
     * @param {any} props - `{ getForms?, draft?, t? }`.
     * @returns {any}
     */
    function ConfigSettingsTab(props) {
      const t = resolveT(props)
      const getForms = props ? props.getForms : undefined
      useConfigFormSubscription(props, getForms)
      const face = configFormFace(props, getForms)
      if (!face || !face.mutate) {
        return h('p', { className: PREFIX + 'config-muted' }, t(face ? 'config.readOnly' : 'config.unavailable'))
      }
      return h(ConfigFormPanel, {
        state: face.snapshot,
        save: face.mutate,
        scope: 'full',
        draft: props ? props.draft : undefined,
        t,
      })
    }

    /** Copy glyph: two offset sheets, the generic "copy" affordance. */
    function copyGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('rect', {
          x: 5.4, y: 5.4, width: 7.2, height: 7.2, rx: 1.6,
          stroke: 'currentColor', strokeWidth: '1.3',
        }),
        h('path', {
          d: 'M10.2 5.4V4.4c0-.9-.7-1.6-1.6-1.6H4.4c-.9 0-1.6.7-1.6 1.6v4.2c0 .9.7 1.6 1.6 1.6h1',
          stroke: 'currentColor', strokeWidth: '1.3', strokeLinecap: 'round',
        }),
      )
    }

    /** Close (dismiss) glyph for cards and the dock board. */
    function closeGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * Disclosure chevron for the dock header and the folded card line. The
     * same down-pointing glyph is rotated when open, so expanding is one
     * smooth turn instead of an instant path swap.
     *
     * @param {boolean} open - whether the body is expanded.
     * @returns {any}
     */
    function chevronGlyph(open) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 12,
          height: 12,
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { transform: open ? 'rotate(180deg)' : 'rotate(0deg)' },
        },
        h('path', {
          d: 'M4.2 6.2 8 10l3.8-3.8',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /**
     * Tool view keyed `render_ui`.
     *
     * Once the inline Chat row is installed the card has exactly one
     * presentation — the row in the answer flow — so the Tool call inside the
     * folded process renders nothing. Without the row definition (service
     * missing) the card falls back into this Tool row so it is never lost.
     *
     * @param {any} props - Tool view props.
     * @returns {any}
     */
    function RenderUiRow(props) {
      if (INLINE_PLACEMENT) return null
      const t = resolveT(props)
      return h(RenderErrorBoundary, { t }, h(RenderUiCard, Object.assign({}, props, { t, bindings: BINDINGS })))
    }

    /**
     * Insert the stylesheet once, and remove it when the plugin is disposed.
     * Guarded so importing this module outside a browser never touches `document`.
     *
     * @param {any} ctx - Client plugin context.
     */
    function insertStyles(ctx) {
      if (typeof document === 'undefined' || !document.head) return
      try {
        ctx.effect(() => {
          let element = document.getElementById(STYLE_ID)
          if (element === null) {
            element = document.createElement('style')
            element.id = STYLE_ID
            element.textContent = CSS
            document.head.appendChild(element)
          }
          return () => {
            if (element !== null && element.parentNode !== null) element.parentNode.removeChild(element)
          }
        }, NS + '.styles')
      } catch (error) {
        warnOnce('styles', '[' + NS + '] stylesheet not installed: ' + describeError(error))
      }
    }

    // -------------------------------------------------------------------------
    // Extension service
    // -------------------------------------------------------------------------

    /** Client service name other plugins reach through `ctx.get('superCards')`. */
    const SERVICE_NAME = 'superCards'
    /** Service API version (bumped only on a breaking API change). */
    const SERVICE_VERSION = 1

    /** Subscribers notified after a block/placement mutation (mounted cards). */
    const REGISTRY_LISTENERS = new Set()

    /**
     * Whether `key` is an own entry of a registry object (never a prototype
     * member such as `constructor` or `toString`).
     *
     * @param {Record<string, any>} target - registry object.
     * @param {unknown} key - candidate key.
     * @returns {boolean}
     */
    function registryOwn(target, key) {
      return typeof key === 'string' && Object.prototype.hasOwnProperty.call(target, key)
    }

    /**
     * Resolve one block implementation.
     *
     * @param {unknown} type - wire block type.
     * @returns {{ dock: boolean, normalize: Function, render: Function } | undefined}
     */
    function blockImpl(type) {
      return registryOwn(BLOCK_IMPL, type) ? BLOCK_IMPL[type] : undefined
    }

    /**
     * Resolve one block implementation, following a content-field alias.
     *
     * The direct registry lookup runs first, so a plugin that registers the
     * literal type keeps control; an unknown name that matches a `content` field
     * (`note`, `summary`, …) folds onto the block that renders the same material.
     *
     * @param {unknown} type - wire block type.
     * @returns {{ dock: boolean, normalize: Function, render: Function } | undefined}
     */
    function resolvedBlockImpl(type) {
      const direct = blockImpl(type)
      if (direct !== undefined) return direct
      const alias = typeof type === 'string' ? BLOCK_ALIASES.get(type) : undefined
      return alias === undefined ? undefined : blockImpl(alias.type)
    }

    /**
     * Resolve one placement definition; unknown names fall back to `answer`.
     *
     * @param {unknown} name - placement name.
     * @returns {{ groupTree: string, dock?: boolean, tail?: boolean }}
     */
    function placementDef(name) {
      return registryOwn(PLACEMENTS, name) ? PLACEMENTS[name] : PLACEMENTS.answer
    }

    /**
     * Whether a placement owns the persistent dock board.
     *
     * @param {unknown} name - placement name.
     * @returns {boolean}
     */
    function isDockPlacement(name) {
      return placementDef(name).dock === true
    }

    /**
     * Whether a placement renders under a completed Turn instead of inline at
     * the call's own position. A tail card is never mounted in the answer flow;
     * the Turn footer reads it back from the session log.
     *
     * @param {unknown} name - placement name.
     * @returns {boolean}
     */
    function isTailPlacement(name) {
      return placementDef(name).tail === true
    }

    /**
     * Subscribe to registry mutations; mounted cards re-render through this.
     *
     * @param {Function} listener - called after every register/replace/restore.
     * @returns {() => void} unsubscribe.
     */
    function subscribeRegistry(listener) {
      if (typeof listener !== 'function') return () => {}
      REGISTRY_LISTENERS.add(listener)
      let active = true
      return () => {
        if (!active) return
        active = false
        REGISTRY_LISTENERS.delete(listener)
      }
    }

    /**
     * Notify every subscriber after a registry mutation; a throwing subscriber
     * must never break the mutation itself.
     *
     * @param {{ kind: string, name: string }} change - what changed.
     * @returns {void}
     */
    function notifyRegistry(change) {
      for (const listener of Array.from(REGISTRY_LISTENERS)) {
        try {
          listener(change)
        } catch (error) {
          warnOnce('registry-listener', '[' + NS + '] a registry subscriber threw: ' + describeError(error))
        }
      }
    }

    /**
     * Validate one block registration definition.
     *
     * @param {any} def - `{ type, dock?, normalize?, render }`.
     * @returns {{ dock: boolean, normalize: Function, render: Function } | null} entry, or null.
     */
    function readBlockDefinition(def) {
      if (!def || typeof def !== 'object') return null
      const type = typeof def.type === 'string' ? def.type.trim() : ''
      if (type === '' || typeof def.render !== 'function') return null
      const normalize = typeof def.normalize === 'function'
        ? def.normalize
        : (raw) => Object.assign({}, raw, { type })
      return { dock: def.dock === true, normalize, render: def.render }
    }

    /**
     * Set one block entry and return the disposer restoring what was there.
     *
     * @param {any} def - `{ type, dock?, normalize?, render }`.
     * @returns {() => void} disposer restoring the previous entry (no-op when refused).
     */
    function setBlock(def) {
      const type = def && typeof def === 'object' && typeof def.type === 'string' ? def.type.trim() : ''
      const entry = readBlockDefinition(def)
      if (entry === null || type === '') {
        warnOnce('registry-block', '[' + NS + '] superCards.blocks: ignored a definition without a type and a render function')
        return () => {}
      }
      const had = registryOwn(BLOCK_IMPL, type)
      const previous = had ? BLOCK_IMPL[type] : undefined
      BLOCK_IMPL[type] = entry
      notifyRegistry({ kind: 'blocks', name: type })
      let active = true
      return () => {
        if (!active) return
        active = false
        if (had) BLOCK_IMPL[type] = previous
        else delete BLOCK_IMPL[type]
        notifyRegistry({ kind: 'blocks', name: type })
      }
    }

    /**
     * Replace (or add) one block type, keeping the previous entry's `dock` flag
     * and functions where the definition omits them.
     *
     * @param {string} type - block type.
     * @param {any} def - `{ dock?, normalize?, render? }`.
     * @returns {() => void} disposer restoring the previous entry.
     */
    function replaceBlockType(type, def) {
      const previous = blockImpl(type)
      const source = def && typeof def === 'object' ? def : {}
      const merged = Object.assign({}, source, {
        type,
        dock: source.dock === undefined && previous !== undefined ? previous.dock : source.dock,
        normalize: source.normalize === undefined && previous !== undefined ? previous.normalize : source.normalize,
        render: source.render === undefined && previous !== undefined ? previous.render : source.render,
      })
      return setBlock(merged)
    }

    /**
     * Read one placement definition, keeping only the known fields.
     *
     * @param {any} def - `{ groupTree?, dock?, tail? }`.
     * @returns {{ groupTree: string, dock?: boolean, tail?: boolean }} placement definition.
     */
    function readPlacementDefinition(def) {
      const source = def && typeof def === 'object' ? def : {}
      const placement = { groupTree: source.groupTree === 'process' ? 'process' : 'turn' }
      if (source.dock === true) placement.dock = true
      if (source.tail === true) placement.tail = true
      return placement
    }

    /**
     * Register one placement and return the disposer restoring the previous one.
     *
     * @param {string} name - placement name.
     * @param {any} def - `{ groupTree?, dock? }`.
     * @returns {() => void}
     */
    function setPlacement(name, def) {
      if (typeof name !== 'string' || name.trim() === '') {
        warnOnce('registry-placement', '[' + NS + '] superCards.placements: ignored a placement without a name')
        return () => {}
      }
      const key = name.trim()
      const had = registryOwn(PLACEMENTS, key)
      const previous = had ? PLACEMENTS[key] : undefined
      PLACEMENTS[key] = readPlacementDefinition(def)
      notifyRegistry({ kind: 'placements', name: key })
      let active = true
      return () => {
        if (!active) return
        active = false
        if (had) PLACEMENTS[key] = previous
        else delete PLACEMENTS[key]
        notifyRegistry({ kind: 'placements', name: key })
      }
    }

    /**
     * Replace (or add) one placement, keeping the previous definition's fields
     * where the new definition omits them.
     *
     * @param {string} name - placement name.
     * @param {any} def - `{ groupTree?, dock? }`.
     * @returns {() => void} disposer restoring the previous definition.
     */
    function replacePlacement(name, def) {
      const previous = registryOwn(PLACEMENTS, name) ? PLACEMENTS[name] : undefined
      const source = def && typeof def === 'object' ? def : {}
      const merged = Object.assign({}, previous || {}, source)
      if (previous && previous.dock === true && source.dock === undefined) merged.dock = true
      return setPlacement(name, merged)
    }

    /**
     * Extension service: read, add and replace block types and placements.
     * Provided as `superCards` for the plugin's whole lifetime.
     */
    const superCardsService = {
      version: SERVICE_VERSION,
      blocks: {
        list: () => Object.keys(BLOCK_IMPL),
        get: (type) => blockImpl(type),
        has: (type) => registryOwn(BLOCK_IMPL, type),
        register: (def) => setBlock(def),
        replace: (type, def) => replaceBlockType(type, def),
      },
      placements: {
        list: () => Object.keys(PLACEMENTS),
        get: (name) => (registryOwn(PLACEMENTS, name) ? PLACEMENTS[name] : undefined),
        register: (name, def) => setPlacement(name, def),
        replace: (name, def) => replacePlacement(name, def),
      },
      /** Preset animation names a block may carry; the stylesheet owns the CSS. */
      motion: {
        list: () => MOTION_EFFECTS.slice(),
        has: (effect) => typeof effect === 'string' && MOTION_EFFECTS.indexOf(effect) !== -1,
      },
      subscribe: (listener) => subscribeRegistry(listener),
    }

    /**
     * Provide the extension service for the plugin's lifetime. A Client build
     * without `ctx.provide` warns once instead of failing the whole plugin.
     *
     * @param {any} ctx - Client plugin context.
     * @returns {void}
     */
    function provideService(ctx) {
      try {
        ctx.effect(() => {
          if (!ctx || typeof ctx.provide !== 'function') {
            throw new Error(SERVICE_NAME + ': ctx.provide is unavailable')
          }
          const disposer = ctx.provide(SERVICE_NAME, superCardsService)
          return () => {
            if (typeof disposer === 'function') disposer()
          }
        }, NS + '.service')
      } catch (error) {
        warnOnce('service', '[' + NS + '] ' + SERVICE_NAME + ' service not provided: ' + describeError(error))
      }
    }

    /** Client setting faces the controls can write (module-wide, set by apply). */
    let BINDINGS = {}

    /**
     * Build the settings face from the live client services.
     *
     * @param {any} ctx - Client plugin context.
     * @returns {{ [key: string]: { get: () => string, set: (value: string) => void } }}
     */
    function makeBindings(ctx) {
      const face = {}
      const service = (name) => {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch {
          return undefined
        }
      }
      const theme = service('theme')
      if (theme && typeof theme.getTheme === 'function' && typeof theme.setTheme === 'function') {
        face.theme = {
          get() {
            try {
              const snapshot = theme.getTheme()
              return snapshot && typeof snapshot.preference === 'string' ? snapshot.preference : ''
            } catch {
              return ''
            }
          },
          set(value) {
            theme.setTheme(value)
          },
        }
      }
      const locale = service('locale')
      if (locale && typeof locale.getLocale === 'function' && typeof locale.setLocale === 'function') {
        face.locale = {
          get() {
            try {
              const snapshot = locale.getLocale()
              return snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
            } catch {
              return ''
            }
          },
          set(value) {
            locale.setLocale(value)
          },
        }
      }
      return face
    }

    /**
     * Register the inline card surface with an active `uiConversation`: the Chat
     * row definition plus its `conversation.chat.node` renderer, and the flag
     * that tells the toolview to leave the row to the inline card.
     *
     * @param {any} scope - context owning the registrations.
     * @returns {void}
     */
    function registerInlineSurface(scope) {
      if (!scope || typeof scope.get !== 'function') return
      let conversation
      let slotService
      try {
        conversation = scope.get('uiConversation')
        slotService = scope.get('slots')
      } catch (error) {
        warnOnce('conversation', '[' + NS + '] uiConversation service unavailable: ' + describeError(error))
        return
      }
      if (!conversation || !conversation.events || typeof conversation.events.register !== 'function') return
      if (!slotService || typeof slotService.inject !== 'function') return
      const registerNode = (key, component) => {
        try {
          return slotService.register({ name: 'conversation.chat.node', key, locale: NS }, component)
        } catch (error) {
          warnOnce('node', '[' + NS + '] ' + NODE_SLOT + ' not installed: ' + describeError(error))
          return () => {}
        }
      }
      try {
        scope.effect(() => conversation.events.register(inlineCardDefinition), NS + '.events')
        scope.effect(() => conversation.events.register(autoCardDefinition), NS + '.auto-events')
        scope.effect(() => conversation.events.register(teamCardDefinition), NS + '.team-events')
        scope.effect(() => conversation.events.register(nextStepsDefinition), NS + '.next-events')
        scope.effect(() => slotService.inject(NODE_SLOT, () => registerNode(NODE_KIND, InlineCardRow)), NS + '.node')
        scope.effect(() => slotService.inject(NODE_SLOT, () => registerNode(AUTO_KIND, AutoCardRow)), NS + '.auto-node')
        scope.effect(() => slotService.inject(NODE_SLOT, () => registerNode(TEAM_KIND, TeamCardRow)), NS + '.team-node')
        scope.effect(() => slotService.inject(NODE_SLOT, () => registerNode(NEXT_KIND, NextStepsCardRow)), NS + '.next-node')
        scope.effect(() => {
          INLINE_PLACEMENT = true
          return () => {
            INLINE_PLACEMENT = false
          }
        }, NS + '.inline')
      } catch (error) {
        warnOnce('events', '[' + NS + '] chat row definition not installed: ' + describeError(error))
      }
    }

    /** Services this Client half needs. */
    const inject = ['slots', 'locale', 'uiConversation']

    /**
     * Register the locale dictionaries, the stylesheet, and the keyed Tool row.
     * Every step is contained: a rejected declaration warns once and never
     * throws out of `apply`.
     *
     * @param {any} ctx - Client plugin context.
     */
    function apply(ctx) {
      // Registers the plugin dictionaries on the locale service; the slot's
      // `locale: NS` declaration then hands the bound `t` to the component.
      const t = makeTranslator(ctx)
      BINDINGS = makeBindings(ctx)
      insertStyles(ctx)
      provideService(ctx)

      let slots
      try {
        slots = ctx && typeof ctx.get === 'function' ? ctx.get('slots') : undefined
      } catch (error) {
        warnOnce('slots', '[' + NS + '] slots service unavailable: ' + describeError(error))
        slots = undefined
      }
      if (!slots || typeof slots.inject !== 'function') return

      try {
        ctx.effect(
          () =>
            slots.inject(SLOT, () => {
              try {
                // Literal wire names here: this registration is the contract's anchor.
                return slots.register({ name: 'tool.call.toolview', key: 'render_ui', locale: NS }, RenderUiRow)
              } catch (error) {
                warnOnce('toolview', '[' + NS + '] ' + SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.toolview',
        )
      } catch (error) {
        warnOnce('toolview', '[' + NS + '] ' + SLOT + ' not installed: ' + describeError(error))
      }

      // Inline placement: a custom Chat row anchored at the call's own seq, at
      // the `turn` group-tree position so it stays outside the folded process
      // and is interleaved with the answer text.
      //
      // The Conversation service can activate after this plugin on a cold page
      // load. Reading it once here is how a restarted page lost every historical
      // card (the row definition was never installed, so replay had no renderer)
      // while a warm page kept working. `ctx.inject` waits for the service and
      // re-runs registration if it is ever replaced.
      if (ctx && typeof ctx.inject === 'function') {
        try {
          ctx.inject(['uiConversation'], (scope) => registerInlineSurface(scope || ctx))
        } catch (error) {
          warnOnce('conversation', '[' + NS + '] uiConversation injection failed: ' + describeError(error))
          registerInlineSurface(ctx)
        }
      } else {
        registerInlineSurface(ctx)
      }

      // Persistent dock card (`place: "dock"`): pinned above the composer and
      // always visible for this Session; `live` blocks keep it current.
      try {
        ctx.effect(
          () =>
            slots.inject(DOCK_SLOT, () => {
              try {
                return slots.register(
                  { name: 'conversation.input.dock', id: 'super-cards-dock', order: 40, locale: NS },
                  DockCard,
                )
              } catch (error) {
                warnOnce('dock', '[' + NS + '] ' + DOCK_SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.dock',
        )
      } catch (error) {
        warnOnce('dock', '[' + NS + '] ' + DOCK_SLOT + ' not installed: ' + describeError(error))
      }

      // A board is live-only: once its Turn closes the dock retires it and this
      // footer hands the same information back as a normal card (unless the
      // model already emitted an answer card for the Turn).
      try {
        ctx.effect(
          () =>
            slots.inject(TAIL_SLOT, () => {
              try {
                return slots.register(
                  { name: 'conversation.chat.turnTail', id: 'super-cards-board-card', order: 31, locale: NS },
                  TurnTailBoard,
                )
              } catch (error) {
                warnOnce('tail', '[' + NS + '] ' + TAIL_SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.tail',
        )
      } catch (error) {
        warnOnce('tail', '[' + NS + '] ' + TAIL_SLOT + ' not installed: ' + describeError(error))
      }

      // Next-step cards (`place: "tail"`): the model's own closing card, shown
      // after the reply and before the Turn's action row, so it is the last
      // thing the user reads. Separate id: it must not be replaced by, nor
      // replace, the retired-board footer above.
      try {
        ctx.effect(
          () =>
            slots.inject(TAIL_SLOT, () => {
              try {
                return slots.register(
                  { name: 'conversation.chat.turnTail', id: 'super-cards-tail-card', order: 32, locale: NS },
                  TurnTailCards,
                )
              } catch (error) {
                warnOnce('tail-next', '[' + NS + '] ' + TAIL_SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.tail-next',
        )
      } catch (error) {
        warnOnce('tail-next', '[' + NS + '] ' + TAIL_SLOT + ' not installed: ' + describeError(error))
      }

      // Configuration surfaces: the bundle's own page in the Plugins screen and
      // a tab inside Settings -> Built-in plugins. Both are seats on other
      // plugins' pages, so an absent slot only warns once and degrades to
      // nothing. `configForms` is optional: the Settings page provides it, and
      // a browser without settings still renders the muted line.
      const getConfigForms = () => {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get('configForms') : undefined
        } catch {
          return undefined
        }
      }
      try {
        ctx.effect(
          () =>
            slots.inject(BUNDLE_CONFIG_SLOT, () => {
              try {
                return slots.register(
                  { name: 'plugins.bundle.config', key: BUNDLE_KEY, locale: NS },
                  (props) => h(ConfigBundleCard, Object.assign({}, props, {
                    getForms: getConfigForms,
                    t: props && typeof props.t === 'function' ? props.t : t,
                  })),
                )
              } catch (error) {
                warnOnce('bundle-config', '[' + NS + '] ' + BUNDLE_CONFIG_SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.bundle-config',
        )
      } catch (error) {
        warnOnce('bundle-config', '[' + NS + '] ' + BUNDLE_CONFIG_SLOT + ' not installed: ' + describeError(error))
      }

      try {
        ctx.effect(
          () =>
            slots.inject(PLUGINS_TAB_SLOT, () => {
              try {
                return slots.register(
                  {
                    name: 'settings.plugins.tab',
                    id: PLUGINS_TAB_ID,
                    order: 30,
                    locale: NS,
                    label: () => t('config.tab'),
                  },
                  (props) => h(ConfigSettingsTab, Object.assign({}, props, {
                    getForms: getConfigForms,
                    t: props && typeof props.t === 'function' ? props.t : t,
                  })),
                )
              } catch (error) {
                warnOnce('settings-tab', '[' + NS + '] ' + PLUGINS_TAB_SLOT + ' not installed: ' + describeError(error))
                return () => {}
              }
            }),
          NS + '.settings-tab',
        )
      } catch (error) {
        warnOnce('settings-tab', '[' + NS + '] ' + PLUGINS_TAB_SLOT + ' not installed: ' + describeError(error))
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = {
      css: CSS,
      extractSpec,
      normalizeSpec,
      normalizeBlock,
      normalizeMotion,
      motionEffects: MOTION_EFFECTS,
      motionDefaults: { duration: MOTION_DEFAULT_DURATION, delay: 0, loop: false },
      withMotion,
      parseInline,
      safeHref,
      contentText,
      parseSpecJson,
      renderBlock,
      listFlows,
      statColumns,
      kvLayout,
      KV_TILE_MAX_ITEMS,
      KV_TILE_MAX_KEY,
      KV_TILE_MAX_VALUE,
      renderUiCallArgs,
      renderUiCallId,
      sparkBlock: SparklineBlock,
      sparkIndexAt,
      tabsBlock: TabsBlock,
      columnsBlock: ColumnsBlock,
      columnRatios: COLUMN_RATIOS,
      imageBlock: ImageBlock,
      deriveContent,
      detectLook,
      isRenderUiEvent,
      renderUiEventTypes: RENDER_UI_EVENT_TYPES,
      readPlacement,
      resolveStatus,
      normalizeControls,
      readControlValues,
      normalizeLive,
      selectDockCard,
      selectBoardConversion,
      inlineDefinition: inlineCardDefinition,
      autoDefinition: autoCardDefinition,
      diagramToMermaid,
      chevronGlyph,
      diagramFigure: renderDiagramFigure,
      composeHtmlDocument,
      htmlThemeTokens: HTML_TOKEN_NAMES,
      htmlCaps: { min: HTML_MIN_HEIGHT, max: HTML_MAX_HEIGHT, default: HTML_DEFAULT_HEIGHT },
      diagramBlock: DiagramBlock,
      teamDefinition: teamCardDefinition,
      teamRow: TeamCardRow,
      teamSpec,
      teamKind: TEAM_KIND,
      teamEventData,
      mergeTeamEvent,
      deriveTeamStatus,
      relativeTime,
      teamStatusLabel,
      teamActivityText,
      teamMessageExcerpt,
      teamLastActivityTime,
      teamCardStatus,
      shouldTickTeamCard,
      teamTicker,
      teamTaskCaption,
      teamTrailLines,
      teamTickMs: TEAM_TICK_MS,
      teamTrailLimit: TEAM_TRAIL_LIMIT,
      teamTrailVisible: TEAM_TRAIL_VISIBLE,
      dictionaries: { zh, en },
      nextDefinition: nextStepsDefinition,
      nextRow: NextStepsCardRow,
      nextSpec: nextStepsSpec,
      nextKind: NEXT_KIND,
      nextEvent: NEXT_EVENT,
      nextStepsEventData,
      mergeNextStepsEvent,
      configBundleCard: ConfigBundleCard,
      configPanel: ConfigFormPanel,
      configSettingsTab: ConfigSettingsTab,
      configFields,
      configPlaces: CONFIG_PLACES,
      configDraft,
      configOps,
      configResetOps,
      configInvalid,
      configNumber,
      configBlockList,
      configSummaryText,
      configNamespace,
      bundleConfigSlot: BUNDLE_CONFIG_SLOT,
      bundleKey: BUNDLE_KEY,
      pluginsTabSlot: PLUGINS_TAB_SLOT,
      pluginsTabId: PLUGINS_TAB_ID,
      autoRow: AutoCardRow,
      autoKind: AUTO_KIND,
      extractFences,
      parseMermaid,
      buildAutoSpecs,
      assistantMessageText,
      card: RenderUiCard,
      row: RenderUiRow,
      inline: InlineCardRow,
      dock: DockCard,
      controls: ControlsBlock,
      closed: ClosedCard,
      turnTailBoard: TurnTailBoard,
      turnTailCards: TurnTailCards,
      selectTailCards,
      isTailPlacement,
      tailCardLimit: TAIL_CARD_LIMIT,
      skeleton: SkeletonCard,
      boundary: RenderErrorBoundary,
      actions: ActionsBlock,
      code: CodeBlock,
      key: KEY,
      slot: SLOT,
      ns: NS,
      cardToMarkdown,
      copyCard,
      blockOrder: BLOCK_ORDER,
      blockAliases: BLOCK_ALIASES,
      unsupportedType: UNSUPPORTED_TYPE,
      diagramCaps: DIAGRAM_CAPS,
      diagramGeometry: DIAGRAM_GEOMETRY,
      dockBlocks: DOCK_BLOCK_TYPES,
      dockBlockLimit: DOCK_BLOCK_LIMIT,
      blocks: BLOCK_IMPL,
      placements: PLACEMENTS,
      placement: (name) => placementDef(name),
      service: superCardsService,
      serviceName: SERVICE_NAME,
      caps: {
        blocks: MAX_BLOCKS,
        tableRows: MAX_TABLE_ROWS,
        sparklineValues: MAX_SPARK_VALUES,
        codeChars: MAX_CODE,
        textChars: MAX_TEXT,
        actions: MAX_ACTIONS,
        htmlChars: MAX_HTML,
        pieSlices: MAX_PIE_SLICES,
        treeNodes: MAX_TREE_NODES,
        treeDepth: MAX_TREE_DEPTH,
        heatmapCells: MAX_HEATMAP_CELLS,
        diffLines: MAX_DIFF_LINES,
        kanbanColumns: MAX_KANBAN_COLUMNS,
        kanbanCards: MAX_KANBAN_CARDS,
        tabs: MAX_TABS,
        tabBlocks: MAX_TAB_BLOCKS,
        columns: MAX_COLUMNS,
        columnBlocks: MAX_COLUMN_BLOCKS,
        imageChars: MAX_IMAGE_CHARS,
      },
    }
    return module.exports
  },
})