import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WorkflowBriefInputError,
  analyzeWorkflowGraph,
  buildWorkflowExplanationBrief,
  loadWorkflowSourceFile,
  normalizeWorkflowJsonBriefConfig,
  validateWorkflowDocument,
  workflowSourceFromManualJson,
  type WorkflowDocument,
} from './core.ts';

function fixture(): WorkflowDocument {
  return {
    id: 'sample-flow',
    name: 'Sample Flow',
    description: 'Turn one source into two parallel analyses and join the result.',
    laneLabels: ['Source', 'Parallel', 'Output'],
    nodes: [
      {
        id: 'source',
        type: 'source-node',
        title: 'Read Source',
        lane: 'Source',
        config: { apiKey: 'must-not-leak', url: 'https://example.com' },
      },
      {
        id: 'left',
        type: 'analysis-node',
        title: 'Analyze Left',
        lane: 'Parallel',
        config: { temperature: 0.2 },
      },
      {
        id: 'right',
        type: 'analysis-node',
        title: 'Analyze Right',
        lane: 'Parallel',
        config: { temperature: 0.4 },
      },
      {
        id: 'join',
        type: 'output-node',
        title: 'Join Results',
        lane: 'Output',
        config: {},
      },
    ],
    edges: [
      { id: 'source-left', fromNodeId: 'source', toNodeId: 'left' },
      { id: 'source-right', fromNodeId: 'source', toNodeId: 'right' },
      { id: 'left-join', fromNodeId: 'left', toNodeId: 'join' },
      { id: 'right-join', fromNodeId: 'right', toNodeId: 'join' },
    ],
  };
}

test('workflow graph analysis preserves parallel execution waves and graph roles', () => {
  const document = fixture();
  assert.deepEqual(validateWorkflowDocument(document), []);
  const graph = analyzeWorkflowGraph(document);
  assert.deepEqual(graph.waves, [['source'], ['left', 'right'], ['join']]);
  assert.deepEqual(graph.roots, ['source']);
  assert.deepEqual(graph.leaves, ['join']);
  assert.deepEqual(graph.branchPoints, ['source']);
  assert.deepEqual(graph.joinPoints, ['join']);
  assert.equal(graph.longestPathNodes, 3);
});

test('workflow validation reports dangling edges and cycles', () => {
  const dangling = fixture();
  dangling.edges.push({ id: 'missing', fromNodeId: 'join', toNodeId: 'nope' });
  assert.ok(validateWorkflowDocument(dangling).some((issue) => /missing target node/.test(issue)));

  const cyclic = fixture();
  cyclic.edges.push({ id: 'join-source', fromNodeId: 'join', toNodeId: 'source' });
  assert.ok(validateWorkflowDocument(cyclic).some((issue) => /contains a cycle/.test(issue)));
});

test('brief includes exact graph and redacts sensitive configuration', async () => {
  const source = workflowSourceFromManualJson(JSON.stringify(fixture()));
  const built = await buildWorkflowExplanationBrief({
    projectRoot: process.cwd(),
    config: normalizeWorkflowJsonBriefConfig({
      targetLanguage: 'Chinese',
      includeNodeDocs: false,
    }),
    source,
  });
  assert.match(built.markdown, /Sample Flow/);
  assert.match(built.markdown, /Wave 2: Analyze Left \[left\]; Analyze Right \[right\]/);
  assert.match(built.markdown, /"from": "source"/);
  assert.match(built.markdown, /\[REDACTED\]/);
  assert.doesNotMatch(built.markdown, /must-not-leak/);
  assert.equal(built.redactedConfigValues, 1);
});

test('file source stays inside the project root and respects size bounds', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-json-brief-'));
  const workflowDir = path.join(projectRoot, 'workflows', 'sample-flow');
  await fs.mkdir(workflowDir, { recursive: true });
  const workflowFile = path.join(workflowDir, 'workflow.json');
  await fs.writeFile(workflowFile, JSON.stringify(fixture()), 'utf8');
  try {
    const loaded = await loadWorkflowSourceFile(
      projectRoot,
      'workflows/sample-flow/workflow.json',
      100_000,
    );
    assert.equal(loaded.document.id, 'sample-flow');
    assert.equal(loaded.sourceLabel, 'workflows/sample-flow/workflow.json');
    await assert.rejects(
      loadWorkflowSourceFile(projectRoot, '../outside.json', 100_000),
      WorkflowBriefInputError,
    );
    await assert.rejects(
      loadWorkflowSourceFile(projectRoot, 'workflows/sample-flow/workflow.json', 20),
      /keep it within 20 bytes/,
    );
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
