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
 *    against the generated narration timeline by `fish-audio-narration`. A model
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
/** Minimum visual items required in every clip. */
export const DEFAULT_MIN_ITEMS_PER_CLIP = 2;
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

export interface StoryboardChartDatum {
  key: string;
  label: string;
  value: number;
  labelPrefix?: string;
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
  /** First CSV row is the header; the first column of each later row is the feature. */
  comparisonCsv?: string;
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
  /** Assigned by sanitizeStoryboard; never authored by the storyboard model. */
  background?: ClipBackground;
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
  chapters: StoryboardChapter[];
  'global-components'?: StoryboardGlobalComponent[];
  clips: StoryboardClip[];
  /**
   * Relative path under the run assetsDir to the verified upstream brief file
   * (`source-brief.md`). Prefer this over embedding the brief text on the edge.
   */
  sourceBriefPath?: string;
  /** @deprecated Prefer sourceBriefPath; kept only for older run history. */
  sourceBrief?: string;
}

/** Fields carrying a component's reusable payload, by component type. */
const PAYLOAD_FIELDS: Record<GlobalComponentType, string[]> = {
  'pyramid-highlight': ['cards'],
  'process-card-highlight': ['cards'],
  'comparison-table': ['comparisonCsv'],
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
      return (parseComparisonCsv(component.comparisonCsv)?.rows || [])
        .map((row) => row.feature);
    default:
      return [];
  }
}

const ANCHOR_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * Components written straight into a clip's `items`. Mirrors the builder's
 * SKILL.md, minus the reserved brand and media types.
 */
/**
 * Menu handed to the model. Selection principles mirror prompt.md §四:
 * failure/emotion → shatter/popup; process → process-card; hierarchy → pyramid;
 * numbers → flowing-stats; trends → chart-line; structure/compare → comparison-table.
 */
export const DIRECT_COMPONENT_GUIDE = [
  'text-typing: opening typed claim. Only as the first item of a clip; never after item 0.',
  'text-popup: punchy alert, reaction, reveal, or light meme-like beat.',
  'text-shatter: failure, risk, collapse, broken old approach, or emotional crash.',
  'text-zoom: one important conclusion or turn.',
  'text-impact: stacked keyword / checklist build; include cumulative `words` array.',
  'text-title / text-logo: closing beat only, and always used as a pair.',
  'ui-dropfiles / ui-prompt-input / ui-render-loading / ui-video-preview:'
  + ' product Demo UI beats. Use at most two of these in the whole storyboard'
  + ' (prefer one input moment + one result moment). ui-prompt-input must include `prompt`.',
  'ui-icon-text: one principle, benefit, boundary, or status; must include a lucide `icon` name.',
  'flowing-stats: explicit number in narration — growth, cost, count, speed, revenue.',
  'element-growth: something compounding or scaling up.',
  'scene-clock: only when narration is about waiting, loading, delay, timeout, countdown,'
  + ' or explicit seconds/minutes/hours; otherwise do not use.',
  'swipe-delete: removing old work, bad leads, risk, or waste.',
].join('\n');

/**
 * Components whose payload is declared once in `global-components` and pulled
 * into a clip by `key`. Reusing one structure across clips with different
 * `spot` values is how a diagram builds up instead of restarting each time.
 */
export const GLOBAL_COMPONENT_GUIDE = [
  'process-card-highlight: unidirectional workflow / steps (prompt.md `flow` / `loopflow` intent);'
  + ' `cards` with a lucide `icon` and `title` each. A shot picks the focused step with `spot`.',
  'pyramid-highlight: hierarchy or capability layers, base first; `cards` as above, focused by `spot`.',
  'comparison-table: structure / classification / plan contrast (prompt.md `structure` intent);'
  + ' use one `comparisonCsv` string with a header row and one data row per comparison.'
  + ' The first column is the row feature; `spot` optionally names that feature.',
  'chart-bar / chart-pie: direct numeric comparison or composition; `chartData` entries with'
  + ' `key`, `label` and numeric `value`.',
  'chart-line: trend or breakthrough (prompt.md `linechart` intent); `lineMetrics` entries with'
  + ' `key`, `label`, `valueStart` and `valueEnd`.',
  'feedback-cards: reactions, testimonials, or story-like state beats; `cards` whose `title`'
  + ' is the quoted line. Prefer this over inventing a `story` component.',
].join('\n');

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function parseCsvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function csvValue(value: string): boolean | string {
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}

export function parseComparisonCsv(value: unknown): {
  featureLabel: string;
  columns: Array<{ label: string }>;
  rows: Array<{ feature: string; values: Array<boolean | string> }>;
} | null {
  const parsed = parseCsvRows(text(value));
  if (parsed.length < 2 || parsed[0].length < 2) return null;
  const featureLabel = parsed[0][0];
  const columns = parsed[0].slice(1).map((label) => ({ label }));
  const rows = parsed.slice(1)
    .filter((cells) => text(cells[0]))
    .map((cells) => ({
      feature: cells[0],
      values: columns.map((_, index) => csvValue(cells[index + 1] ?? '')),
    }));
  return rows.length ? { featureLabel, columns, rows } : null;
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

/** Presentation fields that belong to the renderer, never to storyboard JSON. */
const RENDERER_PRESENTATION_FIELDS = [
  'hue',
  'palette',
  'background',
  'color',
  'colors',
  'backgroundColor',
  'foregroundColor',
  'textColor',
  'borderColor',
  'fill',
  'stroke',
  'gradient',
  'theme',
  'style',
  'css',
] as const;

function stripRendererPresentationFields(value: unknown, changes: string[], path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => stripRendererPresentationFields(entry, changes, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const field of RENDERER_PRESENTATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      delete record[field];
      changes.push(`${path}.${field}: Removed renderer-owned presentation field`);
    }
  }
  for (const [key, child] of Object.entries(record)) {
    stripRendererPresentationFields(child, changes, `${path}.${key}`);
  }
}

/**
 * Auto-correct common structural oversights in LLM-generated storyboard JSON
 * before strict contract validation is run.
 */
export function sanitizeStoryboard(
  value: unknown,
  options?: Partial<StoryboardValidationOptions>,
): { document: unknown; changes: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { document: value, changes: [] };
  }

  // Deep clone to avoid mutating input directly
  const doc = JSON.parse(JSON.stringify(value)) as any;
  const changes: string[] = [];

  // The model writes editorial/script content only. Remove every known visual
  // styling field before any structural normalization, then assign the small
  // set of presentation metadata required by the renderer below.
  stripRendererPresentationFields(doc, changes, 'storyboard');

  // 1. Ensure required document fields
  if (!text(doc.title)) doc.title = 'Untitled Storyboard';
  if (!text(doc.hook)) doc.hook = doc.title;
  if (!text(doc.summary)) doc.summary = doc.title;
  if (!text(doc.closing)) doc.closing = 'Thank you for watching.';

  // 2. Clean items and speech in clips
  if (Array.isArray(doc.clips)) {
    const maxDemoUiHtmlItems = options?.maxDemoUiHtmlItems ?? DEFAULT_MAX_DEMO_UI_HTML_ITEMS;
    let demoUiCount = 0;

    doc.clips.forEach((clip: any, clipIdx: number) => {
      if (!clip || typeof clip !== 'object') return;
      const cLabel = `Clip ${clipIdx + 1}`;

      const assignedBackground = CLIP_BACKGROUNDS[clipIdx % CLIP_BACKGROUNDS.length];
      clip.background = assignedBackground;
      changes.push(`${cLabel}: Assigned deterministic background ${assignedBackground}`);

      if (Array.isArray(clip.items)) {
        clip.items.forEach((item: any, itemIdx: number) => {
          if (!item || typeof item !== 'object') return;
          const iLabel = `${cLabel} item ${itemIdx + 1}`;

          // LLMs sometimes collapse an explicit Mermaid target into its state
          // string. Normalize that shorthand before downstream HTML nodes read
          // the storyboard.
          if (item.demoUi === 'workflow-canvas' || item.demoUi === 'node-mermaid') {
            item.demoUi = { state: item.demoUi };
            changes.push(`${iLabel}: Normalized Mermaid demoUi state to an object`);
          }

          // Cleanup stray key/spot on direct components
          if (!isGlobalComponentType(item.type)) {
            if (item.key !== undefined) {
              delete item.key;
              changes.push(`${iLabel} (${item.type}): Removed stray key`);
            }
            if (item.spot !== undefined) {
              delete item.spot;
              changes.push(`${iLabel} (${item.type}): Removed stray spot`);
            }
          }

          // Auto-fill missing title on title-required types
          if (TITLE_REQUIRED_TYPES.has(item.type) && !text(item.title)) {
            let fallbackTitle = text(item.label) || text(item.prompt);
            if (!fallbackTitle && Array.isArray(item.words) && item.words.length) {
              fallbackTitle = item.words.join(' ');
            }
            if (!fallbackTitle && text(clip.speech)) {
              const words = plainSpeech(clip.speech).split(/\s+/).filter(Boolean).slice(0, 4);
              if (words.length) fallbackTitle = words.join(' ');
            }
            if (!fallbackTitle) fallbackTitle = item.type.replace(/^[a-z]+-/, '').replace(/-/g, ' ');
            item.title = fallbackTitle;
            changes.push(`${iLabel} (${item.type}): Auto-filled missing title -> "${fallbackTitle}"`);
          }

          // Item-specific fixes
          if (item.type === 'ui-prompt-input' && !text(item.prompt)) {
            item.prompt = text(item.title) || 'Enter prompt...';
            changes.push(`${iLabel} (ui-prompt-input): Auto-filled missing prompt`);
          }
          if (item.type === 'ui-icon-text' && !text(item.icon)) {
            item.icon = 'Sparkles';
            changes.push(`${iLabel} (ui-icon-text): Auto-filled missing icon with "Sparkles"`);
          }
          if (item.type === 'text-impact' && !Array.isArray(item.words) && text(item.title)) {
            item.words = item.title.split(/\s+/).filter(Boolean);
            changes.push(`${iLabel} (text-impact): Populated words array from title`);
          }

          // Demo UI HTML items capping
          if (DEMO_UI_HTML_ITEM_TYPES.has(String(item.type))) {
            demoUiCount += 1;
            if (maxDemoUiHtmlItems >= 0 && demoUiCount > maxDemoUiHtmlItems) {
              const oldType = item.type;
              item.type = 'ui-icon-text';
              if (!item.title) item.title = oldType;
              if (!item.icon) item.icon = 'Sparkles';
              delete item.prompt;
              delete item.demoUi;
              changes.push(`${iLabel}: Demoted extra Demo UI HTML placeholder ${oldType} -> ui-icon-text`);
            }
          }
        });
      }

      // Auto-fix Speech Anchors
      if (options?.timingMode !== 'duration' && Array.isArray(clip.items) && clip.items.length > 0) {
        const targetAnchors = Math.max(0, clip.items.length - 1);
        const speech = String(clip.speech ?? '');
        const currentAnchors = speechAnchors(speech);

        if (currentAnchors.length !== targetAnchors) {
          if (targetAnchors === 0) {
            // Strip all anchors if 1 item
            clip.speech = plainSpeech(speech);
            changes.push(`${cLabel}: Stripped all anchors because clip has only 1 item`);
          } else if (currentAnchors.length > targetAnchors) {
            // Keep first targetAnchors, convert remaining **text** to text
            let count = 0;
            clip.speech = speech.replace(ANCHOR_PATTERN, (match, p1) => {
              count += 1;
              return count <= targetAnchors ? match : p1;
            });
            changes.push(`${cLabel}: Reduced anchor count from ${currentAnchors.length} to ${targetAnchors}`);
          } else if (currentAnchors.length < targetAnchors) {
            // Add missing anchors
            const plain = plainSpeech(speech);
            const words = plain.split(/\s+/).filter(Boolean);
            if (words.length >= targetAnchors * 2) {
              const segmentLen = Math.floor(words.length / (targetAnchors + 1));
              const newWords = [...words];
              for (let a = currentAnchors.length; a < targetAnchors; a += 1) {
                const idx = (a + 1) * segmentLen;
                if (idx < newWords.length) {
                  newWords[idx] = `**${newWords[idx]}**`;
                }
              }
              clip.speech = newWords.join(' ');
              changes.push(`${cLabel}: Automatically inserted ${targetAnchors - currentAnchors.length} anchor(s) into speech`);
            }
          }
        }
      }
    });
  }

  // 3. Auto-fix Chapters contiguity and total clip counts
  const totalClips = Array.isArray(doc.clips) ? doc.clips.length : 0;
  if (totalClips > 0) {
    if (!Array.isArray(doc.chapters) || doc.chapters.length === 0) {
      doc.chapters = [{
        title: text(doc.title) || 'Overview',
        summary: text(doc.summary) || 'Video overview',
        startClip: 0,
        clipCount: totalClips,
      }];
      changes.push(`Chapters: Created default chapter covering all ${totalClips} clips`);
    } else {
      let cursor = 0;
      const chLen = doc.chapters.length;

      // Base share per chapter
      const baseShare = Math.max(1, Math.floor(totalClips / chLen));
      let remainder = totalClips - baseShare * chLen;

      doc.chapters.forEach((ch: any, idx: number) => {
        if (!ch || typeof ch !== 'object') return;
        if (!text(ch.title)) ch.title = `Chapter ${idx + 1}`;
        if (!text(ch.summary)) ch.summary = ch.title;

        let share = baseShare;
        if (remainder > 0) {
          share += 1;
          remainder -= 1;
        } else if (remainder < 0) {
          share = Math.max(1, share - 1);
        }

        // If this is the last chapter, assign remaining clips
        if (idx === chLen - 1) {
          share = Math.max(1, totalClips - cursor);
        }

        if (ch.startClip !== cursor || ch.clipCount !== share) {
          ch.startClip = cursor;
          ch.clipCount = share;
          changes.push(`Chapter ${idx + 1}: Rebalanced startClip=${cursor}, clipCount=${share}`);
        }
        cursor += share;
      });
    }
  }

  return { document: doc, changes };
}

/**
 * Runtime a clip's narration will occupy. Without authored durations the speech
 * itself is the only signal, so estimate from its length; the real number
 * arrives once the TTS provider has spoken it.
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
  minItemsPerClip?: number;
  minComponentTypes: number;
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

  const componentType = component.component;
  if (!isGlobalComponentType(componentType)) {
    errors.push(
      `${label} component must be one of ${GLOBAL_COMPONENT_TYPES.join(', ')}; `
      + `received ${JSON.stringify(componentType ?? null)}.`,
    );
    return;
  }

  const named = `${label} (${componentType})`;
  for (const field of PAYLOAD_FIELDS[componentType]) {
    const value = component[field];
    if (field === 'comparisonCsv') {
      if (!parseComparisonCsv(value)) {
        errors.push(`${named} comparisonCsv must contain a header row and at least one data row.`);
      }
      continue;
    }
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
  const minItemsPerClip = Math.max(
    DEFAULT_MIN_ITEMS_PER_CLIP,
    options.minItemsPerClip ?? DEFAULT_MIN_ITEMS_PER_CLIP,
  );
  if (clip.items.length < minItemsPerClip) {
    errors.push(`${label} has ${clip.items.length} item(s); it must contain at least ${minItemsPerClip}.`);
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
