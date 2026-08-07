import assert from "node:assert/strict";
import test from "node:test";
import { computeUpstreamInput, topoOrder, executeWorkflow } from "./engine";
import { combineNodeInputs } from "../lib/node-io";
import type { FlowNode, FlowEdge, WorkflowItem } from "../App/types";

function flowNode(id: string, type = "content-brief", title = id, y = 0, config: Record<string, any> = {}): FlowNode {
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

function testBrief(topic: string) {
  return {
    topic,
    audience: "Workflow test readers",
    objective: "Verify deterministic DAG execution without external services.",
    centralThesis: "Graph dependencies determine execution order.",
    targetLanguage: "English",
    targetDurationSeconds: 60,
    sourceNotes: "- [Source A](https://example.com/a)\n- [Source B](https://example.com/b)",
    factualBoundaries: "Only assert facts present in this test brief.",
    requiredPoints: "Explain the dependency order.",
    forbiddenClaims: "Do not invent timing or performance claims.",
  };
}

test("topoOrder calculates valid order for DAG graph", () => {
  const nodes: FlowNode[] = [
    { ...flowNode("node-c", "content-brief", "C", 100), x: 600 },
    { ...flowNode("node-a", "content-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "content-brief", "B", 100), x: 350 },
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
    { ...flowNode("node-a", "content-brief", "A", 100), x: 100 },
    { ...flowNode("node-b", "content-brief", "B", 100), x: 350 },
  ];
  const edges: FlowEdge[] = [
    { id: "e1", fromNodeId: "node-a", toNodeId: "node-b" },
    { id: "e2", fromNodeId: "node-b", toNodeId: "node-a" },
  ];

  assert.throws(() => topoOrder(nodes, edges), /cyclic dependency/i);
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
      flowNode("start", "content-brief", "Start Node", 0, testBrief("Start")),
      flowNode("branch1", "content-brief", "Branch 1", 100, testBrief("Branch 1")),
      flowNode("branch2", "content-brief", "Branch 2", 200, testBrief("Branch 2")),
      flowNode("end", "content-brief", "End Node", 300, testBrief("End")),
    ],
    edges: [
      { id: "e1", fromNodeId: "start", toNodeId: "branch1" },
      { id: "e2", fromNodeId: "start", toNodeId: "branch2" },
      { id: "e3", fromNodeId: "branch1", toNodeId: "end" },
      { id: "e4", fromNodeId: "branch2", toNodeId: "end" },
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

  const warningNode = flowNode("warning", "content-brief", "Invalid brief", 0, {});
  const healthyNode = flowNode("healthy", "content-brief", "Healthy", 0, testBrief("Healthy"));
  const downstream = flowNode("downstream", "content-brief", "Downstream", 100, testBrief("Downstream"));
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

  const warningNode = flowNode("warning-only", "content-brief", "Invalid brief", 0, {});
  const downstream = flowNode("downstream-warning", "content-brief", "Downstream", 100, testBrief("Downstream"));
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
  const downstream = flowNode("after-failed", "content-brief", "Must not run", 100, testBrief("Must not run"));
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
  const healthy = flowNode("healthy", "content-brief", "Healthy branch", 0, testBrief("Healthy"));
  const child = flowNode("child", "content-brief", "Child", 100, testBrief("Child"));
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
  const unreachable = flowNode("unreachable", "content-brief", "Unreachable", 100, testBrief("Unreachable"));
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
