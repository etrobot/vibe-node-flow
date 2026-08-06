# Generate Demo UI HTML

This deterministic node reads the complete ui-html-generation manifest and writes one self-contained HTML page for each product UI item into the current run's `demo/` directory. For backwards compatibility it can also render the existing deterministic template from a raw storyboard.

The pages have no external network or font dependency and expose `--demo-time` through `postMessage`, so the renderer can control their timeline. Before writing, the node validates every generated target and refuses missing, duplicate, unsafe, or incomplete manifests.
