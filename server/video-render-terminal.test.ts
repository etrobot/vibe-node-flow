import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVideoRenderCommand,
  quoteShellArg,
} from './video-render-terminal.ts';

test('video terminal command shell-quotes run context and invokes the fixed renderer', () => {
  assert.equal(quoteShellArg("a'b"), `'a'"'"'b'`);
  const command = buildVideoRenderCommand({
    projectRoot: "/tmp/project with 'quote'",
    runId: 'run-1; touch /tmp/unsafe',
    baseUrl: 'http://127.0.0.1:3000',
  });
  assert.match(command, /'npm' 'run' 'render:video' '--' '--run-id'/);
  assert.match(command, /'run-1; touch \/tmp\/unsafe'/);
  assert.match(command, /'--base-url' 'http:\/\/127\.0\.0\.1:3000'/);
  assert.match(command, /render_status=\$\?/);
});
