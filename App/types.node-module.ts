import type React from 'react';
import type { FlowNode, FlowEdge, NodeType, NodeConfig } from './types';

// Props every node module's inspector/output component receives.
export interface NodeModuleEditorProps {
  node: FlowNode;
  allNodes: FlowNode[];
  edges: FlowEdge[];
  onUpdateNode: (updatedNode: FlowNode) => void;
  onRunSingleNode: (nodeId: string, manualInput?: string) => void;
  /** Owning workflow and persisted run context for node-owned actions. */
  workflowId?: string;
  runId?: string;
  readOnly?: boolean;
}

// Browser-side contract for a self-contained node extension.
export interface NodeModule {
  type: NodeType;
  label: string; // short name, used for node title (e.g. "LLM")
  menuLabel?: string; // label in the add-node menu; defaults to label
  description?: string; // one-liner shown in the add-node menu
  icon?: string; // Lucide icon name; defaults to 'Puzzle'
  color?: string; // theme color (hex); defaults to '#64748b'
  badge?: string; // optional sublabel under the node on canvas
  /** Lower values appear first in the add-node menu. Defaults to 1000. */
  menuOrder?: number;
  /** Legacy modules can still render persisted nodes without appearing in the add menu. */
  availableInMenu?: boolean;
  /** Optional controls-free page exposed by the node for dedicated render routes. */
  RenderPage?: React.FC;
  /** Optional custom UI view component mounted inside NodeInspector or modal. */
  CustomView?: React.FC<NodeModuleEditorProps>;
  /** Fresh default config for a new node. Defaults to () => ({}). */
  createConfig?(): NodeConfig;
  /** Optional custom output/preview component. */
  OutputView?: React.FC<NodeModuleEditorProps>;
  /** Optional overlay mounted for the node when running. */
  RunOverlay?: React.FC<NodeModuleEditorProps>;
}
