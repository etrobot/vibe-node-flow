import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
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
  COMPONENT_GUIDE,
  MAX_ITEM_DURATION,
  MAX_ITEMS_PER_CLIP,
  MIN_ITEM_DURATION,
  parseStoryboardJson,
  validateStoryboard,
  type StoryboardDocument,
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
  return [
    'Convert the brief below into one storyboard JSON document for a motion-graphics renderer.',
    '',
    '## Output contract',
    '',
    'Return exactly one JSON object with these keys and nothing else:',
    '{"slug","title","hook","summary","closing","hue","chapters":[{"title","summary","startClip","clipCount"}],'
    + '"clips":[{"speech","background","items":[{"type","duration",...}]}]}',
    '',
    '## Hard rules',
    '',
    slugRule,
    `Write every "speech" and on-screen string in ${config.language}.`,
    `Produce ${config.minClips}-${config.maxClips} clips whose item durations total about `
    + `${config.targetDurationSeconds} seconds (±${Math.round(config.durationTolerance * 100)}%).`,
    `"hue" is an integer 0-360 that matches a ${config.tone} mood.`,
    `"background" must be one of: ${CLIP_BACKGROUNDS.join(', ')}.`,
    `Each clip holds 1-${MAX_ITEMS_PER_CLIP} items; each item duration is `
    + `${MIN_ITEM_DURATION}-${MAX_ITEM_DURATION} seconds.`,
    '"speech" is plain narration a voice actor reads aloud: no markdown, no ** markers, no stage directions.',
    'On-screen text lives in item fields such as "title"; keep it to 2-6 words and use **emphasis** only there.',
    `Use at least ${config.minComponentTypes} distinct item types across the storyboard.`,
    'text-typing may only be the first item of its clip.',
    'The final clip, and only the final clip, pairs text-title with text-logo.',
    'Never use the image or video item types; no external media is available.',
    'Chapters must start at clip 0 and their clipCount values must sum to the number of clips.',
    'Every factual claim must trace back to the brief. Do not invent numbers, customers, or endorsements.',
    '',
    '## Component menu',
    '',
    COMPONENT_GUIDE,
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

  const logs: string[] = [
    `Storyboard contract: ${config.minClips}-${config.maxClips} clips, `
    + `${config.targetDurationSeconds}s ±${Math.round(config.durationTolerance * 100)}%, `
    + `${config.minComponentTypes}+ component types.`,
    `Repair policy: initial generation plus up to ${STORYBOARD_RETRY_LIMIT} retries.`,
  ];
  let lastErrors: string[] = ['Storyboard was never produced.'];

  for (let attempt = 1; attempt <= STORYBOARD_ATTEMPT_LIMIT; attempt += 1) {
    const { content } = await callLLM({ temperature: config.temperature, messages });

    let document: StoryboardDocument | undefined;
    let errors: string[];
    let warnings: string[] = [];
    let metrics: Record<string, string | number | boolean> = {};
    try {
      const parsed = parseStoryboardJson(content);
      const report = validateStoryboard(parsed, {
        minClips: config.minClips,
        maxClips: config.maxClips,
        minComponentTypes: config.minComponentTypes,
        targetDurationSeconds: config.targetDurationSeconds,
        durationTolerance: config.durationTolerance,
      });
      errors = report.errors;
      warnings = report.warnings;
      metrics = report.metrics;
      if (!errors.length) document = parsed as StoryboardDocument;
    } catch (error) {
      errors = [error instanceof Error ? error.message : String(error)];
    }

    if (document) {
      if (config.slug) document.slug = config.slug;
      logs.push(
        `Attempt ${attempt}/${STORYBOARD_ATTEMPT_LIMIT} passed the storyboard contract.`,
        ...Object.entries(metrics).map(([key, value]) => `[Metric] ${key}: ${value}`),
        ...warnings.map((warning) => `[Warning] ${warning}`),
      );
      return { output: JSON.stringify(document, null, 2), logs };
    }

    lastErrors = errors;
    logs.push(
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
  (failure as Error & { logs?: string[] }).logs = logs;
  throw failure;
}

export default {
  type: 'clip-storyboard',
  capabilities: ['llm', 'output-validation', 'quality-retry'],
  execute,
};
