# VibeNodeFlow

A small visual workflow framework for AI applications. A workflow is a DAG of source-code nodes. The server owns execution, persistence, scheduling, and diagnostics.

> **Important:** Nodes and workflows are created and maintained by a Coding Agent. The browser UI is for observation and inspection only — users watch runs, review outputs, and diagnose issues through it. All authoring of nodes, edges, prompts, and validation logic is done by the agent writing source code under `nodes/` and `workflows/`.

## Design Logic

The framework has three clear responsibilities:

- **Host:** discovers node plugins, validates the graph, schedules executable nodes, persists runs, and serves diagnostics.
- **Node:** owns its configuration, business logic, input parsing, validation, model calls, retries, output contract, and UI.
- **Edge:** carries data between nodes. It is not a condition, router, or business-rule container.

This keeps the graph declarative and nodes reusable. The host does not inspect JSON, schemas, prompts, or domain data. The receiving node decides whether its input is acceptable.

```text
nodes/<name>/
  node.json       node type
  client.tsx      editor and preview UI
  server.ts       execution logic
        |
        v
plugin discovery -> DAG engine -> Worker -> run history / assets
```

The main AI rule is: a model call must not be exposed as an unvalidated raw LLM node. A generative node must own its prompt, output contract, validation, and bounded repair loop.

## Execution Rules

- Nodes become ready when all direct parents have finished, regardless of parent status.
- Ready nodes run concurrently in dependency waves.
- `success` means the node produced an accepted result.
- `warning` means the node found an input or contract problem. It is shown as `⚠️`.
- `error` means execution or infrastructure failed.
- A wave continues only when at least one node succeeds. If every node in the wave is `warning` or `error`, the workflow stops as failed.
- A failed branch does not cancel sibling branches. This supports one-to-many fan-out without putting conditions on edges.
- The editor's **Stop** action terminates the server-side Worker. Disconnecting the browser does not stop a run.
- Cyclic graphs are rejected.

This gives each node responsibility for input decisions while still stopping a workflow when no usable branch remains.

## Getting Started

```sh
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:3000`.

Production:

```sh
npm run build
NODE_ENV=production npm start
```

The model client reads `BASE_URL`, `API_KEY`, and `LLM_MODEL` from `.env`. Credentials are server-only and are never stored in workflow JSON or browser state.

## Node Contract

Every node lives under `nodes/<name>/` and contains:

```text
node.json
client.tsx
server.ts
```

All three files must declare the same globally unique `type`. The directory name is only for discovery.

### Client

`client.tsx` default-exports a `NodeModule`. Only `type` and `label` are required:

```tsx
import type { NodeModule } from '../types';

export default {
  type: 'acme.uppercase',
  label: 'Uppercase',
  icon: 'CaseUpper',
  createConfig: () => ({ prefix: '' }),
} satisfies NodeModule;
```

The client owns editing and presentation. It is not the source of truth for secrets or server behavior. Optional views include `CustomView`, `OutputView`, `RunOverlay`, and `RenderPage`.

### Server

`server.ts` default-exports `{ type, execute }`:

```ts
import type { NodePluginContext, NodePluginResult } from '../../server/plugins.ts';

export default {
  type: 'acme.uppercase',
  async execute({ input }: NodePluginContext): Promise<NodePluginResult> {
    const text = Object.values(input).join('\n');
    return { output: text.toUpperCase(), logs: ['Converted input.'] };
  },
};
```

`execute` receives the current node, text input, accepted previous outputs, workflow id, definition directory, asset directory, and workflow asset directory.

It returns `{ output, logs? }`. Outputs should be strings when possible; structured values are serialized before crossing an edge.

For node-owned input or contract failures, use the warning errors:

```ts
import { NodeInputError, NodeValidationError } from '../../server/plugins.ts';

if (!text.trim()) throw new NodeInputError('Input is required.');
if (!isValid(text)) throw new NodeValidationError('Input does not match the contract.');
```

The engine records these as `warning`. A node may also return `{ output, status: 'warning', error }` when it has a useful diagnostic output. A normal thrown `Error` is an `error`.

## Data Protocol

Edges always carry text in an object keyed by upstream node id:

```text
{}                                  no upstream
{ "source-id": "text" }            one upstream
{ "a": "text A", "b": "text B" }  multiple upstreams
```

The host does not parse this data. Each receiving node validates and interprets it.

## Workflow Design

Split a node only when there is a real boundary: different roles, parallel work, different models or tools, or an independently auditable contract. Keep prompts, validation code, repair instructions, and quality thresholds together for one generation stage.

Workflow-owned files are stored beside `workflow.json`:

```text
workflows/<workflow-id>/
  workflow.json
  schedule.json
  prompts/
    *.system.md
    *.prompt.md
    *.repair.md
    *.validate.js
```

Prompt file paths are relative to the workflow directory and cannot escape it. Validation scripts run in the restricted script runtime.

## Creating a Workflow

### Directory Structure

Every workflow lives under `workflows/<workflow-id>/` and must contain `workflow.json`:

```text
workflows/<workflow-id>/
  workflow.json       required — graph definition
  schedule.json       optional — cron schedule (auto-created on first save)
  prompts/            optional — workflow-owned prompt and validation files
    *.system.md
    *.prompt.md
    *.repair.md
    *.validate.js
```

Prompt file paths are relative to the workflow directory and cannot escape it. Validation scripts run in the restricted script runtime.

### workflow.json Schema

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
  "nodes": [/* FlowNode[] */],
  "edges": [/* FlowEdge[] */]
}
```

Each node in `nodes`:

```json
{
  "id": "node-abc1234",
  "type": "content-brief",
  "title": "Research Brief",
  "icon": "FileText",
  "color": "#3b82f6",
  "x": 400,
  "y": 200,
  "tags": ["ENV"],
  "config": { "topic": "...", "audience": "..." }
}
```

Each edge in `edges`:

```json
{
  "id": "edge-nodeA-nodeB",
  "fromNodeId": "node-abc1234",
  "toNodeId": "node-def5678"
}
```

### Rules

1. **DAG only.** The graph must be a directed acyclic graph. Cyclic dependencies are rejected at execution time.

2. **Node limit.** A workflow supports up to 10 nodes by default (configurable via `MAX_FLOW_NODES` in `.env`).

3. **Node type must be installed.** Every node's `type` field must correspond to a discovered plugin under `nodes/<name>/`. Unknown types fail at execution.

4. **No raw LLM nodes.** A model call must not be exposed as an unvalidated raw LLM node. A generative node must own its prompt, output contract, validation, and bounded repair loop. This is the project's core AI safety rule.

5. **Split at real boundaries.** Only split a node when there is a genuine boundary: different roles, parallel work, different models or tools, or an independently auditable contract. Keep prompts, validation code, repair instructions, and quality thresholds together for one generation stage.

6. **Edge data is text.** Edges carry text in an object keyed by upstream node id (`{ "source-id": "text" }`). The host does not parse this data; each receiving node validates and interprets it.

7. **Node IDs are opaque.** Node and edge IDs are generated internally. They must match `^[A-Za-z0-9._-]+$` and must not contain `..` (path-traversal guard).

8. **Type naming.** Node types declared in `node.json` must match `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`. The `type` string must be identical across `node.json`, `client.tsx`, and `server.ts`.

9. **Schedule is optional.** If `schedule.json` exists, it must contain `{ enabled, cron, timezone }`. Cron expressions are validated with node-cron; timezones must be valid IANA identifiers. Overlapping scheduled runs of the same workflow are skipped.

10. **Credentials are server-only.** API keys, base URLs, and model names are read from `.env` and are never stored in workflow JSON or browser state.

### Adding a Node Plugin

1. Create `nodes/<name>/` with three required files: `node.json`, `client.tsx`, `server.ts`.
2. `node.json` declares the canonical type: `{ "type": "your.node.type" }`.
3. `client.tsx` default-exports a `NodeModule` with at least `type` and `label`.
4. `server.ts` default-exports `{ type, execute(context) }` returning `{ output, logs? }`.
5. The `type` string must be identical in all three files.
6. Directory names starting with `.` or `_` are skipped by the plugin scanner.
7. Restart `npm run dev` so the plugin is discovered.

### Validation and Error Semantics

- Throw `NodeInputError` when upstream input is missing or unacceptable.
- Throw `NodeValidationError` when the output violates the node's own contract.
- Both are recorded as `warning` (⚠️); sibling branches continue running.
- A regular thrown `Error` is recorded as `error`; the branch stops.
- A wave continues only when at least one node succeeds. If every node in a wave is `warning` or `error`, the workflow stops as failed.

## Installed Nodes

| Type | Purpose |
| --- | --- |
| `content-brief` | Validated editorial contract and evidence boundary. No model call. |
| `validated-generation` | Prompt → LLM → JavaScript validation → quality contract, with repair retries. |
| `clip-storyboard` | Brief → renderer-ready clip JSON, validated against the builder contract. |
| `app-video-project` | Storyboard → `chapters.json` and `chapter/chapter-N.json` project files. |
| `edge-tts-narration` | Clip `speech` → per-clip MP3 via the Microsoft Edge Read Aloud service. |

Each node directory carries a `NODE.md` describing its contract, configuration, and failure behavior.

## Example: App Launch Video With Voice

`workflows/app-launch-video/` chains four nodes into a narrated video project:

```text
content-brief → clip-storyboard → app-video-project → edge-tts-narration
```

The storyboard contract mirrors `data/idea-to-app-builder`, so the generated project works with that builder's own tooling:

```sh
cd data/idea-to-app-builder
npm run validate-project -- forge-app-launch
npm run render-video -- --project forge-app-launch
```

`edge-tts-narration` is a Node.js port of the Microsoft Edge "Read Aloud" protocol — the same service the Python `edge-tts` package uses. It needs no API key, no Python runtime, and no extra dependency: the WebSocket client comes from `undici`. It writes `clip-NN.mp3` per clip plus a stitched `narration.mp3` into the run's assets, copies them into `<project>/voice/`, and reports word-level timings so narration length can be checked against each clip's planned duration.

The `.env` keys `EDGE_TTS_PROXY` and `EDGE_TTS_DISABLE_PROXY` control network routing. When Microsoft starts rejecting the handshake, bump `CHROMIUM_FULL_VERSION` in `nodes/edge-tts-narration/edge-tts.ts`.

The workflow's brief ships with placeholder source URLs. Replace them with verified sources before running.

## Storage

```text
workflows/<workflow-id>/       version-controlled definitions
data/
  studio.db                    SQLite run history
  assets/<workflow-id>/        generated assets
```

Runs contain node statuses, outputs, logs, errors, and a workflow snapshot. Full, API, scheduled, and single-node runs use the same execution path where applicable.

## APIs

```sh
# Plugin diagnostics
curl http://localhost:3000/api/node-plugins

# Run a workflow in the background
curl -X POST http://localhost:3000/api/workflows/<workflow-id>/run/background

# Stop an active run
curl -X POST http://localhost:3000/api/runs/<run-id>/stop

# Read run history
curl 'http://localhost:3000/api/runs?workflowId=<workflow-id>'
curl http://localhost:3000/api/runs/<run-id>
```

Schedules are stored in `schedule.json` and restored when the server starts. Overlapping scheduled runs of the same workflow are skipped.

## Development

To add a node, follow the steps in [Adding a Node Plugin](#adding-a-node-plugin). Add node-specific tests when the node has validation, external calls, or side effects.

Run the checks:

```sh
npm test
npm run lint
npm run build
```
