# Node-First Node and Workflow Design

This document is the design reference for VibeNodeFlow. It separates node design from workflow design and defines their order: **build complete, validated, independently useful nodes first; compose those nodes into workflows second.**

A workflow is the composition layer, not the home of business logic. A node is a capability unit, not a placeholder on a canvas.

## Core Principles

### 1. Node Design Comes First

For every new requirement, first ask, "What node capability should exist?" Only after that should you ask, "How should the nodes be connected?"

Before a node enters a workflow, it must have:

- one clear responsibility;
- readable input, output, and side-effect contracts;
- configuration, input, and output validation;
- actionable success, warning, and error diagnostics;
- core logic that does not depend on one specific workflow graph.

Designing the node first makes the capability independently testable and reusable. The workflow can then stay focused on dependencies instead of accumulating domain rules in edges, canvas state, or host code.

### 2. Prefer Fewer, Better Nodes

Node count is not capability count. Prefer a small set of complete, well-bounded, reliable nodes over many thin nodes that only forward strings.

Split a node only at a real boundary:

- a different role or owner;
- work that can run in parallel, retry independently, or scale independently;
- a different model, tool, permission set, or runtime environment;
- an output contract that must be audited, accepted, or persisted independently.

The following are not sufficient reasons to create a node: shortening a source file, moving one prompt into its own box, separating validation from repair for the same stage, or wrapping a trivial format conversion. Keep one generation stage's prompt, validator, repair instructions, and quality thresholds together.

### 3. Every Node Owns Input Validation

Input validation belongs to the receiving node, not to the host or a central schema registry. Data moves through `upstream output -> edge -> receiving node`, and the receiving node is the sole authority on whether that input is acceptable.

Validation should happen before expensive work and should cover at least:

1. configuration shape and value ranges;
2. input presence and parsing;
3. domain semantics, required fields, counts, and references;
4. external tools, credentials, files, and runtime prerequisites;
5. the node's own output contract.

Use the runtime error types to express contract failures:

- `NodeInputError`: upstream input or node configuration is unacceptable; recorded as `warning` with a repairable explanation;
- `NodeValidationError`: the node's result violates its own contract; recorded as `warning`;
- plain `Error`: execution or infrastructure failure; recorded as `error`.

**Raw LLM nodes are forbidden.** A generative node must never pass unvalidated model output downstream. It owns parsing, deterministic validation, and a bounded repair loop. When repair is exhausted, it reports the complete issue list and attempt log.

### 4. Every Node Has Two Application-Grade Capabilities

The same node must support two modes without duplicating its business logic:

| Capability | Requirement |
| --- | --- |
| Standalone application capability | Given explicit configuration and input, the capability can run with its own validation, output, errors, logs, resources, and side-effect boundary. It may be exposed through an API, CLI, dedicated page, or single-node run. |
| Workflow node capability | The capability can accept upstream workflow input, follow the text edge protocol, return node status and output, consume run context, and participate in DAG dependency waves, assets, and history. |

Both modes must share the same domain core and validators. Only the boundary adapter should differ. Do not maintain separate business implementations for "standalone application" and "workflow node" use.

If a capability has no useful meaning outside its parent node, keep it as an internal module instead of creating another node. The current single-node run path is the minimum implementation of standalone use. If a full end-user application is needed, its entry point belongs to the node directory rather than in host business logic.

## Design Order: From Node to Workflow

Deliver new capabilities in this order:

1. **Define the result.** Describe what the user should receive and what makes that result acceptable.
2. **Set the node boundary.** Define input, output, resources, permissions, failure modes, and the standalone entry point.
3. **Implement the node core.** Keep parsing, domain logic, input/output validation, and diagnostics inside the node directory.
4. **Prove standalone execution first.** Test valid, invalid, empty, and boundary input without relying on a complete workflow.
5. **Add the host adapters.** Provide the `server.ts` plugin adapter and the `client.tsx` editing and observation UI. The host remains responsible only for orchestration and persistence.
6. **Compose the workflow.** Decide dependencies, parallel branches, and joins only after node contracts are stable.
7. **Validate the graph.** Check cycles, installed types, node count, input reachability, failed branches, and resource lifecycles.

## Node Design

### Responsibility Boundary

A node owns every decision specific to its capability:

- configuration and defaults;
- input parsing, semantic validation, and missing-input behavior;
- business logic, model calls, external tools, and retries;
- output shape, output validation, and actionable diagnostics;
- its own editing, preview, and run-state UI;
- any executable that the host may launch for it;
- its asset and run-output path rules.

The host discovers plugins, checks graph structure, schedules execution, persists run history, and serves diagnostics. It does not parse domain JSON, prompts, or business schemas, and it does not decide whether node input is valid.

```text
standalone entry point --\
                         +--> node domain core --> output / diagnostics / assets
workflow adapter -------/

host: discover plugins -> validate DAG -> schedule dependency waves -> persist runs
edge: carry data only; never own conditions, routing, or business rules
```

### Node Directory and Contract

Each node is a removable and distributable directory under `nodes/<name>/`:

```text
nodes/<name>/
  node.json       node type and discovery metadata
  client.tsx      editor, preview, and run-observation UI
  server.ts       server-side execution plugin
  NODE.md         contract, configuration, and failure documentation
  <script>        optional node-owned executable
```

`node.json`, `client.tsx`, and `server.ts` must declare the same globally unique `type`, matching `^[A-Za-z0-9][A-Za-z0-9._:/-]*$`. The directory name is used only for discovery. Directories beginning with `.` or `_` are ignored.

Adding a node means adding this directory and keeping the three `type` declarations consistent. A node must not require changes to the host `package.json`, build configuration, or source code. Deleting the directory removes the node. Restart `npm run dev` to rediscover plugins during development.

The client owns editing and presentation, never secrets or server behavior. `client.tsx` default-exports a `NodeModule`:

```tsx
import type { NodeModule } from '@/App/types.node-module';

export default {
  type: 'acme.uppercase',
  label: 'Uppercase',
  icon: 'CaseUpper',
  createConfig: () => ({ prefix: '' }),
} satisfies NodeModule;
```

The server default-exports `{ type, execute }`. `execute` receives the current node, upstream text input, accepted previous outputs, workflow identity, and asset directories. It returns `{ output, logs? }` and may return a diagnostic `warning` result:

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

Structured values are serialized before crossing an edge. Prefer string outputs where practical, and keep parsing and contract validation inside the receiving node.

### Validation Placement and Order

`execute` must accept explicit input without depending on a fixed upstream node and must return a clear success, warning, or error result. The recommended order is:

```text
read configuration
  -> parse input
  -> validate required values and types
  -> validate domain constraints and references
  -> preflight external dependencies
  -> execute model / tool / side effect
  -> validate output
  -> return result and diagnostics
```

A validation failure should identify the field, the violated rule, and how to repair it. A warning allows sibling branches to continue, but the workflow still fails when an execution wave contains no successful node.

### Standalone Application Adapter

A standalone entry point may be an HTTP API, CLI, dedicated page, or the host's single-node run interface. Regardless of form, it must:

- reuse the same input model and validators as workflow execution;
- avoid fixed upstream node IDs, canvas positions, or hidden global state;
- expose configuration, input, output-validation, and infrastructure failures independently;
- set node-owned timeout, size, permission, file, network, model, and process boundaries;
- produce output that a person can use directly and a workflow adapter can serialize;
- make logs, assets, and cleanup policy traceable in `NODE.md`.

The workflow adapter should only map inputs and inject run context. It must not change the node's domain decisions. Standalone and workflow calls must therefore produce the same auditable result for the same effective input.

### Node Scripts and Capability Discovery

Long renders, browser capture, and other work that should not block a Worker may be shipped as node-owned executables. The host discovers them by capability instead of declaring commands for nodes in its own `package.json`:

```ts
import { nodePluginHasCapability, nodePluginScript } from './plugins.ts';

const videoNode = [...run.nodes].reverse()
  .find((node) => nodePluginHasCapability(node.nodeType, 'video-spec') && node.output);

const scriptPath = nodePluginScript(videoNode.nodeType, 'render-video.sh');
if (!scriptPath) return res.status(400).json({ error: 'That node ships no render-video.sh' });
```

The rules are:

- the script name must be a bare file name; path separators and names beginning with `.` are rejected;
- the resolved path must be a regular file inside the node directory; a missing script is a normal absence of capability;
- the host never hard-codes a node type and asks only which installed node provides a capability;
- the host passes only host-owned context, such as run ID, base URL, and target asset path, with every shell argument quoted;
- exit status is the contract: `0` means the artifact exists at the requested location.

`nodes/app-video-render/render-video.sh` is the current example. It validates arguments and preflights `node`, `curl`, and `ffmpeg` before fetching the run specification.

### Node Split Quality Gate

Before adding or splitting a node, answer each question:

- Does it produce one independently useful result that can be stated in one sentence?
- Can its input and output be expressed as a testable contract?
- Can it run without a complete workflow?
- Does it validate input and output at its own boundary?
- Does it have an independent failure, retry, resource, or permission boundary?
- Does the split enable real parallelism, independent auditing, or reuse?
- Is the proposed node merely separating a prompt, validator, or trivial transformation from the same stage?

If the last answer is yes, merge the responsibility instead of adding a node.

## Workflow Design

### Workflow Responsibility

A workflow is a directed acyclic graph of nodes. It expresses order, parallelism, and joins. It does not redefine node business rules.

Edges carry data only. They are not conditions, routers, or business-rule containers. A receiving node makes any conditional decision from input it has validated.

A workflow may select node configuration, workflow-owned prompt variants, and a run schedule, but it cannot bypass the node contract. Prompt files remain inside the workflow definition directory and cannot escape it. They may specialize a scenario, while the node remains the final authority on accepted output.

### Workflow Files

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
    {
      "id": "node-abc1234",
      "type": "content-brief",
      "title": "Research Brief",
      "lane": "Research",
      "x": 400,
      "y": 200,
      "config": { "topic": "...", "audience": "..." }
    },
    {
      "id": "node-def5678",
      "type": "clip-storyboard",
      "title": "Storyboard",
      "lane": "Generation",
      "x": 760,
      "y": 200,
      "config": {}
    }
  ],
  "edges": [{
    "id": "edge-nodeA-nodeB",
    "fromNodeId": "node-abc1234",
    "toNodeId": "node-def5678"
  }]
}
```

### Graph and Execution Semantics

A node becomes ready after all direct parents finish, regardless of whether each parent ended in `success`, `warning`, or `error`. All ready nodes in the same dependency wave run concurrently.

| Status | Meaning |
| --- | --- |
| `success` | The node produced a result accepted by its own contract. |
| `warning` | The node found an input or output-contract problem and left actionable diagnostics. |
| `error` | Execution or infrastructure failed. |

A failed branch does not cancel sibling branches. This supports one-to-many fan-out without putting conditions on edges. The workflow stops as failed only when a wave contains no `success` node. Cyclic graphs are rejected before execution.

The editor's **Stop** action terminates the server-side Worker. Disconnecting the browser does not stop a run.

### Edge Data Protocol

Edges carry text in an object keyed by upstream node ID:

```text
{}                                 no upstream input
{ "source-id": "text" }            one upstream node
{ "a": "text A", "b": "text B" }   multiple upstream nodes
```

The host does not parse this content. The receiving node merges, parses, validates, and interprets it. Structured values are serialized to text before crossing an edge.

### Workflow Constraints

- **Node count is bounded.** The default maximum is 10, configurable with `MAX_FLOW_NODES` in `.env`. Increasing the count requires a real capability boundary.
- **Only installed node types are valid.** Every `type` must match a discovered plugin; unknown types fail at execution.
- **IDs are opaque.** Node and edge IDs are generated internally, match `^[A-Za-z0-9._-]+$`, and must not contain `..` as a path-traversal guard.
- **Lane is required.** Every node declares a lane. The host normalizes it to a canvas column and snaps `x/y` on load and save.
- **Schedules have a fixed shape.** `schedule.json` stores `{ enabled, cron, timezone }`. Cron is validated with node-cron, timezone must be a valid IANA identifier, and overlapping scheduled runs of the same workflow are skipped.
- **Edges depend on real contracts.** Connect nodes only after their contracts are stable. Never use the workflow graph to hide missing node input validation.

### A Lean Example

`workflows/app-launch-video/` uses five nodes:

```text
content-brief
  -> clip-storyboard
      |-> edge-tts-narration --\
      \-> ui-html-generation --+-> app-video-render
```

The graph keeps only genuine boundaries: content contract, storyboard generation, narration measurement, Demo UI generation, and video rendering can each be validated or run independently.

`clip-storyboard` does not invent duration values and does not generate HTML. It marks visual cuts with `**anchors**` in narration. `edge-tts-narration` resolves those anchors against real word boundaries, while `ui-html-generation` independently validates each offline HTML document. Reusable structures such as process strips and comparison tables are declared once and referenced by clips instead of being regenerated in multiple nodes.

Installed nodes:

| Type | Independent responsibility |
| --- | --- |
| [`content-brief`](../nodes/content-brief/NODE.md) | Validate the editorial contract and evidence boundary without a model call. |
| [`clip-storyboard`](../nodes/clip-storyboard/NODE.md) | Convert a brief into validated clip JSON, reusable structures, and narration anchors. |
| [`ui-html-generation`](../nodes/ui-html-generation/NODE.md) | Generate and independently validate offline HTML for each Demo UI target. |
| [`edge-tts-narration`](../nodes/edge-tts-narration/NODE.md) | Convert clip narration to MP3 and measure the shot timeline. |
| [`app-video-render`](../nodes/app-video-render/NODE.md) | Join timeline, narration, and Demo UI into preview and MP4 preparation; ships `render-video.sh`. |

The MP4 path owned by `app-video-render` requires local `ffmpeg` and a Chromium-family browser. Its current script validates arguments, preflights the toolchain, and fetches the run specification before handing off frame capture. `EDGE_TTS_PROXY` and `EDGE_TTS_DISABLE_PROXY` control narration network routing.

## Implementation Checklist

Before submitting a node or workflow, verify that:

1. the node runs independently against valid, empty, boundary, and invalid input;
2. the node validates input before expensive work and validates output before returning it;
3. `NODE.md` documents configuration, input, output, resources, side effects, and failure behavior;
4. the workflow expresses only dependencies and parallelism, with no business rules in edges or host code;
5. the same result cannot be expressed with fewer nodes without losing a real audit or execution boundary;
6. run history contains enough detail to diagnose warnings, errors, retries, and generated assets.

If a node cannot pass standalone execution and input validation, workflow design has not started yet.
