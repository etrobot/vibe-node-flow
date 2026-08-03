// Node types are opaque strings declared by extensions and persisted with the
// workflow; the host does not maintain a built-in type list.
export type NodeType = string;

export type NodeStatus = 'idle' | 'running' | 'success' | 'warning' | 'error';

// Extension configuration is intentionally opaque to the core. Each node owns
// its config type, validation, editor and server-side interpretation.
export type NodeConfig = Record<string, any>;

export interface FlowNode {
  id: string;
  type: NodeType;
  title: string;
  icon: string; // Lucide icon name
  /** Lane name used to place the node in the canvas column. */
  lane: string;
  color?: string; // optional theme color (hex)
  x: number;
  y: number;
  config: NodeConfig;
  /** Global, non-DAG capabilities referenced by this node (for example ENV or FS). */
  tags?: string[];
  status: NodeStatus;
  output?: any;
  logs?: string[]; // console output captured during script execution
  executionTime?: number; // in ms
  error?: string | null;
}

export interface FlowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  status?: NodeStatus;
}

// Default appearance for a workflow when older records do not have custom
// icon metadata yet.
export const DEFAULT_WORKFLOW_ICON = 'Workflow';
export const DEFAULT_WORKFLOW_COLOR = '#1e293b';

/** Server-owned cron configuration persisted as schedule.json in a workflow folder. */
export interface WorkflowSchedule {
  enabled: boolean;
  cron: string;
  timezone: string;
}

/** Runtime details are computed by the server and are never persisted by the client. */
export interface WorkflowScheduleStatus extends WorkflowSchedule {
  nextRunAt: string | null;
}

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** Lucide icon name shown for the workflow in the list and editor header. */
  icon?: string;
  /** Hex theme color used by the workflow icon. */
  color?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Reusable catalog for node-level global-operation tags. */
  tagCatalog?: string[];
  /** Free-form workflow discovery tags, separate from node operation tags. */
  tags?: string[];
  /** Optional custom labels for canvas column lanes, keyed by column index. */
  laneLabels?: string[];
}

// ---- Run records (persisted in SQLite) ----

export type RunTrigger = 'full' | 'single' | 'schedule';

export interface RunNodeRecord {
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  status: NodeStatus;
  output: any;
  logs: string[];
  error: string | null;
  executionTime: number;
}

/** A single-node run is persisted like any other run and returns its record id. */
export interface SingleNodeRunRecord extends RunNodeRecord {
  runId: string;
}

export interface RunWorkflowSnapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: RunTrigger;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodes: RunNodeRecord[];
  /** Workflow graph/config captured at execution time for the read-only run viewer. */
  workflowSnapshot?: RunWorkflowSnapshot;
}

// Lightweight row for the history list (no per-node payloads)
export interface RunSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: RunTrigger;
  status: 'success' | 'error';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  nodeCount: number;
}

// Events streamed (NDJSON) from the run endpoint
export type RunEvent =
  | { type: 'run-start'; runId: string; order: string[] }
  | { type: 'node-start'; nodeId: string }
  | {
      type: 'node-finish';
      nodeId: string;
      status: NodeStatus;
      output?: any;
      logs?: string[];
      error?: string | null;
      executionTime: number;
    }
  | { type: 'run-finish'; runId: string; status: 'success' | 'error' };
