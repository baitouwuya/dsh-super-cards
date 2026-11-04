# 快速开始

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

超级卡片让助手用原生 UI 卡片回答结构化问题：模型调用 `render_ui` 工具，把答案渲染成对话里的
指标、表格、图表或按钮，而不是一大段 Markdown。本页从安装走到第一张卡片。

## 前置条件

- DSH 桌面版 Web 界面，目标版本 0.2.1-rc.5，`desktop` profile。
- 安装包名：`dsh-super-cards`。
- 不需要构建步骤：Host 半是 ESM，Client 半是浏览器模块，安装后由 DSH 在启动时加载。

## 安装

### 命令行

```bash
dsh plugin --profile desktop add dsh-super-cards
```

### 插件页

- 打开「插件」页，点击 Add plugin，按提示选择 `dsh-super-cards` 完成安装。
- 安装后确认列表里的 `super-cards` 行处于启用状态。

### plugin_manager

已有 DSH 会话里可以直接调用 `plugin_manager` 的 `install_bundle`，把 `target` 指向本地包目录：

```js
plugin_manager({ action: 'install_bundle', target: '/path/to/dsh-super-cards' })
```

三种方式效果相同：都会写入 profile 的 `cordis.patch.yml`，插入一条 `super-cards` 行。

## 重载插件与刷新页面

- 首次安装后重启 DSH，或至少重载该插件行，让 Host 半注册工具与提示词。
- Client 半是浏览器模块：首次安装或升级插件后，刷新一次页面让它重新加载。
- 修改配置并保存后，该行会重挂一次，工具与提示词随之重新注册，不需要重启 DSH。
- 刷新不会丢历史卡片：卡片由会话日志里记录的工具调用参数重建，重放和恢复会话同样适用。

## 第一张卡片

向助手提一个结构化问题，例如「这次发布的结果如何？」。模型会调用 `render_ui`，参数形如：

```jsonc
{
  "title": "部署摘要",
  "subtitle": "production · 刚刚",
  "blocks": [
    {"type": "callout", "tone": "success", "text": "3 个服务全部健康。"}
  ]
}
```

卡片渲染在模型调用它的位置：调用前可以写一段引导文字，调用后可以继续写正文；同一张回答里
可以多次调用，插入多张卡片。

## 两种输入模式

| 模式 | 写法 | 适合 |
| --- | --- | --- |
| `content` 自动排版 | 只写材料字段，卡片自己选控件并排版 | 知道数据，不确定该用哪个控件 |
| `blocks` 手动定制 | 逐个写 `type` 与字段，排布完全可控 | 需要特定控件、顺序或动效 |

两种模式可以混用：`content` 推导出的块在前，手写的 `blocks` 追加在后。`content` 的字段有
`summary`、`metrics`、`series`、`breakdown`、`table`、`steps`、`items`、`facts`、`tags`、`code`、
`quote`、`links`、`image`、`tree`、`flow`、`note`、`sections`、`blocks`、`actions`。

## 四种落位

| place | 位置 | 典型场景 |
| --- | --- | --- |
| `answer` | 回答正文内联，默认 | 结论、对比、规格等最终答案 |
| `process` | 执行过程里，随「过程」折叠 | 中间进度、临时统计 |
| `dock` | 输入框上方看板，回合结束关闭 | 运行期进度与状态一览 |
| `tail` | 回合最后，正文之后、底部操作行之前 | 下一步建议、收尾卡 |

## 确认插件在工作

1. 「设置」→「内置插件」出现「超级卡片」标签页；「插件」页的 `super-cards` 详情页有四项基础配置。
2. 模型工具列表里出现 `render_ui` 与 `render_ui_blocks`；`render_ui` 的返回包含 `ok` 与块数。
3. 提一个结构化问题，回答中出现带标题的卡片，而不是一大段 Markdown 表格。
4. 需要排查注册时：Cordis Inspector 的 `tool.call.toolview` 槽位应出现 `render_ui` 的占用者，
   Loader 里应有一条 `super-cards` 行。

## 相关

- [区块参考](blocks.md)
- [content 自动排版](content.md)
- [四种落位](placements.md)