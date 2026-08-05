/**
 * Hydration: the authored storyboard is compact, the renderer is not.
 *
 * A clip item may say `{"type":"process-card-highlight","key":"build-flow","spot":"ship"}`.
 * `ClipTypeRenderer` needs the whole `cards` array and a numeric `targetIndex`.
 * Expanding here — rather than making the model repeat the structure in every
 * clip, or teaching the renderer to resolve references — keeps both sides
 * simple: the model writes each structure once, the renderer keeps reading the
 * flat shape it always has.
 *
 * Everything in this file is pure, so `app-video-project`, the preview panel,
 * and the tests all expand a document the same way.
 */

import {
  componentNodeKeys,
  estimateSpeechSeconds,
  isGlobalComponentType,
  MIN_ITEM_DURATION,
  plainSpeech,
  type StoryboardClip,
  type StoryboardDocument,
  type StoryboardGlobalComponent,
  type StoryboardItem,
  type TimingMode,
} from './contract.ts';

/** Real seconds for one clip's items, measured from narration by `edge-tts-narration`. */
export interface ClipTiming {
  clipIndex: number;
  startSeconds: number;
  durationSeconds: number;
  items: Array<{ index: number; startSeconds: number; durationSeconds: number }>;
}

/** Payload fields copied from a global component onto the item referencing it. */
const COPIED_FIELDS = [
  'cards',
  'comparisonColumns',
  'comparisonRows',
  'chartData',
  'lineMetrics',
  'chartHeading',
  'chartDescription',
] as const;

export interface HydrateOptions {
  timingMode?: TimingMode;
  /** Measured narration timing, one entry per clip, indexed by `clipIndex`. */
  timing?: ClipTiming[];
  /** Floor applied when durations are derived rather than measured. */
  minItemSeconds?: number;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function globalIndex(document: StoryboardDocument): Map<string, StoryboardGlobalComponent> {
  const index = new Map<string, StoryboardGlobalComponent>();
  for (const component of document['global-components'] || []) {
    const key = String(component?.key ?? '').trim();
    if (key && !index.has(key)) index.set(key, component);
  }
  return index;
}

/**
 * Spread a clip's seconds across its items. Used only until narration measures
 * the real anchor positions — an even split is the honest guess when the only
 * signal is how long the sentence is.
 */
function derivedDurations(clip: StoryboardClip, mode: TimingMode, minItemSeconds: number): number[] {
  const items = clip.items || [];
  if (!items.length) return [];
  if (mode === 'duration') {
    return items.map((item) => {
      const authored = Number(item?.duration);
      return Number.isFinite(authored) && authored > 0 ? authored : minItemSeconds;
    });
  }
  const authored = items.map((item) => Number(item?.duration)).filter((value) => Number.isFinite(value) && value > 0);
  if (authored.length === items.length) return authored;

  const total = Math.max(estimateSpeechSeconds(clip.speech), minItemSeconds * items.length);
  const share = total / items.length;
  return items.map(() => round(Math.max(minItemSeconds, share)));
}

/**
 * Expand one item: merge in the structure it references and turn its semantic
 * `spot` into the positional `targetIndex` the renderer highlights.
 */
export function hydrateItem(
  item: StoryboardItem,
  globals: Map<string, StoryboardGlobalComponent>,
  durationSeconds: number,
): Record<string, unknown> {
  const { key, spot, duration: _authored, ...rest } = item;
  const hydrated: Record<string, unknown> = { ...rest, duration: round(durationSeconds) };

  if (!key || !isGlobalComponentType(item.type)) return hydrated;

  const component = globals.get(key);
  if (!component) return hydrated;

  for (const field of COPIED_FIELDS) {
    const value = (component as unknown as Record<string, unknown>)[field];
    if (value !== undefined && hydrated[field] === undefined) hydrated[field] = value;
  }

  if (spot) {
    const target = componentNodeKeys(component).indexOf(spot);
    if (target >= 0) hydrated.targetIndex = target;
  }
  return hydrated;
}

export function hydrateClip(
  clip: StoryboardClip,
  clipIndex: number,
  globals: Map<string, StoryboardGlobalComponent>,
  options: HydrateOptions,
): Record<string, unknown> {
  const mode = options.timingMode ?? 'anchor';
  const minItemSeconds = options.minItemSeconds ?? MIN_ITEM_DURATION;
  const measured = options.timing?.find((entry) => entry.clipIndex === clipIndex);
  const fallback = derivedDurations(clip, mode, minItemSeconds);

  return {
    // Anchors are direction for the timing pass, not something a viewer reads.
    speech: plainSpeech(clip.speech).trim(),
    background: clip.background,
    items: (clip.items || []).map((item, itemIndex) => {
      const slot = measured?.items?.find((entry) => entry.index === itemIndex);
      const seconds = slot && slot.durationSeconds > 0
        ? slot.durationSeconds
        : (fallback[itemIndex] ?? minItemSeconds);
      return hydrateItem(item, globals, seconds);
    }),
  };
}

/**
 * The renderer-facing document: same fields `ClipsDocument` has always had,
 * plus the optional palette, with every reference already resolved.
 */
export function hydrateDocument(
  document: StoryboardDocument,
  options: HydrateOptions = {},
): Record<string, unknown> {
  const globals = globalIndex(document);
  return {
    title: document.title,
    hook: document.hook,
    summary: document.summary,
    closing: document.closing,
    hue: document.hue,
    ...(document.palette ? { palette: document.palette } : {}),
    chapters: document.chapters,
    clips: (document.clips || []).map((clip, index) => hydrateClip(clip, index, globals, options)),
  };
}

/** Hydrated clips only, for writing one `chapter-N.json`. */
export function hydrateClips(
  document: StoryboardDocument,
  clips: StoryboardClip[],
  startClip: number,
  options: HydrateOptions = {},
): Array<Record<string, unknown>> {
  const globals = globalIndex(document);
  return clips.map((clip, index) => hydrateClip(clip, startClip + index, globals, options));
}
