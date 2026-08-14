# Mermaid English HTML

This node consumes a validated storyboard and its file-backed source brief,
renders the verified Mermaid source locally, and writes offline HTML targets
for the downstream video renderer. It owns its English defaults and rendering
core; it does not import another node.

The node preserves every verified node ID, edge, branch, direction, and source
hash. The workflow-canvas and NODE.md targets are deterministic from the verified
Mermaid source. This English node never calls an LLM.

## Input and output

- Input: one storyboard with `sourceBriefPath` (or a legacy embedded brief) and
  explicit `workflow-canvas` / `node-mermaid` preview targets.
- Output: a Mermaid HTML manifest consumed by `app-video-render`.
- Side effects: writes validated HTML files under the current run asset directory.

## Configuration

The node uses its own configuration: `width`, `height`, `maxTargets`, and
`maxHtmlLength`. `outputLanguage` is fixed to `English` and `translateLabels`
is fixed to `false`.

## Failure behavior

Missing graph or material evidence, an unknown material ID, missing Chromium,
or missing exact graph markers produces a validation warning. No unvalidated
HTML is returned.
