import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SOURCE_BRIEF_ASSET,
  readSourceBrief,
  stripEmbeddedSourceBrief,
  writeSourceBriefAsset,
} from '../lib/source-brief-asset.ts';

test('writeSourceBriefAsset stores the brief once and returns a relative path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-brief-'));
  try {
    const relative = await writeSourceBriefAsset(root, '## Compact Storyboard Context\nhello');
    assert.equal(relative, SOURCE_BRIEF_ASSET);
    assert.equal(
      (await fs.readFile(path.join(root, relative), 'utf8')).trim(),
      '## Compact Storyboard Context\nhello',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('readSourceBrief prefers the path and falls back to embedded text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-brief-read-'));
  try {
    await writeSourceBriefAsset(root, 'from-file');
    assert.equal(await readSourceBrief({ sourceBriefPath: SOURCE_BRIEF_ASSET, sourceBrief: 'legacy' }, root), 'from-file');
    assert.equal(await readSourceBrief({ sourceBrief: 'legacy-only' }, root), 'legacy-only');
    assert.equal(await readSourceBrief({}, root), '');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stripEmbeddedSourceBrief keeps the path reference', () => {
  const stripped = stripEmbeddedSourceBrief({
    slug: 'demo',
    sourceBrief: 'huge',
    sourceBriefPath: SOURCE_BRIEF_ASSET,
  });
  assert.equal(stripped.sourceBrief, undefined);
  assert.equal(stripped.sourceBriefPath, SOURCE_BRIEF_ASSET);
  assert.equal(stripped.slug, 'demo');
});
