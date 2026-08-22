import assert from 'node:assert/strict';
import test from 'node:test';
import {
  estimateDurationSeconds,
  estimateSpeechSeconds,
  parseStoryboardJson,
  parseComparisonCsv,
  plainSpeech,
  sanitizeStoryboard,
  speechAnchors,
  validateStoryboard,
  type StoryboardDocument,
  type StoryboardValidationOptions,
} from './contract.ts';
import { hydrateDocument } from './resolve.ts';
import { buildStoryboardPrompt, compactBriefForStoryboard } from './server.ts';
import { DEFAULT_CLIP_STORYBOARD_CONFIG, OPENING_MODEL_INTRODUCTION_ZH } from './config.ts';
import {
  adaptTimelineSpecForRenderer,
  extractPromptSection,
} from './prompt-source.ts';

const OPTIONS: StoryboardValidationOptions = {
  minComponentTypes: 6,
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

test('sanitizeStoryboard auto-corrects structural defects in malformed LLM responses', () => {
  const malformed: any = {
    slug: 'test-sanitize',
    title: 'Test App',
    // Missing hook, summary, closing
    clips: [
      {
        speech: 'First clip speech text with **too** **many** **anchors**.',
        background: 'aurora',
        items: [
          // Direct component with stray key & spot
          { type: 'flowing-stats', key: 'stray-key', spot: 'stray-spot' },
          // Text-typing missing title
          { type: 'text-typing' },
        ],
      },
      {
        speech: 'Second clip speech text without anchors.',
        background: 'blur',
        items: [
          // Extra Demo UI HTML items beyond max 1
          { type: 'ui-prompt-input' },
          { type: 'ui-render-loading', demoUi: true },
        ],
      },
    ],
    chapters: [
      { startClip: 1, clipCount: 5 }, // Incorrect counts
    ],
  };

  const { document: sanitized, changes } = sanitizeStoryboard(malformed, { maxDemoUiHtmlItems: 1 });
  assert.ok(changes.length > 0, 'recorded sanitization changes');

  // Verify direct component cleanup
  assert.equal((sanitized as any).clips[0].items[0].key, undefined);
  assert.equal((sanitized as any).clips[0].items[0].spot, undefined);

  // Verify missing title auto-fill
  assert.ok(Boolean((sanitized as any).clips[0].items[1].title));

  // Verify anchor count fix (2 items => target 1 anchor)
  assert.equal(speechAnchors((sanitized as any).clips[0].speech).length, 1);

  // Verify Demo UI capping & demotion
  assert.equal((sanitized as any).clips[1].items[1].type, 'ui-icon-text');
  assert.equal((sanitized as any).clips[1].items[1].demoUi, undefined);

  // Verify chapters rebalanced
  assert.equal((sanitized as any).chapters[0].startClip, 0);
  assert.equal((sanitized as any).chapters[0].clipCount, 2);
});

test('sanitizeStoryboard removes all model-authored presentation metadata', () => {
  const { document: sanitized, changes } = sanitizeStoryboard({
    slug: 'color-test',
    title: 'Color Test',
    palette: {
      background: '#000000',
      foreground: '#ffffff',
      muted: '#888888',
      accent: '#ff0000',
      secondary: '#00ff00',
    },
    'global-components': [{
      key: 'counts',
      component: 'chart-bar',
      chartData: [{ key: 'one', label: 'One', value: 1, color: '#ff0000' }],
    }],
    clips: [],
  });

  assert.equal((sanitized as any).palette, undefined);
  assert.equal((sanitized as any)['global-components'][0].chartData[0].color, undefined);
  assert.ok(changes.some((change) => /renderer-owned presentation field/.test(change)));
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

test('storyboard prompt owns the complete opening composition', () => {
  const prompt = buildStoryboardPrompt({
    ...({} as any),
    slug: 'opening-flow',
    language: 'Chinese',
    minComponentTypes: 7,
    timingMode: 'anchor',
    maxGlobalComponents: 5,
    maxDemoUiHtmlItems: 3,
    tone: '清晰、克制、技术讲解感',
  } as any, '## Compact Storyboard Context\nWorkflow: opening-flow');
  assert.match(prompt, /Generate the opening as part of this same complete storyboard JSON/);
  assert.match(prompt, new RegExp(OPENING_MODEL_INTRODUCTION_ZH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /Opening clips must not reference any global-components item/);
});

test('storyboard receives compact workflow facts plus the opening while preserving full source elsewhere', () => {
  const brief = [
    '### Upstream workflow-json-brief',
    '## Compact Storyboard Context',
    'Workflow: Compact Flow [compact-flow]',
    '~~~json',
    '{"nodes":[{"id":"node-a"}]}',
    '~~~',
    '## Node-by-Node Evidence',
    'This verbose section should not be sent to storyboard.',
  ].join('\n');
  const compact = compactBriefForStoryboard(brief);
  assert.match(compact, /Compact Flow/);
  assert.doesNotMatch(compact, /Generated Opening Narration/);
  assert.doesNotMatch(compact, /This verbose section/);
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
  const options = { ...OPTIONS, timingMode: 'duration' as const };
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

test('sanitizeStoryboard overrides model-authored backgrounds deterministically', () => {
  const document = fixture();
  document.clips[0].background = 'semrush-glow';
  const { document: sanitized, changes } = sanitizeStoryboard(document);

  assert.equal((sanitized as any).clips[0].background, 'aurora');
  assert.ok(changes.some((change) => /Assigned deterministic background aurora/.test(change)));
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

test('thin component variety remains an error', () => {
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

test('prompt.md sections load and adapt for the renderer contract', () => {
  const spec = extractPromptSection('SPEC');
  assert.match(spec, /旁白锚点/);
  assert.match(spec, /global-components/);
  assert.match(extractPromptSection('COMPONENTS'), /"component": "flow"/);
  assert.match(extractPromptSection('FULL_VIDEO'), /"clips"/);

  const adaptedChinese = adaptTimelineSpecForRenderer(spec, 'Chinese');
  assert.match(adaptedChinese, /本节点输出形状/);
  assert.match(adaptedChinese, /flow \/ loopflow → `process-card-highlight`/);

  const adaptedEnglish = adaptTimelineSpecForRenderer(spec, 'English');
  assert.match(adaptedEnglish, /Renderer output shape/);
  assert.match(adaptedEnglish, /flow \/ loopflow → `process-card-highlight`/);
});

test('comparison-table uses one compact CSV payload', () => {
  const parsed = parseComparisonCsv('Node,Responsibility\nInput,"Read, validate"\nOutput,Write results');

  assert.deepEqual(parsed, {
    featureLabel: 'Node',
    columns: [{ label: 'Responsibility' }],
    rows: [
      { feature: 'Input', values: ['Read, validate'] },
      { feature: 'Output', values: ['Write results'] },
    ],
  });
});

test('comparison-table CSV passes the storyboard component validator', () => {
  const document = fixture();
  document['global-components']!.push({
    key: 'node-responsibilities',
    component: 'comparison-table',
    comparisonCsv: 'Node,Responsibility\nInput,Read data\nOutput,Write results',
  });
  const errors = validateStoryboard(document, OPTIONS).errors;
  assert.doesNotMatch(errors.join('\n'), /comparisonCsv .*array/);
  assert.doesNotMatch(errors.join('\n'), /comparisonCsv must contain/);
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
  assert.match(prompt, /Authoring rules \(from prompt\.md\)/);
  assert.match(prompt, /Renderer output shape/);
  assert.match(prompt, /This task uses the Doubao-Seed-Evolving model/);
  assert.doesNotMatch(prompt, /semrush-chat/, 'reserved brand scenes stay off the menu');
  assert.match(prompt, /## Brief\n\n# Brief$/);

  const timed = buildStoryboardPrompt(
    { ...DEFAULT_CLIP_STORYBOARD_CONFIG, timingMode: 'duration' },
    '# Brief',
  );
  assert.match(timed, /Each item duration is 0\.6-6 seconds/);
});
