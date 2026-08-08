import "dotenv/config";
import { parentPort, workerData } from "node:worker_threads";
import type { FlowNode, RunEvent, RunNodeRecord, WorkflowItem } from "../App/types";
import type { NodeTextInput } from "../lib/node-io.ts";
import { executeSingleNode, executeWorkflow } from "./engine.ts";
import { loadNodePlugins } from "./plugins.ts";

interface WorkflowWorkerData {
  mode?: "workflow";
  projectRoot: string;
  workflow: WorkflowItem;
  runId: string;
}

interface SingleNodeWorkerData {
  mode: "single";
  projectRoot: string;
  node: FlowNode;
  input: NodeTextInput;
  nodeOutputs: Record<string, string>;
  workflowId: string;
  runId: string;
  reuseOverwriteGeneratedAssets?: boolean;
}

type WorkflowWorkerMessage =
  | { type: "event"; event: RunEvent }
  | { type: "result"; result: Awaited<ReturnType<typeof executeWorkflow>> }
  | { type: "single-result"; record: RunNodeRecord }
  | { type: "fatal"; error: string };

if (!parentPort) {
  throw new Error("workflow-worker.ts can only be started by Worker");
}

const port = parentPort;

async function main(): Promise<void> {
  const data = workerData as WorkflowWorkerData | SingleNodeWorkerData;
  await loadNodePlugins(data.projectRoot, { log: false });

  if (data.mode === "single") {
    const record = await executeSingleNode(
      data.node,
      data.input,
      data.nodeOutputs,
      data.workflowId,
      data.runId,
      Boolean(data.reuseOverwriteGeneratedAssets),
    );
    port.postMessage({ type: "single-result", record } satisfies WorkflowWorkerMessage);
    return;
  }

  const result = await executeWorkflow(data.workflow, (event) => {
    port.postMessage({ type: "event", event } satisfies WorkflowWorkerMessage);
  }, data.runId);
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
