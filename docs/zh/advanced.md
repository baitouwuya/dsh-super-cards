# 进阶能力

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

本页覆盖需要模型显式选择的高级能力：沙箱 HTML、动效预设、内嵌图片、交互控件、视觉密度，以及
卡片右上角的复制与关闭。实现分别在 [lib/blocks.js](../../lib/blocks.js) 与
[client.js](../../client.js)。

## html 卡片

当视觉本身就是答案（自定义动画、小 demo、手绘 SVG）而不是普通内容时，用 `html` 块交一段
自包含的 HTML、CSS、SVG，甚至内联 JS：

```jsonc
{"type":"html","title":"呼吸","height":180,
 "html":"<style>@keyframes b{50%{transform:scale(1.2)}}</style><div class='orb'></div>"}
```

它不内联进卡片 DOM，而是渲染在沙箱 iframe 里：

| 边界 | 做法 |
| --- | --- |
| 同源 | `sandbox="allow-scripts"`，没有 `allow-same-origin`，iframe 是 opaque origin |
| 宿主访问 | 读不到父页面 DOM、cookie、storage，也不能弹窗或跳转顶层 |
| 网络 | CSP 设 `default-src 'none'`、`connect-src 'none'`、`form-action 'none'`，外部脚本、字体、请求全部被拦 |
| 允许的资源 | 内联 style 与 script、`data:` 与 `blob:` 图片、`data:` 字体与媒体 |
| JS | 可以运行 CSS 动画、Web Animations、canvas 与内联脚本，但没有网络和同源权限 |
| 主题 | 渲染时从宿主读取一次 `--dsw-alias-*` 写入 iframe 的 `:root`，内部可直接用同名 CSS 变量 |
| 尺寸 | `height` 取值 120 到 800，默认 240，内容超出在 iframe 内滚动 |
| 体积 | 源码上限 20000 字符，超出由 Host 截断 |
| 检查 | 卡片右上角可在预览与源码之间切换，源码就是实际运行的内容 |
| 动效 | iframe 文档自带 `prefers-reduced-motion` 规则，关闭 CSS 动画与过渡 |

`html` 是唯一的任意内容入口，因此它不进看板、不参与 `motion` 预设、也不会被折叠。

## 动效预设

模型不给任何区块写 CSS，只在区块上加一个可选的 `motion` 对象，从 8 个固定预设里挑一个：

| 预设 | 动起来的部分 | 典型用法 |
| --- | --- | --- |
| `pulse` | 区块内条目轻微呼吸 | 强调正在变化的指标 |
| `flash` | 整块外圈闪一下 | 刚更新的结论 |
| `reveal` | 整块从左向右擦出 | 逐步披露说明 |
| `sweep` | 进度条、柱状图从 0 长到当前值 | 展示进度 |
| `draw` | 图表与流程图线条描边绘制 | 时序图、趋势线画出来 |
| `flow` | 流程图边上的虚线流动 | 表达方向与流转 |
| `bounce` | 整块轻微上弹一次 | 强调一个结果 |
| `shake` | 整块左右抖两下 | 警示 |

```jsonc
{"type":"progress","items":[{"label":"构建","value":0.6}],
 "motion":{"effect":"sweep","duration":1200,"delay":0,"loop":false}}
```

- `duration` 取值 200 到 6000 毫秒，默认 1000；`delay` 取值 0 到 4000 毫秒，默认 0；`loop` 默认 `false`。
- `sweep` 需要 `progress` 或 `bars`，`draw` 与 `flow` 需要 `diagram` 或 `sparkline`；预设与区块不匹配
  时什么也不动，内容照常显示。
- 未知预设按静态渲染，不丢内容、不报错。
- 系统开启「减少动态效果」时，所有 `animation` 与 `transition` 被置空，只保留瞬时状态切换。

## 内嵌图片

`image` 块只接受两种来源：

- `https` 或 `http` 地址：浏览器直接加载，卡片不发送 Referer，`<img>` 懒加载，点击可打开原图。
- `data:image/*` 内联 URI：完全离线，刷新与重放都稳定，适合小图或 SVG。

```jsonc
{"type":"image","src":"https://example.com/chart.png","alt":"P95 延迟","caption":"最近 8 天","height":260,"fit":"contain"}
```

- `src` 的其他 scheme 一律丢弃，包括 `javascript:`、`file:`、`blob:`。
- `data:` URI 上限 200000 字符；`height` 默认 240，夹在 80 到 640；`fit` 取 `cover` 或 `contain`。
- 加载失败显示占位提示，不会把卡片撑坏。
- 这是插件里唯一可能发起网络请求的区块；不想要任何外部请求就在行配置的 `blocks` 里去掉 `image`。

## 交互控件与 live

`controls` 提供设置与按钮两种控件：

- `kind: "setting"` 的分段控件绑定 `theme`（light、dark、system）或 `locale`，点击后立即写入 DSH 设置，
  选中态跟随当前值。
- `kind: "button"` 的 `action.kind: "setting"` 直接应用某个设置值；`action.kind: "prompt"` 把 prompt
  放进输入框，`send: true` 才直接发送给助手。
- 最多 8 个条目，每个设置组最多 6 个选项；不支持的环境显示「当前环境不支持该操作」。
- 需要工具与审批的操作（改文件、跑命令）交给助手完成，卡片本身不越权。

`live` 只在看板（`place: "dock"`）里生效，随会话自动刷新：`field` 取 `messages`、`tools` 或
`last-message`，`limit` 取值 1 到 10，默认 3。

## look 密度

`look` 控制整张卡片的视觉密度，结构不变，只改字号、间距与边框：

| 取值 | 效果 |
| --- | --- |
| `default` | 标准密度 |
| `compact` | 更紧凑，适合长报告 |
| `flat` | 去掉面板边框，只留分隔线 |
| `relaxed` | 更大字号与留白 |

不写 `look` 时按卡片形状自动选：6 块以上、24 条数据以上或 10 行以上表格用 `compact`；纯数据块
（指标、表格、图表，没有正文）用 `flat`；不超过 2 块且含正文用 `relaxed`；其余 `default`。

## 复制 Markdown 与关闭

卡片操作收在右上角，两个小按钮并排，不参与标题排版。

- 复制：把整张卡片序列化成 Markdown 放进剪贴板。标题变二级标题，提示框变引用，指标与表格变表格，
  图表变 mermaid 栅栏，列表、树、tabs、columns 逐层展开；`actions`、`controls`、`live` 这类纯交互
  脚手架不导出。纯展示卡片也有复制按钮，成功后按钮变绿勾。
- 关闭：只在「可关闭」的卡片上出现，即卡片有生命周期状态（running、success、warn、error），或含
  `controls`、`actions`、`live`。纯静态展示卡没有关闭按钮。关闭后收成一条虚线窄条「已收起」，点
  窄条重新打开；展开状态只在当前页面内有效，刷新后恢复展开。
- 看板始终有关闭按钮，关闭后变成一行「看板已关闭」，点击重新打开。

## 相关

- [区块参考](blocks.md)
- [四种落位](placements.md)
- [内部实现](internals.md)