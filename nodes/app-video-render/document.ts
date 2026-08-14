/**
 * Shared storyboard → renderer document shaping for HTML5 preview and MP4 capture.
 * Both paths must hydrate `global-components` references the same way; otherwise
 * process/pyramid/feedback cards silently fall back to hardcoded defaults.
 */

import { hydrateDocument } from './hydrate.ts';
import { CLIP_BACKGROUNDS } from './renderer/clipTypes.ts';

const RENDERER_PRESENTATION_FIELDS = new Set([
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
]);

export function parseJsonObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

/** Compact storyboards still carry `key`/`spot` and need expansion before ClipTypeRenderer. */
export function needsHydration(candidate: Record<string, any>): boolean {
  if (Array.isArray(candidate['global-components']) && candidate['global-components'].length) {
    return true;
  }
  return (candidate.clips || []).some((clip: any) => (clip?.items || []).some(
    (item: any) => item?.key || !(Number(item?.duration) > 0),
  ));
}

function normalizeRendererPresentation(candidate: Record<string, any>): Record<string, any> {
  const normalized = JSON.parse(JSON.stringify(candidate)) as Record<string, any>;
  const strip = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(strip);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const field of RENDERER_PRESENTATION_FIELDS) delete record[field];
    Object.values(record).forEach(strip);
  };
  strip(normalized);
  if (Array.isArray(normalized.clips)) {
    normalized.clips.forEach((clip: any, index: number) => {
      if (clip && typeof clip === 'object') {
        clip.background = CLIP_BACKGROUNDS[index % CLIP_BACKGROUNDS.length];
      }
    });
  }
  return normalized;
}

/**
 * Normalize a storyboard or render-manifest payload into the flat clip document
 * the InteractivePlayer and Playwright renderer both consume.
 */
export function toRendererDocument(value: unknown): Record<string, any> | null {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;

  const candidate = parseJsonObject(parsed.document) || parsed;
  if (!Array.isArray(candidate.clips) || candidate.clips.length === 0) return null;

  const hasRendererItems = candidate.clips.some((clip: any) => Array.isArray(clip?.items));
  if (!hasRendererItems) return null;

  const normalized = normalizeRendererPresentation(candidate);
  // Hydrate compact authoring documents; keep already-timed renderer documents
  // intact so narration anchors remain available to render manifests.
  return needsHydration(normalized)
    ? hydrateDocument(normalized as any)
    : normalized;
}
