import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { FlowNode } from '../../App/types.ts';
import type { NodePluginContext } from '../../server/plugins.ts';
import { CLIP_ITEM_TYPES } from './renderer/clipTypes.ts';
import {
  buildMuxArgs,
  hasCompleteItemTiming,
  mergeUpstreamManifests,
  narrationOverruns,
  resolvePackageDir,
  tailLines,
  validateRenderProject,
} from './render.ts';
import { executeAppVideoRender } from './server.ts';

const RUN_ASSET_MANIFEST = JSON.stringify({
  slug: 'forge-app-launch',
  assetDir: '/assets/generated/run-1',
  clipCount: 2,
});

const NARRATION_MANIFEST = JSON.stringify({
  slug: 'forge-app-launch',
  audioDir: '/assets/generated/node-narration',
  clips: [
    { index: 0, file: 'clip-01.mp3', durationSeconds: 3.1 },
    { index: 1, file: 'clip-02.mp3', durationSeconds: 4.4 },
  ],
});

const TIMED_ANCHOR_DOCUMENT = {
  slug: 'forge-app-launch',
  clips: [{
    speech: 'Turn an idea into a product. **Ship the measured result.**',
    background: 'aurora',
    items: [
      { type: 'image', url: 'assets/launch.png', duration: 1.2 },
      { type: 'video', url: 'assets/demo.mp4', duration: 1.8 },
    ],
  }],
};

const WORKFLOW_CANVAS_GRAPH = {
  workflow: {
    id: 'workflow-demo',
    name: 'Workflow Demo',
    lanes: ['Source', 'Output'],
  },
  nodes: [
    { id: 'source', title: 'Read Source', lane: 'Source' },
    { id: 'output', title: 'Write Output', lane: 'Output' },
  ],
  edges: [{ from: 'source', to: 'output' }],
};

function renderNode(config: Record<string, unknown>): FlowNode {
  return {
    id: 'node-render',
    type: 'app-video-render',
    title: 'App Video Render',
    icon: 'Film',
    lane: 'Output',
    x: 0,
    y: 0,
    config,
    status: 'idle',
  };
}

function renderContext(
  root: string,
  input: Record<string, string>,
  config: Record<string, unknown> = {},
): NodePluginContext {
  return {
    node: renderNode(config),
    input,
    nodeOutputs: {},
    workflowId: 'workflow-test',
    runId: 'run-test',
    workflowDir: root,
    assetsDir: path.join(root, 'generated'),
    nodeAssetsDir: path.join(root, 'node-assets'),
    databasePath: path.join(root, 'studio.db'),
  };
}

test('upstream manifests merge into the slug, audio directory, and clip list', () => {
  const facts = mergeUpstreamManifests({
    'node-storyboard': RUN_ASSET_MANIFEST,
    'node-narration': NARRATION_MANIFEST,
  });

  assert.equal(facts.slug, 'forge-app-launch');
  assert.equal(facts.audioDir, '/assets/generated/node-narration');
  assert.deepEqual(facts.narrationClips.map((clip) => clip.file), ['clip-01.mp3', 'clip-02.mp3']);
});

test('a narration-only upstream is enough, and out-of-order clips are sorted', () => {
  const facts = mergeUpstreamManifests({
    'node-narration': JSON.stringify({
      slug: 'forge-app-launch',
      audioDir: '/project/voice',
      clips: [
        { index: 1, file: 'clip-02.mp3', durationSeconds: 2 },
        { index: 0, file: 'clip-01.mp3', durationSeconds: 1 },
      ],
    }),
  });

  assert.equal(facts.audioDir, '/project/voice');
  assert.deepEqual(facts.narrationClips.map((clip) => clip.index), [0, 1]);
});

test('clip offsets come from the narration timeline, not from a running total', () => {
  const facts = mergeUpstreamManifests({
    'node-narration': JSON.stringify({
      slug: 'forge-app-launch',
      audioDir: '/project/voice',
      timeline: [
        { clipIndex: 0, startSeconds: 0, durationSeconds: 3.1 },
        { clipIndex: 1, startSeconds: 3.1, durationSeconds: 4.4 },
      ],
      clips: [
        { index: 0, file: 'clip-01.mp3', durationSeconds: 3.1 },
        { index: 1, file: 'clip-02.mp3', durationSeconds: 4.4 },
      ],
    }),
  });

  assert.deepEqual(facts.narrationClips.map((clip) => clip.startSeconds), [0, 3.1]);
});

test('manifests written before the timeline fall back to the clip start offsets', () => {
  const facts = mergeUpstreamManifests({
    'node-narration': JSON.stringify({
      slug: 'forge-app-launch',
      audioDir: '/project/voice',
      clips: [
        { index: 0, file: 'clip-01.mp3', durationSeconds: 3.1, startSeconds: 0 },
        { index: 1, file: 'clip-02.mp3', durationSeconds: 4.4, startSeconds: 3.1 },
      ],
    }),
  });

  assert.deepEqual(facts.narrationClips.map((clip) => clip.startSeconds), [0, 3.1]);
});

test('toRendererDocument expands global-components so preview and MP4 share the same cards', async () => {
  const { toRendererDocument } = await import('./document.ts');
  const compact = {
    title: 'Forge',
    hue: 12,
    palette: { accent: '#ff0000' },
    'global-components': [{
      key: 'build-flow',
      component: 'process-card-highlight',
      cards: [
        { key: 'describe', icon: 'MessageSquare', title: 'Describe' },
        { key: 'generate', icon: 'Sparkles', title: 'Generate' },
        { key: 'ship', icon: 'Rocket', title: 'Ship' },
      ],
    }],
    clips: [{
      speech: 'Watch it **generate**.',
      background: 'semrush-glow',
      items: [
        { type: 'text-typing', title: 'Idea' },
        { type: 'process-card-highlight', key: 'build-flow', spot: 'generate' },
      ],
    }],
  };

  const rendered = toRendererDocument(compact) as any;
  const cards = rendered.clips[0].items[1].cards;
  assert.deepEqual(cards.map((card: any) => [card.icon, card.title]), [
    ['MessageSquare', 'Describe'],
    ['Sparkles', 'Generate'],
    ['Rocket', 'Ship'],
  ]);
  assert.equal(rendered.clips[0].items[1].targetIndex, 1);
  assert.equal(rendered.clips[0].items[1].key, undefined);
  assert.equal(rendered.hue, undefined, 'renderer theme is not read from project JSON');
  assert.equal(rendered.palette, undefined, 'renderer palette is not read from project JSON');
  assert.equal(rendered.clips[0].background, 'aurora', 'background is assigned by clip order');
});

test('render facts preserve an embedded storyboard document for preview recovery', () => {
  const document = {
    slug: 'forge-app-launch',
    clips: [{
      speech: 'A launch message.',
      background: 'aurora',
      items: [{ type: 'text-typing', title: 'Launch', duration: 2 }],
    }],
  };
  const facts = mergeUpstreamManifests({
    'node-storyboard': JSON.stringify({
      slug: document.slug,
      document,
      clips: [{ index: 0, speech: document.clips[0].speech, background: 'aurora' }],
    }),
  });

  assert.deepEqual(facts.document, document);
});

test('render facts preserve the exact workflow graph from the Demo UI manifest', () => {
  const facts = mergeUpstreamManifests({
    'node-ui': JSON.stringify({
      kind: 'ui-html-generation',
      slug: 'workflow-demo',
      workflowGraph: WORKFLOW_CANVAS_GRAPH,
      demos: [],
    }),
  });

  assert.deepEqual(facts.workflowGraph, WORKFLOW_CANVAS_GRAPH);
});

test('English Mermaid manifests attach normalized targets to the timed narration document', () => {
  const storyboard = {
    slug: 'workflow-demo',
    clips: [{
      speech: 'Show the **workflow**.',
      background: 'aurora',
      items: [
        { type: 'ui-video-preview', title: 'Canvas', demoUi: 'workflow-canvas' },
        { type: 'ui-video-preview', title: 'Diagram', demoUi: 'node-mermaid' },
      ],
    }],
  };
  const mermaidDocument = structuredClone(storyboard) as any;
  mermaidDocument.clips[0].items[0].demoUi = { state: 'workflow-canvas' };
  mermaidDocument.clips[0].items[1].demoUi = {
    state: 'node-mermaid',
    materialId: 'node-one-diagram-1-12345678',
  };
  const facts = mergeUpstreamManifests({
    'node-narration': JSON.stringify({
      ...storyboard,
      audioDir: '/voice',
      clips: [{ index: 0, file: 'clip-01.mp3', durationSeconds: 2 }],
    }),
    'node-mermaid-en-html': JSON.stringify({
      kind: 'mermaid-en-html',
      document: mermaidDocument,
      demos: [
        { clipIndex: 0, itemIndex: 0, htmlFile: 'demo/clip-01-item-01.html' },
        { clipIndex: 0, itemIndex: 1, htmlFile: 'demo/clip-01-item-02.html' },
      ],
    }),
  });

  assert.equal(facts.generatedDemos.length, 2);
  assert.deepEqual(facts.document?.clips?.[0]?.items?.map((item: any) => item.demoUi), [
    { state: 'workflow-canvas' },
    { state: 'node-mermaid', materialId: 'node-one-diagram-1-12345678' },
  ]);
});

test('renderer validation accepts measured durations while authored anchors remain in speech', () => {
  const report = validateRenderProject(TIMED_ANCHOR_DOCUMENT);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.deepEqual(report.metrics, { clips: 1, items: 2, timedItems: 2 });
  assert.equal(hasCompleteItemTiming(TIMED_ANCHOR_DOCUMENT), true);
});

test('renderer validation accepts every item type implemented by the app node', () => {
  const report = validateRenderProject({
    clips: [{
      speech: 'Exercise the complete renderer-owned scene catalog.',
      background: 'semrush-glow',
      items: CLIP_ITEM_TYPES.map((type) => ({ type, duration: 0.5 })),
    }],
  });

  assert.deepEqual(report.errors, []);
  assert.equal(report.metrics.items, CLIP_ITEM_TYPES.length);
  assert.equal(report.metrics.timedItems, CLIP_ITEM_TYPES.length);
});

test('renderer validation rejects unsupported shapes but treats missing timing as advisory', () => {
  const invalid = validateRenderProject({
    clips: [{
      speech: 'Invalid render input.',
      background: 'unknown',
      items: [
        { type: 'not-a-renderer-item', duration: 0 },
        { type: 'image', duration: '2' },
        { type: 'video' },
      ],
    }],
  });

  assert.match(invalid.errors.join('\n'), /background must be one of/);
  assert.match(invalid.errors.join('\n'), /unsupported type/);
  assert.equal(invalid.errors.filter((error) => /duration must be a positive number/.test(error)).length, 2);
  assert.match(invalid.warnings.join('\n'), /renderer item\(s\) have no positive duration/);
  assert.equal(hasCompleteItemTiming({ clips: [{ items: [{ duration: '2' }] }] }), false);

  const empty = validateRenderProject({ clips: [] });
  assert.match(empty.errors.join('\n'), /clips must be a non-empty array/);
});

test('timed narration document wins over an earlier untimed UI document', () => {
  const untimedDocument = {
    slug: 'forge-app-launch',
    clips: [{
      speech: 'An early UI document.',
      background: 'blur',
      items: [{ type: 'text-typing', title: 'Early' }],
    }],
  };
  const facts = mergeUpstreamManifests({
    'node-ui': JSON.stringify({
      kind: 'ui-html-generation',
      slug: 'forge-app-launch',
      document: untimedDocument,
      demos: [],
    }),
    'node-narration': JSON.stringify({
      slug: 'forge-app-launch',
      document: TIMED_ANCHOR_DOCUMENT,
      audioDir: '/voice',
      timeline: [{ clipIndex: 0, startSeconds: 0, durationSeconds: 3 }],
      clips: [{ index: 0, file: 'clip-01.mp3', durationSeconds: 2.8 }],
    }),
  });

  assert.deepEqual(facts.document, TIMED_ANCHOR_DOCUMENT);
  assert.equal(hasCompleteItemTiming(facts.document), true);
});

test('clip file names that are not clip-NN.mp3 are refused', () => {
  const facts = mergeUpstreamManifests({
    'node-narration': JSON.stringify({
      slug: 'forge-app-launch',
      audioDir: '/audio',
      clips: [
        { index: 0, file: '../../etc/passwd' },
        { index: 1, file: '/tmp/evil.mp3' },
      ],
    }),
  });

  assert.equal(facts.narrationClips.length, 0);
  assert.equal(facts.audioDir, null);
});

test('empty, unparseable, and unsupported upstream output are rejected by the node', () => {
  assert.throws(() => mergeUpstreamManifests({}), /at least one non-empty upstream manifest/);
  assert.throws(() => mergeUpstreamManifests({ a: '   ' }), /at least one non-empty upstream manifest/);
  assert.throws(
    () => mergeUpstreamManifests({ a: 'not json' }),
    /No upstream output was recognized as a supported JSON manifest\. Unsupported upstream: a\./,
  );
  assert.throws(
    () => mergeUpstreamManifests({ empty: '{}', metadata: '{"foo":"bar"}' }),
    /Unsupported upstream: empty, metadata\./,
  );
});

test('unsupported extra upstream is accepted and records every skipped node id', () => {
  const facts = mergeUpstreamManifests({
    'node-storyboard': RUN_ASSET_MANIFEST,
    'node-notes': 'plain text brief',
    'node-empty': '{}',
    'node-metadata': '{"foo":"bar"}',
  });

  assert.equal(facts.slug, 'forge-app-launch');
  assert.deepEqual(facts.unparsedUpstream, ['node-notes', 'node-empty', 'node-metadata']);
});

test('execute keeps validation advisories in output without warning the workflow', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'genno-render-'));
  try {
    const untimedDocument = {
      slug: 'forge-app-launch',
      clips: [{
        speech: 'Timing will be derived later.',
        background: 'blur',
        items: [{ type: 'text-typing', title: 'Derived timing' }],
      }],
    };
    const result = await executeAppVideoRender(
      renderContext(root, {
        'node-storyboard': JSON.stringify(untimedDocument),
        'node-notes': 'A plain-text note that is not a render manifest.',
      }, { dryRun: true }),
      { preflight: async () => ({ problems: [], notes: [] }) },
    );
    const manifest = JSON.parse(String(result.output));

    assert.equal(result.status, undefined);
    assert.equal(result.error, undefined);
    assert.equal(manifest.ready, true);
    assert.ok(manifest.warnings.some((warning: unknown) => String(warning).includes('node-notes')));
    assert.ok(manifest.warnings.some((warning: unknown) => String(warning).includes('no positive duration')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('execute accepts the timed anchor document emitted by narration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'genno-render-'));
  try {
    const result = await executeAppVideoRender(
      renderContext(root, {
        'node-narration': JSON.stringify({
          slug: 'forge-app-launch',
          document: TIMED_ANCHOR_DOCUMENT,
          audioDir: '/voice',
          timeline: [{ clipIndex: 0, startSeconds: 0, durationSeconds: 3 }],
          clips: [{ index: 0, file: 'clip-01.mp3', durationSeconds: 2.8 }],
        }),
      }, { dryRun: true }),
      { preflight: async () => ({ problems: [], notes: [] }) },
    );
    const manifest = JSON.parse(String(result.output));

    assert.equal(result.status, undefined);
    assert.deepEqual(manifest.warnings, []);
    assert.match(manifest.document.clips[0].speech, /\*\*Ship the measured result\.\*\*/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('publishes upstream combined narration under the render run asset id', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'genno-render-'));
  const upstreamAudioDir = path.join(root, 'upstream-audio');
  try {
    await fs.mkdir(upstreamAudioDir, { recursive: true });
    await fs.writeFile(path.join(upstreamAudioDir, 'narration.mp3'), 'fake-mp3');
    const result = await executeAppVideoRender(
      renderContext(root, {
        'node-narration': JSON.stringify({
          slug: 'forge-app-launch',
          document: TIMED_ANCHOR_DOCUMENT,
          audioDir: upstreamAudioDir,
          clips: [{ index: 0, file: 'clip-01.mp3', durationSeconds: 2.8 }],
        }),
      }),
      { preflight: async () => ({ problems: [], notes: [] }) },
    );
    const manifest = JSON.parse(String(result.output));

    assert.equal(manifest.narrationUrl, '/api/workflows/workflow-test/assets/run-test/narration.mp3');
    assert.equal(await fs.readFile(path.join(root, 'generated', 'narration.mp3'), 'utf8'), 'fake-mp3');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('execute revalidates generated workflow HTML against the merged exact graph', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'genno-render-'));
  try {
    const document = {
      slug: 'workflow-demo',
      clips: [{
        speech: 'Show the exact workflow graph.',
        background: 'aurora',
        items: [{
          type: 'ui-video-preview',
          duration: 2,
          demoUi: { state: 'workflow-canvas' },
        }],
      }],
    };
    const htmlWithoutEdge = [
      '<!doctype html><html><head><style>body{margin:0}</style></head>',
      '<body data-demo-ui><main data-workflow-canvas>',
      '<section data-lane="Source"><article data-node-id="source">Read Source</article></section>',
      '<section data-lane="Output"><article data-node-id="output">Write Output</article></section>',
      '</main></body></html>',
    ].join('');

    await assert.rejects(
      executeAppVideoRender(
        renderContext(root, {
          'node-ui': JSON.stringify({
            kind: 'ui-html-generation',
            slug: 'workflow-demo',
            document,
            workflowGraph: WORKFLOW_CANVAS_GRAPH,
            demos: [{ clipIndex: 0, itemIndex: 0, html: htmlWithoutEdge }],
          }),
        }, { dryRun: true }),
        { preflight: async () => ({ problems: [], notes: [] }) },
      ),
      /missing directed edge marker "source -> output"/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('each clip MP3 is delayed to its own start and mixed without normalization', () => {
  const args = buildMuxArgs({
    videoPath: '/project/renders/flow-1/silent.mp4',
    tracks: [
      { path: '/voice/clip-01.mp3', startSeconds: 0 },
      { path: '/voice/clip-02.mp3', startSeconds: 3.5 },
    ],
    musicPath: '/project/music/bgm.mp3',
    musicVolume: 0.18,
    totalSeconds: 12.25,
    audioBitrate: '192k',
    outputPath: '/project/renders/flow-1/final.mp4',
  });

  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[1:a\]aformat=[^,]+,adelay=0:all=1\[voice0\]/);
  assert.match(filter, /\[2:a\]aformat=[^,]+,adelay=3500:all=1\[voice1\]/);
});

test('log tails drop blank lines and keep the end of the output', () => {
  assert.deepEqual(tailLines('a\n\nb\r\nc  \n', 2), ['b', 'c']);
  assert.deepEqual(tailLines('', 5), []);
});
