# 区块参考

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

`render_ui` 支持 29 种区块。模型可以写 `blocks` 逐个指定，也可以用 `content` 让卡片自动选块。
本页按场景给出速查表和每种区块的最小 JSON；精确字段由 `render_ui_blocks` 按需返回，注册表本身在
[lib/blocks.js](../../lib/blocks.js)。

## 按场景选块

| 场景 | 推荐区块 |
| --- | --- |
| 两个方案、两列信息对比 | `table`、`columns`、`tabs` |
| 关键指标 | `stats` |
| 占比构成 | `pie` |
| 趋势变化 | `sparkline` |
| 排行或短类别对比 | `bars` |
| 步骤与历史 | `timeline` |
| 层级、目录、决策路径 | `tree` |
| 状态流转看板 | `kanban` |
| 代码与改动 | `code`、`diff` |
| 流程图与 UML | `diagram` |
| 图片 | `image` |
| 自定义动画或小 demo | `html` |
| 实时计数与消息流 | `live`，只在看板里生效 |
| 下一步按钮 | `actions` |

## 文本与标签

- `text` 段落：`{"type":"text","text":"全部 **健康**。"}`。`text` 必填，支持 `**粗体**` 与行内代码，换行即换行。
- `heading` 小标题：`{"type":"heading","text":"服务","level":2}`。`level` 取 1、2、3。
- `callout` 提示框：`{"type":"callout","tone":"info","text":"14:00 开始灰度。"}`。`tone`、`title` 可选。
- `quote` 引用：`{"type":"quote","text":"Ship small.","by":"发布说明"}`。`by` 可选。
- `badges` 标签：`{"type":"badges","items":[{"label":"stable","tone":"success"}]}`。每个标签有 `label` 与可选 `tone`。
- `divider` 分隔线：`{"type":"divider"}`，没有字段。

## 指标与数字

- `stats` 指标网格：`{"type":"stats","items":[{"label":"Pod","value":"12/12","tone":"success"}]}`。`value` 可以是数字或短字符串，`delta`、`hint`、`tone` 可选。
  列数按条数算，避免最后一行只剩一张卡（6 条读作 3+3）；窄卡片上自动折成两列或一列，奇数条时最后一张占满整行。
- `keyvalue` 规格清单：`{"type":"keyvalue","items":[{"key":"区域","value":"eu-west-1"}]}`。形状由内容自己决定：不超过 6 条短事实排成瓦片（2 列、3 列、3+2 或 2×2），只要有一条值超过 28 字、键超过 16 字，或者条数超过 6，就变成「键在左、值在右」的行式清单——句子不会被塞进半宽瓦片里，奇数条也不会留一个空洞。`columns` 取 1（每行一条）或 2（强制瓦片）。
- `progress` 进度条：`{"type":"progress","items":[{"label":"迁移","value":0.72}]}`。`value` 在 0 到 1 之间，1 渲染成勾。
- `bars` 条形图：`{"type":"bars","items":[{"label":"api","value":42},{"label":"web","value":18}]}`。`direction: "vertical"` 变成柱状图，适合少量类别。
- `sparkline` 趋势线：`{"type":"sparkline","values":[212,199,187,190],"unit":"ms"}`。`labels` 数量需与 `values` 一致。
- `pie` 饼图：`{"type":"pie","items":[{"label":"api","value":62},{"label":"web","value":38}]}`。默认环形，`donut: false` 变实心。
- `heatmap` 热力图：`{"type":"heatmap","columns":14,"items":[{"label":"周一","value":3}]}`。`max` 可固定强度尺度。底部一行左边是覆盖范围与总量（取首末标签，如 `10/21 – 11/03 · 37次`），右边是颜色图例；每个格子的完整标签在 `title` 里。

## 表格与看板

- `table` 数据表：`{"type":"table","columns":["服务","状态"],"rows":[["api","healthy"]]}`。`align` 逐列对齐，`caption` 是表下一行。
- `diff` 代码差异：`{"type":"diff","lines":[{"kind":"del","text":"retries: 3,"},{"kind":"add","text":"retries: 5,"}]}`。`kind` 取 `add`、`del`、`ctx`。
- `kanban` 看板：`{"type":"kanban","columns":[{"title":"待办","cards":[{"title":"限流"}]}]}`。卡片可带 `text`、`badges`、`tone`。泳道在宽卡片上横向排列（多了可横向滚动），容器宽度 ≤600px 时改成纵向堆叠，一条泳道一行。

## 结构与关系

- `list` 列表：`{"type":"list","ordered":true,"items":["构建","测试"]}`。`ordered` 控制有序与无序。
  宽卡片上，6 条以上且每条不超过 220 字的列表会自动分栏（最少 21rem 一栏，窄列里自动回到单栏），不再把右侧留空。
- `tree` 层级树：`{"type":"tree","nodes":[{"label":"src","children":[{"label":"client.js"}]}]}`。节点可带 `note`、`badge`、`tone`。
- `diagram` 图表：`{"type":"diagram","kind":"flowchart","nodes":[{"id":"a","label":"请求"},{"id":"b","label":"部署"}],"edges":[{"from":"a","to":"b"}]}`。`kind` 取 `flowchart`、`state`、`sequence`、`class`、`er`；一张卡只放一个图。
- `timeline` 时间线：`{"type":"timeline","items":[{"title":"构建","time":"14:02"}]}`。`text`、`time`、`tone` 可选。
- `links` 链接：`{"type":"links","items":[{"label":"Runbook","href":"https://example.com/runbook"}]}`。只渲染 `http`、`https`、`mailto`。

## 容器与布局

- `columns` 并排分栏：`{"type":"columns","items":[{"blocks":[{"type":"text","text":"左"}]},{"blocks":[{"type":"text","text":"右"}]}]}`。最多 3 栏，`weights` 给每栏 1 到 3 份宽度。
- `tabs` 标签页：`{"type":"tabs","items":[{"label":"概览","blocks":[{"type":"text","text":"..."}]}]}`。最多 5 页；页签内不能再嵌 `tabs` 或 `columns`。

## 交互与动态

- `actions` 按钮：`{"type":"actions","items":[{"label":"查看日志","prompt":"查看日志","tone":"primary"}]}`。点击只把 `prompt` 填入输入框，不自动发送。
- `controls` 控件：`{"type":"controls","items":[{"kind":"button","label":"深色","action":{"kind":"setting","setting":"theme","value":"dark"}}]}`。`kind:"setting"` 分段控件直接写 DSH 设置；按钮可应用设置或提交 prompt。
- `live` 实时内容：`{"type":"live","field":"messages","limit":5}`。`field` 取 `messages`、`tools`、`last-message`；只在看板（`place: "dock"`）里生效。

## 富媒体

- `code` 代码块：`{"type":"code","language":"bash","code":"dsh deploy --prod"}`。`language`、`title` 可选，代码内不解析行内标记。宿主把 `@deepseek-ai/dsh-client-ui-primitives` 放进模块表时，代码用宿主自己的 shiki 上色（与正文代码块同一套 `--shiki-*` 色板，语言按需懒加载），探测不到就退回纯文本。
- `image` 图片：`{"type":"image","src":"https://example.com/chart.png","alt":"延迟趋势"}`。`src` 只接受 `https`、`http` 或 `data:image/*`；`height` 为 80 到 640，`fit` 取 `cover` 或 `contain`。
- `html` 自定义视觉：`{"type":"html","height":160,"html":"<div class='orb'></div>"}`。渲染在沙箱 iframe 里，无网络、无同源权限；源码上限 20000 字符，`height` 为 120 到 800。

任意区块都可以额外带一个 `motion` 对象，细节见 [进阶能力](advanced.md)。

## 上限

上限来自 [lib/shared.js](../../lib/shared.js) 的 `CAPS`，超出部分被截断或丢弃，丢弃项在结果的
`dropped` 里报告。

| 项目 | 上限 |
| --- | --- |
| 单卡区块数 | 24 |
| 表格行数 | 50 |
| 文本字段 | 4000 字符 |
| 代码块 | 8000 字符 |
| 趋势图数值 | 120 个 |
| actions 按钮 | 8 个 |
| 饼图扇区 | 8 片 |
| 层级树 | 200 节点、4 层 |
| 热力图 | 371 格 |
| diff 行 | 400 行 |
| 看板 | 4 列、每列 8 卡 |
| tabs | 5 个页签、每页 6 块 |
| columns | 3 栏、每栏 6 块 |
| 看板区块 | 4 块 |
| 图表 | 24 节点、48 边、8 参与者、24 消息 |
| 内嵌图片 data URI | 200000 字符 |
| 图片高度 | 80 到 640 |
| html 源码 | 20000 字符 |
| html 高度 | 120 到 800 |
| live 条数 | 1 到 10 |
| controls 条目 | 8 项、每组 6 个选项 |

## 内容字段名与别名折叠

`content` 的字段名（`note`、`summary`、`metrics`、`series`、`breakdown`、`steps`、`items`、`tags`、
`facts`、`flow`、`notice`、`bullets`）不是区块类型，不在工具枚举里。如果把它们误写成某个区块的
`type`，两端归一化时会折叠到渲染同样内容的区块上：

- `note` 变成 `callout` 并补 `warn` 色调；
- `summary`、`notice` 变成 `callout` 并补 `info` 色调；
- `metrics` 变成 `stats`，`series` 变成 `sparkline`，`breakdown` 变成 `pie`；
- `steps` 变成 `timeline`，`items`、`bullets` 变成 `list`；
- `facts` 变成 `keyvalue`，`tags` 变成 `badges`，`flow` 变成 `diagram`。

折叠只改名字、不改数据形状：数据本身不符合目标区块要求时，仍会按「无可用内容」被丢弃。

## 相关

- [content 自动排版](content.md)
- [进阶能力](advanced.md)
- [排错](troubleshooting.md)