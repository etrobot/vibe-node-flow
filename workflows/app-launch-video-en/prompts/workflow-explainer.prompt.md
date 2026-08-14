Convert the supplied workflow brief into one English storyboard JSON document for a local motion-graphics renderer. The video should read like a visual technical walkthrough, not a stack of title cards. Use diagrams, highlighted process structures, cards, icons, and charts only when the brief supports them.

## Output contract

Return exactly one object with:

{"slug","title","hook","summary","closing","chapters":[{"title","summary","startClip","clipCount"}],"global-components":[{"key","component",...}],"clips":[{"speech","items":[{"type",...}]}]}

Do not generate `hue`, `palette`, `background`, or chart datum colors. They are renderer-owned presentation metadata assigned deterministically after the script JSON is validated.

## Story structure

1. Open with the concrete problem represented by the workflow name and description.
2. Generate the opening inside this same storyboard JSON response. The opening should be the first two clips:
   - Opening clip 1 should introduce the workflow problem in one clear English sentence and may mention the model when relevant. A good model sentence is: `This task uses the Doubao-Seed-Evolving model, an evolving model from ByteDance designed for high-frequency code development, complex task orchestration, and long-running Agent workflows; it natively supports text, high-resolution image, and video analysis, making it suitable for this task.` Use at least two visual items when they help the beat land.
   - Opening clip 2 should state one design advantage supported by the brief in one sentence and use at least one visual item.
   - Opening clips should not reference `global-components`, especially `process-card-highlight` or another full workflow/process card. Do not show the complete node flow in the opening.
   - Prefer varied direct visual types such as `text-typing`, `text-impact`, `ui-icon-text`, `flowing-stats`, `element-growth`, or `scene-clock`. Avoid pure text-only title cards when a stronger visual type fits.
   - Reserve `process-card-highlight` and other reusable global structures for the middle node walkthrough, where they can be revisited with different `spot` values.
3. Walk the source workflow in dependency-wave order. Cover the important nodes, inputs, outputs, and data flow. You do not need a separate clip for every minor node if a grouped explanation stays faithful to the brief.
4. Name real inputs, outputs, important configuration, branches, joins, and warning or error boundaries only when the brief supports them. Keep the source node IDs and edge topology authoritative. Use faithful English titles for on-screen text.
5. This explainer workflow has no generic product Demo UI generation stage. Do not create or reference `ui-prompt-input`, `ui-dropfiles`, or `ui-render-loading`, and do not write HTML in this JSON. The dedicated Mermaid asset node is the only HTML surface: include one `ui-video-preview` item with `demoUi` state `workflow-canvas`, and one `ui-video-preview` item with `demoUi` state `node-mermaid` plus an exact `materialId` copied from the brief's verified Mermaid materials. These two targets may appear in middle or output clips and must be narrated as workflow diagrams, not product UI.
6. Close with one factual end-to-end summary, not a generic call to action.
7. Keep the middle visually varied when the brief allows it. Reusable process/card/table/chart components are encouraged, but not required in a fixed number of clips.

## Hard rules

- Set `slug` from the source workflow ID using lowercase kebab-case.
- Write every speech and on-screen string in English.
- Produce 6-10 clips and about 90 seconds of narration, within 35 percent.
- Use 1-3 items in every clip and at least five distinct item types overall.
- Do not generate `background`; the storyboard node assigns it deterministically from `aurora`, `blur`, `wave`, and `semrush-glow`.
- The final clip, and only the final clip, pairs `text-title` with `text-logo`.
- `text-typing` may only be the first item of a clip.
- Every `text-typing`, `text-popup`, `text-shatter`, `text-zoom`, `text-title`, `text-logo`, and `ui-icon-text` item must include a concise title. `ui-icon-text` must also include a Lucide icon.
- `text-impact` must include a concise title or a cumulative words array.
- On-screen titles should normally be two to six words, except for exact source node names or faithful English translations of them.
- Do not invent metrics, prices, runtime results, users, endorsements, or capabilities.
- Use `ui-video-preview` only for the two explicit Mermaid targets above; do not add any other Demo UI target.
- Do not claim that any source workflow run succeeded; describe only the documented behavior and output contract.

## Narration anchors

Items carry no duration. A clip with N items must contain exactly N-1 phrases wrapped in double asterisks inside speech. Item one starts with the clip; each anchor starts the next item. Anchor a short complete English phrase at the exact moment the visual should change. Do not anchor punctuation or a whole sentence.

## Reusable structures

`global-components` is optional. When you use it, prefer one to three reusable structures. A `process-card-highlight` is useful when the brief supports a real node walkthrough, but it is not mandatory. Reuse declared structures across multiple clips with different `spot` values when that helps the walkthrough build step by step.

Choose additional structures from `pyramid-highlight`, `comparison-table`, `chart-bar`, `chart-line`, and `feedback-cards` only when their content is directly supported by the brief. A chart may use exact node, edge, or execution-wave counts found in the brief, but never invent performance numbers, costs, user outcomes, testimonials, or percentages merely to fill a chart.

Every declared structure must be referenced by at least one clip. A reusable component reference has the form `{"type":"process-card-highlight","key":"...","spot":"..."}` and must not repeat the full payload in the clip item.

Use these exact payload shapes; never emit a reusable component with a null `component` or omitted payload:

- `{"key":"workflow-stages","component":"process-card-highlight","cards":[{"key":"node-a","title":"Faithful English node title","icon":"Workflow"}]}`. Every card needs a lowercase kebab-case key, a concise title, and a Lucide icon; each spot must equal a card key.
- `{"key":"node-comparison","component":"comparison-table","comparisonCsv":"Node,Responsibility\\nInput,Read data\\nOutput,Write results"}`. The first CSV row is the header; the first column of each later row is the feature.
- `{"key":"execution-counts","component":"chart-bar","chartData":[{"key":"nodes","label":"Nodes","value":2}]}`. Every datum needs a lowercase kebab-case key, a label, and a numeric value explicitly supported by the brief.

If a structure cannot be filled with these exact fields and verified facts, omit it rather than emitting a placeholder or null field.

## Direct and reusable visual types

Use only these direct types:

- `text-typing`, `text-popup`, `text-shatter`, `text-zoom`, `text-impact`
- `ui-icon-text` with a Lucide icon
- `ui-video-preview` only when it carries one of the two explicit Mermaid `demoUi` targets above
- `flowing-stats`, `element-growth`, `scene-clock`, `swipe-delete`
- `text-title` and `text-logo` for the closing pair

Reusable types are also allowed when declared above:

- `process-card-highlight`, `pyramid-highlight`, `comparison-table`
- `chart-bar`, `chart-line`, `chart-pie`, `feedback-cards`

The machine-readable source workflow graph is authoritative. Never imply different nodes or edges. Other clips may summarize the walkthrough with English text and icons, but every factual statement must be grounded in the brief.

## Chapters

Chapters must be contiguous from clip zero and their clipCount values must sum exactly to the number of clips. Use a compact structure such as problem and overview, node walkthrough, and output and boundaries.
