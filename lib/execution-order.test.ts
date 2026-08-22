import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlowEdge, FlowNode } from '../App/types';
import { orderNodesByExecution, topoOrder } from './execution-order';

function flowNode(id: string, x = 0, y = 0): FlowNode {
  return {
    id,
    type: 'test',
    title: id,
    icon: 'Puzzle',
    lane: 'Lane 1',
    x,
    y,
    config: {},
    status: 'idle',
  };
}

function edge(fromNodeId: string, toNodeId: string): FlowEdge {
  return { id: `${fromNodeId}->${toNodeId}`, fromNodeId, toNodeId };
}

test('topoOrder follows directed edges', () => {
  const nodes = [flowNode('c'), flowNode('a'), flowNode('b')];
  const edges = [edge('a', 'b'), edge('b', 'c')];
  assert.deepEqual(topoOrder(nodes, edges), ['a', 'b', 'c']);
});

test('orderNodesByExecution returns nodes in topo order', () => {
  const nodes = [flowNode('c'), flowNode('a'), flowNode('b')];
  const edges = [edge('a', 'b'), edge('b', 'c')];
  assert.deepEqual(orderNodesByExecution(nodes, edges).map((node) => node.id), ['a', 'b', 'c']);
});

test('orderNodesByExecution falls back to visual order on a cycle', () => {
  const nodes = [flowNode('b', 0, 80), flowNode('a', 0, 20)];
  const edges = [edge('a', 'b'), edge('b', 'a')];
  assert.deepEqual(orderNodesByExecution(nodes, edges).map((node) => node.id), ['a', 'b']);
});
