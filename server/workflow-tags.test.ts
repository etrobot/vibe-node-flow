import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  DEFAULT_NODE_TAG_CATALOG,
  getNodeTagColors,
  mergeNodeTagCatalog,
  uniqueNodeTags,
  uniqueWorkflowTags,
  workflowHasAnyTag,
  workflowHasTag,
} from '../lib/workflow-tags';

test('node tag catalogs keep built-ins and merge custom selections case-insensitively', () => {
  assert.deepEqual(
    mergeNodeTagCatalog(['crm', 'ENV'], ['CRM', 'Warehouse']),
    [...DEFAULT_NODE_TAG_CATALOG, 'crm', 'Warehouse'],
  );
  assert.deepEqual(uniqueNodeTags([' ENV ', 'env', '', 'CRM']), ['ENV', 'CRM']);
});

test('workflow discovery tags stay unique and match filters case-insensitively', () => {
  assert.deepEqual(uniqueWorkflowTags([' Video ', 'video', '', 'Daily']), ['Video', 'Daily']);
  assert.equal(workflowHasTag(['Video', 'Daily'], 'video'), true);
  assert.equal(workflowHasAnyTag(['Video'], ['daily', 'VIDEO']), true);
  assert.equal(workflowHasAnyTag(['Video'], ['daily']), false);
  assert.equal(workflowHasAnyTag(['Video'], []), true);
});

test('macaron colors are stable and built-in tags use distinct presets', () => {
  assert.deepEqual(getNodeTagColors('CRM'), getNodeTagColors('crm'));
  assert.notDeepEqual(getNodeTagColors('DB'), getNodeTagColors('ENV'));
  assert.notDeepEqual(getNodeTagColors('ENV'), getNodeTagColors('FS'));
});

function runStorageScript(workflowsDir: string, dataDir: string, script: string) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', script],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        GENNO_DIR: workflowsDir,
        GENNO_DATA_DIR: dataDir,
      },
    },
  );
}

test('storage upgrades legacy workflows with the default tag catalog and persists node tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genno-tags-'));
  const workflowsDir = path.join(root, 'workflows');
  const workflowDir = path.join(workflowsDir, 'legacy-tags');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(workflowDir, { recursive: true });

  fs.writeFileSync(
    path.join(workflowDir, 'workflow.json'),
    JSON.stringify({
      id: 'legacy-tags',
      name: 'Legacy tags',
      description: 'Compatibility fixture',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      tags: ['workflow-metadata'],
      nodes: [{
        id: 'node-a',
        type: 'content-brief',
        title: 'Node A',
        icon: 'Puzzle',
        x: 75,
        y: 87,
        tags: ['CRM'],
        config: {},
      }],
      edges: [],
    }, null, 2),
    'utf8',
  );

  try {
    const storageUrl = new URL('./storage.ts', import.meta.url).href;
    const script = `
      const storage = await import(${JSON.stringify(storageUrl)});
      const workflow = storage.getWorkflow('legacy-tags');
      if (!workflow) throw new Error('Workflow not found');
      storage.saveWorkflow(workflow);
      process.stdout.write(JSON.stringify(workflow));
    `;
    const result = runStorageScript(workflowsDir, dataDir, script);

    assert.equal(result.status, 0, result.stderr);
    const loaded = JSON.parse(result.stdout);
    assert.deepEqual(loaded.tagCatalog, [...DEFAULT_NODE_TAG_CATALOG, 'CRM']);
    assert.deepEqual(loaded.tags, ['workflow-metadata']);
    assert.deepEqual(loaded.nodes[0].tags, ['CRM']);
    assert.equal(loaded.nodes[0].lane, 'Lane 1');
    assert.equal(loaded.nodes[0].x, 60);
    assert.equal(loaded.nodes[0].y, 80);

    const persisted = JSON.parse(fs.readFileSync(path.join(workflowDir, 'workflow.json'), 'utf8'));
    assert.deepEqual(persisted.tagCatalog, [...DEFAULT_NODE_TAG_CATALOG, 'CRM']);
    assert.deepEqual(persisted.tags, ['workflow-metadata']);
    assert.deepEqual(persisted.nodes[0].tags, ['CRM']);
    assert.equal(persisted.nodes[0].lane, 'Lane 1');
    assert.equal(persisted.nodes[0].x, 60);
    assert.equal(persisted.nodes[0].y, 80);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('updateWorkflowMeta persists and clears discovery tags; duplicate copies them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genno-wf-tags-'));
  const workflowsDir = path.join(root, 'workflows');
  const workflowDir = path.join(workflowsDir, 'tagged-wf');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(workflowDir, { recursive: true });

  fs.writeFileSync(
    path.join(workflowDir, 'workflow.json'),
    JSON.stringify({
      id: 'tagged-wf',
      name: 'Tagged workflow',
      description: 'Discovery tags fixture',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      nodes: [],
      edges: [],
    }, null, 2),
    'utf8',
  );

  try {
    const storageUrl = new URL('./storage.ts', import.meta.url).href;
    const script = `
      const storage = await import(${JSON.stringify(storageUrl)});
      const updated = storage.updateWorkflowMeta(
        'tagged-wf',
        undefined,
        undefined,
        undefined,
        undefined,
        [' Video ', 'video', 'Daily'],
      );
      const duplicated = storage.duplicateWorkflow('tagged-wf');
      const cleared = storage.updateWorkflowMeta(
        'tagged-wf',
        undefined,
        undefined,
        undefined,
        undefined,
        [],
      );
      process.stdout.write(JSON.stringify({
        updatedTags: updated.tags,
        duplicatedTags: duplicated.tags,
        clearedTags: cleared.tags,
        duplicatedId: duplicated.id,
      }));
    `;
    const result = runStorageScript(workflowsDir, dataDir, script);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.updatedTags, ['Video', 'Daily']);
    assert.deepEqual(payload.duplicatedTags, ['Video', 'Daily']);
    assert.deepEqual(payload.clearedTags, []);

    const sourcePersisted = JSON.parse(fs.readFileSync(path.join(workflowDir, 'workflow.json'), 'utf8'));
    assert.equal(sourcePersisted.tags, undefined);
    const copyPersisted = JSON.parse(
      fs.readFileSync(path.join(workflowsDir, payload.duplicatedId, 'workflow.json'), 'utf8'),
    );
    assert.deepEqual(copyPersisted.tags, ['Video', 'Daily']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
