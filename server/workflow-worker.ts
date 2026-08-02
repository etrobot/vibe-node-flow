import "dotenv/config";
import { parentPort, workerData } from "node:worker_threads";
import type { WorkflowItem, RunEvent } from "../App/types";
import { executeWorkflow } from "./engine.ts";
import { loadNodePlugins } from "./plugins.ts";

interface WorkflowWorkerData {
  projectRoot: string;
  workflow: WorkflowItem;
}

type WorkflowWorkerMessage =
  | { type: "event"; event: RunEvent }
  | { type: "result"; result: Awaited<ReturnType<typeof executeWorkflow>> }
  | { type: "fatal"; error: string };

if (!parentPort) {
  throw new Error("workflow-worker.ts can only be started by Worker");
}

const port = parentPort;

async function main(): Promise<void> {
  const data = workerData as WorkflowWorkerData;
  await loadNodePlugins(data.projectRoot, { log: false });
  const result = await executeWorkflow(data.workflow, (event) => {
    port.postMessage({ type: "event", event } satisfies WorkflowWorkerMessage);
  });
  port.postMessage({ type: "result", result } satisfies WorkflowWorkerMessage);
}

main()
  .catch((error) => {
    port.postMessage({
      type: "fatal",
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkflowWorkerMessage);
  })
  .finally(() => port.close());
