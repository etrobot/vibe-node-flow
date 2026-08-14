import assert from "node:assert/strict";
import test from "node:test";
import { computeUpstreamInput, topoOrder, executeWorkflow, assertNoOverlappingEdges } from "./engine";
import { combineNodeInputs } from "../lib/node-io";
import type { FlowNode, FlowEdge, WorkflowItem } from "../App/types";

const TEST_WORKFLOW_JSON_BRIEF_CONFIG = {
  sourceWorkflowPath: "workflows/app-launch-video-en/workflow.json",
};

function flowNode(
  id: string,
  type = "workflow-json-brief",
  title = id,
  y = 0,
  config: Record<string, any> = TEST_WORKFLOW_JSON_BRIEF_CONFIG,
): FlowNode {
  return {
    id,
    type,
    title,
    icon: "Puzzle",
    lane: "Lane 1",
    x: 0,
    y,
    config,
    status: "idle",
  };
}

test("topoOrder calculates valid order for DAG graph", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-c", "workflow-json-brief", "C", 100), x: 600 },
    { ...flowNode("node-a", "workflow-json-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "workflow-json-brief", "B", 100), x: 350 },
  ];
  const edges: FlowEdge[] = [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-b", toNodeId: "node-c" },
  ];

  const order = topoOrder(nodes, edges);
  assert.deepEqual(order, ["node-a", "node-b", "node-c"]);
});

test("topoOrder throws error on cyclic dependency", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-a", "workflow-json-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "workflow-json-brief", "B", 100), x: 350 },
  ];
  const edges: FlowEdge[] = [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-b", toNodeId: "node-a" },
  ];

  assert.throws(() => topoOrder(nodes, edges), /cyclic dependency/i);
});

test("assertNoOverlappingEdges allows linear chains and fan-out joins", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-a", "workflow-json-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "workflow-json-brief", "B", 100), x: 350 },
    { ...flowNode("node-c", "workflow-json-brief", "C", 100), x: 600 },
    { ...flowNode("node-d", "workflow-json-brief", "D", 200), x: 350 },
  ];

  assert.doesNotThrow(() => assertNoOverlappingEdges(nodes, [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-b", toNodeId: "node-c" },
  ]));

  assert.doesNotThrow(() => assertNoOverlappingEdges(nodes, [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-a", toNodeId: "node-d" },
    { id: "e3", fromNodeId: "node-b", toNodeId: "node-c" },
    { id: "e4", fromNodeId: "node-d", toNodeId: "node-c" },
  ]));
});

test("assertNoOverlappingEdges rejects direct edge when a longer path exists", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-a", "workflow-json-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "workflow-json-brief", "B", 100), x: 350 },
    { ...flowNode("node-c", "workflow-json-brief", "C", 100), x: 600 },
  ];
  const edges: FlowEdge[] = [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-b", toNodeId: "node-c" },
    { id: "e3", fromNodeId: "node-a", toNodeId: "node-c" },
  ];

  assert.throws(
    () => assertNoOverlappingEdges(nodes, edges),
    /overlapping connections.*A -> C.*A -> B -> C/i,
  );
});

test("assertNoOverlappingEdges rejects duplicate edges between the same nodes", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-a", "workflow-json-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "workflow-json-brief", "B", 100), x: 350 },
  ];
  const edges: FlowEdge[] = [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-a", toNodeId: "node-b" },
  ];

  assert.throws(
    () => assertNoOverlappingEdges(nodes, edges),
    /duplicate edges.*A.*B/i,
  );
});

test("executeWorkflow rejects overlapping connections before running nodes", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const wf: WorkflowItem = {
    id: "overlap-wf",
    name: "Overlap workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      flowNode("a"),
      flowNode("b", "workflow-json-brief", "B", 100),
      flowNode("c", "workflow-json-brief", "C", 200),
    ],
    edges: [
      { id: "ab", fromNodeId: "a", toNodeId: "b" },
      { id: "bc", fromNodeId: "b", toNodeId: "c" },
      { id: "ac", fromNodeId: "a", toNodeId: "c" },
    ],
  };

  await assert.rejects(
    () => executeWorkflow(wf, () => undefined),
    /overlapping connections/i,
  );
});

test("upstream input is always keyed by upstream node id", () => {
  assert.deepEqual(combineNodeInputs([]), {});
  assert.deepEqual(combineNodeInputs([{ key: "source", value: "text" }]), { source: "text" });
  assert.deepEqual(
    computeUpstreamInput(
      "target",
      [
        { id: "e1", fromNodeId: "source-a", toNodeId: "target" },
        { id: "e2", fromNodeId: "source-b", toNodeId: "target" },
      ],
      { "source-a": "A", "source-b": "B" },
    ),
    { "source-a": "A", "source-b": "B" },
  );
});

test("executeWorkflow runs nodes according to edge connections and parallelism", async () => {
  // Load plugins first so node types can execute in tests
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const wf: WorkflowItem = {
    id: "test-wf",
    name: "Test DAG Workflow",
    description: "Deterministic execution test",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      flowNode("start", "workflow-json-brief", "Start Node", 0),
      flowNode("branch1", "workflow-json-brief", "Branch 1", 100),
      flowNode("branch2", "workflow-json-brief", "Branch 2", 200),
      flowNode("end", "workflow-json-brief", "End Node", 300),
    ],
    edges: [
      { id: "e1", fromNodeId: "start", toNodeId: "branch1" },
      { id: "e2", fromNodeId: "start", toNodeId: "branch2" },
      { id: "e3", fromNodeId: "branch1", toNodeId: "end" },
    ],
  };

  const startTimes: Record<string, number> = {};
  const finishTimes: Record<string, number> = {};
  const events: Array<{ type: string; nodeId?: string }> = [];

  const result = await executeWorkflow(wf, (event) => {
    events.push({ type: event.type, nodeId: "nodeId" in event ? event.nodeId : undefined });
    if (event.type === "node-start") {
      startTimes[event.nodeId] = Date.now();
    } else if (event.type === "node-finish") {
      finishTimes[event.nodeId] = Date.now();
    }
  });

  assert.equal(result.status, "success");
  assert.equal(result.nodes.length, 4);

  // Verification: start executed before branches, branches before end
  assert.ok(finishTimes["start"] <= startTimes["branch1"]);
  assert.ok(finishTimes["start"] <= startTimes["branch2"]);
  assert.ok(finishTimes["branch1"] <= startTimes["end"]);
  assert.ok(finishTimes["branch2"] <= startTimes["end"]);

  // Live logs must stream before finish, and a finished sibling must not wait
  // for the rest of its parallel wave before emitting node-finish.
  assert.ok(events.some((event) => event.type === "node-log"));
  const branchWave = events.filter((event) =>
    event.nodeId === "branch1" || event.nodeId === "branch2"
  );
  const firstBranchFinish = branchWave.findIndex((event) => event.type === "node-finish");
  assert.ok(firstBranchFinish >= 0);
  assert.ok(
    branchWave.slice(firstBranchFinish + 1).some((event) =>
      event.type === "node-log" || event.type === "node-finish"
    ),
    "expected activity from the other parallel branch after the first finish",
  );
});

test("a warning can continue when another branch succeeds in the same wave", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const warningNode = flowNode("warning", "workflow-json-brief", "Invalid brief", 0, {});
  const healthyNode = flowNode("healthy");
  const downstream = flowNode("downstream", "workflow-json-brief", "Downstream", 100);
  const result = await executeWorkflow({
    id: "warning-wf",
    name: "Warning workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [warningNode, healthyNode, downstream],
    edges: [{ id: "warning-edge", fromNodeId: "warning", toNodeId: "downstream" }],
  }, () => undefined);

  assert.equal(result.status, "success");
  assert.equal(result.nodes.find((node) => node.nodeId === "warning")?.status, "warning");
  assert.equal(result.nodes.find((node) => node.nodeId === "healthy")?.status, "success");
  assert.equal(result.nodes.find((node) => node.nodeId === "downstream")?.status, "success");
});

test("a warning-only ready wave stops before its downstream nodes", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const warningNode = flowNode("warning-only", "workflow-json-brief", "Invalid brief", 0, {});
  const downstream = flowNode("downstream-warning", "workflow-json-brief", "Downstream", 100);
  const result = await executeWorkflow({
    id: "warning-stop-wf",
    name: "Warning stop workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [warningNode, downstream],
    edges: [{ id: "warning-stop-edge", fromNodeId: "warning-only", toNodeId: "downstream-warning" }],
  }, () => undefined);

  assert.equal(result.status, "error");
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].status, "warning");
});

test("a failed first node stops a linear workflow", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const failed = flowNode("first-failed", "missing-test-node", "First failed", 0);
  const downstream = flowNode("after-failed", "workflow-json-brief", "Must not run", 100);
  const result = await executeWorkflow({
    id: "first-failed-wf",
    name: "First failed workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [failed, downstream],
    edges: [{ id: "first-failed-edge", fromNodeId: "first-failed", toNodeId: "after-failed" }],
  }, () => undefined);

  assert.equal(result.status, "error");
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].status, "error");
});

test("one failed branch does not stop another branch or its child", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const failed = flowNode("failed", "missing-test-node", "Failed branch", 0);
  const healthy = flowNode("healthy", "workflow-json-brief", "Healthy branch", 0);
  const child = flowNode("child", "workflow-json-brief", "Child", 100);
  const result = await executeWorkflow({
    id: "branch-wf",
    name: "Branch workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [failed, healthy, child],
    edges: [{ id: "branch-edge", fromNodeId: "failed", toNodeId: "child" }],
  }, () => undefined);

  assert.equal(result.status, "error");
  assert.equal(result.nodes.find((node) => node.nodeId === "failed")?.status, "error");
  assert.equal(result.nodes.find((node) => node.nodeId === "healthy")?.status, "success");
  assert.equal(result.nodes.find((node) => node.nodeId === "child")?.status, "success");
});

test("the workflow stops when every node in the ready wave fails", async () => {
  const { loadNodePlugins } = await import("./plugins");
  await loadNodePlugins(process.cwd(), { log: false });

  const first = flowNode("first", "missing-test-node", "First", 0);
  const second = flowNode("second", "another-missing-test-node", "Second", 0);
  const unreachable = flowNode("unreachable", "workflow-json-brief", "Unreachable", 100);
  const result = await executeWorkflow({
    id: "stop-wf",
    name: "Stop workflow",
    description: "",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [first, second, unreachable],
    edges: [{ id: "stop-edge", fromNodeId: "first", toNodeId: "unreachable" }],
  }, () => undefined);

  assert.equal(result.status, "error");
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes.some((node) => node.nodeId === "unreachable"), false);
});
