/**
 * Hydration lives in this node so the renderer can expand compact
 * `global-components` references without importing another node.
 */

import { CLIP_BACKGROUNDS } from './renderer/clipTypes.ts';
import { parseComparisonCsv } from './comparisonCsv.ts';

const GLOBAL_COMPONENT_TYPES = new Set([
  'pyramid-highlight',
  'process-card-highlight',
  'comparison-table',
  'chart-bar',
  'chart-line',
  'chart-pie',
  'feedback-cards',
]);

const MIN_ITEM_DURATION = 0.6;
const WORDS_PER_SECOND = 2.6;
const HAN_CHARS_PER_SECOND = 4.8;
const ANCHOR_PATTERN = /\*\*([^*]+)\*\*/g;

const COPIED_FIELDS = [
  'cards',
  'comparisonCsv',
  'chartData',
  'lineMetrics',
  'chartHeading',
  'chartDescription',
] as const;

export interface ClipTiming {
  clipIndex: number;
  startSeconds: number;
  durationSeconds: number;
  items: Array<{ index: number; startSeconds: number; durationSeconds: number }>;
}

export interface HydrateOptions {
  timingMode?: 'anchor' | 'duration';
  timing?: ClipTiming[];
  minItemSeconds?: number;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function plainSpeech(speech: string): string {
  return String(speech ?? '').replace(ANCHOR_PATTERN, '$1');
}

function estimateSpeechSeconds(speech: string): number {
  const plain = plainSpeech(speech).trim();
  if (!plain) return 0;
  const han = (plain.match(/\p{Script=Han}/gu) || []).length;
  const words = plain
    .replace(/\p{Script=Han}/gu, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return han / HAN_CHARS_PER_SECOND + words / WORDS_PER_SECOND;
}

function componentNodeKeys(component: Record<string, any>): string[] {
  switch (component.component) {
    case 'pyramid-highlight':
    case 'process-card-highlight':
    case 'feedback-cards':
      return (component.cards || []).map((card: any) => String(card?.key ?? ''));
    case 'chart-bar':
    case 'chart-pie':
      return (component.chartData || []).map((datum: any) => String(datum?.key ?? ''));
    case 'chart-line':
      return (component.lineMetrics || []).map((metric: any) => String(metric?.key ?? ''));
    case 'comparison-table':
      return (parseComparisonCsv(component.comparisonCsv)?.rows || []).map((row) => row.feature);
    default:
      return [];
  }
}

function globalIndex(document: Record<string, any>): Map<string, Record<string, any>> {
  const index = new Map<string, Record<string, any>>();
  for (const component of document['global-components'] || []) {
    const key = String(component?.key ?? '').trim();
    if (key && !index.has(key)) index.set(key, component);
  }
  return index;
}

function derivedDurations(clip: Record<string, any>, mode: 'anchor' | 'duration', minItemSeconds: number): number[] {
  const items = clip.items || [];
  if (!items.length) return [];
  if (mode === 'duration') {
    return items.map((item: any) => {
      const authored = Number(item?.duration);
      return Number.isFinite(authored) && authored > 0 ? authored : minItemSeconds;
    });
  }
  const authored = items.map((item: any) => Number(item?.duration)).filter((value: number) => Number.isFinite(value) && value > 0);
  if (authored.length === items.length) return authored;

  const total = Math.max(estimateSpeechSeconds(clip.speech), minItemSeconds * items.length);
  const share = total / items.length;
  return items.map(() => round(Math.max(minItemSeconds, share)));
}

export function hydrateItem(
  item: Record<string, any>,
  globals: Map<string, Record<string, any>>,
  durationSeconds: number,
): Record<string, unknown> {
  const { key, spot, duration: _authored, ...rest } = item;
  const hydrated: Record<string, unknown> = { ...rest, duration: round(durationSeconds) };

  if (!key || !GLOBAL_COMPONENT_TYPES.has(item.type)) return hydrated;

  const component = globals.get(key);
  if (!component) return hydrated;

  for (const field of COPIED_FIELDS) {
    const value = component[field];
    if (value !== undefined && hydrated[field] === undefined) hydrated[field] = value;
  }

  if (spot) {
    const target = componentNodeKeys(component).indexOf(spot);
    if (target >= 0) hydrated.targetIndex = target;
  }
  return hydrated;
}

export function hydrateClip(
  clip: Record<string, any>,
  clipIndex: number,
  globals: Map<string, Record<string, any>>,
  options: HydrateOptions,
): Record<string, unknown> {
  const mode = options.timingMode ?? 'anchor';
  const minItemSeconds = options.minItemSeconds ?? MIN_ITEM_DURATION;
  const measured = options.timing?.find((entry) => entry.clipIndex === clipIndex);
  const fallback = derivedDurations(clip, mode, minItemSeconds);

  return {
    speech: plainSpeech(clip.speech).trim(),
    background: CLIP_BACKGROUNDS[clipIndex % CLIP_BACKGROUNDS.length],
    items: (clip.items || []).map((item: any, itemIndex: number) => {
      const slot = measured?.items?.find((entry) => entry.index === itemIndex);
      const seconds = slot && slot.durationSeconds > 0
        ? slot.durationSeconds
        : (fallback[itemIndex] ?? minItemSeconds);
      return hydrateItem(item, globals, seconds);
    }),
  };
}

export function hydrateDocument(
  document: Record<string, any>,
  options: HydrateOptions = {},
): Record<string, unknown> {
  const globals = globalIndex(document);
  return {
    ...(document.slug ? { slug: document.slug } : {}),
    title: document.title,
    hook: document.hook,
    summary: document.summary,
    closing: document.closing,
    chapters: document.chapters,
    clips: (document.clips || []).map((clip: any, index: number) => hydrateClip(clip, index, globals, options)),
  };
}
