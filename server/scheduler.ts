import cron, { type ScheduledTask } from "node-cron";
import type { RunRecord, WorkflowScheduleStatus } from "../App/types";
import * as storage from "./storage";
import { getActiveFullWorkflowRun, startWorkflowRun } from "./run-service";
import {
  ensureWorkflowScheduleFile,
  readWorkflowSchedule,
} from "./schedule-config";
import { sendTelegramMessage } from "./telegram";

const scheduledTasks = new Map<string, ScheduledTask>();
let started = false;

function summarizeRunFailure(result: RunRecord): string {
  const failures = result.nodes
    .filter((node) => node.status === "error" || node.status === "warning")
    .map((node) => `${node.nodeTitle}: ${node.error || "failed without an error message"}`);
  return failures.length ? failures.join("\n") : "The workflow executor returned an error without node details.";
}

async function notifyCronFailure(
  workflowId: string,
  workflowName: string,
  runId: string | undefined,
  reason: string,
): Promise<void> {
  console.warn(
    `[scheduler] ${workflowId} cron run failed${runId ? ` (run ${runId})` : ""}: ${reason}`,
  );

  const message = [
    "⚠️ Cron workflow failed",
    `Workflow: ${workflowName} (${workflowId})`,
    ...(runId ? [`Run: ${runId}`] : []),
    `Time: ${new Date().toISOString()}`,
    `Error: ${reason}`,
  ].join("\n");

  try {
    if (await sendTelegramMessage(message)) {
      console.log(`[scheduler] Telegram failure notification sent for ${workflowId}`);
    }
  } catch (error) {
    console.error(
      `[scheduler] Telegram failure notification could not be sent for ${workflowId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

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
      const active = getActiveFullWorkflowRun(workflowId);
      if (active) {
        console.warn(
          `[scheduler] ${workflowId} skipped scheduled trigger at ${context.triggeredAt.toISOString()} because run ${active.id} is still active (trigger: ${active.trigger})`,
        );
        return;
      }

      try {
        const job = startWorkflowRun(workflowId, "schedule");
        console.log(
          `[scheduler] ${workflowId} triggered ${job.id} at ${context.triggeredAt.toISOString()}`,
        );
        const result = await job.done;
        console.log(
          `[scheduler] ${workflowId} finished ${result.id} with ${result.status}`,
        );
        if (result.status === "error") {
          await notifyCronFailure(
            workflowId,
            workflow.name,
            result.id,
            summarizeRunFailure(result),
          );
        }
      } catch (error) {
        await notifyCronFailure(
          workflowId,
          workflow.name,
          undefined,
          error instanceof Error ? error.message : String(error),
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
