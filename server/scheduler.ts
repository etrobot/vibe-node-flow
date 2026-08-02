import cron, { type ScheduledTask } from "node-cron";
import type { WorkflowScheduleStatus } from "../App/types";
import * as storage from "./storage";
import { startWorkflowRun } from "./run-service";
import {
  ensureWorkflowScheduleFile,
  readWorkflowSchedule,
} from "./schedule-config";

const scheduledTasks = new Map<string, ScheduledTask>();
let started = false;

async function destroyTask(workflowId: string): Promise<void> {
  const existing = scheduledTasks.get(workflowId);
  scheduledTasks.delete(workflowId);
  if (existing) await existing.destroy();
}

export async function syncWorkflowSchedule(workflowId: string): Promise<void> {
  await destroyTask(workflowId);

  const workflow = storage.getWorkflow(workflowId);
  if (!workflow) return;
  storage.ensureWorkflowAssets(workflowId);
  const schedule = ensureWorkflowScheduleFile(workflowId);
  if (!schedule.enabled) return;

  const task = cron.schedule(
    schedule.cron,
    async (context) => {
      try {
        const job = startWorkflowRun(workflowId, "schedule");
        console.log(
          `[scheduler] ${workflowId} triggered ${job.id} at ${context.triggeredAt.toISOString()}`,
        );
        const result = await job.done;
        console.log(
          `[scheduler] ${workflowId} finished ${result.id} with ${result.status}`,
        );
      } catch (error) {
        console.error(
          `[scheduler] ${workflowId} failed to start:`,
          error instanceof Error ? error.message : error,
        );
      }
    },
    {
      name: `workflow:${workflowId}`,
      timezone: schedule.timezone,
      noOverlap: true,
      unref: true,
    },
  );
  task.on("execution:overlap", () => {
    console.warn(`[scheduler] ${workflowId} skipped because its previous run is still active`);
  });
  scheduledTasks.set(workflowId, task);
}

export async function startWorkflowScheduler(): Promise<void> {
  if (started) return;
  started = true;

  let registered = 0;
  for (const workflow of storage.listWorkflows()) {
    try {
      storage.ensureWorkflowAssets(workflow.id);
      await syncWorkflowSchedule(workflow.id);
      if (scheduledTasks.has(workflow.id)) registered += 1;
    } catch (error) {
      console.error(
        `[scheduler] unable to load ${workflow.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  console.log(`[scheduler] ready with ${registered} enabled workflow schedule(s)`);
}

export async function removeWorkflowSchedule(workflowId: string): Promise<void> {
  await destroyTask(workflowId);
}

export function getWorkflowScheduleStatus(workflowId: string): WorkflowScheduleStatus {
  const schedule = readWorkflowSchedule(workflowId);
  const nextRun = scheduledTasks.get(workflowId)?.getNextRun() ?? null;
  return {
    ...schedule,
    nextRunAt: nextRun?.toISOString() ?? null,
  };
}

export async function stopWorkflowScheduler(): Promise<void> {
  const tasks = [...scheduledTasks.values()];
  scheduledTasks.clear();
  started = false;
  await Promise.all(tasks.map((task) => task.destroy()));
}
