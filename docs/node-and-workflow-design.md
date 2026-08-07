# Node-First Node and Workflow Design

The design reference for VibeNodeFlow. The order is fixed: **build complete, validated, independently useful nodes first; compose them into workflows second.**

A workflow is the composition layer, not the home of business logic. A node is a capability unit, not a placeholder on a canvas.

## Core Principles

### 1. Node design comes first

For every requirement, ask "What node capability should exist?" before "How should the nodes be connected?" Workflows should start with three nodes: data acquisition, data processing, and formatted output. If a problem can be solved without adding complexity, do not increase it; under this principle, these three types of nodes should be prioritized.

Before a node enters a workflow it must have one clear responsibility, readable input/output/side-effect contracts, validation of configuration, input, and output, actionable success/warning/error diagnostics, and core logic that does not depend on one specific graph. This keeps the capability independently testable and reusable, and keeps domain rules out of edges, canvas state, and host code.

### 2. Prefer fewer, better nodes

Node count is not capability count. Split only at a real boundary:

- a different role or owner;
- work that runs in parallel, retries, or scales independently;
- a different model, tool, permission set, or runtime;
- an output contract that must be audited, accepted, or persisted independently.

Not sufficient reasons: shortening a source file, isolating one prompt, separating validation from repair within the same stage, or wrapping a trivial format conversion. Keep one generation stage's prompt, validator, repair instructions, and quality thresholds together.

### 3. Every node owns its input validation

Data moves `upstream output -> edge -> receiving node`, and the receiving node is the sole authority on whether that input is acceptable — not the host, not a central schema registry. Validate before expensive work, covering:

1. configuration shape and value ranges;
2. input presence and parsing;
3. domain semantics, required fields, counts, and references;
4. external tools, credentials, files, and runtime prerequisites;
5. the node's own output contract.

| Error type | Meaning | Recorded as |
| --- | --- | --- |
| `NodeInputError` | Upstream input or node configuration is unacceptable | `warning`, with a repairable explanation |
| `NodeValidationError` | The node's result violates its own contract | `warning` |
| plain `Error` | Execution or infrastructure failure | `error` |

**Raw LLM nodes are forbidden.** A generative node never passes unvalidated model output downstream: it owns parsing, deterministic validation, and a bounded repair loop, and reports the full issue list and attempt log when repair is exhausted.

### 4. Every node has two application-grade capabilities

| Capability | Requirement |
| --- | --- |
| Standalone application | Given explicit configuration and input, runs with its own validation, output, errors, logs, resources, and side-effect boundary — exposed through an API, CLI, dedicated page, or single-node run. |
| Workflow node | Accepts upstream input, follows the text edge protocol, returns node status and output, consumes run context, and participates in DAG waves, assets, and history. |

Both modes share the same domain core and validators; only the boundary adapter differs. Never maintain two business implementations. A capability with no useful meaning outside its parent node stays an internal module. Single-node run is the minimum standalone implementation; a fuller end-user application belongs in the node directory, never in host business logic.

## Design Order

1. **Define the result.** What the user receives, and what makes it acceptable.
2. **Set the node boundary.** Input, output, resources, permissions, failure modes, standalone entry point.
3. **Implement the node core.** Parsing, domain logic, input/output validation, and diagnostics — all inside the node directory.
4. **Prove standalone execution first.** Valid, invalid, empty, and boundary input, without a complete workflow.
5. **Add the host adapters.** The `server.ts` plugin and the `client.tsx` editing/observation UI. The host only orchestrates and persists.
6. **Compose the workflow.** Dependencies, parallel branches, and joins — only after node contracts are stable.
7. **Validate the graph.** Cycles, installed types, node count, input reachability, failed branches, resource lifecycles.

## Node Design

### Responsibility boundary

A node owns configuration and defaults; input parsing, semantic validation, and missing-input behavior; business logic, model calls, external tools, and retries; output shape, output validation, and actionable diagnostics; its own editing, preview, and run-state UI; any executable the host may launch for it; and its asset and run-output path rules.

The host discovers plugins, checks graph structure, schedules execution, persists run history, and serves diagnostics. It never parses domain JSON, prompts, or business schemas, and never decides whether node input is valid.

```text
standalone entry point --\
                         +--> node domain core --> output / diagnostics / assets
workflow adapter -------/

host: discover plugins -> validate DAG -> schedule dependency waves -> persist runs
edge: carry data only; never own conditions, routing, or business rules
```

### Directory and contract

Each node is a removable and distributable directory under `nodes/<name>/`:

```text
nodes/<name>/
  node.json       node type and discovery metadata
  client.tsx      editor, preview, and run-observation UI
  server.ts       server-side execution plugin
  NODE.md         contract, configuration, and failure documentation
  <script>        optional node-owned executable
```

`node.json`, `client.tsx`, and `server.ts` must declare the same globally unique `type`, matching `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`. The directory name only affects discovery; directories beginning with `.` or `_` are ignored. Adding a node means adding this directory — never changes to the host `package.json`, build configuration, or source code. Deleting the directory removes the node. Restart `npm run dev` to rediscover plugins during development.

`client.tsx` owns editing and presentation, never secrets or server behavior, and default-exports a `NodeModule`:

```tsx
import type { NodeModule } from '@/App/types.node-module';

export default {
  type: 'acme.uppercase',
  label: 'Uppercase',
  icon: 'CaseUpper',
  createConfig: () => ({ prefix: '' }),
} satisfies NodeModule;
```

`server.ts` default-exports `{ type, execute }`. `execute` receives the current node, upstream text input, accepted previous outputs, workflow identity, and asset directories; it returns `{ output, logs? }` and may return a diagnostic warning:

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

Structured values are serialized before crossing an edge. Prefer string outputs, and keep parsing and contract validation inside the receiving node.

### Validation order

```text
read configuration -> parse input -> validate required values and types
  -> validate domain constraints and references -> preflight external dependencies
  -> execute model / tool / side effect -> validate output -> return result and diagnostics
```

A validation failure names the field, the violated rule, and how to repair it. A warning lets sibling branches continue, but the workflow still fails when an execution wave contains no successful node.

### Standalone adapter

Whatever its form — HTTP API, CLI, dedicated page, or the host's single-node run — it must:

- reuse the same input model and validators as workflow execution;
- avoid fixed upstream node IDs, canvas positions, and hidden global state;
- expose configuration, input, output-validation, and infrastructure failures independently;
- set node-owned timeout, size, permission, file, network, model, and process boundaries;
- produce output a person can use directly and a workflow adapter can serialize;
- document logs, assets, and cleanup policy in `NODE.md`.

The workflow adapter only maps inputs and injects run context; it never changes the node's domain decisions. The same effective input must produce the same auditable result in both modes.

### Node scripts and capability discovery

Long renders, browser capture, and other work that should not block a Worker may ship as node-owned executables. The host discovers them by capability, not by node type:

```ts
import { nodePluginHasCapability, nodePluginScript } from './plugins.ts';

const videoNode = [...run.nodes].reverse()
  .find((node) => nodePluginHasCapability(node.nodeType, 'video-spec') && node.output);

const scriptPath = nodePluginScript(videoNode.nodeType, 'render-video.sh');
if (!scriptPath) return res.status(400).json({ error: 'That node ships no render-video.sh' });
```

- the script name must be a bare file name; path separators and leading `.` are rejected;
- the resolved path must be a regular file inside the node directory; a missing script is a normal absence of capability;
- the host never hard-codes a node type and asks only which installed node provides a capability;
- the host passes only host-owned context — run ID, base URL, target asset path — with every shell argument quoted;
- exit status is the contract: `0` means the artifact exists at the requested location.

`nodes/app-video-render/render-video.sh` is the current example; it validates arguments and preflights `node`, `curl`, and `ffmpeg` before fetching the run specification.

### Split quality gate

Answer before adding or splitting a node:

- Does it produce one independently useful result, stated in one sentence?
- Can its input and output be expressed as a testable contract?
- Can it run without a complete workflow?
- Does it validate input and output at its own boundary?
- Does it have an independent failure, retry, resource, or permission boundary?
- Does the split enable real parallelism, independent auditing, or reuse?
- Is it merely separating a prompt, validator, or trivial transformation from the same stage? **If yes, merge instead of adding a node.**

## Workflow Design

### Responsibility

A workflow is a directed acyclic graph expressing order, parallelism, and joins. It never redefines node business rules. Edges carry data only — they are not conditions, routers, or business-rule containers; a receiving node makes any conditional decision from input it has validated.

A workflow may select node configuration, workflow-owned prompt variants, and a run schedule, but cannot bypass the node contract. Prompt files stay inside the workflow definition directory and cannot escape it; they specialize a scenario while the node remains the final authority on accepted output.

### Files

```text
workflows/<workflow-id>/
  workflow.json       required graph definition
  schedule.json       optional cron schedule, created on first save
  prompts/            optional workflow-owned prompt and validation files
    *.system.md  *.prompt.md  *.repair.md  *.validate.js
```

A minimal valid graph definition:

```json
{
  "id": "wf-260802-093000",
  "name": "My Workflow",
  "description": "What this workflow does",
  "icon": "Workflow",
  "color": "#1e293b",
  "laneLabels": ["Research", "Generation"],
  "nodes": [
    { "id": "node-abc1234", "type": "content-brief", "title": "Research Brief",
      "lane": "Research", "x": 400, "y": 200,
      "config": { "topic": "...", "audience": "..." } },
    { "id": "node-def5678", "type": "clip-storyboard", "title": "Storyboard",
      "lane": "Generation", "x": 760, "y": 200, "config": {} }
  ],
  "edges": [
    { "id": "edge-nodeA-nodeB", "fromNodeId": "node-abc1234", "toNodeId": "node-def5678" }
  ]
}
```

### Execution semantics

A node becomes ready after all direct parents finish, whatever their status. All ready nodes in the same dependency wave run concurrently.

| Status | Meaning |
| --- | --- |
| `success` | The node produced a result accepted by its own contract. |
| `warning` | The node found an input or output-contract problem and left actionable diagnostics. |
| `error` | Execution or infrastructure failed. |

A failed branch never cancels sibling branches — this supports one-to-many fan-out without putting conditions on edges. The workflow stops as failed only when a wave contains no `success` node. Cyclic graphs are rejected before execution. The editor's **Stop** action terminates the server-side Worker; disconnecting the browser does not stop a run.

### Edge data protocol

Edges carry text in an object keyed by upstream node ID:

```text
{}                                 no upstream input
{ "source-id": "text" }            one upstream node
{ "a": "text A", "b": "text B" }   multiple upstream nodes
```

The host does not parse this content. The receiving node merges, parses, validates, and interprets it.

### Constraints

- **Node count is bounded.** Default maximum 10, configurable with `MAX_FLOW_NODES` in `.env`. Raising it requires a real capability boundary.
- **Only installed node types are valid.** Every `type` must match a discovered plugin; unknown types fail at execution.
- **IDs are opaque.** Generated internally, matching `^[A-Za-z0-9._-]+$`, and must not contain `..` as a path-traversal guard.
- **Lane is required.** The host normalizes it to a canvas column and snaps `x/y` on load and save.
- **Schedules have a fixed shape.** `{ enabled, cron, timezone }`; cron is validated with node-cron, timezone must be a valid IANA identifier, and overlapping scheduled runs of the same workflow are skipped.
- **Edges depend on real contracts.** Connect nodes only after their contracts are stable, and never use the graph to hide missing node input validation.

### A lean example

`workflows/app-launch-video/` keeps only genuine boundaries — content contract, storyboard generation, narration measurement, Demo UI generation, and video rendering — each independently validatable and runnable:

```text
content-brief -> clip-storyboard
                   |-> edge-tts-narration --\
                   \-> ui-html-generation --+-> app-video-render
```

| Type | Independent responsibility |
| --- | --- |
| [`content-brief`](../nodes/content-brief/NODE.md) | Validate the editorial contract and evidence boundary without a model call. |
| [`clip-storyboard`](../nodes/clip-storyboard/NODE.md) | Convert a brief into validated clip JSON, reusable structures, and narration anchors. |
| [`ui-html-generation`](../nodes/ui-html-generation/NODE.md) | Generate and independently validate offline HTML for each Demo UI target. |
| [`edge-tts-narration`](../nodes/edge-tts-narration/NODE.md) | Convert clip narration to MP3 and measure the shot timeline. |
| [`app-video-render`](../nodes/app-video-render/NODE.md) | Join timeline, narration, and Demo UI into preview and MP4 preparation; ships `render-video.sh`. |

`clip-storyboard` invents no duration values and generates no HTML — it marks visual cuts with `**anchors**` in narration. `edge-tts-narration` resolves those anchors against real word boundaries, and `ui-html-generation` validates each offline HTML document independently. Reusable structures such as process strips and comparison tables are declared once and referenced by clips instead of being regenerated per node.

The MP4 path requires local `ffmpeg` and a Chromium-family browser. `EDGE_TTS_PROXY` and `EDGE_TTS_DISABLE_PROXY` control narration network routing.

## Checklist

1. The node runs independently against valid, empty, boundary, and invalid input.
2. It validates input before expensive work and validates output before returning it.
3. `NODE.md` documents configuration, input, output, resources, side effects, and failure behavior.
4. The workflow expresses only dependencies and parallelism — no business rules in edges or host code.
5. The same result cannot be expressed with fewer nodes without losing a real audit or execution boundary.
6. Run history contains enough detail to diagnose warnings, errors, retries, and generated assets.

If a node cannot pass standalone execution and input validation, workflow design has not started yet.
