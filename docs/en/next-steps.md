# Automatic next steps

> Part of [Super Cards](../../README.md) · [Documentation](../README.md)

The "next steps" card at the end of a turn has two sources: the model writes it itself with `place: "tail"`, or the Host generates it automatically after the turn ends. The former is the default path with zero extra calls; the latter is optional and off by default. Generation logic lives in [lib/next-steps.js](../../lib/next-steps.js).

## How to enable

Turn on "automatic next steps" on the Settings page or the Plugins page, or write the row config by hand:

```yaml
config:
  nextSteps: true
  nextStepsMax: 3
  nextStepsTimeoutMs: 15000
  nextStepsMinChars: 200
  # nextStepsProvider: some-provider
  # nextStepsModel: some-model
```

Only an explicit `nextSteps: true` enables it; omission or a non-boolean value counts as off.

## Generation flow

1. The Host listens on `session/event` and takes the turn number after `turn/end`.
2. It collects the text blocks of every `assistant/message` in that turn from the session log, taking only the prose the user read.
3. It resolves the route: an explicitly configured provider and model pair takes priority; otherwise it uses the provider and model in the session request header.
4. It sends one very small model request and asks for a single JSON object; the input answer is at most 6000 characters, truncated beyond that.
5. It parses the JSON defensively: tolerating code fences and surrounding prose, also accepting a bare options array, deduplicating and truncating fields.
6. It appends one `plugin:super-cards/next-steps` plugin record: `{turn, summary?, text, options, at}`. The record is written through the Host's `appendPluginRecord`, which marks it `ignorable`; a Host that does not know the type then keeps the log loadable and skips it. A Host without that writer writes nothing and spends no model call.
7. The Client renders it in the `tail` position: optional recap, one question, a row of buttons, with the first option as the primary button.

## Generation contract

| Field | Constraint |
| --- | --- |
| `summary` | Optional, 1 to 2 sentences, at most 240 characters; omitted entirely when empty or unusable |
| `text` | One question, at most 160 characters |
| `options` | 2 to `nextStepsMax`; `label` at most 40 characters, `prompt` at most 400 characters |
| Language | Same language as the answer prose |
| Usability | `prompt` must stand alone as the user's next message; duplicate options are dropped |

The equivalent JSON shape:

```jsonc
{
  "summary": "一句话概括这一回合做了什么。",
  "text": "接下来想做什么？",
  "options": [
    {"label": "跑测试", "prompt": "跑一遍这个仓库的测试套件。"},
    {"label": "看 diff", "prompt": "把这次改动总结成 diff。"}
  ]
}
```

When the model output is unusable (no parsable JSON, no usable option at all), no event is appended and no empty card is generated.

## Skip conditions

Any one of these conditions skips generation, avoiding pointless calls and duplicate cards:

- `nextSteps` is not explicitly enabled.
- The answer text is shorter than `nextStepsMinChars`, so even small talk does not pop a card.
- The turn already has a model-written `tail` card.
- The turn already generated a next-steps event; this check reads the session log, so replay or repeated registration never appends a second one.
- No model route can be resolved (neither an explicit config nor a session request header).
- The current environment has no usable `llm` service.
- The current session is a subagent session: `header.origin === 'subagent'`, a `parentSession` exists, or `delegationDepth > 0`. A subagent ends a turn on every step, so generating there is useless and wastes calls.

## Timeout, concurrency and cancellation

- Every generation carries a `nextStepsTimeoutMs` timeout (default 15000 milliseconds) and aborts the request when it fires.
- Only one generation runs per session at a time; a new one does not stack on top.
- When the user sends the next turn (`turn/start`) during generation, this generation is cancelled.
- Unloading the plugin aborts every in-flight request.
- A timeout, a provider error, or unusable output only skips this attempt; no error event is written.

## Cost and priority

- Off by default: when off, the scheduler returns before scanning the log, so the extra cost per turn is zero.
- When on: each qualifying turn produces one small model call, with an output cap of 800 tokens and input up to 6000 characters.
- Priority: a model-written `tail` card always wins. The two are mutually exclusive within a turn; once the model writes one, nothing is generated.
- Transient: after the user starts the next turn, the previous turn's "next steps" card (written or generated) is no longer shown; the recycled board card is the exception.

## Two approaches compared

| Dimension | Model-written tail | Host-generated |
| --- | --- | --- |
| Default state | On, the model decides | Off, must be enabled explicitly |
| Extra cost | No extra call | One small call per qualifying turn |
| Control | Content and wording decided by the model on the spot | Prompt guarantees structure; content comes from a small model |
| Fits | Complex context that needs the concrete conclusion | You want a stable closing suggestion every turn |

## Related

- [Four placements](placements.md)
- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)