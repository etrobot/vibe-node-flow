import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import demoPlugin from '../app-video-demo-ui/server.ts';
import uiHtmlPlugin from './server.ts';

function storyboard() {
  return {
    slug: 'forge-app-launch',
    clips: [
      {
        speech: 'Describe the product.',
        background: 'aurora',
        items: [{ type: 'ui-prompt-input', prompt: 'Build a habit tracker', ctaText: 'Build' }],
      },
      {
        speech: 'Open the preview.',
        background: 'blur',
        items: [{ type: 'ui-video-preview', title: 'Your product is ready' }],
      },
    ],
  };
}

function validHtml(label: string): string {
  return '<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#080b14;color:white}</style></head>'
    + '<body data-demo-ui data-target="' + label + '"><main>' + label + '</main></body></html>';
}

async function withMockProvider(
  responses: string[],
  run: (requests: any[]) => Promise<void>,
): Promise<void> {
  const requests: any[] = [];
  let responseIndex = 0;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const content = responses[Math.min(responseIndex++, responses.length - 1)];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      model: 'mock-ui-model',
      choices: [{ message: { content } }],
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const previous = {
    BASE_URL: process.env.BASE_URL,
    API_KEY: process.env.API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  process.env.BASE_URL = 'http://127.0.0.1:' + address.port;
  process.env.API_KEY = 'mock-key';
  process.env.LLM_MODEL = 'mock-ui-model';
  try {
    await run(requests);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function context(input: Record<string, string>, assetsDir: string) {
  return {
    node: { type: 'ui-html-generation', config: { retryLimit: 1, width: 1920, height: 1080 } },
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

test('UI HTML generation calls the model once per target and retries only the failing target', async () => {
  const document = storyboard();
  await withMockProvider(['bad html', validHtml('prompt'), validHtml('preview')], async (requests) => {
    const result = await uiHtmlPlugin.execute(context({
      storyboard: JSON.stringify(document),
      brief: 'Use only the supplied product facts.',
    }, '/tmp'));
    const output = JSON.parse(result.output);
    assert.equal(output.demos.length, 2);
    assert.deepEqual(output.demos.map((demo: any) => [demo.clipIndex, demo.itemIndex]), [[0, 0], [1, 0]]);
    assert.equal(requests.length, 3);
    assert.equal(requests[0].messages.length, 2);
    assert.equal(requests[1].messages.length, 4);
    assert.equal(requests[2].messages.length, 2);
    assert.match(requests[0].messages[1].content, /\"clipIndex\": 0/);
    assert.match(requests[1].messages.at(-1).content, /HTML is empty|HTML must/);
    assert.match(requests[2].messages[1].content, /\"clipIndex\": 1/);
    assert.doesNotMatch(requests[2].messages[1].content, /Build a habit tracker/);
    assert.match(result.logs.join('\n'), /model=mock-ui-model/);
  });
});

test('UI HTML generation fails the whole stage when one target exhausts its retries', async () => {
  const document = storyboard();
  await withMockProvider(['bad html'], async (requests) => {
    await assert.rejects(
      uiHtmlPlugin.execute(context({ storyboard: JSON.stringify(document) }, '/tmp')),
      (error: any) => {
        assert.match(error.message, /UI HTML generation failed for clip 1, item 1/);
        assert.match((error.logs || []).join('\n'), /failed validation/);
        return true;
      },
    );
    assert.equal(requests.length, 2);
  });
});

test('the deterministic Demo UI packager writes a complete generated manifest only after validation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-ui-generated-'));
  try {
    const document = storyboard();
    const generated = {
      kind: 'ui-html-generation',
      slug: document.slug,
      width: 1920,
      height: 1080,
      document,
      demos: [
        { clipIndex: 0, itemIndex: 0, html: validHtml('prompt'), generation: { model: 'mock-ui-model', attempt: 1 } },
        { clipIndex: 1, itemIndex: 0, html: validHtml('preview'), generation: { model: 'mock-ui-model', attempt: 1 } },
      ],
    };
    const result = await demoPlugin.execute({
      node: { type: 'app-video-demo-ui', config: {} },
      input: { 'ui-html-generation': JSON.stringify(generated) },
      nodeOutputs: {},
      workflowId: 'test-workflow',
      runId: 'test-run',
      workflowDir: root,
      workflowDefinitionDir: root,
      assetsDir: root,
      nodeAssetsDir: root,
    } as any);
    const manifest = JSON.parse(result.output);
    assert.equal(manifest.demoCount, 2);
    assert.equal(manifest.demos[0].generation.model, 'mock-ui-model');
    const html = await fs.readFile(path.join(root, manifest.demos[0].htmlFile), 'utf8');
    assert.equal(html, validHtml('prompt'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
