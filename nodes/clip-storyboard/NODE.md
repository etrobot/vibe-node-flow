# Clip Storyboard

## Design

`clip-storyboard` is the single generative stage between an editorial brief and a renderable video project. It owns its prompt, its output contract, its deterministic validator, and a bounded repair loop, so no unvalidated model output ever reaches a downstream node.

The contract mirrors `data/idea-to-app-builder`: the same clip shape, the same background names, and the same item types as `src/renderer/clipTypes.ts`. A storyboard accepted here also passes the builder's own `npm run validate-project`.

## Input And Output

- Input: one or more upstream briefs. Every non-empty upstream output is concatenated and labeled by node id.
- Output: pretty-printed JSON with `slug`, `title`, `hook`, `summary`, `closing`, `hue`, `chapters`, and `clips`.
- Side effects: one or more model calls. No files are written.

## Configuration

`slug` pins the downstream project folder name; leaving it blank lets the model derive one. `language` and `tone` steer narration and hue. `minClips`/`maxClips`, `minComponentTypes`, `targetDurationSeconds`, and `durationTolerance` define the accepted shape. `systemPromptFile` and `promptFile` swap in workflow-owned prompt files, resolved relative to the workflow definition directory.

## Validation

Every candidate is parsed as JSON, then checked for: kebab-case slug, required document fields, hue range, clip count, plain `speech` with no `**` markers, known backgrounds, 1-3 items per clip, item durations between 0.6 and 6 seconds, per-type required fields (`prompt`, `icon`, `words`, `title`), `text-typing` only as a clip's first item, the `text-title`/`text-logo` pair only in the closing clip, no `image`/`video` items, contiguous chapters that cover every clip, a minimum number of distinct component types, and a total runtime inside the target window.

## Failure Behavior

A failed contract triggers a repair call carrying the exact issue list. After the initial generation plus four repair retries, the node reports a warning (`⚠️`) with every remaining issue and the full attempt log. A missing or empty upstream brief is an immediate warning.
