import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { callLLM } from '../../server/llm.ts';
import {
  DEFAULT_CLIP_STORYBOARD_CONFIG,
  STORYBOARD_ATTEMPT_LIMIT,
  STORYBOARD_RETRY_LIMIT,
  type ClipStoryboardConfig,
} from './config.ts';
import {
  CLIP_BACKGROUNDS,
  DIRECT_COMPONENT_GUIDE,
  GLOBAL_COMPONENT_GUIDE,
  GLOBAL_COMPONENT_TYPES,
  MAX_ITEM_DURATION,
  MAX_ITEMS_PER_CLIP,
  MIN_ITEM_DURATION,
  parseStoryboardJson,
  sanitizeStoryboard,
  validateStoryboard,
  type StoryboardDocument,
  type TimingMode,
} from './contract.ts';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeConfig(value: unknown): ClipStoryboardConfig {
  const raw = value && typeof value === 'object' ? value as Partial<ClipStoryboardConfig> : {};
  const minClips = integer(raw.minClips, DEFAULT_CLIP_STORYBOARD_CONFIG.minClips, 3, 40);
  const maxClips = Math.max(minClips, integer(raw.maxClips, DEFAULT_CLIP_STORYBOARD_CONFIG.maxClips, 3, 40));
  const temperature = Number(raw.temperature);
  const tolerance = Number(raw.durationTolerance);
  const timingMode: TimingMode = raw.timingMode === 'duration' ? 'duration' : 'anchor';
  return {
    ...DEFAULT_CLIP_STORYBOARD_CONFIG,
    ...raw,
    slug: clean(raw.slug),
    language: clean(raw.language) || DEFAULT_CLIP_STORYBOARD_CONFIG.language,
    tone: clean(raw.tone) || DEFAULT_CLIP_STORYBOARD_CONFIG.tone,
    minClips,
    maxClips,
    minComponentTypes: integer(raw.minComponentTypes, DEFAULT_CLIP_STORYBOARD_CONFIG.minComponentTypes, 1, 20),
    targetDurationSeconds: integer(
      raw.targetDurationSeconds,
      DEFAULT_CLIP_STORYBOARD_CONFIG.targetDurationSeconds,
      15,
      900,
    ),
    durationTolerance: Number.isFinite(tolerance)
      ? Math.max(0.05, Math.min(0.6, tolerance))
      : DEFAULT_CLIP_STORYBOARD_CONFIG.durationTolerance,
    timingMode,
    maxGlobalComponents: integer(
      raw.maxGlobalComponents,
      DEFAULT_CLIP_STORYBOARD_CONFIG.maxGlobalComponents,
      0,
      24,
    ),
    maxDemoUiHtmlItems: integer(
      raw.maxDemoUiHtmlItems,
      DEFAULT_CLIP_STORYBOARD_CONFIG.maxDemoUiHtmlItems,
      0,
      8,
    ),
    temperature: Number.isFinite(temperature)
      ? Math.max(0, Math.min(2, temperature))
      : DEFAULT_CLIP_STORYBOARD_CONFIG.temperature,
    systemPrompt: clean(raw.systemPrompt) || DEFAULT_CLIP_STORYBOARD_CONFIG.systemPrompt,
    systemPromptFile: clean(raw.systemPromptFile) || undefined,
    promptFile: clean(raw.promptFile) || undefined,
  };
}

/** Read a workflow-owned prompt file, refusing any path that escapes the workflow. */
async function readWorkflowFile(definitionDir: string, relativeFile: string, label: string): Promise<string> {
  if (path.isAbsolute(relativeFile)) {
    throw new NodeValidationError(`${label} file must be relative to the workflow directory.`);
  }
  const root = path.resolve(definitionDir);
  const target = path.resolve(root, relativeFile);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new NodeValidationError(`${label} file escapes the workflow directory: ${relativeFile}`);
  }
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    throw new NodeValidationError(
      `${label} file cannot be read (${relativeFile}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function briefText(input: Record<string, string>): string {
  const sections = Object.entries(input)
    .map(([id, value]) => [id, clean(value)] as const)
    .filter(([, value]) => Boolean(value))
    .map(([id, value]) => `### Upstream ${id}\n\n${value}`);
  if (!sections.length) {
    throw new NodeInputError('Clip Storyboard requires at least one non-empty upstream brief.');
  }
  return sections.join('\n\n');
}

export function buildStoryboardPrompt(config: ClipStoryboardConfig, brief: string): string {
  const slugRule = config.slug
    ? `Set "slug" to exactly "${config.slug}".`
    : 'Set "slug" to a lowercase kebab-case name derived from the title.';

  const timingRules = config.timingMode === 'anchor'
    ? [
      'Items carry no "duration". Timing comes from the narration itself.',
      'A clip with N items must have exactly N-1 **anchor** phrases in its "speech".'
      + ' Anchor 1 starts item 2, anchor 2 starts item 3, and so on; item 1 starts with the clip.',
      'Write the shots first, then choose anchors in order. An anchor is a short complete phrase'
      + ' (a keyword, number, conclusion, or turn) that is the moment the picture should change.',
      'When the item after an anchor references a global component with a "spot", anchor the words'
      + ' that name that node: match the focused card\'s title as closely as the sentence allows.',
      'Never split a word or anchor bare punctuation, and never anchor a whole sentence.',
      `Total narration should read in about ${config.targetDurationSeconds} seconds`
      + ` (±${Math.round(config.durationTolerance * 100)}%) at a natural pace.`,
    ]
    : [
      `Each item duration is ${MIN_ITEM_DURATION}-${MAX_ITEM_DURATION} seconds.`,
      `Item durations total about ${config.targetDurationSeconds} seconds`
      + ` (±${Math.round(config.durationTolerance * 100)}%).`,
      '"speech" is plain narration a voice actor reads aloud: no markdown, no ** markers.',
    ];

  const globalRules = config.maxGlobalComponents > 0
    ? [
      '',
      '## Reusable structures',
      '',
      `Declare every ${GLOBAL_COMPONENT_TYPES.join(', ')} once in "global-components"`
      + ` (at most ${config.maxGlobalComponents}), each with a unique kebab-case "key".`,
      'A clip then references it with {"type": <same type>, "key": <component key>, "spot": <node key>}'
      + ' and writes no payload of its own.',
      'Every card, chartData entry, and lineMetrics entry needs its own kebab-case "key";'
      + ' "spot" must name one of them. For comparison-table, "spot" names a row "feature".',
      'process-card-highlight and pyramid-highlight always need a "spot". The others may omit it.',
      'Reuse one structure across several clips with a different "spot" each time so a diagram builds'
      + ' up as the narration walks it, instead of a new structure appearing every clip.',
      'Declare nothing you do not reference.',
      '',
      GLOBAL_COMPONENT_GUIDE,
    ]
    : [];

  return [
    'Convert the brief below into one storyboard JSON document for a motion-graphics renderer.',
    '',
    '## Output contract',
    '',
    'Return exactly one JSON object with these keys and nothing else:',
    '{"slug","title","hook","summary","closing","hue","palette":{"background","foreground","muted",'
    + '"accent","secondary"},"chapters":[{"title","summary","startClip","clipCount"}],'
    + '"global-components":[{"key","component",...}],'
    + '"clips":[{"speech","background","items":[{"type",...}]}]}',
    '',
    '## Hard rules',
    '',
    slugRule,
    `Write every "speech" and on-screen string in ${config.language}.`,
    `Produce ${config.minClips}-${config.maxClips} clips.`,
    `"hue" is an integer 0-360 that matches a ${config.tone} mood.`,
    '"palette" is optional; when present every role is a #rrggbb hex color reading well on dark video.',
    `"background" must be one of: ${CLIP_BACKGROUNDS.join(', ')}.`,
    `Each clip holds 1-${MAX_ITEMS_PER_CLIP} items.`,
    ...timingRules,
    'On-screen text lives in item fields such as "title"; keep it to 2-6 words.',
    `Use at least ${config.minComponentTypes} distinct item types across the storyboard.`,
    'text-typing may only be the first item of its clip.',
    'The final clip, and only the final clip, pairs text-title with text-logo.',
    `Use at most ${config.maxDemoUiHtmlItems} Demo UI HTML placeholders total`
      + ' (ui-prompt-input, ui-dropfiles, ui-render-loading, ui-video-preview).'
      + ' Prefer one input moment and one result moment; do not stack loading/preview copies.',
    'Chapters must start at clip 0 and their clipCount values must sum to the number of clips.',
    'Every factual claim must trace back to the brief. Do not invent numbers, customers, or endorsements.',
    ...globalRules,
    '',
    '## Few-shot example output structure',
    '',
    '```json',
    '{',
    '  "slug": "forge-app-launch",',
    '  "title": "Forge App Launch",',
    '  "hook": "Build production apps in minutes",',
    '  "summary": "Introduction to Forge features and architecture",',
    '  "closing": "Try Forge today.",',
    '  "hue": 210,',
    '  "palette": {',
    '    "background": "#0b0f19",',
    '    "foreground": "#f8fafc",',
    '    "muted": "#64748b",',
    '    "accent": "#38bdf8",',
    '    "secondary": "#818cf8"',
    '  },',
    '  "chapters": [',
    '    { "title": "Introduction", "summary": "Core workflow overview", "startClip": 0, "clipCount": 1 },',
    '    { "title": "Conclusion", "summary": "Call to action", "startClip": 1, "clipCount": 1 }',
    '  ],',
    '  "global-components": [',
    '    {',
    '      "key": "process-overview",',
    '      "component": "process-card-highlight",',
    '      "cards": [',
    '        { "key": "step-1", "icon": "Code", "title": "Design Component" },',
    '        { "key": "step-2", "icon": "Rocket", "title": "Deploy Instant" }',
    '      ]',
    '    }',
    '  ],',
    '  "clips": [',
    '    {',
    '      "speech": "Forge turns your ideas into **scalable apps** automatically.",',
    '      "background": "aurora",',
    '      "items": [',
    '        { "type": "text-typing", "title": "Forge App Builder" },',
    '        { "type": "process-card-highlight", "key": "process-overview", "spot": "step-1" }',
    '      ]',
    '    },',
    '    {',
    '      "speech": "Get started with Forge today.",',
    '      "background": "semrush-glow",',
    '      "items": [',
    '        { "type": "text-title", "title": "Forge" },',
    '        { "type": "text-logo", "title": "Build Faster" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '## Component menu',
    '',
    DIRECT_COMPONENT_GUIDE,
    '',
    '## Brief',
    '',
    brief,
  ].join('\n');
}

function repairPrompt(errors: string[], attempt: number): string {
  return [
    'The storyboard failed its contract check. Return the complete corrected JSON document only.',
    'Preserve everything that already passed and fix every listed issue.',
    '',
    `Attempt ${attempt} of ${STORYBOARD_ATTEMPT_LIMIT}. Issues:`,
    ...errors.map((issue) => `- ${issue}`),
  ].join('\n');
}

async function execute({
  node,
  input,
  workflowDefinitionDir,
  workflowDir,
  onLog,
}: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const brief = briefText(input);
  const definitionRoot = workflowDefinitionDir || workflowDir;

  const systemPrompt = config.systemPromptFile
    ? await readWorkflowFile(definitionRoot, config.systemPromptFile, 'System prompt')
    : config.systemPrompt;
  const prompt = config.promptFile
    ? `${await readWorkflowFile(definitionRoot, config.promptFile, 'Prompt')}\n\n## Brief\n\n${brief}`
    : buildStoryboardPrompt(config, brief);

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) messages.push({ role: 'system', content: systemPrompt.trim() });
  messages.push({ role: 'user', content: prompt });

  const log = createNodeLogger(onLog);
  log.push(
    `Storyboard contract: ${config.minClips}-${config.maxClips} clips, `
    + `${config.targetDurationSeconds}s ±${Math.round(config.durationTolerance * 100)}%, `
    + `${config.minComponentTypes}+ component types, ${config.timingMode} timing.`,
    `Repair policy: initial generation plus up to ${STORYBOARD_RETRY_LIMIT} retries.`,
  );
  let lastErrors: string[] = ['Storyboard was never produced.'];

  for (let attempt = 1; attempt <= STORYBOARD_ATTEMPT_LIMIT; attempt += 1) {
    log.push(`Calling LLM for storyboard attempt ${attempt}/${STORYBOARD_ATTEMPT_LIMIT}...`);
    const requestStarted = Date.now();
    const { content } = await callLLM({ temperature: config.temperature, messages });
    log.push(
      `LLM returned ${content.length} chars for attempt ${attempt} in ${Date.now() - requestStarted}ms.`,
    );

    let document: StoryboardDocument | undefined;
    let errors: string[];
    let warnings: string[] = [];
    let metrics: Record<string, string | number | boolean> = {};
    try {
      const parsed = parseStoryboardJson(content);
      const validationOpts = {
        minClips: config.minClips,
        maxClips: config.maxClips,
        minComponentTypes: config.minComponentTypes,
        targetDurationSeconds: config.targetDurationSeconds,
        durationTolerance: config.durationTolerance,
        timingMode: config.timingMode,
        maxGlobalComponents: config.maxGlobalComponents,
        maxDemoUiHtmlItems: config.maxDemoUiHtmlItems,
      };

      const { document: sanitized, changes } = sanitizeStoryboard(parsed, validationOpts);
      if (changes.length > 0) {
        log.push(
          `[Sanitize] Applied ${changes.length} auto-fix(es):`,
          ...changes.map((c) => `  - ${c}`),
        );
      }

      const report = validateStoryboard(sanitized, validationOpts);
      errors = report.errors;
      warnings = report.warnings;
      metrics = report.metrics;
      if (!errors.length) document = sanitized as StoryboardDocument;
    } catch (error) {
      errors = [error instanceof Error ? error.message : String(error)];
    }

    if (document) {
      if (config.slug) document.slug = config.slug;
      log.push(
        `Attempt ${attempt}/${STORYBOARD_ATTEMPT_LIMIT} passed the storyboard contract.`,
        ...Object.entries(metrics).map(([key, value]) => `[Metric] ${key}: ${value}`),
        ...warnings.map((warning) => `[Warning] ${warning}`),
      );
      return { output: JSON.stringify(document, null, 2), logs: log.logs };
    }

    lastErrors = errors;
    log.push(
      `Attempt ${attempt}/${STORYBOARD_ATTEMPT_LIMIT} failed the storyboard contract:`,
      ...errors.map((issue) => `[Attempt ${attempt}] ${issue}`),
    );
    messages.push({ role: 'assistant', content });
    messages.push({ role: 'user', content: repairPrompt(errors, attempt + 1) });
  }

  const failure = new NodeValidationError(
    `Storyboard failed after ${STORYBOARD_RETRY_LIMIT} repair retries:\n`
    + lastErrors.map((issue) => `- ${issue}`).join('\n'),
  );
  (failure as Error & { logs?: string[] }).logs = log.logs;
  throw failure;
}

export default {
  type: 'clip-storyboard',
  capabilities: ['llm', 'output-validation', 'quality-retry'],
  execute,
};
