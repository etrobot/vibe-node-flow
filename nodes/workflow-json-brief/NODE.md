# Workflow JSON Brief

## Design

workflow-json-brief is the evidence boundary for workflow explainer videos. It reads one Genno workflow.json, validates the graph as a DAG, derives dependency waves and graph roles, redacts sensitive configuration, emits a deterministic Markdown brief, and can append one evidence-grounded LLM opening narration for the downstream storyboard. It does not execute the source workflow.

The brief contains both a human-readable node-by-node explanation source and a machine-readable graph. Downstream storyboard and Demo UI nodes can therefore narrate the workflow and draw its real nodes and edges without inventing structure.

## Input And Output

- Input: normally none; the configured sourceWorkflowPath is used.
- Manual/single-node override: one workspace-relative path, raw workflow JSON, or JSON containing sourceWorkflowPath, workflowPath, or path.
- Output: a compact storyboard context with source identity, graph scale, execution waves, concise node evidence, Mermaid material IDs, and the exact machine graph. The core builder also exposes the full deterministic Markdown for diagnostics/tests, but it is not sent across the workflow edge.
- Side effects: reads files inside the project root only. It writes nothing and does not run the source workflow.

## Configuration

- sourceWorkflowPath — required path relative to the project root. Absolute paths are accepted only when they resolve inside the same root; symlink escapes are rejected.
- targetLanguage, targetAudience, targetDurationSeconds, explanationFocus — delivery contract copied into the brief.
- Opening narration is not generated here. This node remains a deterministic evidence boundary; `clip-storyboard` generates the narration and all visual beats together in one storyboard JSON response.
- includeNodeDocs — when enabled, looks up each unique node type in the source bundle's nodes directory first, then the current project's nodes directory.
- includeNodeConfig — includes a bounded configuration summary.
- maxWorkflowBytes, maxNodeDocChars, maxConfigValueChars — file and prompt-size boundaries.

Configuration keys resembling API keys, access/refresh tokens, passwords, secrets, authorization values, private keys, or credentials are replaced with [REDACTED]. Long strings and large collections are truncated explicitly.

## Validation

The node requires:

- workflow id, name, a non-empty nodes array, and an edges array;
- unique node and edge IDs;
- a type, title, lane, and object config for every node;
- real edge endpoints, no self-connections, and no duplicate connections;
- no more than 100 nodes or 500 edges;
- an acyclic graph.

The graph analyzer preserves source node order inside each execution wave and identifies entry nodes, terminal nodes, branches, joins, isolated nodes, and longest dependency depth.

## Failure Behavior

Missing, unreadable, oversized, out-of-root, or malformed source files are input warnings. Invalid node/edge contracts, dangling edges, duplicates, and cycles are validation warnings. Missing NODE.md files do not fail the node; the output records that only workflow titles, configuration, and graph structure may be used for that type.
