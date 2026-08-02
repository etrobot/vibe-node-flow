import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkflowSchedule } from "./schedule-config";

test("normalizes a valid workflow schedule", () => {
  assert.deepEqual(
    normalizeWorkflowSchedule({
      enabled: true,
      cron: "0  9  * * *",
      timezone: "Asia/Shanghai",
    }),
    {
      enabled: true,
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
    },
  );
});

test("accepts node-cron six-field expressions", () => {
  assert.equal(
    normalizeWorkflowSchedule({
      enabled: true,
      cron: "*/5 * * * * *",
      timezone: "UTC",
    }).cron,
    "*/5 * * * * *",
  );
});

test("rejects invalid cron expressions and timezones", () => {
  assert.throws(
    () => normalizeWorkflowSchedule({ enabled: true, cron: "not-cron", timezone: "UTC" }),
    /cron/i,
  );
  assert.throws(
    () => normalizeWorkflowSchedule({ enabled: true, cron: "0 9 * * *", timezone: "Mars/Base" }),
    /timezone/,
  );
});
