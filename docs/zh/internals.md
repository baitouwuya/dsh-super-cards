# 内部实现

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

一句话概括：**Host 负责描述与归一化，Client 负责渲染与扩展，每一半各有一张唯一的区块注册表，
两半之间跑一致性测试。** 设计细节见 [ARCHITECTURE.md](../../ARCHITECTURE.md)。

## 两半

| 半 | 文件 | 职责 |
| --- | --- | --- |
| Host | [index.js](../../index.js) 与 lib 目录 | 注册 `render_ui`、`render_ui_blocks`、提示词段、只读服务，以及可选自动下一步 |
| Client | [client.js](../../client.js) | 匹配调用事件、重建卡片、注册区块渲染器与落位、提供可扩展服务 |

Host 的模块分工：

- [lib/shared.js](../../lib/shared.js)：词表（tone、icon、status、look）、上限 `CAPS`、取值辅助。
- [lib/blocks.js](../../lib/blocks.js)：29 种区块的注册表、归一化、目录与契约文本、别名表。
- [lib/content.js](../../lib/content.js)：`content` 自动排版引擎。
- [lib/spec.js](../../lib/spec.js)：`readPlace`、`normalizeSpec`、`executeRenderUi`。
- [lib/tools.js](../../lib/tools.js)：工具描述、提示词、两个工具定义与配置解析。
- [lib/config.js](../../lib/config.js)：Schemastery 配置 schema 与校验。
- [lib/service.js](../../lib/service.js)：只读 `superCards` 服务。
- [lib/next-steps.js](../../lib/next-steps.js)：回合结束的自动下一步生成器。

## 调用链

```text
模型调用 render_ui
      │  参数是 UI spec
      ▼
Host 校验 + 归一化（上限、别名、看板白名单）
      │  返回 {ok, blocks, types, place}
      ▼
会话日志记录 tool/call 及其参数
      │
      ▼
Client 行定义匹配事件，从记录参数重建卡片
```

卡片渲染所需的 spec 全部来自会话日志里记录的工具调用参数，插件不保存额外状态。

## 会话日志即真相

- Client 在 `start` 阶段读 `block.argsRaw`，在 `result` 阶段读 `block.call.argsRaw`，两者都是那次调用
  的原始参数。
- 因此回放、恢复会话、fork 之后卡片仍然存在，并渲染成同样的形状。
- 工具错误会渲染成一张小型错误卡片；渲染组件外还有错误边界兜底，绝不把对话行弄空。
- `run_code` 脚本里调用 `tools.render_ui` 时，日志里没有顶层 `tool/call`，只有 PTC 派发事件
  （`tool/ptc-dispatch-start`、`tool/ptc-dispatch`）。行定义同时匹配这三种事件，同一次调用只生成
  一行，结算事件只刷新参数、不新增卡片。
- 卡片本身不追加新的会话事件；唯一的插件事件是显式开启自动下一步后的
  `super-cards/next-steps`。

## 渐进披露

| 层级 | 载体 | 内容 |
| --- | --- | --- |
| 常驻 | `render_ui` 描述 | 用途、何时用何时不用、规则、区块目录（名字加一句话用途）、一个范例 |
| 按需 | `render_ui_blocks` | 单个或全部区块的精确字段、说明与示例；`type` 传 `motion` 或 `content` 取对应词汇 |
| 纠错 | `render_ui` 结果的 `dropped` | 每个被丢弃区块的序号、类型与原因 |

新增一种区块只需要扩充注册表与按需契约，不会让常驻描述变长。

## 两端一致性

- Host 与 Client 各有一份区块注册表，顺序、看板白名单、别名表与上限必须相等；
  `test/client.test.mjs` 的一致性用例会逐项比较，改一侧漏另一侧会直接测试失败。
- `content` 自动排版在两个实现里是同一套规则：同一份 `content` 推导出的块逐字段一致。
- 增加一种区块需要两处都加：Host 注册归一化与契约，Client 注册渲染器。只加一侧时，Host 会把该
  类型报进 `dropped`，Client 会为没有渲染器的类型显示占位提示。

## 性能实测

数据来自 [README.md](../../README.md) 的实测记录。

| 指标 | 典型 6 块卡片 | 满配 24 块卡片 |
| --- | --- | --- |
| 参数 JSON | 约 660 字节 | 约 10 KB |
| 归一化加排版 | 0.004 毫秒 | 0.03 毫秒 |
| 建元素树 | 0.017 毫秒 | 0.15 毫秒 |
| DOM 节点 | 约 70 | 约 650 |

- 100 张典型卡片整帧重渲染的 JS 成本约 1.3 毫秒；30 张满配卡片约 3.4 毫秒。
- 浏览器侧：120 张卡片约 1.6 万节点，首屏约 150 到 200 毫秒；300 张约 4 万节点，首屏约 190 到
  230 毫秒，滚动保持 60 fps。
- 三个会话选择器共用每快照一份索引（`WeakMap`）：400 回合、2400 节点时，每个会话事件从约 21 毫秒
  降到 0.06 到 0.25 毫秒，且曲线是线性的。
- 卡片正文按录制参数的字符串缓存归一化结果，父组件重渲染不再重复解析同一张卡。
- `html` 帧懒加载，`live` 无轮询；唯一的定时器是运行中的子代理进度卡，每秒刷新一次相对时间，结束即停。
- 自动下一步默认关闭；关闭时调度在扫描日志之前返回，长会话每回合零成本。
- 刻意没有给卡片加 `content-visibility: auto`：首屏会快约 40%，但滚动高度从 12.4 万像素压到
  4.4 万像素，长会话的滚动与「跳到某一轮」会跳动。

## superCards 服务

Host 与 Client 都提供同名 Cordis 服务 `superCards`，用途不同。

Host 面是只读的，通过 `ctx.get('superCards')` 取得：

```js
const ui = ctx.get('superCards')
ui.blocks.list()          // 全部区块类型
ui.blocks.dock()          // 看板白名单
ui.blocks.has('table')    // 是否认识某个类型
ui.blocks.get('table')    // {type, purpose, dock}
ui.blocks.contract('table') // 精确契约文本
ui.placements.list()      // 四种落位
ui.motion.list()          // 动效预设
```

Client 面是可变的，通过 `ctx.get('superCards')` 取得，供其它 Client 插件扩展渲染器：

```js
const ui = ctx.get('superCards')
const dispose = ui.blocks.register({
  type: 'meter',
  dock: true,
  normalize(raw) { /* → block 或 null */ },
  render(block, key, ctx) { /* → React 元素 */ },
})
ui.blocks.replace('table', { render: myTableRenderer })
ui.placements.register('sidebar', { groupTree: 'turn' })
```

`register` 与 `replace` 返回 disposer，执行后恢复原实现；卡片订阅注册表变化并原地重渲染。服务本身
在 `ctx.effect` 里提供，随插件卸载而消失。

## 相关

- [配置](configuration.md)
- [进阶能力](advanced.md)
- [排错](troubleshooting.md)