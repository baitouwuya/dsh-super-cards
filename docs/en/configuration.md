# Configuration

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

Configuration lives in the plugin config of one row, that is, the `config` object of the `super-cards` row in the profile's `cordis.patch.yml`. The three UI paths are equivalent and all write back to the same row config. The schema is defined in [lib/config.js](../../lib/config.js); every editable field is marked `volatile`, so it projects into a settings form.

## Three ways to edit

### Plugins page

Plugins → `super-cards` detail page offers four basic settings: automatic next steps, board, default placement, and block cap.

### Settings page

Settings → Built-in plugins → Super Cards tab offers the full form: the four basics, plus next-step option count, timeout, minimum length, the provider and model used for generation, and the enabled block types.

### Hand-written cordis.patch.yml

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

Every field in the row is optional and omitting one uses its default; an undeclared key makes validation fail and reports the key name instead of silently ignoring it.

## Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `blocks` | array of type names | all enabled | Enable only the listed block types; an empty array or omission means all; unknown names are ignored |
| `maxBlocks` | integer | 24 | Per-card block cap, range 1 to 24 |
| `dock` | boolean | `true` | Whether `place: "dock"` boards are allowed |
| `defaultPlace` | enum | `answer` | Placement when the model omits `place`; takes `answer`, `process`, `dock`, `tail` |
| `nextSteps` | boolean | `false` | Automatically generate a next-steps card at turn end; only an explicit `true` enables it |
| `nextStepsMax` | integer | 3 | Cap on automatic next-step options, range 1 to 4 |
| `nextStepsTimeoutMs` | integer | 15000 | Timeout of the generation call, range 1000 to 60000 milliseconds |
| `nextStepsMinChars` | integer | 200 | Answers shorter than this are not processed; range 0 to 2000 |
| `nextStepsProvider` | string | empty | Provider used for generation; must be paired with `nextStepsModel` |
| `nextStepsModel` | string | empty | Model used for generation; must be paired with `nextStepsProvider` |

Notes:

- `blocks` affects the tool enum, the block directory in the tool description, validation error text, and auto-layout fallback at the same time; it is not a single-place change. To forbid the networked `image` block entirely, remove it here.
- With `dock` set to `false`, a `place: "dock"` from the model lands in `answer` instead.
- `nextStepsProvider` and `nextStepsModel` only take effect when both are present; writing only one is ignored and falls back to the session route.
- Out-of-range numbers are clamped to the boundary; validation failure reports an error and names the field; in old rows that bypass validation, invalid values fall back to defaults on apply and the plugin still loads.

## Saved means remounted

- Saving the form writes the change back to the row config; after validation passes, the row remounts once.
- `apply()` reads the config on mount and registers the tools, prompt, and optional services, so after a remount the tool description, block enum, and validation text use the new config; changes take effect immediately without restarting DSH.
- Open pages keep working with the new config without a refresh; after the first install or a plugin version upgrade, refreshing once is still recommended so the Client half reloads.
- Without the `configForms` client service the settings page degrades to a single notice line; in that case edit through the Plugins page or hand-written YAML.

## Vendored dependencies and sync

`lib/config.js` depends on `@deepseek-ai/schemastery`, which in turn depends on `@deepseek-ai/cosmokit`. A local plugin cannot resolve the application's own `node_modules`, so the plugin vendors a copy of both packages, currently `schemastery 3.19.0` and `cosmokit 1.9.0`, taken from the installed Harness.

After a DSH upgrade, re-extract this pair from the application bundle so validation and projection code match the host version:

```bash
npm run sync:vendor
npm run sync:vendor -- "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
```

After syncing, run `npm test` and reload the plugin row.

## Related

- [Automatic next steps](next-steps.md)
- [Block reference](blocks.md)
- [Troubleshooting](troubleshooting.md)