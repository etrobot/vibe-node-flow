import type { FlowNode, FlowEdge } from '../types';
import { combineNodeInputs, nodeOutputToText, type NodeTextInput } from '../../lib/node-io';

// Resolve a node's upstream input on the client the same way the server engine
// does (server/engine.ts `computeUpstreamInput`): every input is an object
// keyed by upstream node id, including the single-parent case.
export function resolveUpstreamInput(
  nodeId: string,
  edges: FlowEdge[],
  nodes: FlowNode[],
): NodeTextInput {
  const parents = edges.filter((e) => e.toNodeId === nodeId);
  return combineNodeInputs(
    parents.map((edge) => ({
      key: edge.fromNodeId,
      value: nodes.find((node) => node.id === edge.fromNodeId)?.output,
    })),
  );
}

export { nodeOutputToText };
