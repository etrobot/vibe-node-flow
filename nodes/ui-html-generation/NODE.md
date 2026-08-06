# UI HTML Generation

This node is the LLM boundary for Demo UI surfaces. It finds every DemoUiTarget in one storyboard and makes an independent model request for each target. A repair request contains only that target's previous response and validation errors; another target never shares model conversation state.

Each response must be a complete offline HTML document for the configured 1920x1080 composition. The deterministic contract checks doctype, html/head/body structure, inline style, data-demo-ui, network independence, browser network APIs, DOM HTML injection APIs, size limits, and escaping of special characters in target text.

The node returns a generation manifest in memory. It does not write any HTML file. The downstream app-video-render node validates every target again, writes all HTML files, and attaches their same-run references to the storyboard before rendering.

## Input And Output

- Input: one validated video JSON document and the upstream content brief.
- Output: a ui-html-generation manifest with the source document and one HTML payload per target.
- Side effects: none.

## Configuration

- width and height set the target composition.
- temperature controls the model temperature.
- retryLimit controls repair calls for each target, up to three.
- maxHtmlLength limits one HTML response.

## Failure Behavior

An unavailable model, malformed HTML, external dependency, missing marker, unsafe text injection, or exhausted target-level retries fails the whole node. No partial generation manifest is returned, and logs identify the target, attempt, provider attempt count, model, and validation errors.
