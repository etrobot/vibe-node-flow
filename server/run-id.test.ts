import assert from "node:assert/strict";
import test from "node:test";
import { makeRunId } from "./run-id";

test("run ids use local YYMMDDHHMMSS numeric format", () => {
  const date = new Date(2026, 7, 2, 15, 4, 9);
  assert.equal(makeRunId(date), "260802150409");
  assert.match(makeRunId(date), /^\d{12}$/);
});
