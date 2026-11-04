# Getting started

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

Super Cards lets the assistant answer structured questions with native UI cards: the model calls the `render_ui` tool and the answer renders as metrics, tables, charts, or buttons in the conversation instead of a wall of Markdown. This page goes from installation to the first card.

## Prerequisites

- DSH desktop Web UI, target version 0.2.1-rc.5, `desktop` profile.
- Package name: `dsh-super-cards`.
- No build step: the Host half is ESM, the Client half is a browser module, and DSH loads them at startup after installation.

## Install

### Command line

```bash
dsh plugin --profile desktop add dsh-super-cards
```

### Plugins page

- Open the Plugins page, click Add plugin, and pick `dsh-super-cards` when prompted to finish the installation.
- After installation, confirm the `super-cards` row is enabled in the list.

### plugin_manager

In an existing DSH session you can call `plugin_manager`'s `install_bundle` directly and point `target` at the local package directory:

```js
plugin_manager({ action: 'install_bundle', target: '/path/to/dsh-super-cards' })
```

All three paths are equivalent: each writes to the profile's `cordis.patch.yml` and inserts a `super-cards` row.

## Reload the plugin and refresh the page

- Restart DSH after the first install, or at least reload the plugin row, so the Host half registers the tool and prompt.
- The Client half is a browser module: after installing or upgrading the plugin, refresh the page once so it loads again.
- After changing and saving configuration the row remounts once, and the tool and prompt are registered again; restarting DSH is not required.
- A refresh does not lose historical cards: cards are rebuilt from the tool-call arguments recorded in the session log, and the same holds for replay and resume.

## Your first card

Ask the assistant a structured question, for example "How did this release go?". The model calls `render_ui` with arguments like:

```jsonc
{
  "title": "Deploy summary",
  "subtitle": "production · just now",
  "blocks": [
    {"type": "callout", "tone": "success", "text": "All 3 services are healthy."}
  ]
}
```

The card renders where the model called it: you can write a lead-in paragraph before the call and continue the prose after it; one answer can call it several times and insert several cards.

## Two input modes

| Mode | How to write it | Good for |
| --- | --- | --- |
| `content` auto layout | Write only the material fields; the card picks its controls and layout | You know the data but are unsure which control to use |
| `blocks` manual | Write each `type` and its fields; layout is fully under control | You need a specific control, order, or motion |

The two modes mix: blocks derived from `content` come first, hand-written `blocks` are appended after. `content` fields are `summary`, `metrics`, `series`, `breakdown`, `table`, `steps`, `items`, `facts`, `tags`, `code`, `quote`, `links`, `image`, `tree`, `flow`, `note`, `sections`, `blocks`, `actions`.

## Four placements

| place | Position | Typical use |
| --- | --- | --- |
| `answer` | Inline in the answer prose, default | Final answers such as conclusions, comparisons, specs |
| `process` | Inside the execution process, collapses with "Process" | Intermediate progress, temporary stats |
| `dock` | Board above the composer, closes when the turn ends | Runtime progress and status at a glance |
| `tail` | At the end of the turn, after the prose and before the bottom action row | Next-step suggestions, closing cards |

## Confirm the plugin is working

1. Settings → Built-in plugins shows a Super Cards tab; the `super-cards` detail page on the Plugins page has four basic settings.
2. The model's tool list shows `render_ui` and `render_ui_blocks`; `render_ui`'s return includes `ok` and the block count.
3. Ask a structured question; the answer shows a card with a title instead of a long Markdown table.
4. To debug registration: Cordis Inspector's `tool.call.toolview` slot should show an occupant for `render_ui`, and the Loader should have a `super-cards` row.

## Related

- [Block reference](blocks.md)
- [content auto layout](content.md)
- [Four placements](placements.md)