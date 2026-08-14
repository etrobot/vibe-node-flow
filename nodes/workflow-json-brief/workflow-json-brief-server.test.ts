import assert from 'node:assert/strict';
import test from 'node:test';
import { executeWorkflowJsonBrief } from './server.ts';

const workflow = {
  id: 'opening-flow',
  name: '字幕驱动流程',
  description: '按字幕筛选内容，再逐段定位并识别视频帧。',
  laneLabels: ['输入', '处理'],
  nodes: [
    { id: 'source', type: 'source-node', title: '读取字幕', lane: '输入', config: {} },
    { id: 'analysis', type: 'analysis-node', title: '定位目标帧', lane: '处理', config: { retryLimit: 2 } },
  ],
  edges: [{ id: 'source-analysis', fromNodeId: 'source', toNodeId: 'analysis' }],
};

test('workflow-json-brief stays deterministic and leaves opening generation to storyboard', async () => {
  const result = await executeWorkflowJsonBrief({
    node: {
      type: 'workflow-json-brief',
      config: {},
    },
    input: { workflow: JSON.stringify(workflow) },
    nodeOutputs: {},
    workflowId: 'opening-flow',
    runId: 'test-run',
    workflowDir: '/tmp',
    assetsDir: '/tmp',
    nodeAssetsDir: '/tmp',
  } as any);
  assert.doesNotMatch(result.output, /## Generated Opening Narration/);
  assert.match(result.output, /## Compact Storyboard Context/);
  assert.doesNotMatch(result.output, /## Node-by-Node Evidence/);
  assert.match(result.logs?.join('\n') || '', /generated inside the complete storyboard JSON/);
});

test('workflow-json-brief ignores legacy opening settings', async () => {
  const result = await executeWorkflowJsonBrief({
    node: { type: 'workflow-json-brief', config: { generateOpening: true } },
    input: { workflow: JSON.stringify(workflow) },
    nodeOutputs: {},
    workflowId: 'opening-flow',
    runId: 'test-run',
    workflowDir: '/tmp',
    assetsDir: '/tmp',
    nodeAssetsDir: '/tmp',
  } as any);

  assert.doesNotMatch(result.output, /## Generated Opening Narration/);
  assert.match(result.logs?.join('\n') || '', /generated inside the complete storyboard JSON/);
});
