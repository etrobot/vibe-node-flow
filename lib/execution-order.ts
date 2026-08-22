import type { FlowEdge, FlowNode } from '../App/types';

/**
 * Topological execution order of nodes from directed edges (Kahn's algorithm).
 * Mirrors server/engine.ts so the app layout sidebar matches run order.
 *
 * Throws if the graph contains a cycle.
 */
export function topoOrder(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const graph = new Map<string, string[]>();

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
    throw new Error('Workflow contains a cyclic dependency');
  }

  return order;
}

/**
 * Nodes sorted in execution order for the app-layout sidebar.
 * Falls back to visual top-to-bottom / left-to-right when the graph is cyclic.
 */
export function orderNodesByExecution(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  try {
    const ids = topoOrder(nodes, edges);
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((node): node is FlowNode => Boolean(node));
    return ordered;
  } catch (err) {
    const fallback = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x);
    console.warn('[execution-order] cycle, fallback to visual order', {
      error: (err as Error).message,
      ids: fallback.map((node) => node.id),
    });
    return fallback;
  }
}
