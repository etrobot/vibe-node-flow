/**
 * The clip contract mirrors `data/idea-to-app-builder`: the renderer, its
 * `scripts/validate-project.ts`, and `src/renderer/clipTypes.ts` all agree on
 * this shape. Keeping the deterministic checks here means a storyboard that
 * passes this node also passes `npm run validate-project` in the builder.
 *
 * Two things the authored document does NOT carry, both borrowed from the
 * ContentFactory video spec:
 *
 *  - Structural payloads. A pyramid or a process strip is declared once in
 *    `global-components` and referenced by `key`; a shot picks the highlighted
 *    node with a semantic `spot` instead of a positional `targetIndex`.
 *  - Item durations. Timing comes from `**anchors**` in the narration, resolved
 *    against real Edge TTS word boundaries by `edge-tts-narration`. A model
 *    guessing seconds is what made narration and picture drift apart before.
 *
 * `resolve.ts` expands both back into the flat item shape the renderer reads.
 */

export const CLIP_BACKGROUNDS = ['aurora', 'blur', 'wave', 'semrush-glow'] as const;

/** Every type the renderer implements. Hand-written project JSON may use all of them. */
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

/**
 * Types withheld from the model. The renderer keeps every implementation, but a
 * generic product video has no use for another product's brand scenes, and
 * `image`/`video` need media this workflow never produces.
 */
const RESERVED_ITEM_TYPES = new Set<string>([
  'x-profile',
  'image',
  'video',
  'semrush-search',
  'semrush-ai-badge',
  'semrush-logo',
  'semrush-workspace',
  'semrush-chat',
  'semrush-publish',
  'semrush-audit',
  'semrush-feature-cloud',
]);

/** The menu handed to the model: every renderer type that is not reserved. */
export const AUTHORABLE_ITEM_TYPES = CLIP_ITEM_TYPES.filter(
  (type) => !RESERVED_ITEM_TYPES.has(type),
);

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

/**
 * Types whose payload is a reusable structure. Declared once in
 * `global-components`, referenced from clips by `key`.
 */
export const GLOBAL_COMPONENT_TYPES = [
  'pyramid-highlight',
  'process-card-highlight',
  'comparison-table',
  'chart-bar',
  'chart-line',
  'chart-pie',
  'feedback-cards',
] as const;

/** Referencing types that also need a `spot`, because they highlight one node. */
const SPOT_REQUIRED_TYPES = new Set<string>(['pyramid-highlight', 'process-card-highlight']);

export const MIN_ITEM_DURATION = 0.6;
export const MAX_ITEM_DURATION = 6;
export const MAX_ITEMS_PER_CLIP = 3;
export const MAX_GLOBAL_COMPONENTS = 12;

/** Speech pace used to estimate runtime, since items no longer carry seconds. */
export const WORDS_PER_SECOND = 2.6;
/** Han script has no spaces, so estimate its pace per character instead. */
export const HAN_CHARS_PER_SECOND = 4.8;

export const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ClipBackground = (typeof CLIP_BACKGROUNDS)[number];
export type ClipItemType = (typeof CLIP_ITEM_TYPES)[number];
export type GlobalComponentType = (typeof GLOBAL_COMPONENT_TYPES)[number];
export type TimingMode = 'anchor' | 'duration';

export interface StoryboardCard {
  key: string;
  icon?: string;
  title: string;
  number?: string;
}

export interface StoryboardComparisonColumn {
  label: string;
  featured?: boolean;
}

export interface StoryboardComparisonRow {
  feature: string;
  values: Array<boolean | string>;
}

export interface StoryboardChartDatum {
  key: string;
  label: string;
  value: number;
  labelPrefix?: string;
  color?: string;
}

export interface StoryboardLineMetric {
  key: string;
  label: string;
  prefix?: string;
  suffix?: string;
  direction?: 'up' | 'down';
  valueStart?: number;
  valueEnd?: number;
}

/** One reusable structure. Only the field matching `component` is read. */
export interface StoryboardGlobalComponent {
  key: string;
  component: GlobalComponentType;
  cards?: StoryboardCard[];
  comparisonColumns?: StoryboardComparisonColumn[];
  comparisonRows?: StoryboardComparisonRow[];
  chartData?: StoryboardChartDatum[];
  lineMetrics?: StoryboardLineMetric[];
  chartHeading?: string;
  chartDescription?: string;
}

export interface StoryboardItem {
  type: ClipItemType;
  /** Optional under `anchor` timing; the narration resolves real seconds. */
  duration?: number;
  /** Reference into `global-components`. Required for referencing types. */
  key?: string;
  /** Node inside the referenced component to focus. */
  spot?: string;
  title?: string;
  label?: string;
  secondaryLabel?: string;
  icon?: string;
  prompt?: string;
  words?: string[];
  ctaText?: string;
  effect?: 'shockwave';
  /** Optional opt-in for a generated product surface; the demo node also recognizes UI item types. */
  demoUi?: boolean | { state?: string; [key: string]: unknown };
  demo?: boolean;
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

export interface StoryboardPalette {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  secondary: string;
}

export interface StoryboardDocument {
  slug: string;
  title: string;
  hook: string;
  summary: string;
  closing: string;
  hue: number;
  palette?: StoryboardPalette;
  chapters: StoryboardChapter[];
  'global-components'?: StoryboardGlobalComponent[];
  clips: StoryboardClip[];
}

/** Fields carrying a component's reusable payload, by component type. */
const PAYLOAD_FIELDS: Record<GlobalComponentType, string[]> = {
  'pyramid-highlight': ['cards'],
  'process-card-highlight': ['cards'],
  'comparison-table': ['comparisonColumns', 'comparisonRows'],
  'chart-bar': ['chartData'],
  'chart-pie': ['chartData'],
  'chart-line': ['lineMetrics'],
  'feedback-cards': ['cards'],
};

export function isGlobalComponentType(type: unknown): type is GlobalComponentType {
  return GLOBAL_COMPONENT_TYPES.includes(type as GlobalComponentType);
}

/**
 * Every addressable node key inside one component, in render order. This is the
 * set `spot` may point at, and the order `targetIndex` counts through.
 */
export function componentNodeKeys(component: StoryboardGlobalComponent): string[] {
  switch (component.component) {
    case 'pyramid-highlight':
    case 'process-card-highlight':
    case 'feedback-cards':
      return (component.cards || []).map((card) => String(card?.key ?? ''));
    case 'chart-bar':
    case 'chart-pie':
      return (component.chartData || []).map((datum) => String(datum?.key ?? ''));
    case 'chart-line':
      return (component.lineMetrics || []).map((metric) => String(metric?.key ?? ''));
    case 'comparison-table':
      return (component.comparisonRows || []).map((row) => String(row?.feature ?? ''));
    default:
      return [];
  }
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const ANCHOR_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * Components written straight into a clip's `items`. Mirrors the builder's
 * SKILL.md, minus the reserved brand and media types.
 */
export const DIRECT_COMPONENT_GUIDE = [
  'text-typing: typed command, compact claim, or generated-output line. Only as the first item of a clip.',
  'text-popup: punchy alert, reaction, or quick reveal.',
  'text-shatter: broken old approach, risk, failure, or disruption.',
  'text-zoom: one important conclusion.',
  'text-impact: stacked keyword build; include cumulative `words` array.',
  'text-title / text-logo: closing beat only, and always used as a pair.',
  'ui-dropfiles / ui-prompt-input / ui-render-loading / ui-video-preview:'
  + ' product Demo UI beats. Use at most two of these in the whole storyboard'
  + ' (prefer one input moment + one result moment). ui-prompt-input must include `prompt`.',
  'ui-icon-text: one principle, benefit, boundary, or status; must include a lucide `icon` name.',
  'flowing-stats: growth, usage, reach, revenue, count, or speed metric.',
  'element-growth: something compounding or scaling up.',
  'scene-clock: time pressure, countdown, speed, or schedule.',
  'swipe-delete: removing old work, bad leads, risk, or waste.',
].join('\n');

/**
 * Components whose payload is declared once in `global-components` and pulled
 * into a clip by `key`. Reusing one structure across clips with different
 * `spot` values is how a diagram builds up instead of restarting each time.
 */
export const GLOBAL_COMPONENT_GUIDE = [
  'process-card-highlight: workflow or process overview; `cards` with a lucide `icon` and `title` each.'
  + ' A shot picks the focused step with `spot`.',
  'pyramid-highlight: hierarchy or capability layers, base first; `cards` as above, focused by `spot`.',
  'comparison-table: structured comparison; `comparisonColumns` plus `comparisonRows`,'
  + ' each row holding one value per column. `spot` optionally names a row `feature`.',
  'chart-bar / chart-pie: direct numeric comparison or composition; `chartData` entries with'
  + ' `key`, `label` and numeric `value`.',
  'chart-line: trend or before/after motion; `lineMetrics` entries with `key`, `label`,'
  + ' `valueStart` and `valueEnd`.',
  'feedback-cards: a wall of reactions or testimonials; `cards` whose `title` is the quoted line.',
].join('\n');

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

/** The `**…**` shot-switch anchors in one speech string, in reading order. */
export function speechAnchors(speech: string): string[] {
  return [...String(speech ?? '').matchAll(ANCHOR_PATTERN)].map((match) => match[1]);
}

/** Narration as the voice actually reads it: anchors are direction, not text. */
export function plainSpeech(speech: string): string {
  return String(speech ?? '').replace(ANCHOR_PATTERN, '$1');
}

/**
 * Runtime a clip's narration will occupy. Without authored durations the speech
 * itself is the only signal, so estimate from its length; the real number
 * arrives once Edge TTS has spoken it.
 */
export function estimateSpeechSeconds(speech: string): number {
  const plain = plainSpeech(speech).trim();
  if (!plain) return 0;
  const han = (plain.match(/\p{Script=Han}/gu) || []).length;
  const words = plain
    .replace(/\p{Script=Han}/gu, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return han / HAN_CHARS_PER_SECOND + words / WORDS_PER_SECOND;
}

/**
 * Estimated runtime for the storyboard. Under `duration` timing this is the sum
 * of authored item seconds; under `anchor` timing it is the narration estimate.
 */
export function estimateDurationSeconds(clips: StoryboardClip[], mode: TimingMode = 'anchor'): number {
  if (mode === 'duration') {
    return (clips || []).reduce(
      (total, clip) => total + (clip?.items || []).reduce(
        (clipTotal, item) => clipTotal + (Number(item?.duration) || 0),
        0,
      ),
      0,
    );
  }
  return (clips || []).reduce((total, clip) => total + estimateSpeechSeconds(clip?.speech), 0);
}

/** Item types that become LLM HTML Demo surfaces downstream. */
export const DEMO_UI_HTML_ITEM_TYPES = new Set([
  'ui-dropfiles',
  'ui-prompt-input',
  'ui-render-loading',
  'ui-video-preview',
]);

export const DEFAULT_MAX_DEMO_UI_HTML_ITEMS = 2;

export interface StoryboardValidationOptions {
  minClips: number;
  maxClips: number;
  minComponentTypes: number;
  targetDurationSeconds: number;
  durationTolerance: number;
  timingMode: TimingMode;
  maxGlobalComponents: number;
  /** Ceiling on product Demo UI HTML placeholders across the whole storyboard. */
  maxDemoUiHtmlItems?: number;
}

export interface StoryboardReport {
  errors: string[];
  warnings: string[];
  metrics: Record<string, string | number | boolean>;
}

function validateCard(
  card: any,
  label: string,
  seen: Set<string>,
  errors: string[],
  requireIcon = false,
): void {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    errors.push(`${label} is not an object.`);
    return;
  }
  const key = text(card.key);
  if (!KEY_PATTERN.test(key)) {
    errors.push(`${label} key ${JSON.stringify(card.key ?? null)} must be lowercase kebab-case.`);
  } else if (seen.has(key)) {
    errors.push(`${label} key ${key} is already used in this component.`);
  } else {
    seen.add(key);
  }
  if (!text(card.title)) errors.push(`${label} is missing title.`);
  if (requireIcon && !text(card.icon)) {
    errors.push(`${label} must include a lucide icon name.`);
  }
}

function validateGlobalComponent(
  component: any,
  index: number,
  seenKeys: Set<string>,
  errors: string[],
): void {
  const label = `Global component ${index + 1}`;
  if (!component || typeof component !== 'object' || Array.isArray(component)) {
    errors.push(`${label} is not an object.`);
    return;
  }

  const key = text(component.key);
  if (!KEY_PATTERN.test(key)) {
    errors.push(`${label} key ${JSON.stringify(component.key ?? null)} must be lowercase kebab-case.`);
  } else if (seenKeys.has(key)) {
    errors.push(`${label} key ${key} is declared twice.`);
  } else {
    seenKeys.add(key);
  }

  if (!isGlobalComponentType(component.component)) {
    errors.push(
      `${label} component must be one of ${GLOBAL_COMPONENT_TYPES.join(', ')}; `
      + `received ${JSON.stringify(component.component ?? null)}.`,
    );
    return;
  }

  const named = `${label} (${component.component})`;
  for (const field of PAYLOAD_FIELDS[component.component]) {
    const value = component[field];
    if (!Array.isArray(value) || !value.length) {
      errors.push(`${named} is missing a non-empty ${field} array.`);
    }
  }

  if (Array.isArray(component.cards)) {
    const seenCards = new Set<string>();
    const requireIcon = component.component === 'process-card-highlight'
      || component.component === 'pyramid-highlight';
    component.cards.forEach((card: any, cardIndex: number) => {
      validateCard(card, `${named} card ${cardIndex + 1}`, seenCards, errors, requireIcon);
    });
  }

  if (component.component === 'chart-bar' || component.component === 'chart-pie') {
    const seenData = new Set<string>();
    (Array.isArray(component.chartData) ? component.chartData : []).forEach((datum: any, dataIndex: number) => {
      const dataLabel = `${named} chartData ${dataIndex + 1}`;
      const dataKey = text(datum?.key);
      if (!KEY_PATTERN.test(dataKey)) {
        errors.push(`${dataLabel} key ${JSON.stringify(datum?.key ?? null)} must be lowercase kebab-case.`);
      } else if (seenData.has(dataKey)) {
        errors.push(`${dataLabel} key ${dataKey} is already used in this component.`);
      } else {
        seenData.add(dataKey);
      }
      if (!text(datum?.label)) errors.push(`${dataLabel} is missing label.`);
      if (!Number.isFinite(Number(datum?.value))) errors.push(`${dataLabel} value must be a number.`);
    });
  }

  if (component.component === 'chart-line') {
    const seenMetrics = new Set<string>();
    (Array.isArray(component.lineMetrics) ? component.lineMetrics : []).forEach((metric: any, metricIndex: number) => {
      const metricLabel = `${named} lineMetrics ${metricIndex + 1}`;
      const metricKey = text(metric?.key);
      if (!KEY_PATTERN.test(metricKey)) {
        errors.push(`${metricLabel} key ${JSON.stringify(metric?.key ?? null)} must be lowercase kebab-case.`);
      } else if (seenMetrics.has(metricKey)) {
        errors.push(`${metricLabel} key ${metricKey} is already used in this component.`);
      } else {
        seenMetrics.add(metricKey);
      }
      if (!text(metric?.label)) errors.push(`${metricLabel} is missing label.`);
    });
  }

  if (component.component === 'comparison-table') {
    const columns = Array.isArray(component.comparisonColumns) ? component.comparisonColumns : [];
    const rows = Array.isArray(component.comparisonRows) ? component.comparisonRows : [];
    columns.forEach((column: any, columnIndex: number) => {
      if (!text(column?.label)) {
        errors.push(`${named} comparisonColumns ${columnIndex + 1} is missing label.`);
      }
    });
    rows.forEach((row: any, rowIndex: number) => {
      const rowLabel = `${named} comparisonRows ${rowIndex + 1}`;
      if (!text(row?.feature)) errors.push(`${rowLabel} is missing feature.`);
      if (!Array.isArray(row?.values) || row.values.length !== columns.length) {
        errors.push(`${rowLabel} must hold exactly ${columns.length} values, one per column.`);
      }
    });
  }
}

function validateItem(
  item: any,
  label: string,
  globals: Map<string, StoryboardGlobalComponent>,
  options: StoryboardValidationOptions,
  errors: string[],
  warnings: string[],
): void {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${label} is not an object.`);
    return;
  }
  if (!AUTHORABLE_ITEM_TYPES.includes(item.type)) {
    errors.push(
      RESERVED_ITEM_TYPES.has(item.type)
        ? `${label} uses reserved type ${item.type}; it is not available to this storyboard.`
        : `${label} has missing or unknown type ${JSON.stringify(item.type ?? null)}.`,
    );
    return;
  }

  if (options.timingMode === 'duration') {
    const duration = Number(item.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`${label} duration must be a positive number.`);
    } else if (duration < MIN_ITEM_DURATION || duration > MAX_ITEM_DURATION) {
      errors.push(`${label} duration ${duration} must be between ${MIN_ITEM_DURATION} and ${MAX_ITEM_DURATION} seconds.`);
    }
  } else if (item.duration !== undefined) {
    const duration = Number(item.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`${label} duration is present but not a positive number; omit it or give it seconds.`);
    }
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
  if (item.effect !== undefined && item.effect !== 'shockwave') {
    errors.push(`${label} has unsupported effect ${JSON.stringify(item.effect)}.`);
  }
  if (text(item.title).length > 60) {
    warnings.push(`${label} title is long; on-screen text reads best at 2-6 words.`);
  }

  if (!isGlobalComponentType(item.type)) {
    if (text(item.key) || text(item.spot)) {
      errors.push(`${label} (${item.type}) carries key/spot, but only ${GLOBAL_COMPONENT_TYPES.join(', ')} reference a global component.`);
    }
    return;
  }

  const key = text(item.key);
  if (!key) {
    errors.push(`${label} (${item.type}) must reference a global component with key.`);
    return;
  }
  const component = globals.get(key);
  if (!component) {
    errors.push(`${label} references unknown global component key ${key}.`);
    return;
  }
  if (component.component !== item.type) {
    errors.push(
      `${label} is a ${item.type} but global component ${key} is a ${component.component}.`,
    );
    return;
  }

  const spot = text(item.spot);
  if (!spot) {
    if (SPOT_REQUIRED_TYPES.has(item.type)) {
      errors.push(`${label} (${item.type}) must name the highlighted node with spot.`);
    }
    return;
  }
  const nodeKeys = componentNodeKeys(component);
  if (!nodeKeys.includes(spot)) {
    errors.push(
      `${label} spot ${spot} is not a node of global component ${key}`
      + `${nodeKeys.length ? ` (${nodeKeys.join(', ')})` : ''}.`,
    );
  }
}

function validateClip(
  clip: any,
  index: number,
  isLast: boolean,
  globals: Map<string, StoryboardGlobalComponent>,
  options: StoryboardValidationOptions,
  errors: string[],
  warnings: string[],
): void {
  const label = `Clip ${index + 1}`;
  if (!clip || typeof clip !== 'object' || Array.isArray(clip)) {
    errors.push(`${label} is not an object.`);
    return;
  }
  const speech = String(clip.speech ?? '');
  if (!text(speech)) errors.push(`${label} is missing speech.`);
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

  if (options.timingMode === 'anchor') {
    const anchors = speechAnchors(speech);
    const expected = Math.max(0, clip.items.length - 1);
    if (anchors.length !== expected) {
      errors.push(
        `${label} has ${clip.items.length} items so speech needs exactly ${expected} **anchor** `
        + `phrase(s) to switch on; found ${anchors.length}.`,
      );
    }
    anchors.forEach((anchor, anchorIndex) => {
      if (!anchor.trim()) {
        errors.push(`${label} anchor ${anchorIndex + 1} is empty.`);
      } else if (anchor.trim().length > 40) {
        warnings.push(`${label} anchor ${anchorIndex + 1} is long; anchor a short phrase, not a sentence.`);
      }
    });
    if (/\*\*\*/.test(speech)) {
      errors.push(`${label} speech has nested or unbalanced ** markers.`);
    }
  } else if (/\*\*/.test(speech)) {
    errors.push(`${label} speech contains ** markers; under duration timing speech must stay plain.`);
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
    validateItem(item, `${label} item ${itemIndex + 1}`, globals, options, errors, warnings);
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

function validatePalette(palette: any, errors: string[]): void {
  if (palette === undefined) return;
  if (!palette || typeof palette !== 'object' || Array.isArray(palette)) {
    errors.push('palette must be an object when present.');
    return;
  }
  for (const role of ['background', 'foreground', 'muted', 'accent', 'secondary'] as const) {
    if (!HEX_COLOR.test(text(palette[role]))) {
      errors.push(`palette.${role} must be a #rrggbb hex color.`);
    }
  }
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
  validatePalette(document.palette, errors);

  const declared = document['global-components'];
  const globals = new Map<string, StoryboardGlobalComponent>();
  if (declared !== undefined) {
    if (!Array.isArray(declared)) {
      errors.push('global-components must be an array when present.');
    } else {
      if (declared.length > options.maxGlobalComponents) {
        errors.push(
          `global-components holds ${declared.length} entries; keep at most ${options.maxGlobalComponents}.`,
        );
      }
      const seenKeys = new Set<string>();
      declared.forEach((component: any, index: number) => {
        validateGlobalComponent(component, index, seenKeys, errors);
        const key = text(component?.key);
        if (key && isGlobalComponentType(component?.component) && !globals.has(key)) {
          globals.set(key, component as StoryboardGlobalComponent);
        }
      });
    }
  }

  if (!Array.isArray(document.clips) || document.clips.length === 0) {
    errors.push('clips must be a non-empty array.');
    return { errors, warnings, metrics: {} };
  }
  const clips = document.clips as StoryboardClip[];
  if (clips.length < options.minClips || clips.length > options.maxClips) {
    errors.push(`clips must contain ${options.minClips}-${options.maxClips} entries; received ${clips.length}.`);
  }

  clips.forEach((clip, index) => {
    validateClip(clip, index, index === clips.length - 1, globals, options, errors, warnings);
  });
  validateChapters(document, clips.length, errors);

  const maxDemoUiHtmlItems = options.maxDemoUiHtmlItems ?? DEFAULT_MAX_DEMO_UI_HTML_ITEMS;
  const demoUiItems: string[] = [];
  clips.forEach((clip, clipIndex) => {
    (clip?.items || []).forEach((item, itemIndex) => {
      if (DEMO_UI_HTML_ITEM_TYPES.has(String(item?.type || ''))) {
        demoUiItems.push(`clip ${clipIndex + 1} item ${itemIndex + 1} (${item.type})`);
      }
    });
  });
  if (maxDemoUiHtmlItems >= 0 && demoUiItems.length > maxDemoUiHtmlItems) {
    errors.push(
      `Storyboard has ${demoUiItems.length} Demo UI HTML placeholders`
      + ` (${demoUiItems.join(', ')}); keep at most ${maxDemoUiHtmlItems}`
      + ' (prefer one input + one result). Extra product beats should use other component types.',
    );
  }

  const componentTypes = new Set<string>();
  const referenced = new Set<string>();
  for (const clip of clips) {
    for (const item of clip?.items || []) {
      if (item?.type) componentTypes.add(item.type);
      if (item?.key) referenced.add(String(item.key));
    }
  }
  if (componentTypes.size < options.minComponentTypes) {
    errors.push(
      `Storyboard uses ${componentTypes.size} component types; at least ${options.minComponentTypes} are required.`,
    );
  }
  for (const key of globals.keys()) {
    if (!referenced.has(key)) {
      warnings.push(`Global component ${key} is declared but never referenced by a clip.`);
    }
  }

  const duration = estimateDurationSeconds(clips, options.timingMode);
  const lower = options.targetDurationSeconds * (1 - options.durationTolerance);
  const upper = options.targetDurationSeconds * (1 + options.durationTolerance);
  if (duration < lower || duration > upper) {
    errors.push(
      `${options.timingMode === 'anchor' ? 'Estimated narration' : 'Estimated runtime'} `
      + `${duration.toFixed(1)}s must fall within ${lower.toFixed(1)}-${upper.toFixed(1)}s `
      + `(target ${options.targetDurationSeconds}s).`,
    );
  }

  const speechWords = clips.reduce(
    (total, clip) => total + plainSpeech(clip?.speech).split(/\s+/).filter(Boolean).length,
    0,
  );

  return {
    errors,
    warnings,
    metrics: {
      clips: clips.length,
      chapters: Array.isArray(document.chapters) ? document.chapters.length : 0,
      componentTypes: componentTypes.size,
      globalComponents: globals.size,
      demoUiHtmlItems: demoUiItems.length,
      estimatedSeconds: Number(duration.toFixed(1)),
      speechWords,
    },
  };
}
