import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  FlowNode,
  RunEvent,
  ActiveRunSnapshot,
  RunNodeRecord,
  RunRecord,
  RunTrigger,
  WorkflowItem,
} from "../App/types";
import type { NodeTextInput } from "../lib/node-io";
import * as storage from "./storage";
import * as store from "./db";
import { assertNoOverlappingEdges, topoOrder, type ExecutionResult } from "./engine";
import { getNodePlugin } from "./plugins";
import { assertFlowNodeLimit } from "./workflow-policy";
import { makeRunId } from "./run-id";

type WorkerMessage =
  | { type: "event"; event: RunEvent }
  | { type: "result"; result: ExecutionResult }
  | { type: "single-result"; record: RunNodeRecord }
  | { type: "fatal"; error: string };

export type RunEventListener = (event: RunEvent) => void;

export interface WorkflowRunJob {
  id: string;
  workflowId: string;
  trigger: RunTrigger;
  startedAt: string;
  status: "running" | "success" | "error";
  finishedAt?: string;
  done: Promise<RunRecord>;
  subscribe(listener: RunEventListener): () => void;
  snapshot(): ActiveRunSnapshot;
  stop(): boolean;
}

const jobs = new Map<string, WorkflowRunJobImpl>();
const completedJobRetentionMs = 10 * 60 * 1000;

function assertWorkflowPluginsAvailable(workflow: WorkflowItem): void {
  const unavailable = [
    ...new Set(
      workflow.nodes
        .map((node) => node.type)
        .filter((type) => !getNodePlugin(type)),
    ),
  ];
  if (unavailable.length) {
    throw new Error(`Node plugin not installed or data prep failed: ${unavailable.join(", ")}`);
  }
}

function resolveWorkerEntry(): { url: URL; bundled: boolean } {
  const builtEntry = path.join(process.cwd(), "dist/workflow-worker.mjs");
  const sourceEntry = path.join(process.cwd(), "server/workflow-worker.ts");
  const bundled = process.env.NODE_ENV === "production" && fs.existsSync(builtEntry);
  return {
    url: pathToFileURL(bundled ? builtEntry : sourceEntry),
    bundled,
  };
}

interface SingleNodeRequest {
  node: FlowNode;
  input: NodeTextInput;
  nodeOutputs: Record<string, string>;
}

class WorkflowRunJobImpl implements WorkflowRunJob {
  readonly id = makeRunId();
  readonly workflowId: string;
  readonly trigger: RunTrigger;
  readonly startedAt = new Date().toISOString();
  readonly done: Promise<RunRecord>;
  status: "running" | "success" | "error" = "running";
  finishedAt?: string;

  private readonly workflow: WorkflowItem;
  private readonly startedMs = Date.now();
  private readonly events: RunEvent[] = [];
  private readonly listeners = new Set<RunEventListener>();
  private readonly partialNodes: RunNodeRecord[] = [];
  private resolveDone!: (record: RunRecord) => void;
  private worker: Worker | null = null;
  private settled = false;
  private readonly singleNodeRequest?: SingleNodeRequest;

  constructor(workflow: WorkflowItem, trigger: RunTrigger, singleNodeRequest?: SingleNodeRequest) {
    this.workflow = structuredClone(workflow);
    this.workflowId = workflow.id;
    this.trigger = trigger;
    this.singleNodeRequest = singleNodeRequest;
    this.done = new Promise<RunRecord>((resolve) => {
      this.resolveDone = resolve;
    });

    this.emit({
      type: "run-start",
      runId: this.id,
      order: singleNodeRequest
        ? [singleNodeRequest.node.id]
        : topoOrder(this.workflow.nodes, this.workflow.edges),
    });
    this.startWorker();
  }

  subscribe(listener: RunEventListener): () => void {
    for (const event of this.events) listener(event);
    if (!this.settled) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): ActiveRunSnapshot {
    return {
      id: this.id,
      workflowId: this.workflowId,
      trigger: this.trigger,
      status: "running",
      startedAt: this.startedAt,
      events: [...this.events],
    };
  }

  stop(): boolean {
    if (this.settled) return false;
    if (this.singleNodeRequest) {
      this.emit({
        type: "node-finish",
        nodeId: this.singleNodeRequest.node.id,
        status: "error",
        error: "Node run stopped by user",
        executionTime: Date.now() - this.startedMs,
      });
    }
    this.emit({
      type: "node-finish",
      nodeId: "__engine__",
      status: "error",
      error: "Workflow stopped by user",
      executionTime: 0,
    });
    this.finish("error", this.partialNodes);
    return true;
  }

  private emit(event: RunEvent): void {
    this.events.push(event);
    if (event.type === "node-finish" && event.nodeId !== "__engine__") {
      const node = this.workflow.nodes.find((candidate) => candidate.id === event.nodeId);
      if (node) {
        this.partialNodes.push({
          nodeId: node.id,
          nodeTitle: node.title,
          nodeType: node.type,
          status: event.status,
          output: event.output ?? null,
          logs: event.logs || [],
          resourceAccesses: event.resourceAccesses || [],
          error: event.error ?? null,
          executionTime: event.executionTime,
        });
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Run event listener failed:", error);
      }
    }
  }

  private startWorker(): void {
    try {
      const entry = resolveWorkerEntry();
      this.worker = new Worker(entry.url, {
        workerData: {
          projectRoot: process.cwd(),
          ...(this.singleNodeRequest
            ? {
                mode: "single",
                node: this.singleNodeRequest.node,
                input: this.singleNodeRequest.input,
                nodeOutputs: this.singleNodeRequest.nodeOutputs,
                workflowId: this.workflow.id,
                reuseOverwriteGeneratedAssets: Boolean(
                  this.workflow.reuseOverwriteGeneratedAssets,
                ),
              }
            : {
                mode: "workflow",
                workflow: this.workflow,
              }),
          runId: this.id,
        },
        execArgv: entry.bundled ? [] : ["--import", "tsx"],
      });
    } catch (error) {
      this.finishWithError(error instanceof Error ? error.message : String(error));
      return;
    }

    this.worker.on("message", (message: WorkerMessage) => {
      if (message.type === "event") {
        this.emit(message.event);
      } else if (message.type === "result") {
        this.finish(message.result.status, message.result.nodes);
      } else if (message.type === "single-result") {
        this.finish(message.record.status === "error" ? "error" : "success", [message.record]);
      } else if (message.type === "fatal") {
        this.finishWithError(message.error);
      }
    });
    this.worker.on("error", (error) => this.finishWithError(error.message));
    this.worker.on("exit", (code) => {
      if (!this.settled && code !== 0) {
        this.finishWithError(`Workflow Worker exited unexpectedly (code ${code})`);
      } else if (!this.settled) {
        this.finishWithError("Workflow Worker did not return execution result");
      }
    });
  }

  private finishWithError(message: string): void {
    if (this.settled) return;
    this.emit({
      type: "node-finish",
      nodeId: "__engine__",
      status: "error",
      error: message || "Executor error",
      executionTime: 0,
    });
    this.finish("error", this.partialNodes);
  }

  private finish(status: "success" | "error", nodes: RunNodeRecord[]): void {
    if (this.settled) return;
    this.settled = true;
    this.status = status;
    this.finishedAt = new Date().toISOString();
    const record: RunRecord = {
      id: this.id,
      workflowId: this.workflow.id,
      workflowName: this.workflow.name,
      trigger: this.trigger,
      status,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: Date.now() - this.startedMs,
      nodes,
      workflowSnapshot: {
        nodes: this.workflow.nodes,
        edges: this.workflow.edges,
        reuseOverwriteGeneratedAssets: Boolean(
          this.workflow.reuseOverwriteGeneratedAssets,
        ),
      },
    };

    try {
      store.insertRun(record);
    } catch (error) {
      console.error("Failed to persist workflow run:", error);
    }

    this.emit({ type: "run-finish", runId: this.id, status });
    this.listeners.clear();
    this.resolveDone(record);
    if (this.worker) void this.worker.terminate().catch(() => undefined);

    const cleanup = setTimeout(() => jobs.delete(this.id), completedJobRetentionMs);
    cleanup.unref();
  }
}

/** Shared entry point for manual API runs and future schedule triggers. */
export function startWorkflowRun(
  workflowId: string,
  trigger: Exclude<RunTrigger, "single"> = "full",
): WorkflowRunJob {
  const workflow = storage.getWorkflow(workflowId);
  if (!workflow) throw new Error("Workflow not found");
  storage.ensureWorkflowAssets(workflowId);
  assertFlowNodeLimit(workflow.nodes);
  assertNoOverlappingEdges(workflow.nodes, workflow.edges);
  assertWorkflowPluginsAvailable(workflow);
  const job = new WorkflowRunJobImpl(workflow, trigger);
  jobs.set(job.id, job);
  return job;
}

/** Run one node in an isolated Worker, using the same lifecycle as a full run. */
export function startSingleNodeRun(
  workflowId: string,
  nodeId: string,
  input: NodeTextInput,
  nodeOutputs: Record<string, string>,
): WorkflowRunJob {
  const workflow = storage.getWorkflow(workflowId);
  if (!workflow) throw new Error("Workflow not found");
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error("Node not found");
  storage.ensureWorkflowAssets(workflowId);
  assertWorkflowPluginsAvailable({ ...workflow, nodes: [node] });
  const job = new WorkflowRunJobImpl(workflow, "single", {
    node: structuredClone(node),
    input: structuredClone(input),
    nodeOutputs: structuredClone(nodeOutputs),
  });
  jobs.set(job.id, job);
  return job;
}

export function getWorkflowRunJob(runId: string): WorkflowRunJob | undefined {
  return jobs.get(runId);
}

/** Return the newest still-running job for a workflow, if one exists. */
export function getActiveWorkflowRun(workflowId: string): ActiveRunSnapshot | undefined {
  return [...jobs.values()]
    .filter((job) => job.workflowId === workflowId && job.status === "running")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
    ?.snapshot();
}
