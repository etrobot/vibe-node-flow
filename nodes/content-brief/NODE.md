# Content Brief

## Design

`content-brief` is the evidence boundary for a workflow. It combines structured editorial requirements with optional upstream research results, then emits one deterministic Markdown brief before any model call is made.

The node is intentionally not generative: it validates that the topic, audience, objective, thesis, delivery constraints, factual boundaries, required points, forbidden claims, and at least two source URLs are present. This keeps downstream generation grounded in an explicit contract.

## Input And Output

- Input: optional source-linked research text keyed by upstream node id.
- Output: Markdown containing the normalized content brief, verified source notes, and optional supplemental research.
- Side effects: none.

## Configuration

The editor owns the topic, audience, objective, central thesis, language, target duration, source notes, factual boundaries, required points, and forbidden claims. The target duration must be between 30 and 900 seconds.

## Failure Behavior

The node reports a warning (`⚠️`) immediately when a required field is missing, the duration is invalid, or fewer than two distinct HTTP(S) source URLs are provided. It does not fill gaps or infer unsupported facts. Other branches can continue when at least one node in the same execution wave succeeds; if every node in that wave warns or fails, the workflow stops.
