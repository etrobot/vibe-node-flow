# Generate Demo UI HTML

This deterministic node reads the validated Storyboard and writes one self-contained HTML page for each product UI item into the current run's `demo/` directory. It emits a manifest keyed by `clipIndex` and `itemIndex`.

The pages have no external network or font dependency and expose `--demo-time` through `postMessage`, so the renderer can control their timeline.

