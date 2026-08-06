import type { StoryboardDocument, StoryboardItem } from '../clip-storyboard/contract.ts';

/** UI items that represent an interaction with the product rather than a text overlay. */
export const DEMO_UI_ITEM_TYPES = new Set([
  'ui-dropfiles',
  'ui-prompt-input',
  'ui-render-loading',
  'ui-video-preview',
]);

export interface DemoUiTarget {
  clipIndex: number;
  itemIndex: number;
  item: StoryboardItem;
}

export interface DemoUiReference {
  clipIndex: number;
  itemIndex: number;
  htmlFile: string;
  /** Same-run URL, injected by the compose node for browser consumers. */
  url?: string;
}

/**
 * Validate HTML returned by the target-level model node before it is written
 * into a run. This deliberately checks the transport/sandbox boundary here so
 * the deterministic packager cannot accidentally accept a second, untrusted
 * HTML producer.
 */
export function validateDemoHtml(
  htmlValue: unknown,
  target: DemoUiTarget,
  maxLength = 400_000,
): string[] {
  const html = String(htmlValue ?? '');
  const errors: string[] = [];
  if (html.length === 0) errors.push('HTML is empty.');
  if (html.length > maxLength) errors.push('HTML exceeds the ' + maxLength + '-character limit.');
  if (!/^\s*<!doctype html>/i.test(html)) errors.push('HTML must start with <!doctype html>.');
  if (!/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html)) {
    errors.push('HTML must contain html, head, and body elements.');
  }
  if (!/<style\b[^>]*>/i.test(html)) errors.push('HTML must contain an inline style block.');
  if (!/data-demo-ui(?:\s|=|>)/i.test(html)) errors.push('HTML is missing the data-demo-ui marker.');
  if (/(?:https?:\/\/|\/\/)/i.test(html)
    || /(?:src|href)\s*=\s*['"][^'"]+/i.test(html) && /(?:src|href)\s*=\s*['"](?:\/\/|https?:)/i.test(html)
    || /@import\b/i.test(html)) {
    errors.push('HTML must not contain external network dependencies.');
  }
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/i.test(html)) {
    errors.push('HTML must not depend on browser network APIs.');
  }
  if (/\b(?:innerHTML|outerHTML|document\.write)\b/i.test(html)) {
    errors.push('HTML must not inject unescaped text through DOM HTML APIs.');
  }

  const item = target.item as unknown as Record<string, unknown>;
  for (const value of Object.values(item)) {
    if (typeof value !== 'string' || !/[&<>"']/.test(value)) continue;
    if (html.includes(value)) {
      errors.push('User text must be HTML-escaped: ' + JSON.stringify(value));
    }
  }
  return errors;
}

/**
 * Find items that need a real product surface. The explicit flag is useful for
 * future storyboard contracts; the current contract remains backwards compatible
 * by treating the existing UI scene types as demo candidates.
 */
export function findDemoUiTargets(document: StoryboardDocument | any): DemoUiTarget[] {
  const targets: DemoUiTarget[] = [];
  for (const [clipIndex, clip] of (document?.clips || []).entries()) {
    for (const [itemIndex, item] of (clip?.items || []).entries()) {
      const explicit = item?.demoUi === true || item?.demo === true
        || (item?.demoUi && typeof item.demoUi === 'object');
      if (explicit || DEMO_UI_ITEM_TYPES.has(String(item?.type || ''))) {
        targets.push({ clipIndex, itemIndex, item: item as StoryboardItem });
      }
    }
  }
  return targets;
}

export function demoFileName(clipIndex: number, itemIndex: number): string {
  return `demo/clip-${String(clipIndex + 1).padStart(2, '0')}-item-${String(itemIndex + 1).padStart(2, '0')}.html`;
}

export function isSafeDemoFile(file: string): boolean {
  return Boolean(file)
    && !file.startsWith('/')
    && !file.includes('\\')
    && file.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')
    && file.startsWith('demo/');
}
