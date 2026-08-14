import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildWorkflowMermaidSource, executeMermaidEnHtml } from './server.ts';

function graphBrief(): string {
  return [
    '## Machine-Readable Workflow Graph',
    '~~~json',
    JSON.stringify({
      workflow: { id: 'four-node-flow', name: 'Four Node Flow', lanes: ['One', 'Two', 'Three', 'Four'] },
      nodes: [
        { id: 'node-1', title: 'Node One', lane: 'One' },
        { id: 'node-2', title: 'Node Two', lane: 'Two' },
        { id: 'node-3', title: 'Node Three', lane: 'Three' },
        { id: 'node-4', title: 'Node Four', lane: 'Four' },
      ],
      edges: [
        { from: 'node-1', to: 'node-2' },
        { from: 'node-2', to: 'node-3' },
        { from: 'node-3', to: 'node-4' },
      ],
      mermaidMaterials: [{
        id: 'node-one-diagram-1-12345678',
        nodeType: 'node-one',
        title: 'node-one · NODE.md diagram 1',
        source: 'flowchart LR\n  A["Read source"] --> B["Write output"]',
        sourceSha256: 'a'.repeat(64),
        documentationSource: 'nodes/node-one/NODE.md',
      }],
    }),
    '~~~',
  ].join('\n');
}

function context() {
  return {
    node: {
      type: 'mermaid-en-html',
      config: { width: 1920, height: 1080, maxTargets: 3 },
    },
    input: {
      storyboard: JSON.stringify({
        slug: 'four-node-flow',
        sourceBrief: graphBrief(),
        clips: [{
          speech: 'Show the complete flow. **Show the diagram.**',
          background: 'aurora',
          items: [
            { type: 'ui-video-preview', title: 'Complete flow', demoUi: { state: 'workflow-canvas' } },
            { type: 'ui-video-preview', title: 'Diagram', demoUi: { state: 'node-mermaid', materialId: 'node-one-diagram-1-12345678' } },
          ],
        }],
      }),
    },
    nodeOutputs: {},
    workflowId: 'test-workflow',
    runId: 'test-run',
    workflowDir: '/tmp',
    workflowDefinitionDir: '/tmp',
    assetsDir: '/tmp',
    nodeAssetsDir: '/tmp',
  } as any;
}

test('mermaid-en-html renders verified English Mermaid without an LLM', async () => {
  const result = await executeMermaidEnHtml(context(), {
    renderMermaidSvgs: async (materials) => new Map(materials.map((material) => [material.id, '<svg><path/></svg>'])),
  });

  const manifest = JSON.parse(result.output);
  assert.equal(manifest.kind, 'mermaid-en-html');
  assert.equal(manifest.demos.length, 2);
  assert.equal(manifest.sourceBrief, undefined);
  assert.equal(manifest.document?.sourceBrief, undefined);
  assert.ok(Array.isArray(manifest.workflowMermaidMaterials));
  assert.equal(manifest.workflowMermaidMaterials[0].id, 'node-one-diagram-1-12345678');
  const canvas = await fs.readFile('/tmp/' + manifest.demos[0].htmlFile, 'utf8');
  assert.match(canvas, /lang="en"/);
  assert.match(canvas, /data-mermaid-workflow/);
  assert.match(canvas, /Workflow graph · 4 nodes · 3 edges/);
  for (const nodeId of ['node-1', 'node-2', 'node-3', 'node-4']) {
    assert.match(canvas, new RegExp('data-node-id="' + nodeId + '"'));
  }
  assert.match(canvas, /data-edge-from="node-3" data-edge-to="node-4"/);
  const mermaidHtml = await fs.readFile('/tmp/' + manifest.demos[1].htmlFile, 'utf8');
  assert.match(mermaidHtml, /data-mermaid-material-id="node-one-diagram-1-12345678"/);
  assert.match(mermaidHtml, /Read source/);
});

test('mermaid-en-html reads sourceBriefPath from run assets', async () => {
  const root = await fs.mkdtemp('/tmp/mermaid-en-brief-');
  try {
    await fs.writeFile(path.join(root, 'source-brief.md'), graphBrief(), 'utf8');
    const ctx = context();
    ctx.assetsDir = root;
    ctx.input = {
      storyboard: JSON.stringify({
        slug: 'four-node-flow',
        sourceBriefPath: 'source-brief.md',
        clips: [{
          speech: 'Show the complete flow.',
          background: 'aurora',
          items: [
            { type: 'ui-video-preview', title: 'Complete flow', demoUi: { state: 'workflow-canvas' } },
          ],
        }],
      }),
    };
    const result = await executeMermaidEnHtml(ctx, {
      renderMermaidSvgs: async (materials) => new Map(materials.map((material) => [material.id, '<svg><path/></svg>'])),
    });
    const manifest = JSON.parse(result.output);
    assert.equal(manifest.sourceBriefPath, 'source-brief.md');
    assert.equal(manifest.workflowGraph?.nodes.length, 4);
    assert.equal(manifest.sourceBrief, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Mermaid canvas uses English source workflow labels without changing graph ids', () => {
  const source = buildWorkflowMermaidSource({
    workflow: { id: 'youtube-ai-prompt-extraction', name: 'Extraction Workflow', lanes: ['Video', 'Segmentation'] },
    nodes: [
      { id: 'node-youtube-latest', title: 'Select Video', lane: 'Video' },
      { id: 'node-ai-video-analysis', title: 'Check Subtitles', lane: 'Segmentation' },
    ],
    edges: [{ from: 'node-youtube-latest', to: 'node-ai-video-analysis' }],
  });

  assert.match(source, /subgraph lane1\["Video"\]/);
  assert.match(source, /n1\["Select Video"\]/);
  assert.match(source, /n2\["Check Subtitles"\]/);
  assert.match(source, /n1 --> n2/);
});
