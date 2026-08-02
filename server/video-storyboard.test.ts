import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateDurationSeconds,
  parseStoryboardJson,
  validateStoryboard,
  type StoryboardDocument,
} from '../nodes/clip-storyboard/contract.ts';
import { buildStoryboardPrompt } from '../nodes/clip-storyboard/server.ts';
import { DEFAULT_CLIP_STORYBOARD_CONFIG } from '../nodes/clip-storyboard/config.ts';
import { chapterFiles } from '../nodes/app-video-project/server.ts';
import { clipFileName, readNarrationSource } from '../nodes/edge-tts-narration/server.ts';

const OPTIONS = {
  minClips: 3,
  maxClips: 12,
  minComponentTypes: 6,
  targetDurationSeconds: 20,
  durationTolerance: 0.25,
};

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
    clips: [
      {
        speech: 'Ideas are everywhere. Most die because building was too hard.',
        background: 'blur',
        items: [
          { type: 'text-typing', title: 'Describe it', duration: 2 },
          { type: 'text-popup', title: 'Ship today', duration: 2 },
        ],
      },
      {
        speech: 'Describe the product you want and watch it take shape.',
        background: 'aurora',
        items: [
          { type: 'ui-prompt-input', prompt: 'Build a habit tracker', duration: 3 },
          { type: 'ui-render-loading', duration: 2 },
        ],
      },
      {
        speech: 'It ships with authentication and a database, not a mockup.',
        background: 'wave',
        items: [
          { type: 'ui-icon-text', title: 'Auth included', icon: 'ShieldCheck', duration: 3 },
          { type: 'flowing-stats', duration: 2 },
        ],
      },
      {
        speech: 'Turn your idea into a real product.',
        background: 'semrush-glow',
        items: [
          { type: 'text-title', title: 'Forge', duration: 3 },
          { type: 'text-logo', title: 'Forge', duration: 3 },
        ],
      },
    ],
  } as StoryboardDocument;
}

test('a conforming storyboard passes and reports its metrics', () => {
  const report = validateStoryboard(fixture(), OPTIONS);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.metrics, {
    clips: 4,
    chapters: 2,
    componentTypes: 8,
    estimatedSeconds: 20,
    speechWords: 37,
  });
  assert.equal(estimateDurationSeconds(fixture().clips), 20);
});

test('fenced or prose-wrapped JSON responses are recovered', () => {
  const document = parseStoryboardJson('Here you go:\n```json\n{"slug":"a-b","clips":[]}\n```\nDone.') as any;
  assert.equal(document.slug, 'a-b');
  assert.throws(() => parseStoryboardJson('no json here'), /no JSON object/);
  assert.throws(() => parseStoryboardJson('{"slug": }'), /not valid JSON/);
});

test('clip-level contract violations are reported individually', () => {
  const document = fixture();
  document.clips[0].speech = 'Ideas are **everywhere**.';
  document.clips[1].background = 'sunset' as any;
  document.clips[2].items = [
    { type: 'text-popup', title: 'First', duration: 2 },
    { type: 'text-typing', title: 'Second', duration: 3 },
  ];

  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /Clip 1 speech contains \*\* markers/.test(issue)));
  assert.ok(errors.some((issue) => /Clip 2 background must be one of/.test(issue)));
  assert.ok(errors.some((issue) => /Clip 3 text-typing must be the first item/.test(issue)));
});

test('the closing pair is required in the final clip and refused everywhere else', () => {
  const misplaced = fixture();
  misplaced.clips[0].items = [
    { type: 'text-title', title: 'Forge', duration: 2 },
    { type: 'text-logo', title: 'Forge', duration: 2 },
  ];
  const misplacedErrors = validateStoryboard(misplaced, OPTIONS).errors;
  assert.ok(misplacedErrors.some((issue) => /Clip 1 uses the closing pair outside the final clip/.test(issue)));

  const unpaired = fixture();
  unpaired.clips[3].items = [{ type: 'text-zoom', title: 'Forge', duration: 6 }];
  const unpairedErrors = validateStoryboard(unpaired, OPTIONS).errors;
  assert.ok(unpairedErrors.some((issue) => /Clip 4 is the closing clip and must pair/.test(issue)));
});

test('media items, bad durations, and missing per-type fields are rejected', () => {
  const document = fixture();
  document.clips[1].items = [
    { type: 'image', duration: 2, url: 'https://example.com/a.png' } as any,
    { type: 'ui-icon-text', title: 'No icon', duration: 12 },
  ];
  const { errors } = validateStoryboard(document, OPTIONS);
  assert.ok(errors.some((issue) => /uses image; this node does not generate media/.test(issue)));
  assert.ok(errors.some((issue) => /duration 12 must be between 0\.6 and 6 seconds/.test(issue)));
  assert.ok(errors.some((issue) => /ui-icon-text must include a lucide icon name/.test(issue)));
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

test('runtime outside the target window and thin component variety are rejected', () => {
  const document = fixture();
  document.clips[0].items = [{ type: 'text-popup', title: 'Only', duration: 1 }];
  const { errors } = validateStoryboard(document, { ...OPTIONS, targetDurationSeconds: 60 });
  assert.ok(errors.some((issue) => /must fall within 45\.0-75\.0s/.test(issue)));

  const thin = validateStoryboard(fixture(), { ...OPTIONS, minComponentTypes: 20 }).errors;
  assert.ok(thin.some((issue) => /uses 8 component types; at least 20 are required/.test(issue)));
});

test('the generation prompt states the pinned slug and the hard contract', () => {
  const prompt = buildStoryboardPrompt(
    { ...DEFAULT_CLIP_STORYBOARD_CONFIG, slug: 'forge-app-launch', language: 'English' },
    '# Brief',
  );
  assert.match(prompt, /Set "slug" to exactly "forge-app-launch"/);
  assert.match(prompt, /Write every "speech" and on-screen string in English/);
  assert.match(prompt, /Never use the image or video item types/);
  assert.match(prompt, /## Brief\n\n# Brief$/);
});

test('chapters split into one builder clip file each', () => {
  const files = chapterFiles(fixture());
  assert.deepEqual(files.map((entry) => entry.file), ['chapter-1.json', 'chapter-2.json']);
  assert.deepEqual(files.map((entry) => entry.clips.length), [2, 2]);
  assert.equal(files[1].clips[1].speech, 'Turn your idea into a real product.');

  const broken = fixture();
  broken.chapters[0].clipCount = 9;
  assert.throws(() => chapterFiles(broken), /only 4 remain/);
});

test('narration reads either a project manifest or a raw storyboard', () => {
  const fromStoryboard = readNarrationSource(JSON.stringify(fixture()));
  assert.equal(fromStoryboard.clips.length, 4);
  assert.equal(fromStoryboard.slug, 'forge-app-launch');
  assert.equal(fromStoryboard.projectDir, null);
  // Planned seconds fall out of the storyboard item durations.
  assert.equal(fromStoryboard.clips[0].plannedSeconds, 4);

  const fromManifest = readNarrationSource(JSON.stringify({
    slug: 'forge-app-launch',
    projectDir: '/tmp/project',
    clips: [{ index: 0, speech: 'Ideas are everywhere.' }],
  }));
  assert.equal(fromManifest.projectDir, '/tmp/project');
  assert.equal(fromManifest.clips[0].plannedSeconds, undefined);

  assert.throws(() => readNarrationSource(''), /empty upstream output/);
  assert.throws(() => readNarrationSource('nope'), /not JSON/);
  assert.throws(() => readNarrationSource('{"clips":[]}'), /non-empty clips array/);
  assert.throws(
    () => readNarrationSource('{"clips":[{"speech":"ok"},{"speech":"  "}]}'),
    /Clips 2 have no speech/,
  );
});

test('clip audio file names are zero padded and one-based', () => {
  assert.equal(clipFileName(0), 'clip-01.mp3');
  assert.equal(clipFileName(11), 'clip-12.mp3');
});
