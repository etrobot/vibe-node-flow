import fs from "node:fs";
import type {
  FlowNode,
  FlowEdge,
  WorkflowItem,
  RunNodeRecord,
  RunEvent,
} from "../App/types";
import {
  combineNodeInputs,
  nodeOutputToText,
  type NodeTextInput,
} from "../lib/node-io.ts";
import { getNodePlugin, isNodeWarning } from "./plugins.ts";
import {
  workflowAssetRoot,
  workflowDir as workflowDefinitionDir,
  workflowRunAssetsDir,
  nodeAssetsDir,
} from "./paths.ts";
import { makeRunId } from "./run-id.ts";
// Kept as a compatibility export for integrations that used the old engine
// helper. The actual sandbox now belongs to the extension runtime.
export { runScript } from "./node-runtime.ts";
export type { ScriptResult } from "./node-runtime.ts";

// --- graph execution ---------------------------------------------------------

/**
 * Topological execution order of nodes derived strictly from directed edge connections (DAG).
 *
 * Uses Kahn's algorithm:
 * 1. Computes in-degree for every node.
 * 2. Starts with in-degree 0 nodes (entry nodes).
 * 3. Iteratively processes dependencies.
 *
 * Throws an Error if a cyclic dependency (loop) is detected.
 */
export function topoOrder(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>(); // parentId -> childIds[]

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    graph.set(n.id, []);
  }

  for (const e of edges) {
    if (nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId)) {
      inDegree.set(e.toNodeId, (inDegree.get(e.toNodeId) || 0) + 1);
      graph.get(e.fromNodeId)?.push(e.toNodeId);
    }
  }

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  const order: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    order.push(curr);

    const children = graph.get(curr) || [];
    for (const child of children) {
      const newDeg = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) {
        queue.push(child);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("Workflow contains a cyclic dependency");
  }

  return order;
}

export function computeUpstreamInput(
  nodeId: string,
  edges: FlowEdge[],
  outputsById: Record<string, string>
): NodeTextInput {
  const parents = edges.filter((e) => e.toNodeId === nodeId);
  return combineNodeInputs(
    parents.map((edge) => ({
      key: edge.fromNodeId,
      value: outputsById[edge.fromNodeId] ?? "",
    })),
  );
}

async function execNode(
  node: FlowNode,
  upstreamInput: NodeTextInput,
  nodeOutputs: Record<string, string>,
  workflowId: string,
  runId: string,
): Promise<{ output: any; logs: string[]; status: "success" | "warning"; error: string | null }> {
  const plugin = getNodePlugin(node.type);
  if (!plugin) {
    throw new Error(`Node type "${node.type}" not installed or plugin failed to start`);
  }
  const result = await plugin.execute({
    node,
    input: upstreamInput,
    nodeOutputs,
    workflowId,
    runId,
    workflowDir: workflowAssetRoot(workflowId),
    workflowDefinitionDir: workflowDefinitionDir(workflowId),
    assetsDir: workflowRunAssetsDir(workflowId, runId),
    nodeAssetsDir: nodeAssetsDir(node.id),
  });
  if (!result || typeof result !== "object" || !("output" in result)) {
    throw new Error(`Node ${node.type} execute must return { output, logs? }`);
  }
  if (result.logs !== undefined && (!Array.isArray(result.logs) || result.logs.some((log) => typeof log !== "string"))) {
    throw new Error(`Node ${node.type} returned logs must be a string array`);
  }
  const status = result.status || "success";
  if (status !== "success" && status !== "warning") {
    throw new Error(`Node ${node.type} returned an invalid status: ${String(result.status)}`);
  }
  if (status === "warning" && !result.error) {
    throw new Error(`Node ${node.type} returned warning status without an error message`);
  }
  return { output: result.output, logs: result.logs || [], status, error: result.error || null };
}

export type EmitFn = (event: RunEvent) => void;

export interface ExecutionResult {
  status: "success" | "error";
  order: string[];
  nodes: RunNodeRecord[];
}

// Run a full workflow using DAG topological execution.
// Nodes with satisfied upstream dependencies are executed concurrently in waves.
export async function executeWorkflow(
  wf: WorkflowItem,
  emit: EmitFn,
  runId = makeRunId(),
): Promise<ExecutionResult> {
  fs.mkdirSync(workflowRunAssetsDir(wf.id, runId), { recursive: true });
  const order = topoOrder(wf.nodes, wf.edges);
  const outputsById: Record<string, string> = {};
  const outputsCombined: Record<string, string> = {}; // keyed by id AND title
  const records: RunNodeRecord[] = [];
  let status: "success" | "error" = "success";

  // Build parent dependency lookup
  const parentMap = new Map<string, string[]>();
  for (const node of wf.nodes) {
    const parents = wf.edges.filter((e) => e.toNodeId === node.id).map((e) => e.fromNodeId);
    parentMap.set(node.id, parents);
  }

  const executedNodeIds = new Set<string>();

  while (executedNodeIds.size < wf.nodes.length) {
    // A node becomes ready when every direct parent has finished, regardless of
    // that parent's status. The receiving node owns input acceptance decisions.
    const readyNodes = wf.nodes.filter((node) => {
      if (executedNodeIds.has(node.id)) return false;
      const parents = parentMap.get(node.id) || [];
      return parents.every((pId) => executedNodeIds.has(pId));
    });

    if (readyNodes.length === 0) {
      // Unexecutable remaining nodes (e.g. parent failed or skipped)
      break;
    }

    // Run all ready nodes in parallel
    const levelResults = await Promise.all(
      readyNodes.map(async (node) => {
        emit({ type: "node-start", nodeId: node.id });
        const upstreamInput = computeUpstreamInput(node.id, wf.edges, outputsById);
        const start = Date.now();
        try {
          const { output, logs, status, error } = await execNode(
            node,
            upstreamInput,
            outputsCombined,
            wf.id,
            runId,
          );
          const executionTime = Date.now() - start;
          const edgeText = nodeOutputToText(output);
          outputsById[node.id] = edgeText;
          outputsCombined[node.id] = edgeText;
          outputsCombined[node.title] = edgeText;

          return {
            node,
            record: {
              nodeId: node.id,
              nodeTitle: node.title,
              nodeType: node.type,
              status,
              output,
              logs,
              error,
              executionTime,
            },
            finish: {
              type: "node-finish" as const,
              nodeId: node.id,
              status,
              output,
              logs,
              error,
              executionTime,
            },
          };
        } catch (err: any) {
          const executionTime = Date.now() - start;
          const message = err?.message || "Execution error";
          const logs: string[] = err?.logs || [];
          const warning = isNodeWarning(err);
          return {
            node,
            record: {
              nodeId: node.id,
              nodeTitle: node.title,
              nodeType: node.type,
              status: warning ? "warning" as const : "error" as const,
              output: null,
              logs,
              error: message,
              executionTime,
            },
            finish: {
              type: "node-finish" as const,
              nodeId: node.id,
              status: warning ? "warning" as const : "error" as const,
              error: message,
              logs,
              executionTime,
            },
          };
        }
      }),
    );

    for (const res of levelResults) {
      executedNodeIds.add(res.node.id);
      records.push(res.record);
      emit(res.finish);
      if (res.record.status === "error") {
        status = "error";
      }
    }

    // A failed branch does not cancel its siblings. Stop only when the current
    // ready wave has no successful branch left. Warnings are still failures
    // for control flow, even though they have a distinct node presentation.
    if (levelResults.every((res) => res.record.status !== "success")) {
      status = "error";
      break;
    }
  }

  return { status, order, nodes: records };
}

// Run a single node in isolation. `input` is the resolved upstream input and
// `nodeOutputs` maps other nodes' ids/titles to their last outputs (for {{...}}
// and $nodes references) — both supplied by the caller from its known state.
export async function executeSingleNode(
  node: FlowNode,
  input: NodeTextInput,
  nodeOutputs: Record<string, string>,
  workflowId: string,
  runId = makeRunId(),
): Promise<RunNodeRecord> {
  fs.mkdirSync(workflowRunAssetsDir(workflowId, runId), { recursive: true });
  const start = Date.now();
  try {
    const { output, logs, status, error } = await execNode(
      node,
      input,
      nodeOutputs || {},
      workflowId,
      runId,
    );
    return {
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status,
      output,
      logs,
      error,
      executionTime: Date.now() - start,
    };
  } catch (err: any) {
    return {
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      status: isNodeWarning(err) ? "warning" : "error",
      output: null,
      logs: err?.logs || [],
      error: err?.message || "Single node execution error",
      executionTime: Date.now() - start,
    };
  }
}
