import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import type { WorkflowSchedule } from "../App/types";
import { workflowDir, workflowScheduleFile } from "./paths";

export const DEFAULT_WORKFLOW_CRON = "0 9 * * *";

export function serverTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultWorkflowSchedule(): WorkflowSchedule {
  return {
    enabled: false,
    cron: DEFAULT_WORKFLOW_CRON,
    timezone: serverTimezone(),
  };
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

export function normalizeWorkflowSchedule(
  value: unknown,
  fallback: WorkflowSchedule = defaultWorkflowSchedule(),
): WorkflowSchedule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Schedule config must be a JSON object");
  }

  const input = value as Partial<WorkflowSchedule>;
  const enabled = input.enabled ?? fallback.enabled;
  const expression = input.cron ?? fallback.cron;
  const timezone = input.timezone ?? fallback.timezone;

  if (typeof enabled !== "boolean") {
    throw new Error("Schedule config enabled must be boolean");
  }
  if (typeof expression !== "string" || !expression.trim()) {
    throw new Error("Schedule config cron cannot be empty");
  }
  if (!cron.validate(expression.trim())) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  if (typeof timezone !== "string" || !timezone.trim()) {
    throw new Error("Schedule config timezone cannot be empty");
  }
  assertTimezone(timezone.trim());

  return {
    enabled,
    cron: expression.trim().replace(/\s+/g, " "),
    timezone: timezone.trim(),
  };
}

function writeScheduleFile(workflowId: string, schedule: WorkflowSchedule): void {
  const dir = workflowDir(workflowId);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error("Workflow not found");
  }

  const file = workflowScheduleFile(workflowId);
  const temporary = path.join(
    dir,
    `.schedule-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(schedule, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

export function readWorkflowSchedule(workflowId: string): WorkflowSchedule {
  const file = workflowScheduleFile(workflowId);
  if (!fs.existsSync(file)) return defaultWorkflowSchedule();

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read schedule.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return normalizeWorkflowSchedule(parsed);
}

export function ensureWorkflowScheduleFile(workflowId: string): WorkflowSchedule {
  const file = workflowScheduleFile(workflowId);
  if (fs.existsSync(file)) return readWorkflowSchedule(workflowId);
  const schedule = defaultWorkflowSchedule();
  writeScheduleFile(workflowId, schedule);
  return schedule;
}

export function saveWorkflowSchedule(
  workflowId: string,
  value: unknown,
): WorkflowSchedule {
  const schedule = normalizeWorkflowSchedule(value);
  writeScheduleFile(workflowId, schedule);
  return schedule;
}
