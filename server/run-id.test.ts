import assert from "node:assert/strict";
import test from "node:test";
import { makeRunId } from "./run-id";

test("run ids use a local timestamp plus a collision-resistant suffix", () => {
  const date = new Date(2026, 7, 2, 15, 4, 9);
  assert.match(makeRunId(date), /^260802150409-[0-9a-f]{8}$/);
  assert.notEqual(makeRunId(date), makeRunId(date));
});
