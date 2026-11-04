# 配置

> 属于 [超级卡片](../../README.md) · [文档索引](../README.md)

配置写在一行插件配置里，也就是 profile 的 `cordis.patch.yml` 中 `super-cards` 行的 `config`
对象。三种界面改法效果相同，最终都写回同一份行配置。schema 定义在
[lib/config.js](../../lib/config.js)，可编辑字段都标了 `volatile`，因此会投影成设置表单。

## 三种改法

### 插件页

「插件」→ `super-cards` 详情页，提供四项基础配置：自动下一步、看板、默认落位、块数上限。

### 设置页

「设置」→「内置插件」→「超级卡片」标签页，提供完整表单：基础四项，加上下一步的选项数、超时、
最小长度、生成用的 provider 与 model，以及启用的块类型。

### 手写 cordis.patch.yml

```yaml
- insert:
    - id: super-cards
      name: dsh-super-cards
      config:
        maxBlocks: 12
        dock: true
        defaultPlace: answer
        blocks: [text, heading, callout, stats, table, progress]
```

行里所有字段都可省略，省略即使用默认值；出现未声明的键会让校验失败并报出键名，不会静默忽略。

## 字段

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `blocks` | 类型名数组 | 全部启用 | 只启用列出的块类型；空数组或不写表示全部；未知名字忽略 |
| `maxBlocks` | 整数 | 24 | 单卡块数上限，范围 1 到 24 |
| `dock` | 布尔 | `true` | 是否允许 `place: "dock"` 看板 |
| `defaultPlace` | 枚举 | `answer` | 模型省略 `place` 时的落位，取 `answer`、`process`、`dock`、`tail` |
| `nextSteps` | 布尔 | `false` | 回合结束自动生成下一步卡，显式 `true` 才开启 |
| `nextStepsMax` | 整数 | 3 | 自动下一步的选项数上限，范围 1 到 4 |
| `nextStepsTimeoutMs` | 整数 | 15000 | 生成调用的超时，范围 1000 到 60000 毫秒 |
| `nextStepsMinChars` | 整数 | 200 | 回答短于此长度不生成，范围 0 到 2000 |
| `nextStepsProvider` | 字符串 | 空 | 指定生成用 provider，需与 `nextStepsModel` 成对 |
| `nextStepsModel` | 字符串 | 空 | 指定生成用 model，需与 `nextStepsProvider` 成对 |

说明：

- `blocks` 同时影响工具枚举、工具描述里的区块目录、校验错误提示与自动排版回退，不是只改一处。
  想完全禁止联网的 `image` 块，就在这里去掉它。
- `dock` 为 `false` 时，即使模型传 `place: "dock"` 也会落到 `answer`。
- `nextStepsProvider` 与 `nextStepsModel` 只有成对出现才生效；只写一个会被忽略，回退到会话路由。
- 数值超出范围时被夹到边界；校验失败会报错并指出字段；绕过校验的旧行里，非法值在应用时回退默认，
  插件不会因此加载失败。

## 保存即重挂

- 表单保存时把改动写回行配置；配置校验通过后，该行会重挂一次。
- `apply()` 在挂载时读取配置并注册工具、提示词与可选服务，所以重挂后工具描述、块枚举、校验
  提示都会换成新配置，改动立即生效，不需要重启 DSH。
- 已打开的页面不需要刷新就能继续使用新配置；首次安装或升级插件版本后仍建议刷新一次，让 Client
  半重新加载。
- 设置页在缺少 `configForms` 客户端服务时会退化成一行提示，此时用插件页或手写 YAML 修改。

## 随包依赖与同步

`lib/config.js` 依赖 `@deepseek-ai/schemastery`，后者再依赖 `@deepseek-ai/cosmokit`。本地插件
解析不到应用自己的 `node_modules`，所以插件里随包带了一份这两个包的副本，当前版本是
`schemastery 3.19.0` 与 `cosmokit 1.9.0`，取自安装的 Harness。

DSH 升级后，从应用包里重新提取这一对包，保证校验与投影代码和宿主同版本：

```bash
npm run sync:vendor
npm run sync:vendor -- "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
```

同步后运行 `npm test`，再重载插件行。

## 相关

- [自动下一步](next-steps.md)
- [区块参考](blocks.md)
- [排错](troubleshooting.md)