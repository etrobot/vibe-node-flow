import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import demoPlugin, { renderDemoHtml } from './server.ts';
import composePlugin from '../app-video-compose/server.ts';

function storyboard() {
  return {
    slug: 'forge-app-launch',
    title: 'Forge',
    hook: 'Ideas become products.',
    summary: 'A builder turns descriptions into products.',
    closing: 'Ship the idea.',
    hue: 220,
    chapters: [{ title: 'Build', summary: 'Build it.', startClip: 0, clipCount: 2 }],
    clips: [
      {
        speech: 'Describe the product and **build** it.',
        background: 'aurora',
        items: [{ type: 'ui-prompt-input', prompt: 'Build a habit tracker', ctaText: 'Build' }, { type: 'text-zoom', title: 'Ship it' }],
      },
      {
        speech: 'Open the **preview**.',
        background: 'blur',
        items: [{ type: 'ui-video-preview', title: 'Your product is ready' }],
      },
    ],
  };
}

function context(node: any, input: Record<string, string>, assetsDir: string) {
  return {
    node,
    input,
    nodeOutputs: {},
    workflowId: 'test-workflow',
    runId: 'test-run',
    workflowDir: assetsDir,
    workflowDefinitionDir: assetsDir,
    assetsDir,
    nodeAssetsDir: assetsDir,
  } as any;
}

test('Demo UI HTML is deterministic and self-contained', async () => {
  const document = storyboard();
  const htmlA = renderDemoHtml({ clipIndex: 0, itemIndex: 0, item: document.clips[0].items[0] as any }, { width: 1920, height: 1080 });
  const htmlB = renderDemoHtml({ clipIndex: 0, itemIndex: 0, item: document.clips[0].items[0] as any }, { width: 1920, height: 1080 });
  assert.equal(htmlA, htmlB);
  assert.match(htmlA, /^<!doctype html>/i);
  assert.match(htmlA, /Build a habit tracker/);
  assert.match(htmlA, /data-demo-ui/);
  assert.doesNotMatch(htmlA, /https?:\/\//);
});

test('Demo UI node writes one HTML per product UI item', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-demo-'));
  try {
    const output = await demoPlugin.execute(context(
      { type: 'app-video-demo-ui', config: {} },
      { storyboard: JSON.stringify(storyboard()) },
      root,
    ));
    const manifest = JSON.parse(output.output);
    assert.equal(manifest.demoCount, 2);
    assert.deepEqual(manifest.demos.map((demo: any) => [demo.clipIndex, demo.itemIndex]), [[0, 0], [1, 0]]);
    for (const demo of manifest.demos) {
      const html = await fs.readFile(path.join(root, demo.htmlFile), 'utf8');
      assert.match(html, /data-demo-ui/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('compose node associates Demo UI without changing speech or duration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-compose-'));
  try {
    const chapterDir = path.join(root, 'chapter');
    await fs.mkdir(path.join(root, 'demo'), { recursive: true });
    await fs.writeFile(path.join(root, 'demo/clip-01-item-01.html'), '<!doctype html><body data-demo-ui></body>');
    const document = storyboard();
    const hydrated = {
      ...document,
      clips: document.clips.map((clip) => ({
        ...clip,
        speech: clip.speech.replaceAll(/\*\*/g, ''),
        items: clip.items.map((item) => ({ ...item, duration: 2 })),
      })),
    };
    await fs.mkdir(chapterDir, { recursive: true });
    await fs.writeFile(path.join(chapterDir, 'chapter-1.json'), JSON.stringify({ clips: [hydrated.clips[0], hydrated.clips[1]] }));
    const project = {
      slug: document.slug,
      assetDir: root,
      chapterFiles: ['chapter-1.json'],
      storyboard: document,
      document: hydrated,
      clips: [{ index: 0, speech: document.clips[0].speech, itemCount: 2 }, { index: 1, speech: document.clips[1].speech, itemCount: 1 }],
    };
    const demo = {
      kind: 'app-video-demo-ui',
      slug: document.slug,
      assetDir: root,
      demos: [
        { clipIndex: 0, itemIndex: 0, htmlFile: 'demo/clip-01-item-01.html' },
        { clipIndex: 1, itemIndex: 0, htmlFile: 'demo/clip-02-item-01.html' },
      ],
    };
    await fs.writeFile(path.join(root, 'demo/clip-02-item-01.html'), '<!doctype html><body data-demo-ui></body>');

    const output = await composePlugin.execute(context(
      { type: 'app-video-compose', config: {} },
      { project: JSON.stringify(project), demo: JSON.stringify(demo) },
      root,
    ));
    const composed = JSON.parse(output.output);
    const chapter = JSON.parse(await fs.readFile(path.join(chapterDir, 'chapter-1.json'), 'utf8'));
    assert.equal(chapter.clips[0].speech, hydrated.clips[0].speech);
    assert.equal(chapter.clips[0].items[0].duration, 2);
    assert.equal(chapter.clips[0].items[0].demoUi.htmlFile, 'demo/clip-01-item-01.html');
    assert.equal(chapter.clips[1].items[0].demoUi.itemIndex, 0);
    assert.equal(composed.composed, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

