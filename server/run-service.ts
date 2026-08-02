import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type {
  RunEvent,
  RunNodeRecord,
  RunRecord,
  RunTrigger,
  WorkflowItem,
} from "../App/types";
import * as storage from "./storage";
import * as store from "./db";
import { topoOrder, type ExecutionResult } from "./engine";
import { getNodePlugin } from "./plugins";
import { assertFlowNodeLimit } from "./workflow-policy";
import { makeRunId } from "./run-id";

type WorkerMessage =
  | { type: "event"; event: RunEvent }
  | { type: "result"; result: ExecutionResult }
  | { type: "fatal"; error: string };

export type RunEventListener = (event: RunEvent) => void;

export interface WorkflowRunJob {
  id: string;
  workflowId: string;
  trigger: Exclude<RunTrigger, "single">;
  startedAt: string;
  status: "running" | "success" | "error";
  finishedAt?: string;
  done: Promise<RunRecord>;
  subscribe(listener: RunEventListener): () => void;
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

class WorkflowRunJobImpl implements WorkflowRunJob {
  readonly id = makeRunId();
  readonly workflowId: string;
  readonly trigger: Exclude<RunTrigger, "single">;
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

  constructor(workflow: WorkflowItem, trigger: Exclude<RunTrigger, "single">) {
    this.workflow = structuredClone(workflow);
    this.workflowId = workflow.id;
    this.trigger = trigger;
    this.done = new Promise<RunRecord>((resolve) => {
      this.resolveDone = resolve;
    });

    this.emit({
      type: "run-start",
      runId: this.id,
      order: topoOrder(this.workflow.nodes, this.workflow.edges),
    });
    this.startWorker();
  }

  subscribe(listener: RunEventListener): () => void {
    for (const event of this.events) listener(event);
    if (!this.settled) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): boolean {
    if (this.settled) return false;
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
          workflow: this.workflow,
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
  assertWorkflowPluginsAvailable(workflow);
  const job = new WorkflowRunJobImpl(workflow, trigger);
  jobs.set(job.id, job);
  return job;
}

export function getWorkflowRunJob(runId: string): WorkflowRunJob | undefined {
  return jobs.get(runId);
}
