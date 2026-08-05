import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMuxArgs,
  mergeUpstreamManifests,
  narrationOverruns,
  resolvePackageDir,
  tailLines,
} from './render.ts';

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

test('upstream manifests merge into the slug, audio directory, and clip list', () => {
  const facts = mergeUpstreamManifests({
    'node-project': RUN_ASSET_MANIFEST,
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

test('render facts preserve an embedded storyboard document for preview recovery', () => {
  const document = {
    slug: 'forge-app-launch',
    hue: 220,
    clips: [{
      speech: 'A launch message.',
      background: 'aurora',
      items: [{ type: 'text-typing', title: 'Launch', duration: 2 }],
    }],
  };
  const facts = mergeUpstreamManifests({
    'node-project': JSON.stringify({
      slug: document.slug,
      document,
      clips: [{ index: 0, speech: document.clips[0].speech, background: 'aurora' }],
    }),
  });

  assert.deepEqual(facts.document, document);
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

test('empty and unparseable upstream output are node-owned warnings', () => {
  assert.throws(() => mergeUpstreamManifests({}), /at least one non-empty upstream manifest/);
  assert.throws(() => mergeUpstreamManifests({ a: '   ' }), /at least one non-empty upstream manifest/);
  assert.throws(() => mergeUpstreamManifests({ a: 'not json' }), /No upstream output parsed/);
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
