import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildVideoRenderCommand,
  quoteShellArg,
  VIDEO_RENDER_SCRIPT,
} from './video-render-terminal.ts';
import { loadNodePlugins, nodePluginHasCapability, nodePluginScript } from './plugins.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

const OPTIONS = {
  projectRoot: "/tmp/project with 'quote'",
  scriptPath: '/tmp/nodes/app-video-render/render-video.sh',
  runId: 'run-1; touch /tmp/unsafe',
  baseUrl: 'http://127.0.0.1:3000',
  outputPath: '/tmp/assets/run-1/video.mp4',
};

test('the terminal runs the node-owned script directly, never an npm script', () => {
  const command = buildVideoRenderCommand(OPTIONS);

  assert.match(command, /'\/tmp\/nodes\/app-video-render\/render-video\.sh'/);
  // Routing through the host package.json is the coupling this replaced.
  assert.doesNotMatch(command, /npm/);
  assert.equal(VIDEO_RENDER_SCRIPT, 'render-video.sh');
});

test('every argument is shell-quoted, so a run id cannot inject a command', () => {
  assert.equal(quoteShellArg("a'b"), `'a'"'"'b'`);

  const command = buildVideoRenderCommand(OPTIONS);
  assert.match(command, /'--run-id' 'run-1; touch \/tmp\/unsafe'/);
  assert.match(command, /'--base-url' 'http:\/\/127\.0\.0\.1:3000'/);
  assert.match(command, /'--out' '\/tmp\/assets\/run-1\/video\.mp4'/);
  assert.match(command, /cd '\/tmp\/project with '"'"'quote'"'"''/);
  assert.match(command, /render_status=\$\?/);
});

test('the render script is resolved from whichever node owns the capability', async () => {
  await loadNodePlugins(PROJECT_ROOT, { log: false });

  // The host looks the script up by capability, never by node name.
  assert.ok(nodePluginHasCapability('app-video-render', 'video-spec'));
  const resolved = nodePluginScript('app-video-render', VIDEO_RENDER_SCRIPT);
  assert.equal(resolved, path.join(PROJECT_ROOT, 'nodes/app-video-render', VIDEO_RENDER_SCRIPT));

  // A node that ships no such file simply has nothing to run.
  assert.equal(nodePluginScript('clip-storyboard', VIDEO_RENDER_SCRIPT), null);
  assert.equal(nodePluginScript('no-such-node', VIDEO_RENDER_SCRIPT), null);
});

test('a script name can never reach outside its own node directory', async () => {
  await loadNodePlugins(PROJECT_ROOT, { log: false });

  for (const name of ['../../server/api.ts', '../clip-storyboard/config.ts', 'scripts/run.sh', '.env', '']) {
    assert.equal(
      nodePluginScript('app-video-render', name),
      null,
      `${JSON.stringify(name)} must not resolve`,
    );
  }
});
