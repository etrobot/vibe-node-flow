# App Video Project

## Design

`app-video-project` is the deterministic bridge between a validated storyboard and the local renderer in `data/idea-to-app-builder`. It performs no model call. It splits clips into one `chapter-N.json` per chapter, writes `chapters.json` with document metadata, and emits a manifest the narration node consumes.

The output layout is exactly what the builder expects, so the written project works with `npm run validate-project -- <slug>`, the preview UI, and `npm run render-video -- --project <slug>`.

## Input And Output

- Input: exactly one upstream storyboard JSON document.
- Output: JSON manifest with `slug`, `projectDir`, `builderProjectDir`, `chapterFiles`, `clipCount`, `estimatedSeconds`, and per-clip `speech`.
- Side effects: writes `description.md`, `chapters.json`, and `chapter/chapter-N.json` into the run's asset directory, and optionally mirrors them into the builder workspace.

## Configuration

`builderProjectsDir` is resolved relative to the server data directory and defaults to `idea-to-app-builder/projects`; blank writes only into the run's asset directory. `overwrite` replaces an existing project of the same slug. `writeDescription` controls the human-readable `description.md`.

## Failure Behavior

The node reports a warning (`⚠️`) when the upstream count is not exactly one, the payload is not a storyboard document, the slug is not lowercase kebab-case, a chapter's `clipCount` is invalid, chapters do not cover every clip, the configured builder directory escapes the data directory, or an existing project would be replaced while `overwrite` is disabled.
