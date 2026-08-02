/**
 * The clip contract mirrors `data/idea-to-app-builder`: the renderer, its
 * `scripts/validate-project.ts`, and `src/renderer/clipTypes.ts` all agree on
 * this shape. Keeping the deterministic checks here means a storyboard that
 * passes this node also passes `npm run validate-project` in the builder.
 */

export const CLIP_BACKGROUNDS = ['aurora', 'blur', 'wave', 'semrush-glow'] as const;

export const CLIP_ITEM_TYPES = [
  'text-typing',
  'text-popup',
  'text-shatter',
  'text-zoom',
  'text-impact',
  'text-title',
  'text-logo',
  'ui-dropfiles',
  'ui-prompt-input',
  'ui-render-loading',
  'ui-video-preview',
  'ui-icon-text',
  'x-profile',
  'flowing-stats',
  'element-growth',
  'scene-clock',
  'swipe-delete',
  'chart-bar',
  'chart-line',
  'chart-pie',
  'feedback-cards',
  'image',
  'video',
  'comparison-table',
  'pyramid-highlight',
  'process-card-highlight',
  'semrush-search',
  'semrush-ai-badge',
  'semrush-logo',
  'semrush-workspace',
  'semrush-chat',
  'semrush-publish',
  'semrush-audit',
  'semrush-feature-cloud',
] as const;

/** Types the builder's validator refuses to render without a `title`. */
const TITLE_REQUIRED_TYPES = new Set([
  'text-typing',
  'text-popup',
  'text-shatter',
  'text-zoom',
  'text-title',
  'text-logo',
  'ui-icon-text',
]);

/** Remote media cannot be guaranteed at render time, so the node refuses it. */
const MEDIA_TYPES = new Set(['image', 'video']);

export const MIN_ITEM_DURATION = 0.6;
export const MAX_ITEM_DURATION = 6;
export const MAX_ITEMS_PER_CLIP = 3;

export type ClipBackground = (typeof CLIP_BACKGROUNDS)[number];
export type ClipItemType = (typeof CLIP_ITEM_TYPES)[number];

export interface StoryboardItem {
  type: ClipItemType;
  duration: number;
  title?: string;
  [key: string]: unknown;
}

export interface StoryboardClip {
  speech: string;
  background: ClipBackground;
  items: StoryboardItem[];
}

export interface StoryboardChapter {
  title: string;
  summary: string;
  startClip: number;
  clipCount: number;
}

export interface StoryboardDocument {
  slug: string;
  title: string;
  hook: string;
  summary: string;
  closing: string;
  hue: number;
  chapters: StoryboardChapter[];
  clips: StoryboardClip[];
}

/** Component menu handed to the model. Mirrors the builder's SKILL.md. */
export const COMPONENT_GUIDE = [
  'text-typing: typed command, compact claim, or generated-output line. Only as the first item of a clip.',
  'text-popup: punchy alert, reaction, or quick reveal.',
  'text-shatter: broken old approach, risk, failure, or disruption.',
  'text-zoom: one important conclusion.',
  'text-impact: stacked keyword build; include cumulative `words` array.',
  'text-title / text-logo: closing beat only, and always used as a pair.',
  'ui-dropfiles: importing files, screenshots, evidence, notes, or assets.',
  'ui-prompt-input: a concrete AI or tool instruction; must include `prompt`.',
  'ui-render-loading: generating, analyzing, exporting, or processing.',
  'ui-video-preview: previewing the product, demo, or final video.',
  'ui-icon-text: one principle, benefit, boundary, or status; must include a lucide `icon` name.',
  'flowing-stats: growth, usage, reach, revenue, count, or speed metric.',
  'scene-clock: time pressure, countdown, speed, or schedule.',
  'swipe-delete: removing old work, bad leads, risk, or waste.',
  'chart-bar / chart-pie: direct numeric comparison or composition; include `chartData`.',
  'chart-line: trend or before/after motion; include `lineMetrics` with start and end values.',
  'comparison-table: structured comparison; include matching `columns` and `rows`.',
  'pyramid-highlight: hierarchy or capability layers; include `cards` and `targetIndex`.',
  'process-card-highlight: workflow or process overview; include `cards` and `targetIndex`.',
  'semrush-search / semrush-ai-badge / semrush-logo / semrush-workspace / semrush-chat / semrush-publish'
  + ' / semrush-audit / semrush-feature-cloud: branded scene beats.',
].join('\n');

export interface StoryboardValidationOptions {
  minClips: number;
  maxClips: number;
  minComponentTypes: number;
  targetDurationSeconds: number;
  durationTolerance: number;
}

export interface StoryboardReport {
  errors: string[];
  warnings: string[];
  metrics: Record<string, string | number | boolean>;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

/** Accept a fenced or prose-wrapped response and return the JSON object body. */
export function parseStoryboardJson(raw: string): unknown {
  const withoutFences = String(raw ?? '')
    .replace(/^﻿/, '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Response contains no JSON object.');
  }
  const body = withoutFences.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateItem(item: any, label: string, errors: string[], warnings: string[]): void {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${label} is not an object.`);
    return;
  }
  if (!CLIP_ITEM_TYPES.includes(item.type)) {
    errors.push(`${label} has missing or unknown type ${JSON.stringify(item.type ?? null)}.`);
    return;
  }
  const duration = Number(item.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push(`${label} duration must be a positive number.`);
  } else if (duration < MIN_ITEM_DURATION || duration > MAX_ITEM_DURATION) {
    errors.push(`${label} duration ${duration} must be between ${MIN_ITEM_DURATION} and ${MAX_ITEM_DURATION} seconds.`);
  }
  if (TITLE_REQUIRED_TYPES.has(item.type) && !text(item.title)) {
    errors.push(`${label} (${item.type}) is missing title.`);
  }
  if (item.type === 'ui-prompt-input' && !text(item.prompt)) {
    errors.push(`${label} ui-prompt-input must include prompt.`);
  }
  if (item.type === 'ui-icon-text' && !text(item.icon)) {
    errors.push(`${label} ui-icon-text must include a lucide icon name.`);
  }
  if (item.type === 'text-impact' && !Array.isArray(item.words) && !text(item.title)) {
    errors.push(`${label} text-impact needs words or title.`);
  }
  if (MEDIA_TYPES.has(item.type)) {
    errors.push(`${label} uses ${item.type}; this node does not generate media, so remove it.`);
  }
  if (item.effect !== undefined && item.effect !== 'shockwave') {
    errors.push(`${label} has unsupported effect ${JSON.stringify(item.effect)}.`);
  }
  if (text(item.title).length > 60) {
    warnings.push(`${label} title is long; on-screen text reads best at 2-6 words.`);
  }
}

function validateClip(clip: any, index: number, isLast: boolean, errors: string[], warnings: string[]): void {
  const label = `Clip ${index + 1}`;
  if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
    errors.push(`${label} is not an object.`);
    return;
  }
  if (!text(clip.speech)) errors.push(`${label} is missing speech.`);
  if (/\*\*/.test(String(clip.speech ?? ''))) {
    errors.push(`${label} speech contains ** markers; speech must stay plain.`);
  }
  if (!CLIP_BACKGROUNDS.includes(clip.background)) {
    errors.push(`${label} background must be one of ${CLIP_BACKGROUNDS.join(', ')}.`);
  }
  if (!Array.isArray(clip.items) || clip.items.length === 0) {
    errors.push(`${label} is missing items.`);
    return;
  }
  if (clip.items.length > MAX_ITEMS_PER_CLIP) {
    errors.push(`${label} has ${clip.items.length} items; keep 1-${MAX_ITEMS_PER_CLIP}.`);
  }

  const types: string[] = clip.items.map((item: any) => item?.type);
  const typingIndex = types.indexOf('text-typing');
  if (typingIndex > 0) errors.push(`${label} text-typing must be the first item of the clip.`);

  const hasTitle = types.includes('text-title');
  const hasLogo = types.includes('text-logo');
  if (hasTitle !== hasLogo) errors.push(`${label} must use text-title and text-logo together.`);
  if ((hasTitle || hasLogo) && !isLast) errors.push(`${label} uses the closing pair outside the final clip.`);
  if (isLast && !hasTitle) errors.push(`${label} is the closing clip and must pair text-title with text-logo.`);

  clip.items.forEach((item: any, itemIndex: number) => {
    validateItem(item, `${label} item ${itemIndex + 1}`, errors, warnings);
  });
}

function validateChapters(document: any, clipCount: number, errors: string[]): void {
  if (!Array.isArray(document.chapters) || document.chapters.length === 0) {
    errors.push('chapters must be a non-empty array.');
    return;
  }
  let cursor = 0;
  document.chapters.forEach((chapter: any, index: number) => {
    const label = `Chapter ${index + 1}`;
    if (!text(chapter?.title)) errors.push(`${label} is missing title.`);
    if (!text(chapter?.summary)) errors.push(`${label} is missing summary.`);
    if (Number(chapter?.startClip) !== cursor) {
      errors.push(`${label} startClip must be ${cursor} so chapters stay contiguous from clip 0.`);
    }
    const count = Number(chapter?.clipCount);
    if (!Number.isInteger(count) || count <= 0) {
      errors.push(`${label} clipCount must be a positive integer.`);
      return;
    }
    cursor += count;
  });
  if (cursor !== clipCount) {
    errors.push(`Chapter clipCount values total ${cursor} but the storyboard has ${clipCount} clips.`);
  }
}

/** Estimated runtime: clip length is the sum of its item durations. */
export function estimateDurationSeconds(clips: StoryboardClip[]): number {
  return clips.reduce(
    (total, clip) => total + (clip.items || []).reduce(
      (clipTotal, item) => clipTotal + (Number(item?.duration) || 0),
      0,
    ),
    0,
  );
}

export function validateStoryboard(
  value: unknown,
  options: StoryboardValidationOptions,
): StoryboardReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const document = value as any;

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { errors: ['Storyboard must be a JSON object.'], warnings, metrics: {} };
  }

  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(text(document.slug))) {
    errors.push('slug must be lowercase kebab-case, 2-49 characters.');
  }
  for (const field of ['title', 'hook', 'summary', 'closing'] as const) {
    if (!text(document[field])) errors.push(`${field} is required.`);
  }
  const hue = Number(document.hue);
  if (!Number.isFinite(hue) || hue < 0 || hue > 360) errors.push('hue must be a number between 0 and 360.');

  if (!Array.isArray(document.clips) || document.clips.length === 0) {
    errors.push('clips must be a non-empty array.');
    return { errors, warnings, metrics: {} };
  }
  const clips = document.clips as StoryboardClip[];
  if (clips.length < options.minClips || clips.length > options.maxClips) {
    errors.push(`clips must contain ${options.minClips}-${options.maxClips} entries; received ${clips.length}.`);
  }

  clips.forEach((clip, index) => validateClip(clip, index, index === clips.length - 1, errors, warnings));
  validateChapters(document, clips.length, errors);

  const componentTypes = new Set<string>();
  for (const clip of clips) {
    for (const item of clip?.items || []) {
      if (item?.type) componentTypes.add(item.type);
    }
  }
  if (componentTypes.size < options.minComponentTypes) {
    errors.push(
      `Storyboard uses ${componentTypes.size} component types; at least ${options.minComponentTypes} are required.`,
    );
  }

  const duration = estimateDurationSeconds(clips);
  const lower = options.targetDurationSeconds * (1 - options.durationTolerance);
  const upper = options.targetDurationSeconds * (1 + options.durationTolerance);
  if (duration < lower || duration > upper) {
    errors.push(
      `Estimated runtime ${duration.toFixed(1)}s must fall within ${lower.toFixed(1)}-${upper.toFixed(1)}s `
      + `(target ${options.targetDurationSeconds}s).`,
    );
  }

  const speechWords = clips.reduce(
    (total, clip) => total + text(clip?.speech).split(/\s+/).filter(Boolean).length,
    0,
  );

  return {
    errors,
    warnings,
    metrics: {
      clips: clips.length,
      chapters: Array.isArray(document.chapters) ? document.chapters.length : 0,
      componentTypes: componentTypes.size,
      estimatedSeconds: Number(duration.toFixed(1)),
      speechWords,
    },
  };
}
