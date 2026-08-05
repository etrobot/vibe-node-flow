# Clip Storyboard

## Design

`clip-storyboard` is the single generative stage between an editorial brief and a renderable video project. It owns its prompt, its output contract, its deterministic validator, and a bounded repair loop, so no unvalidated model output ever reaches a downstream node.

Two things the model does **not** write, both because it is bad at them:

- **Seconds.** A model asked how long a shot should last invents a number, and the narration then arrives at a different length. Instead the storyboard marks *where* the picture cuts with `**anchors**` in the speech, and `edge-tts-narration` resolves those against real Edge TTS word boundaries. Timing is read off the voice rather than negotiated with it.
- **Repeated structure.** A process strip or comparison table is declared once under `global-components` and referenced from clips by `key`, with `spot` naming the node to focus. Reusing one structure across clips is what makes a diagram build up as the narration walks it; repeating the payload per clip is what made it restart.

`resolve.ts` expands both back into the flat item shape the renderer has always read, so none of this reaches `ClipTypeRenderer`.

## Input And Output

- Input: one or more upstream briefs. Every non-empty upstream output is concatenated and labeled by node id.
- Output: pretty-printed JSON with `slug`, `title`, `hook`, `summary`, `closing`, `hue`, optional `palette`, `chapters`, optional `global-components`, and `clips`.
- Side effects: one or more model calls. No files are written.

## Contract

```jsonc
{
  "slug": "forge-app-launch",
  "title": "…", "hook": "…", "summary": "…", "closing": "…",
  "hue": 345,
  "palette": { "background": "#0b0510", "foreground": "#f8f5ff",
               "muted": "#a99eb7", "accent": "#ff5d7a", "secondary": "#b06bff" },
  "chapters": [{ "title": "…", "summary": "…", "startClip": 0, "clipCount": 2 }],
  "global-components": [
    { "key": "build-flow", "component": "process-card-highlight",
      "cards": [{ "key": "describe", "icon": "MessageSquare", "title": "Describe" },
                { "key": "generate", "icon": "Sparkles",      "title": "Generate" }] }
  ],
  "clips": [
    { "speech": "Describe the product and watch it **generate** into something real.",
      "background": "aurora",
      "items": [{ "type": "ui-prompt-input", "prompt": "Build a habit tracker" },
                { "type": "process-card-highlight", "key": "build-flow", "spot": "generate" }] }
  ]
}
```

A clip with N items carries exactly N-1 anchors: anchor 1 starts item 2, and item 1 starts with the clip.

`process-card-highlight`, `pyramid-highlight`, `comparison-table`, `chart-bar`, `chart-line`, `chart-pie`, and `feedback-cards` must reference a global component. The two `-highlight` types also require a `spot`; the rest may omit it.

## Configuration

`slug` pins the downstream project folder name; leaving it blank lets the model derive one. `language` and `tone` steer narration and hue. `minClips`/`maxClips`, `minComponentTypes`, `targetDurationSeconds`, and `durationTolerance` define the accepted shape — under anchor timing the duration window applies to the *estimated narration*, since no item carries seconds.

`timingMode` selects the contract. `anchor` (default) is the above. `duration` restores the older shape: plain speech with no `**`, and a required `0.6`-`6` second `duration` on every item. `maxGlobalComponents` caps reusable structures; `0` disables them and forces every payload inline.

`systemPromptFile` and `promptFile` swap in workflow-owned prompt files, resolved relative to the workflow definition directory.

## Component Menu

The renderer implements 34 item types; the model is offered 23. `x-profile`, `image`, `video`, and the eight `semrush-*` brand scenes are reserved — hand-written project JSON may still use them, but a generic product video should not be nudged toward another product's branding, and no media exists for `image`/`video`. Choosing a reserved type is a contract error naming it as such.

## Validation

Every candidate is parsed as JSON, then checked for: kebab-case slug, required document fields, hue range, hex palette roles, clip count, known backgrounds, 1-3 items per clip, the anchor count matching the item count, per-type required fields (`prompt`, `icon`, `words`, `title`), `text-typing` only as a clip's first item, the `text-title`/`text-logo` pair only in the closing clip, no reserved types, unique kebab-case keys on every component and card, `spot` resolving to a node of the referenced component, contiguous chapters that cover every clip, a minimum number of distinct component types, and an estimated narration inside the target window.

A declared-but-unreferenced global component is a warning, not an error — it usually means a clip lost its reference during a repair pass.

## Failure Behavior

A failed contract triggers a repair call carrying the exact issue list. After the initial generation plus four repair retries, the node reports a warning (`⚠️`) with every remaining issue and the full attempt log. A missing or empty upstream brief is an immediate warning.
