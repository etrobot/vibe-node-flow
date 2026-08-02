import type { FlowNode } from "../App/types";
import { getMaxFlowNodes } from "./env";

export function assertFlowNodeLimit(nodes: FlowNode[]): void {
  const limit = getMaxFlowNodes();
  if (nodes.length > limit) {
    throw new Error(`Workflow max ${limit} nodes allowed, current is ${nodes.length}`);
  }
}
