import assert from "node:assert/strict";
import test from "node:test";
import { runScript } from "./node-runtime.ts";

test("runScript interrupts a Promise that never settles", async () => {
  await assert.rejects(
    runScript("await new Promise(() => {});", "", {}, "", 10),
    /execution timed out after 10ms/,
  );
});

