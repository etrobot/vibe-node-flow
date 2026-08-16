import assert from 'node:assert/strict';
import test from 'node:test';
import { clipFileName, readNarrationSource } from './server.ts';
import { boundaryOffsets, resolveClipTiming, stripAnchors } from './timing.ts';

test('narration reads either a run asset manifest or a raw storyboard', () => {
  const fromStoryboard = readNarrationSource(JSON.stringify({
    slug: 'forge-app-launch',
    clips: [
      {
        speech: 'Ideas are everywhere. Most die because **building** was too hard.',
        items: [{ type: 'text-typing' }, { type: 'text-popup' }],
      },
      {
        speech: 'Describe the product you want and watch it **generate**.',
        items: [{ type: 'ui-prompt-input' }, { type: 'process-card-highlight' }],
      },
      {
        speech: 'It ships with authentication so you can **ship** it.',
        items: [{ type: 'ui-icon-text' }, { type: 'process-card-highlight' }],
      },
      {
        speech: 'Turn your idea into a real product.',
        items: [{ type: 'text-title' }, { type: 'text-logo' }],
      },
    ],
  }));
  assert.equal(fromStoryboard.clips.length, 4);
  assert.equal(fromStoryboard.slug, 'forge-app-launch');
  assert.equal(fromStoryboard.assetDir, null);
  assert.equal(fromStoryboard.clips[0].itemCount, 2);
  assert.equal(fromStoryboard.clips[0].plannedSeconds, undefined);

  const fromManifest = readNarrationSource(JSON.stringify({
    slug: 'forge-app-launch',
    assetDir: '/tmp/run-assets',
    chapterFiles: ['chapter-1.json'],
    document: { clips: [{ items: [{ type: 'ui-prompt-input', demoUi: { htmlFile: 'demo/clip-01-item-01.html' } }] }] },
    clips: [{ index: 0, speech: 'Ideas are **everywhere**.', itemCount: 2 }],
  }));
  assert.equal(fromManifest.assetDir, '/tmp/run-assets');
  assert.deepEqual(fromManifest.chapterFiles, ['chapter-1.json']);
  assert.equal((fromManifest.document as any)?.clips?.[0]?.items?.[0]?.demoUi?.htmlFile, 'demo/clip-01-item-01.html');
  assert.equal(fromManifest.clips[0].itemCount, 2);
  assert.equal(fromManifest.clips[0].plannedSeconds, undefined);

  assert.throws(() => readNarrationSource(''), /empty upstream output/);
  assert.throws(() => readNarrationSource('nope'), /not JSON/);
  assert.throws(() => readNarrationSource('{"clips":[]}'), /non-empty clips array/);
  assert.throws(
    () => readNarrationSource('{"clips":[{"speech":"ok"},{"speech":"  "}]}'),
    /Clips 2 have no speech/,
  );
});

test('stripping anchors yields the spoken string and where each anchor lands in it', () => {
  const { plain, anchors } = stripAnchors('Ideas are everywhere. **Building** was the bottleneck.');
  assert.equal(plain, 'Ideas are everywhere. Building was the bottleneck.');
  assert.deepEqual(anchors, [{ text: 'Building', charIndex: 22 }]);
  assert.equal(plain.slice(22, 30), 'Building');

  const wrapped = stripAnchors('Ideas   are\n  everywhere. **Building**  was hard.');
  assert.equal(wrapped.plain, 'Ideas are everywhere. Building was hard.');
  assert.equal(wrapped.plain.slice(wrapped.anchors[0].charIndex, wrapped.anchors[0].charIndex + 8), 'Building');
});

test('word boundaries map to character offsets even when a word repeats', () => {
  const plain = 'Ship it and ship it again.';
  const offsets = boundaryOffsets(plain, [
    { text: 'Ship', offsetSeconds: 0, durationSeconds: 0.3 },
    { text: 'it', offsetSeconds: 0.3, durationSeconds: 0.2 },
    { text: 'and', offsetSeconds: 0.5, durationSeconds: 0.2 },
    { text: 'ship', offsetSeconds: 0.7, durationSeconds: 0.3 },
    { text: 'it', offsetSeconds: 1.0, durationSeconds: 0.2 },
  ]);
  assert.deepEqual(offsets, [0, 5, 8, 12, 17]);
});

test('anchor timing places the cut where the voice said the anchor', () => {
  const result = resolveClipTiming({
    speech: 'Ideas are everywhere. **Building** was the bottleneck.',
    itemCount: 2,
    audioSeconds: 4.05,
    boundaries: [
      { text: 'Ideas', offsetSeconds: 0.00, durationSeconds: 0.40 },
      { text: 'are', offsetSeconds: 0.40, durationSeconds: 0.25 },
      { text: 'everywhere', offsetSeconds: 0.65, durationSeconds: 1.09 },
      { text: 'Building', offsetSeconds: 1.74, durationSeconds: 0.70 },
      { text: 'was', offsetSeconds: 2.44, durationSeconds: 0.25 },
      { text: 'the', offsetSeconds: 2.69, durationSeconds: 0.20 },
      { text: 'bottleneck', offsetSeconds: 2.89, durationSeconds: 1.16 },
    ],
  });

  assert.equal(result.measured, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items, [
    { index: 0, startSeconds: 0, durationSeconds: 1.74 },
    { index: 1, startSeconds: 1.74, durationSeconds: 2.31 },
  ]);
  assert.equal(
    result.items.reduce((total, item) => total + item.durationSeconds, 0).toFixed(2),
    '4.05',
  );
});

test('audio-only TTS maps anchor text position onto the measured MP3 duration', () => {
  const result = resolveClipTiming({
    speech: 'One two. **Three** four.',
    itemCount: 2,
    audioSeconds: 10,
    boundaries: [],
  });

  assert.equal(result.measured, false);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items, [
    { index: 0, startSeconds: 0, durationSeconds: 4.5 },
    { index: 1, startSeconds: 4.5, durationSeconds: 5.5 },
  ]);
});

test('partial timestamp matches do not make the first Chinese item consume the clip', () => {
  const result = resolveClipTiming({
    speech: '先介绍流程，**然后**展示结果，**最后**总结。',
    itemCount: 3,
    audioSeconds: 6,
    minItemSeconds: 0.35,
    boundaries: [
      { text: '先', offsetSeconds: 0, durationSeconds: 0.2 },
      { text: '介绍', offsetSeconds: 0.2, durationSeconds: 0.4 },
    ],
  });

  assert.equal(result.measured, false);
  assert.deepEqual(result.items.map((item) => item.durationSeconds), [2, 2.333, 1.667]);
  assert.ok(result.items.every((item) => item.durationSeconds >= 0.35));
});

test('timing falls back to an even split rather than guessing', () => {
  const boundaries = [
    { text: 'Ideas', offsetSeconds: 0, durationSeconds: 0.4 },
    { text: 'ship', offsetSeconds: 0.4, durationSeconds: 0.4 },
  ];

  const mismatched = resolveClipTiming({
    speech: 'Ideas ship.',
    itemCount: 3,
    audioSeconds: 3,
    boundaries,
  });
  assert.equal(mismatched.measured, false);
  assert.ok(mismatched.warnings.some((issue) => /instead of 2/.test(issue)));
  assert.deepEqual(mismatched.items.map((item) => item.durationSeconds), [1, 1, 1]);

  const single = resolveClipTiming({ speech: 'Ideas ship.', itemCount: 1, audioSeconds: 3, boundaries });
  assert.equal(single.measured, true);
  assert.deepEqual(single.items, [{ index: 0, startSeconds: 0, durationSeconds: 3 }]);

  const cramped = resolveClipTiming({
    speech: 'Ideas **ship**.',
    itemCount: 2,
    audioSeconds: 0.4,
    boundaries,
    minItemSeconds: 0.35,
  });
  assert.equal(cramped.measured, false);
  assert.deepEqual(cramped.items.map((item) => item.durationSeconds), [0.2, 0.2]);
});

test('anchors closer together than the floor are spread to keep every shot visible', () => {
  const result = resolveClipTiming({
    speech: 'A **b** **c** d.',
    itemCount: 3,
    audioSeconds: 4,
    minItemSeconds: 0.5,
    boundaries: [
      { text: 'A', offsetSeconds: 0.0, durationSeconds: 0.1 },
      { text: 'b', offsetSeconds: 0.1, durationSeconds: 0.05 },
      { text: 'c', offsetSeconds: 0.15, durationSeconds: 0.05 },
      { text: 'd', offsetSeconds: 0.2, durationSeconds: 0.1 },
    ],
  });
  assert.ok(result.items.every((item) => item.durationSeconds >= 0.5), 'no shot is below the floor');
  assert.equal(
    result.items.reduce((total, item) => total + item.durationSeconds, 0).toFixed(2),
    '4.00',
  );
});

test('clip audio file names are zero padded and one-based', () => {
  assert.equal(clipFileName(0), 'clip-01.mp3');
  assert.equal(clipFileName(11), 'clip-12.mp3');
});
