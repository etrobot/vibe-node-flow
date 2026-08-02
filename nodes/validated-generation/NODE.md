# Validated Generation

## Design

`validated-generation` is the workflow's controlled model boundary. It combines prompt rendering, one model request, workflow-owned JavaScript validation, deterministic quality checks, and bounded repair into one auditable node.

The node is configured for a stage rather than exposed as a raw LLM primitive. Its quality mode describes the contract being produced: evidence distillation, a confirmed script, or a video timeline specification.

## Input And Output

- Input: exactly one upstream text output, supplied as `{ "upstream-node-id": "text" }`.
- Output: the accepted model response, normally as text. Structured output is serialized when it crosses the next edge.
- Validation context: JavaScript receives the candidate as `input`, the direct upstream text as `$upstream`, and accepted earlier outputs as `$nodes`.

## Configuration

Prompts, validation code, repair instructions, and quality thresholds can be inline or loaded from files relative to the owning workflow definition. Supported quality modes provide stage-specific deterministic checks, word limits, visual requirements, and warning policy.

## Failure Behavior

The node reports missing, empty, or ambiguous upstream input as a warning (`⚠️`). A candidate that violates the JavaScript or quality contract is repaired up to five times after the initial generation. If the final candidate still fails, the node reports the collected validation errors as a warning; provider and runtime failures remain failed errors. The workflow continues only if another node in the same execution wave succeeds.
