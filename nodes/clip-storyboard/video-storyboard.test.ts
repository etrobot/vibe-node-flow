import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateDurationSeconds,
  estimateSpeechSeconds,
  parseStoryboardJson,
  plainSpeech,
  speechAnchors,
  validateStoryboard,
  type StoryboardDocument,
  type StoryboardValidationOptions,
} from './contract.ts';
import { hydrateDocument } from './resolve.ts';
import { buildStoryboardPrompt } from './server.ts';
import { DEFAULT_CLIP_STORYBOARD_CONFIG } from './config.ts';
import { clipFileName, readNarrationSource } from '../edge-tts-narration/server.ts';
import { boundaryOffsets, resolveClipTiming, stripAnchors } from '../edge-tts-narration/timing.ts';

const OPTIONS: StoryboardValidationOptions = {
  minClips: 3,
  maxClips: 12,
  minComponentTypes: 6,
  targetDurationSeconds: 20,
  durationTolerance: 0.35,
  timingMode: 'anchor',
  maxGlobalComponents: 12,
};

/**
 * Four clips under anchor timing: no item durations, one `**anchor**` per extra
 * item, and one reusable structure revisited from two different clips.
 */
function fixture(): StoryboardDocument {
  return {
    slug: 'forge-app-launch',
    title: 'Forge',
    hook: 'Ideas are everywhere.',
    summary: 'An AI builder turns a described idea into a working product.',
    closing: 'Turn your idea into a real product.',
    hue: 345,
    chapters: [
      { title: 'The Spark', summary: 'Ideas outnumber shipped products.', startClip: 0, clipCount: 2 },
      { title: 'Until Now', summary: 'Describing the product is enough.', startClip: 2, clipCount: 2 },
    ],
    'global-components': [
      {
        key: 'build-flow',
        component: 'process-card-highlight',
        cards: [
          { key: 'describe', icon: 'MessageSquare', title: 'Describe' },
          { key: 'generate', icon: 'Sparkles', title: 'Generate' },
          { key: 'ship', icon: 'Rocket', title: 'Ship' },
        ],
      },
    ],
    clips: [
      {
        speech: 'Ideas are everywhere. Most die because **building** was too hard for one person alone.',
        background: 'blur',
        items: [
          { type: 'text-typing', title: 'Describe it' },
          { type: 'text-popup', title: 'Ship today' },
        ],
      },
      {
        speech: 'Describe the product you want and watch it **generate** into something you can open.',
        background: 'aurora',
        items: [
          { type: 'ui-prompt-input', prompt: 'Build a habit tracker' },
          { type: 'process-card-highlight', key: 'build-flow', spot: 'generate' },
        ],
      },
      {
        speech: 'It ships with authentication and a database, so you can **ship** it the same afternoon.',
        background: 'wave',
        items: [
          { type: 'ui-icon-text', title: 'Auth included', icon: 'ShieldCheck' },
          { type: 'process-card-highlight', key: 'build-flow', spot: 'ship' },
        ],
      },
      {
        speech: 'Turn your idea into a real product and **launch** it.',
        background: 'semrush-glow',
        items: [
          { type: 'text-title', title: 'Forge' },
          { type: 'text-logo', title: 'Forge' },
        ],
      },
    ],
  } as StoryboardDocument;
}

test('rejects more than two Demo UI HTML placeholders', () => {
  const document = fixture();
  document.clips[0].items = [
    { type: 'ui-prompt-input', prompt: 'One' } as any,
    { type: 'ui-render-loading' } as any,
  ];
  document.clips[1].items = [
    { type: 'ui-video-preview' } as any,
    { type: 'ui-dropfiles' } as any,
  ];
  const { errors } = validateStoryboard(document, { ...OPTIONS, maxDemoUiHtmlItems: 2 });
  assert.ok(errors.some((issue) => /at most 2/.test(issue)));
});

test('a conforming anchor-timed storyboard passes and reports its metrics', () => {
  const report = validateStoryboard(fixture(), OPTIONS);
  assert.deepEqual(report.errors, []);
  assert.equal(report.metrics.clips, 4);
  assert.equal(report.metrics.chapters, 2);
  assert.equal(report.metrics.globalComponents, 1);
  assert.equal(report.metrics.componentTypes, 7);
  assert.equal(report.metrics.demoUiHtmlItems, 1);
  // No authored seconds: runtime is estimated from the narration itself.
  assert.equal(
    report.metrics.estimatedSeconds,
    Number(estimateDurationSeconds(fixture().clips).toFixed(1)),
  );
});

test('anchors are direction for the picture, never text the voice reads', () => {
  assert.deepEqual(speechAnchors('Ideas **build** and **ship**.'), ['build', 'ship']);
  assert.equal(plainSpeech('Ideas **build** and **ship**.'), 'Ideas build and ship.');
  assert.ok(estimateSpeechSeconds('one two three four five') > 0);
  // Anchors must not inflate the estimate.
  assert.equal(estimateSpeechSeconds('one **two** three'), estimateSpeechSeconds('one two three'));
});

test('a clip needs exactly one anchor fewer than it has items', () => {
  const missing = fixture();
  missing.clips[0].speech = 'Ideas are everywhere. Most die because building was too hard for one person.';
  assert.ok(validateStoryboard(missing, OPTIONS).errors.some(
    (issue) => /Clip 1 has 2 items so speech needs exactly 1 \*\*anchor\*\*/.test(issue),
  ));

  const extra = fixture();
  extra.clips[0].speech = 'Ideas are **everywhere**. Most die because **building** was too hard for one.';
  assert.ok(validateStoryboard(extra, OPTIONS).errors.some(
    (issue) => /found 2/.test(issue),
  ));
});

test('under duration timing the old plain-speech contract still holds', () => {
  const document = fixture();
  const options = { ...OPTIONS, timingMode: 'duration' as const, targetDurationSeconds: 16 };
  // Anchors are now illegal, and every item needs seconds.
  const { errors } = validateStoryboard(document, options);
  assert.ok(errors.some((issue) => /Clip 1 speech contains \*\* markers/.test(issue)));
  assert.ok(errors.some((issue) => /Clip 1 item 1 duration must be a positive number/.test(issue)));

  const timed = fixture();
  for (const clip of timed.clips) {
    clip.speech = plainSpeech(clip.speech);
    clip.items.forEach((item) => { item.duration = 2; });
  }
  assert.deepEqual(validateStoryboard(timed, options).errors, []);
  assert.equal(estimateDurationSeconds(timed.clips, 'duration'), 16);
});

test('fenced or prose-wrapped JSON responses are recovered', () => {
  const document = parseStoryboardJson('Here you go:\n```json\n{"slug":"a-b","clips":[]}\n```\nDone.') as any;
  assert.equal(document.slug, 'a-b');
  assert.throws(() => parseStoryboardJson('no json here'), /no JSON object/);
  assert.throws(() => parseStoryboardJson('{"slug": }'), /not valid JSON/);
});

test('clip-level contract violations are reported individually', () => {
  const document = fixture();
  document.clips[1].background = 'sunset' as any;
  document.clips[2].items = [
    { type: 'text-popup', title: 'First' },
    { type: 'text-typing', title: 'Second' },
  ];

  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /Clip 2 background must be one of/.test(issue)));
  assert.ok(errors.some((issue) => /Clip 3 text-typing must be the first item/.test(issue)));
});

test('the closing pair is required in the final clip and refused everywhere else', () => {
  const misplaced = fixture();
  misplaced.clips[0].items = [
    { type: 'text-title', title: 'Forge' },
    { type: 'text-logo', title: 'Forge' },
  ];
  const misplacedErrors = validateStoryboard(misplaced, OPTIONS).errors;
  assert.ok(misplacedErrors.some((issue) => /Clip 1 uses the closing pair outside the final clip/.test(issue)));

  const unpaired = fixture();
  unpaired.clips[3].speech = 'Turn your idea into a real product.';
  unpaired.clips[3].items = [{ type: 'text-zoom', title: 'Forge' }];
  const unpairedErrors = validateStoryboard(unpaired, OPTIONS).errors;
  assert.ok(unpairedErrors.some((issue) => /Clip 4 is the closing clip and must pair/.test(issue)));
});

test('reserved brand and media types are withheld from the storyboard', () => {
  const document = fixture();
  document.clips[1].items = [
    { type: 'image' } as any,
    { type: 'semrush-chat' } as any,
  ];
  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /uses reserved type image/.test(issue)));
  assert.ok(errors.some((issue) => /uses reserved type semrush-chat/.test(issue)));
});

test('missing per-type fields are still rejected', () => {
  const document = fixture();
  document.clips[1].items = [
    { type: 'ui-prompt-input' },
    { type: 'ui-icon-text', title: 'No icon' },
  ];
  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /ui-prompt-input must include prompt/.test(issue)));
  assert.ok(errors.some((issue) => /ui-icon-text must include a lucide icon name/.test(issue)));
});

test('a referencing item must name a global component and an existing spot', () => {
  const unknownKey = fixture();
  unknownKey.clips[1].items[1] = { type: 'process-card-highlight', key: 'nope', spot: 'generate' };
  assert.ok(validateStoryboard(unknownKey, OPTIONS).errors.some(
    (issue) => /references unknown global component key nope/.test(issue),
  ));

  const unknownSpot = fixture();
  unknownSpot.clips[1].items[1] = { type: 'process-card-highlight', key: 'build-flow', spot: 'deploy' };
  assert.ok(validateStoryboard(unknownSpot, OPTIONS).errors.some(
    (issue) => /spot deploy is not a node of global component build-flow \(describe, generate, ship\)/.test(issue),
  ));

  const noKey = fixture();
  noKey.clips[1].items[1] = { type: 'process-card-highlight' };
  assert.ok(validateStoryboard(noKey, OPTIONS).errors.some(
    (issue) => /must reference a global component with key/.test(issue),
  ));

  const wrongType = fixture();
  wrongType.clips[1].items[1] = { type: 'pyramid-highlight', key: 'build-flow', spot: 'ship' };
  assert.ok(validateStoryboard(wrongType, OPTIONS).errors.some(
    (issue) => /is a pyramid-highlight but global component build-flow is a process-card-highlight/.test(issue),
  ));

  const strayKey = fixture();
  strayKey.clips[0].items[0] = { type: 'text-typing', title: 'Describe it', key: 'build-flow' };
  assert.ok(validateStoryboard(strayKey, OPTIONS).errors.some(
    (issue) => /carries key\/spot, but only/.test(issue),
  ));
});

test('a declared structure that no clip uses is a warning, not an error', () => {
  const document = fixture();
  document['global-components']!.push({
    key: 'unused-tiers',
    component: 'pyramid-highlight',
    cards: [{ key: 'base', icon: 'Layers', title: 'Base' }],
  });
  const report = validateStoryboard(document, OPTIONS);
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((issue) => /unused-tiers is declared but never referenced/.test(issue)));
});

test('global component cards need unique kebab-case keys', () => {
  const document = fixture();
  document['global-components']![0].cards = [
    { key: 'describe', icon: 'MessageSquare', title: 'Describe' },
    { key: 'Describe', icon: 'Sparkles', title: 'Generate' },
    { key: 'describe', icon: 'Rocket', title: 'Ship' },
  ];
  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /key "Describe" must be lowercase kebab-case/.test(issue)));
  assert.ok(errors.some((issue) => /key describe is already used in this component/.test(issue)));
});

test('palette roles must be hex colors when the storyboard sets them', () => {
  const document = fixture();
  document.palette = {
    background: '#0b0510',
    foreground: '#f8f5ff',
    muted: 'grey',
    accent: '#ff5d7a',
    secondary: '#b06bff',
  };
  assert.ok(validateStoryboard(document, OPTIONS).errors.some(
    (issue) => /palette\.muted must be a #rrggbb hex color/.test(issue),
  ));

  document.palette.muted = '#a99eb7';
  assert.deepEqual(validateStoryboard(document, OPTIONS).errors, []);
});

test('chapters must start at clip 0 and cover every clip', () => {
  const document = fixture();
  document.chapters[1].clipCount = 1;
  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /total 3 but the storyboard has 4 clips/.test(issue)));

  const shifted = fixture();
  shifted.chapters[0].startClip = 1;
  assert.ok(validateStoryboard(shifted, OPTIONS).errors.some(
    (issue) => /Chapter 1 startClip must be 0/.test(issue),
  ));
});

test('narration outside the target window and thin component variety are rejected', () => {
  const { errors } = validateStoryboard(fixture(), { ...OPTIONS, targetDurationSeconds: 300 });
  assert.ok(errors.some((issue) => /Estimated narration .* must fall within 195\.0-405\.0s/.test(issue)));

  const thin = validateStoryboard(fixture(), { ...OPTIONS, minComponentTypes: 20 }).errors;
  assert.ok(thin.some((issue) => /uses 7 component types; at least 20 are required/.test(issue)));
});

test('hydration expands references into the flat shape the renderer reads', () => {
  const hydrated = hydrateDocument(fixture()) as any;
  const referencing = hydrated.clips[1].items[1];

  assert.equal(referencing.type, 'process-card-highlight');
  assert.equal(referencing.key, undefined, 'the reference is resolved away');
  assert.equal(referencing.spot, undefined);
  assert.equal(referencing.targetIndex, 1, 'spot "generate" is the second card');
  assert.deepEqual(referencing.cards.map((card: any) => card.title), ['Describe', 'Generate', 'Ship']);

  // The same structure, revisited from a later clip at a different node.
  assert.equal(hydrated.clips[2].items[1].targetIndex, 2);

  // Every item carries positive seconds, and the speech is anchor-free.
  for (const clip of hydrated.clips) {
    assert.ok(!clip.speech.includes('**'));
    for (const item of clip.items) assert.ok(item.duration > 0);
  }
});

test('hydration prefers measured narration timing over its own estimate', () => {
  const hydrated = hydrateDocument(fixture(), {
    timing: [{
      clipIndex: 0,
      startSeconds: 0,
      durationSeconds: 4.05,
      items: [
        { index: 0, startSeconds: 0, durationSeconds: 1.74 },
        { index: 1, startSeconds: 1.74, durationSeconds: 2.31 },
      ],
    }],
  }) as any;
  assert.deepEqual(hydrated.clips[0].items.map((item: any) => item.duration), [1.74, 2.31]);
});

test('the generation prompt states the pinned slug and the anchor contract', () => {
  const prompt = buildStoryboardPrompt(
    { ...DEFAULT_CLIP_STORYBOARD_CONFIG, slug: 'forge-app-launch', language: 'English' },
    '# Brief',
  );
  assert.match(prompt, /Set "slug" to exactly "forge-app-launch"/);
  assert.match(prompt, /Write every "speech" and on-screen string in English/);
  assert.match(prompt, /exactly N-1 \*\*anchor\*\* phrases/);
  assert.match(prompt, /Declare every pyramid-highlight/);
  assert.doesNotMatch(prompt, /semrush-chat/, 'reserved brand scenes stay off the menu');
  assert.match(prompt, /## Brief\n\n# Brief$/);

  const timed = buildStoryboardPrompt(
    { ...DEFAULT_CLIP_STORYBOARD_CONFIG, timingMode: 'duration' },
    '# Brief',
  );
  assert.match(timed, /Each item duration is 0\.6-6 seconds/);
});

test('narration reads either a run asset manifest or a raw storyboard', () => {
  const fromStoryboard = readNarrationSource(JSON.stringify(fixture()));
  assert.equal(fromStoryboard.clips.length, 4);
  assert.equal(fromStoryboard.slug, 'forge-app-launch');
  assert.equal(fromStoryboard.assetDir, null);
  assert.equal(fromStoryboard.clips[0].itemCount, 2);
  // Anchor-timed storyboards author no seconds, so there is no plan to exceed.
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

  // Whitespace collapses exactly as the synthesizer collapses it.
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
  // The second "ship"/"it" resolve to their own occurrence, not the first.
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
  // The split always accounts for the whole clip.
  assert.equal(
    result.items.reduce((total, item) => total + item.durationSeconds, 0).toFixed(2),
    '4.05',
  );
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

  // One item never needs an anchor and always spans the whole clip.
  const single = resolveClipTiming({ speech: 'Ideas ship.', itemCount: 1, audioSeconds: 3, boundaries });
  assert.equal(single.measured, true);
  assert.deepEqual(single.items, [{ index: 0, startSeconds: 0, durationSeconds: 3 }]);

  // Audio too short to give each shot its floor.
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
