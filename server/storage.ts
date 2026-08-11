import fs from "node:fs";
import path from "node:path";
import type {
  FlowNode,
  FlowEdge,
  NodeConfig,
  WorkflowItem,
} from "../App/types";
import { DEFAULT_WORKFLOW_ICON, DEFAULT_WORKFLOW_COLOR } from "../App/types";
import {
  ensureDataDirs,
  WORKFLOWS_DIR,
  workflowDir,
  workflowAssetsDir,
  workflowAssetRoot,
  workflowScheduleFile,
} from "./paths";
import { assertNoOverlappingEdges } from "./engine";
import { assertFlowNodeLimit } from "./workflow-policy";
import {
  DEFAULT_NODE_TAG_CATALOG,
  mergeNodeTagCatalog,
  uniqueNodeTags,
} from "../lib/workflow-tags";
import {
  ensureWorkflowScheduleFile,
  readWorkflowSchedule,
  saveWorkflowSchedule,
} from "./schedule-config";
import { columnIndexOf, columnX, snapY, assertUniqueLaneLabels } from "../lib/canvas-layout";

// Shape stored inside workflow.json. Node configuration is opaque to the host,
// so an extension can add fields without changing persistence.
interface DiskNode {
  id: string;
  type: FlowNode["type"];
  title: string;
  icon: string;
  /** Required for new definitions; legacy files are upgraded on read. */
  lane?: string;
  color?: string;
  x: number;
  y: number;
  tags?: string[];
  /** Opaque extension-owned config. */
  config?: NodeConfig;
}

interface DiskWorkflow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  icon?: string;
  color?: string;
  tagCatalog?: string[];
  tags?: string[];
  laneLabels?: string[];
  reuseOverwriteGeneratedAssets?: boolean;
  nodes: DiskNode[];
  edges: FlowEdge[];
}

function yymmddhhmmss(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`;
}

const nowIso = () => new Date().toISOString();

// --- (de)serialization -------------------------------------------------------

function toDiskNode(node: FlowNode): DiskNode {
  const lane = typeof node.lane === "string" ? node.lane.trim() : "";
  if (!lane) throw new Error(`Node ${node.id} is missing required lane name`);
  const base: DiskNode = {
    id: node.id,
    type: node.type,
    title: node.title,
    icon: node.icon,
    lane,
    x: node.x,
    y: node.y,
  };
  if (node.color) base.color = node.color;
  const tags = uniqueNodeTags(node.tags);
  if (tags.length > 0) base.tags = tags;
  base.config = node.config ?? {};
  return base;
}

function fromDiskNode(_id: string, dn: DiskNode): FlowNode {
  return {
    id: dn.id,
    type: dn.type,
    title: dn.title,
    icon: dn.icon,
    lane: dn.lane,
    color: dn.color,
    x: dn.x,
    y: dn.y,
    config: dn.config ?? {},
    tags: uniqueNodeTags(dn.tags),
    status: "idle",
    error: null,
  };
}

function summaryNode(dn: DiskNode): FlowNode {
  return {
    id: dn.id,
    type: dn.type,
    title: dn.title,
    icon: dn.icon,
    lane: dn.lane,
    color: dn.color,
    x: dn.x,
    y: dn.y,
    config: dn.config ?? {},
    tags: uniqueNodeTags(dn.tags),
    status: "idle",
  };
}

/** Upgrade legacy nodes and keep every node aligned to its named lane. */
function normalizeDiskLayout(workflow: DiskWorkflow): DiskWorkflow {
  const labels = Array.isArray(workflow.laneLabels)
    ? workflow.laneLabels.map((label) => typeof label === "string" ? label.trim() : "")
    : [];
  const laneLabels = [...labels];
  const nodes = workflow.nodes.map((node) => {
    const requestedLane = typeof node.lane === "string" ? node.lane.trim() : "";
    let column = requestedLane ? laneLabels.indexOf(requestedLane) : -1;
    if (column < 0) {
      const xColumn = columnIndexOf(Number.isFinite(node.x) ? node.x : 0);
      // Use the existing x column for legacy nodes, or for a new lane when
      // that column does not already have a different named lane.
      column = !laneLabels[xColumn] || !requestedLane
        ? xColumn
        : (laneLabels.findIndex((label) => !label) >= 0
          ? laneLabels.findIndex((label) => !label)
          : laneLabels.length);
    }
    const lane = requestedLane || laneLabels[column] || `Lane ${column + 1}`;
    laneLabels[column] = lane;
    return {
      ...node,
      lane,
      x: columnX(column),
      y: snapY(Number.isFinite(node.y) ? node.y : 0),
    };
  });
  return { ...workflow, laneLabels, nodes };
}

function workflowTagCatalog(workflow: DiskWorkflow): string[] {
  return mergeNodeTagCatalog(
    workflow.tagCatalog,
    workflow.nodes.flatMap((node) => node.tags ?? []),
  );
}

function readDiskWorkflow(id: string): DiskWorkflow | null {
  const file = path.join(workflowDir(id), "workflow.json");
  if (!fs.existsSync(file)) return null;
  return normalizeDiskLayout(JSON.parse(fs.readFileSync(file, "utf-8")) as DiskWorkflow);
}

// --- public API --------------------------------------------------------------

export function listWorkflows(): WorkflowItem[] {
  ensureDataDirs();
  const items: (WorkflowItem & { _updated: number })[] = [];
  for (const entry of fs.readdirSync(WORKFLOWS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dw = readDiskWorkflow(entry.name);
    if (!dw) continue;
    items.push({
      id: dw.id,
      name: dw.name,
      description: dw.description,
      createdAt: dw.createdAt,
      updatedAt: dw.updatedAt,
      icon: dw.icon || DEFAULT_WORKFLOW_ICON,
      color: dw.color || DEFAULT_WORKFLOW_COLOR,
      tagCatalog: workflowTagCatalog(dw),
      tags: dw.tags,
      laneLabels: dw.laneLabels,
      reuseOverwriteGeneratedAssets: Boolean(dw.reuseOverwriteGeneratedAssets),
      nodes: dw.nodes.map(summaryNode),
      edges: dw.edges,
      _updated: Date.parse(dw.updatedAt) || 0,
    });
  }
  // Newest first
  items.sort((a, b) => b._updated - a._updated);
  return items.map(({ _updated, ...w }) => w);
}

export function getWorkflow(id: string): WorkflowItem | null {
  const dw = readDiskWorkflow(id);
  if (!dw) return null;
  return {
    id: dw.id,
    name: dw.name,
    description: dw.description,
    createdAt: dw.createdAt,
    updatedAt: dw.updatedAt,
    icon: dw.icon || DEFAULT_WORKFLOW_ICON,
    color: dw.color || DEFAULT_WORKFLOW_COLOR,
    tagCatalog: workflowTagCatalog(dw),
    tags: dw.tags,
    laneLabels: dw.laneLabels,
    reuseOverwriteGeneratedAssets: Boolean(dw.reuseOverwriteGeneratedAssets),
    nodes: dw.nodes.map((dn) => fromDiskNode(id, dn)),
    edges: dw.edges,
  };
}

export function ensureWorkflowAssets(id: string): void {
  const wfDir = workflowDir(id);
  if (!fs.existsSync(path.join(wfDir, "workflow.json"))) {
    throw new Error("Workflow not found");
  }
  if (!fs.existsSync(workflowScheduleFile(id))) {
    ensureWorkflowScheduleFile(id);
  }
}

function copyWorkflowStaticAssets(sourceId: string, targetId: string): void {
  const source = workflowAssetsDir(sourceId);
  if (!fs.existsSync(source)) return;
  // Skip the reusable overwrite root under assets/generated; only copy static inputs.
  const reusableGenerated = path.join(source, "generated");
  fs.cpSync(source, workflowAssetsDir(targetId), {
    recursive: true,
    force: true,
    filter: (candidate) =>
      candidate !== reusableGenerated && !candidate.startsWith(`${reusableGenerated}${path.sep}`),
  });
}

// Persist a full workflow as graph data plus opaque extension configs.
export function saveWorkflow(item: WorkflowItem): WorkflowItem {
  assertFlowNodeLimit(item.nodes);
  assertNoOverlappingEdges(item.nodes, item.edges);
  ensureDataDirs();
  const dir = workflowDir(item.id);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readDiskWorkflow(item.id);
  const createdAt = existing?.createdAt ?? item.createdAt ?? nowIso();
  const updatedAt = nowIso();
  const workflowIcon = item.icon || existing?.icon || DEFAULT_WORKFLOW_ICON;
  const workflowColor = item.color || existing?.color || DEFAULT_WORKFLOW_COLOR;

  const normalized = normalizeDiskLayout({
    id: item.id,
    name: item.name,
    description: item.description,
    createdAt,
    updatedAt,
    icon: workflowIcon,
    color: workflowColor,
    tagCatalog: item.tagCatalog,
    tags: item.tags,
    laneLabels: item.laneLabels,
    reuseOverwriteGeneratedAssets: Boolean(item.reuseOverwriteGeneratedAssets),
    nodes: item.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      icon: node.icon,
      lane: node.lane,
      color: node.color,
      x: node.x,
      y: node.y,
      tags: node.tags,
      config: node.config,
    })),
    edges: item.edges,
  });
  assertUniqueLaneLabels(normalized.laneLabels);

  const disk: DiskWorkflow = {
    id: item.id,
    name: item.name,
    description: item.description,
    createdAt,
    updatedAt,
    icon: workflowIcon,
    color: workflowColor,
    tagCatalog: mergeNodeTagCatalog(
      item.tagCatalog,
      normalized.nodes.flatMap((node) => node.tags ?? []),
    ),
    tags: item.tags,
    laneLabels: normalized.laneLabels,
    reuseOverwriteGeneratedAssets: Boolean(item.reuseOverwriteGeneratedAssets),
    nodes: normalized.nodes.map((node) => toDiskNode({
      ...node,
      lane: node.lane,
      config: node.config ?? {},
      status: "idle",
    })),
    edges: normalized.edges.map((e) => ({
      id: e.id,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
    })),
  };

  fs.writeFileSync(
    path.join(dir, "workflow.json"),
    JSON.stringify(disk, null, 2),
    "utf-8"
  );
  ensureWorkflowAssets(item.id);

  return getWorkflow(item.id)!;
}

export function createWorkflow(
  name: string,
  description: string
): WorkflowItem {
  const id = `wf-${yymmddhhmmss(new Date())}`;
  const iso = nowIso();
  return saveWorkflow({
    id,
    name,
    description,
    createdAt: iso,
    updatedAt: iso,
    icon: DEFAULT_WORKFLOW_ICON,
    color: DEFAULT_WORKFLOW_COLOR,
    tagCatalog: [...DEFAULT_NODE_TAG_CATALOG],
    nodes: [],
    edges: [],
  });
}

export function duplicateWorkflow(id: string): WorkflowItem | null {
  const src = getWorkflow(id);
  if (!src) return null;
  const newId = `wf-${yymmddhhmmss(new Date())}`;
  const idMap: Record<string, string> = {};
  const nodes: FlowNode[] = src.nodes.map((n) => {
    const nid = `node-${Math.random().toString(36).slice(2, 9)}`;
    idMap[n.id] = nid;
    return { ...n, id: nid, status: "idle", output: undefined, error: null };
  });
  const edges: FlowEdge[] = src.edges.map((e) => ({
    id: `edge-${idMap[e.fromNodeId] ?? e.fromNodeId}-${idMap[e.toNodeId] ?? e.toNodeId}`,
    fromNodeId: idMap[e.fromNodeId] ?? e.fromNodeId,
    toNodeId: idMap[e.toNodeId] ?? e.toNodeId,
    status: "idle",
  }));
  const iso = nowIso();
  const duplicated = saveWorkflow({
    id: newId,
    name: `${src.name} (Copy)`,
    description: src.description,
    createdAt: iso,
    updatedAt: iso,
    icon: src.icon || DEFAULT_WORKFLOW_ICON,
    color: src.color || DEFAULT_WORKFLOW_COLOR,
    tagCatalog: src.tagCatalog,
    laneLabels: src.laneLabels,
    reuseOverwriteGeneratedAssets: Boolean(src.reuseOverwriteGeneratedAssets),
    nodes,
    edges,
  });
  copyWorkflowStaticAssets(id, newId);
  try {
    const sourceSchedule = readWorkflowSchedule(id);
    saveWorkflowSchedule(newId, { ...sourceSchedule, enabled: false });
  } catch {
    // A broken source schedule must not prevent graph duplication. The new
    // workflow keeps the safe, disabled schedule created by saveWorkflow().
  }
  return duplicated;
}

export function updateWorkflowMeta(
  id: string,
  name?: string,
  description?: string,
  icon?: string,
  color?: string
): WorkflowItem | null {
  const dw = readDiskWorkflow(id);
  if (!dw) return null;
  if (name !== undefined) dw.name = name;
  if (description !== undefined) dw.description = description;
  if (icon !== undefined) dw.icon = icon || DEFAULT_WORKFLOW_ICON;
  if (color !== undefined) dw.color = color || DEFAULT_WORKFLOW_COLOR;
  dw.updatedAt = nowIso();
  fs.writeFileSync(
    path.join(workflowDir(id), "workflow.json"),
    JSON.stringify(dw, null, 2),
    "utf-8"
  );
  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const dir = workflowDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  const assetRoot = workflowAssetRoot(id);
  if (fs.existsSync(assetRoot)) fs.rmSync(assetRoot, { recursive: true, force: true });
  return true;
}
