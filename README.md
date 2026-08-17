# Genno

A small visual workflow framework for AI applications. A workflow is a DAG of source-code nodes. The server owns execution, persistence, scheduling, and diagnostics.

> **Important:** Nodes and workflows are created and maintained by a Coding Agent. The browser UI is for observation and inspection only — users watch runs, review outputs, and diagnose issues through it. All authoring of nodes, edges, prompts, and validation logic is done by the agent writing source code under `nodes/` and `workflows/`.

<img width="3022" height="1708" alt="image" src="https://github.com/user-attachments/assets/1b5db451-d741-4294-8a9f-552ab8d5e566" />


## Design

Genno follows a node-first design: first build a small set of complete, independently useful and self-validating nodes; only then compose them into a workflow. A node must be usable both as an independent application capability and as a composable DAG node. The host orchestrates discovery, graph execution, persistence and diagnostics; edges carry data only.

The full contract and design rules are kept in one dedicated document:

[Node-First Node and Workflow Design](docs/node-and-workflow-design.md)

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

Produces `dist/genno`, a single binary bundling server and frontend, built with Node.js SEA. It defaults to port **39741** (uncommon, to avoid conflicts):

```sh
./dist/genno                # listens on 39741
PORT=8080 ./dist/genno      # listens on 8080
```

Prerequisites: Node.js ≥ 20 for `--experimental-sea-config`. On macOS, `codesign` re-signs the binary after blob injection.

## Documentation

- [Node-First Node and Workflow Design](docs/node-and-workflow-design.md) covers node-first delivery, fewer but stronger nodes, node-owned validation, standalone/workflow dual capability, and DAG composition rules.
- Every installed node directory includes a `NODE.md` describing its input, output, configuration, side effects, and failure behavior.

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
