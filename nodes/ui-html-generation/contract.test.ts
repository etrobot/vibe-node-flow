import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findDemoUiTargets,
  normalizeDemoHtml,
  selectDemoUiTargets,
  validateDemoHtml,
  type DemoUiTarget,
} from './contract.ts';

const target: DemoUiTarget = {
  clipIndex: 0,
  itemIndex: 0,
  item: { type: 'ui-prompt-input', prompt: 'Build a habit tracker', ctaText: 'Build' } as any,
};

function wrap(body: string, headExtra = ''): string {
  return '<html><head><style>html,body{margin:0}</style>'
    + headExtra
    + '</head><body data-demo-ui>' + body + '</body></html>';
}

test('normalizes markdown fences and accepts HTML without a leading doctype', () => {
  const inner = wrap('<main>ready</main>');
  const fenced = 'Here you go:\n```html\n' + inner + '\n```\n';
  assert.equal(normalizeDemoHtml(fenced), inner);
  assert.deepEqual(validateDemoHtml(fenced, target), []);
  assert.deepEqual(validateDemoHtml(inner, target), []);
});

test('allows offline HTML with JS comments, SVG xmlns, and plain-text URLs', () => {
  const html = wrap(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="8"/></svg>'
    + '<p>Docs: https://example.com/docs</p>'
    + '<script>// boot the demo surface\nconst ready = true;</script>',
  );
  assert.deepEqual(validateDemoHtml(html, target), []);
});

test('rejects remote resource loads and network APIs with a snippet', () => {
  assert.match(
    validateDemoHtml(wrap('', '<script src="https://cdn.example.com/a.js"></script>'), target).join('\n'),
    /external network dependencies.*cdn\.example\.com/,
  );
  assert.match(
    validateDemoHtml(wrap('<img src="//cdn.example.com/a.png">'), target).join('\n'),
    /external network dependencies/,
  );
  assert.match(
    validateDemoHtml(
      wrap('', '<style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style>'),
      target,
    ).join('\n'),
    /external network dependencies/,
  );
  assert.match(
    validateDemoHtml(wrap('<script>fetch("/api")</script>'), target).join('\n'),
    /browser network APIs.*fetch/,
  );
});

test('does not treat the word fetch in copy as a network API call', () => {
  const html = wrap('<p>We fetch your latest build status.</p>');
  assert.deepEqual(validateDemoHtml(html, target), []);
});

test('selects at most two Demo UI HTML targets, preferring prompt + preview', () => {
  const document = {
    clips: [
      { items: [{ type: 'ui-render-loading' }, { type: 'ui-dropfiles' }] },
      { items: [{ type: 'ui-prompt-input', prompt: 'Build' }] },
      { items: [{ type: 'ui-video-preview' }, { type: 'ui-render-loading' }] },
    ],
  };
  const selected = findDemoUiTargets(document, 2);
  assert.deepEqual(
    selected.map((item) => [item.clipIndex, item.itemIndex, item.item.type]),
    [[1, 0, 'ui-prompt-input'], [2, 0, 'ui-video-preview']],
  );
  assert.equal(selectDemoUiTargets(findDemoUiTargets(document, 99), 2).length, 2);
});
