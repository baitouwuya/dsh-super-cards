# content 自动排版

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

`content` 是 `render_ui` 的自动排版输入：模型只描述要展示的材料，卡片自己选控件、决定顺序。
推导规则在 [lib/content.js](../../lib/content.js)，Host 与 Client 各有一份实现，测试逐字段对比两边
的输出，因此同一份 `content` 在重放时得到同样的卡片。

## 字段表

| 字段 | 形状 | 推导出的控件 |
| --- | --- | --- |
| `summary` | 字符串或 `{text, tone?, title?}` | `callout`，默认 `info` 色调，永远在最前 |
| `metrics` | `[{label, value, delta?, hint?, tone?}]` 或 `{label: value}` | `stats`；`stats` 被禁用时退回 `list` |
| `series` | `{values, labels?, title?, unit?, kind?}` | 趋势用 `sparkline`；短类别对比用 `bars` |
| `breakdown` | `{items, title?, unit?, kind?}` | 不超过 8 片用 `pie`，更多或指定 `bars` 时用 `bars` |
| `table` | `{columns, rows, align?, caption?}` | `table` |
| `steps` | `[{title, text?, time?, tone?}]` 或字符串数组 | `timeline`；被禁用时退回有序 `list` |
| `items` | 字符串数组 | `list` |
| `facts` | `{key: value}` 或 `[{key, value}]` | `keyvalue`；不超过 8 项时两列 |
| `tags` | 字符串数组或 `[{label, tone?}]` | `badges` |
| `code` | 字符串或 `{code, language?, title?}` | `code` |
| `quote` | 字符串或 `{text, by?}` | `quote` |
| `links` | `[{label, href, description?}]` | `links` |
| `image` | 字符串或 `{src, alt?, caption?, height?, fit?}` | `image` |
| `tree` | `{nodes, title?}` 或节点数组 | `tree` |
| `flow` | `{kind?, title?, direction?, nodes?, edges?, participants?, messages?}` | `diagram` |
| `note` | 字符串或 `{text, tone?}` | `callout`，默认 `warn` 色调 |
| `sections` | `[{heading, ...任意 content 字段}]` | 2 到 3 节并排成 `columns`，4 到 5 节变 `tabs`，更多堆叠小标题 |
| `blocks` | `[Block, ...]` | 手写块，追加在自动块之后 |
| `actions` | `[{label, prompt, tone?}]` | `actions`，在自动块的最后 |

`series` 的判定：`values` 至少 6 个、或没有标签时按趋势画 `sparkline`；有标签且不足 6 个时按短序列
画 `bars`，不超过 8 项时自动竖排。`breakdown` 的判定：默认 `pie` 且最多 8 片，`kind: "bars"` 或切片
更多时改画 `bars`。`summary` 与 `note` 的区别只是默认色调与阅读位置，两者都渲染成 `callout`。

## 排版规则

- 字段按书写顺序进入阅读顺序，只有两个例外：`summary` 永远最前，`actions` 永远在自动块最后。
- 普通块一律整行堆叠，不会自动两两并排；只有 `sections` 会形成并排行。
- `sections` 有 2 到 3 节时，若各节估算高度接近（最高不超过最矮的 2.2 倍）才并排成 `columns`，
  否则每节带小标题堆叠；4 到 5 节变 `tabs`；超过 5 节按小标题堆叠。
- 并排时按内容分配宽度：带表格、热力图、看板、图示、代码、图片、HTML 或树的节拿 2 份宽度，
  文字或图表的节拿 1 份。高度差距过大时不并排，避免短列下方留白。
- `sections` 内部按 `stack` 排布，不再嵌套分节；`tabs` 与 `columns` 也不允许互相嵌套。
- `layout` 取 `auto`（默认）或 `stack`。`stack` 让所有块各占一行，`sections` 也按小标题堆叠。
- 窄卡片上，并排的 `columns` 会自动折回单列。

## 示例

```jsonc
{
  "title": "本周发布",
  "subtitle": "10/28 – 11/03 · 3 个服务",
  "icon": "chart",
  "content": {
    "summary": "18 次发布全部完成，其中 2 次回滚已恢复。",
    "metrics": [
      {"label": "发布次数", "value": 18, "delta": "+3", "tone": "success"},
      {"label": "P95 延迟", "value": "212 ms", "delta": "-8%"}
    ],
    "series": {"title": "P95 延迟", "values": [240, 228, 231, 219, 212], "unit": "ms"},
    "breakdown": {"title": "变更来源", "unit": "%", "items": [
      {"label": "自动发布", "value": 62}, {"label": "手动触发", "value": 24}, {"label": "定时任务", "value": 14}
    ]},
    "actions": [{"label": "查看发布日志", "prompt": "查看本周的发布日志", "tone": "primary"}]
  }
}
```

这张卡片会得到：`callout` 摘要、`stats` 指标网格、`sparkline` 趋势、`pie` 占比、最后的 `actions`。
标题下会出现「自动排版」标记，表示块是从 `content` 推导出来的。

## 何时用 content，何时用 blocks

- 用 `content`：知道要展示的数据，但不确定该用指标网格还是表格、该不该并排；这也让卡片在两端
  实现间保持一致。
- 用 `blocks`：需要精确的控件、顺序、动效，或需要手写 `columns` 的 `weights` 控制宽度。
- 混用：`content` 推导的块在前，`blocks` 追加在后。`content` 内的 `actions` 在自动块最后，但手写块
  会继续追加在它之后。

## dropped 报告

`render_ui` 的返回是 `{ok, blocks, types, place}`，有内容被丢弃时再带一个 `dropped` 数组，每项是
`{index, type, reason}`。常见原因：

- `unknown block type`：类型名不在枚举里；
- `block type not enabled by config`：该类型被行配置的 `blocks` 关闭；
- `no usable content`：字段缺失或为空，归一化后不可渲染；
- `over the block cap`：超过单卡上限；
- `not allowed in a dock board`：看板不接受该类型。

自动排版同样受这些上限约束。模型看到 `dropped` 后应修正对应块并重新调用；卡片会正常渲染其余块。

## 相关

- [区块参考](blocks.md)
- [快速开始](getting-started.md)
- [四种落位](placements.md)