# VibeNodeFlow

A small visual workflow framework for AI applications. A workflow is a DAG of source-code nodes. The server owns execution, persistence, scheduling, and diagnostics.

> **Important:** Nodes and workflows are created and maintained by a Coding Agent. The browser UI is for observation and inspection only — users watch runs, review outputs, and diagnose issues through it. All authoring of nodes, edges, prompts, and validation logic is done by the agent writing source code under `nodes/` and `workflows/`.

## Design Logic

- **Host:** discovers node plugins, validates the graph, schedules executable nodes, persists runs, and serves diagnostics.
- **Node:** owns its configuration, business logic, input parsing, validation, model calls, retries, output contract, UI, and any executable it needs the host to launch.
- **Edge:** carries data between nodes. It is not a condition, router, or business-rule container.

```text
nodes/<name>/
  node.json       node type
  client.tsx      editor and preview UI
  server.ts       execution logic
  <name>.sh       optional executable the host can launch
        |
        v
plugin discovery -> DAG engine -> Worker -> run history / assets
```

Two rules follow from this split:

1. **No raw LLM nodes.** A model call must not be exposed as an unvalidated raw LLM node. A generative node owns its prompt, output contract, validation, and bounded repair loop. This is the project's core AI safety rule.
2. **A node must not require the host to change to accommodate it.** Installing a node means dropping a directory into `nodes/`; uninstalling it means deleting that directory. Nothing about a node may live in the host's `package.json`, build config, or source — see [Node Scripts](#node-scripts).

The host never inspects JSON, schemas, prompts, or domain data. Validation is a Chain of Responsibility: the chain runs upstream output → edge → receiving node, and the receiving node is the sole authority on whether its input is acceptable. No central schema registry, no host-level type checking.

## Execution Rules

- Nodes become ready when all direct parents have finished, regardless of parent status.
- Ready nodes run concurrently in dependency waves.
- `success` — the node produced an accepted result.
- `warning` (⚠️) — the node found an input or contract problem. Throw `NodeInputError` for unacceptable upstream input, `NodeValidationError` when output violates the node's own contract.
- `error` — execution or infrastructure failed. A plain thrown `Error` lands here and stops the branch.
- A failed branch does not cancel sibling branches. This supports one-to-many fan-out without putting conditions on edges.
- A wave continues only when at least one node succeeds. If every node in a wave is `warning` or `error`, the workflow stops as failed.
- The editor's **Stop** action terminates the server-side Worker. Disconnecting the browser does not stop a run.
- Cyclic graphs are rejected.

Each node decides about its own input, while the workflow still stops when no usable branch remains.

## Getting Started

```sh
cp .env.example .env
npm install
npm run dev          # http://localhost:3000
```

Production:

```sh
npm run build
NODE_ENV=production npm start
```

The model client reads `BASE_URL`, `API_KEY`, and `LLM_MODEL` from `.env`. Credentials are server-only and are never stored in workflow JSON or browser state.

### Single Executable Deployment (Recommended)

```sh
pnpm run pack
```

Produces `dist/vibe-node-flow`, a single binary bundling server and frontend, built with Node.js SEA. It defaults to port **39741** (uncommon, to avoid conflicts):

```sh
./dist/vibe-node-flow                # listens on 39741
PORT=8080 ./dist/vibe-node-flow      # listens on 8080
```

Prerequisites: Node.js ≥ 20 for `--experimental-sea-config`. On macOS, `codesign` re-signs the binary after blob injection.

## Node Contract

Every node lives under `nodes/<name>/` and contains `node.json`, `client.tsx`, and `server.ts`. All three must declare the same globally unique `type`, matching `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`. The directory name is only for discovery, and directories starting with `.` or `_` are skipped by the scanner.

### Client

`client.tsx` default-exports a `NodeModule`. Only `type` and `label` are required:

```tsx
import type { NodeModule } from '@/App/types.node-module';

export default {
  type: 'acme.uppercase',
  label: 'Uppercase',
  icon: 'CaseUpper',
  createConfig: () => ({ prefix: '' }),
} satisfies NodeModule;
```

The client owns editing and presentation, never secrets or server behavior. Optional views: `CustomView`, `OutputView`, `RunOverlay`, `RenderPage`.

### Server

`server.ts` default-exports `{ type, execute }`:

```ts
import type { NodePluginContext, NodePluginResult } from '../../server/plugins.ts';
import { NodeInputError, NodeValidationError } from '../../server/plugins.ts';

export default {
  type: 'acme.uppercase',
  async execute({ input }: NodePluginContext): Promise<NodePluginResult> {
    const text = Object.values(input).join('\n');
    if (!text.trim()) throw new NodeInputError('Input is required.');
    if (!isValid(text)) throw new NodeValidationError('Input does not match the contract.');
    return { output: text.toUpperCase(), logs: ['Converted input.'] };
  },
};
```

`execute` receives the current node, text input, accepted previous outputs, workflow id, definition directory, asset directory, and workflow asset directory. It returns `{ output, logs? }`; outputs should be strings when possible, since structured values are serialized before crossing an edge. A node with a useful diagnostic output may also return `{ output, status: 'warning', error }`.

### Node Scripts

Some work does not belong in `execute`: a long render, a browser capture, anything a user should watch in a terminal rather than block a Worker on. A node ships that as an executable in its own directory, and the host finds it by capability:

```ts
import { nodePluginHasCapability, nodePluginScript } from './plugins.ts';

const videoNode = [...run.nodes].reverse()
  .find((node) => nodePluginHasCapability(node.nodeType, 'video-spec') && node.output);

const scriptPath = nodePluginScript(videoNode.nodeType, 'render-video.sh');
if (!scriptPath) return res.status(400).json({ error: 'That node ships no render-video.sh' });
```

**Why not a `package.json` script.** The obvious alternative — `"render:video": "tsx nodes/app-video-render/scripts/render.ts"` — inverts the dependency. The host would declare a command on the node's behalf, so deleting the node leaves a dangling `npm run`, two nodes could never both own "the render step", and a node could not be distributed as a directory. `nodePluginScript` reverses it: the host asks whether a node provides a file, and learns nothing about what is inside it.

- `name` is a bare file name. Path separators, and names beginning with `.`, are refused — a node cannot reach outside its own directory.
- The path must resolve to a regular file, or the lookup returns `null`. A missing script is a normal condition, not an exception.
- No node type is hard-coded host-side. Capability decides who is asked, so swapping the render node changes nothing here. Declare it in `server.ts`: `capabilities: ['filesystem', 'process', 'video-spec']`.
- The host passes only what it alone knows — run id, its own base URL, the asset path it wants written. Every argument is shell-quoted; a run id cannot inject a command.
- The exit code is the contract. `0` means the artifact exists where the host asked for it.

`nodes/app-video-render/render-video.sh` is the worked example: it validates its arguments, preflights `node`/`curl`/`ffmpeg`, and fetches the run's spec before doing anything expensive.

### Adding a Node

Create the three files with a matching `type`, add nothing to the host `package.json`, then restart `npm run dev` so the plugin is discovered. Add tests when the node has validation, external calls, or side effects.

## Data Protocol

Edges always carry text in an object keyed by upstream node id:

```text
{}                                 no upstream
{ "source-id": "text" }            one upstream
{ "a": "text A", "b": "text B" }   multiple upstreams
```

The host does not parse this data. Each receiving node validates and interprets it.

## Workflows

```text
workflows/<workflow-id>/
  workflow.json       required — graph definition
  schedule.json       optional — cron schedule (auto-created on first save)
  prompts/            optional — workflow-owned prompt and validation files
    *.system.md  *.prompt.md  *.repair.md  *.validate.js
```

Prompt file paths are relative to the workflow directory and cannot escape it. Validation scripts run in the restricted script runtime.

```json
{
  "id": "wf-260802-093000",
  "name": "My Workflow",
  "description": "What this workflow does",
  "createdAt": "2026-08-02T09:30:00.000Z",
  "updatedAt": "2026-08-02T09:30:00.000Z",
  "icon": "Workflow",
  "color": "#1e293b",
  "tagCatalog": ["DB", "ENV", "FS"],
  "tags": ["content", "video"],
  "laneLabels": ["Research", "Generation"],
  "nodes": [{
    "id": "node-abc1234",
    "type": "content-brief",
    "title": "Research Brief",
    "icon": "FileText",
    "lane": "Research",
    "color": "#3b82f6",
    "x": 400,
    "y": 200,
    "tags": ["ENV"],
    "config": { "topic": "...", "audience": "..." }
  }],
  "edges": [{
    "id": "edge-nodeA-nodeB",
    "fromNodeId": "node-abc1234",
    "toNodeId": "node-def5678"
  }]
}
```

Constraints beyond the rules already stated above:

- **Node limit.** 10 by default, configurable via `MAX_FLOW_NODES` in `.env`.
- **Installed types only.** Every node `type` must match a discovered plugin; unknown types fail at execution.
- **Opaque IDs.** Node and edge IDs are generated internally, must match `^[A-Za-z0-9._-]+$`, and must not contain `..` (path-traversal guard).
- **Lane is required.** Every node declares its lane name; the host normalizes it to a canvas column and snaps `x/y` on load and save.
- **Schedule shape.** `schedule.json` holds `{ enabled, cron, timezone }` — cron validated with node-cron, timezone a valid IANA identifier. Overlapping scheduled runs of the same workflow are skipped.
- **Split at real boundaries.** Only split a node for a genuine boundary: different roles, parallel work, different models or tools, or an independently auditable contract. Keep prompts, validation code, repair instructions, and quality thresholds together for one generation stage.

## Installed Nodes

| Type | Purpose |
| --- | --- |
| `content-brief` | Validated editorial contract and evidence boundary. No model call. |
| `validated-generation` | Prompt → LLM → JavaScript validation → quality contract, with repair retries. |
| `clip-storyboard` | Brief → clip JSON with reusable structures and narration anchors, validated. |
| `app-video-project` | Storyboard → `chapters.json` and `chapter/chapter-N.json`, references expanded. |
| `edge-tts-narration` | Clip `speech` → per-clip MP3 via Microsoft Edge Read Aloud, plus the measured shot timeline. |
| `app-video-render` | Project → MP4, narration mixed onto the timeline. Ships `render-video.sh`. |

Each node directory carries a `NODE.md` describing its contract, configuration, and failure behavior.

## Example: App Launch Video With Voice

`workflows/app-launch-video/` chains five nodes from a brief to a finished MP4:

```text
content-brief → clip-storyboard → app-video-project → edge-tts-narration → app-video-render
```

Two things the storyboard does not contain, because a model is bad at both:

- **Seconds.** Items carry no duration. The narration marks where the picture cuts with `**anchors**`, and `edge-tts-narration` resolves those against real word boundaries. Timing is read off the voice instead of negotiated with it.
- **Repeated structure.** A process strip or comparison table is declared once under `global-components` and referenced by `key`, with `spot` naming the node to focus. Revisiting one structure across clips is what makes a diagram build up rather than restart.

`app-video-project` expands both into the flat shape the renderer reads, so neither reaches the render layer.

`edge-tts-narration` is a Node.js port of the Microsoft Edge "Read Aloud" protocol — the same service the Python `edge-tts` package uses. No API key, no Python runtime, no extra dependency: the WebSocket client comes from `undici`. It writes `clip-NN.mp3` per clip plus a stitched `narration.mp3`, copies them into `<project>/voice/`, and writes the measured shot lengths back into `chapter-N.json` so picture and voice come from one measurement.

`app-video-render` prepares the render and reports it; the MP4 itself is produced by `nodes/app-video-render/render-video.sh`, which the panel's **Render MP4** button opens in a visible terminal. It needs `ffmpeg` on PATH (`brew install ffmpeg`) and a local Chrome, Edge, Brave, or Chromium, because every frame is a screenshot.

> The frame-capture step is not implemented yet. `render-video.sh` validates its arguments, preflights the toolchain, and fetches the run's spec, then exits `2` printing the contract its missing handoff target must satisfy.

The `.env` keys `EDGE_TTS_PROXY` and `EDGE_TTS_DISABLE_PROXY` control network routing. When Microsoft starts rejecting the handshake, bump `CHROMIUM_FULL_VERSION` in `nodes/edge-tts-narration/edge-tts.ts`. The workflow's brief ships with placeholder source URLs — replace them with verified sources before running.

## Storage

```text
workflows/<workflow-id>/                    version-controlled definitions
data/
  studio.db                                 SQLite run history
  assets/<workflow-id>/generated/<run-id>/  run-scoped generated assets
  assets/<node-id>/                         reusable node assets
```

Runs contain node statuses, outputs, logs, errors, and a workflow snapshot. Full, API, scheduled, and single-node runs use the same execution path where applicable. Schedules are restored when the server starts.

## APIs

### Shareable browser links

The browser UI uses stable URLs for every workflow and run record, so a link
can be refreshed or shared directly:

```text
/workflows/<workflow-id>              workflow editor
/history                              all run history
/history?workflowId=<workflow-id>     history for one workflow
/runs/<run-id>                        run detail snapshot
```

The link icon beside a workflow or run record copies its URL to the clipboard.

```sh
curl http://localhost:3000/api/node-plugins                                  # plugin diagnostics
curl -X POST http://localhost:3000/api/workflows/<workflow-id>/run/background
curl -X POST http://localhost:3000/api/runs/<run-id>/stop
curl 'http://localhost:3000/api/runs?workflowId=<workflow-id>'
curl http://localhost:3000/api/runs/<run-id>
```

## Development

```sh
npm test
npm run lint
npm run build
```
