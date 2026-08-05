# App Video Project

## Design

`app-video-project` is the deterministic bridge between a validated storyboard and the renderer. It performs no model call. It splits clips into one `chapter-N.json` per chapter, writes `chapters.json` with document metadata into the current run asset directory, and emits a manifest the narration node consumes.

This is also where the compact authored storyboard becomes something a renderer can draw. `resolve.ts` expands each clip item: a `{"key": "build-flow", "spot": "generate"}` reference is replaced by the structure it names plus the numeric `targetIndex` that highlights `generate`, and every item gets seconds. The authored form is kept alongside as `storyboard.json`, so a rerun can re-resolve from the source rather than from the expansion.

The output layout is exactly what the renderer expects. It is scoped to the current run and is not a separately managed project.

## Input And Output

- Input: exactly one upstream storyboard JSON document.
- Output: JSON manifest with `slug`, `assetDir`, `chapterFiles`, `clipCount`, `globalComponentCount`, `estimatedSeconds`, the hydrated `document` for preview, the authored `storyboard`, and per-clip `speech` and `itemCount`. The speech keeps its `**anchors**`, because `edge-tts-narration` needs them to place the cuts.
- Side effects: writes `description.md`, `chapters.json`, `storyboard.json`, and `chapter/chapter-N.json` into `data/assets/<workflow-id>/generated/<run-id>/`.

## Durations

The durations written into `chapter-N.json` are provisional: an even split of the clip's estimated narration, because at this point nobody has spoken it yet. `edge-tts-narration` runs next and overwrites them with what the voice actually did. Rendering without narration therefore still produces a watchable video, just one whose cuts are evenly spaced rather than measured.

## Configuration

`writeDescription` controls the human-readable `description.md`. The files are written directly into the run's asset directory, and the render node reads them from there.

## Failure Behavior

The node reports a warning (`⚠️`) when the upstream count is not exactly one, the payload is not a storyboard document, the slug is not lowercase kebab-case, a chapter's `clipCount` is invalid, or chapters do not cover every clip.
