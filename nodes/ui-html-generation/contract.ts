import type { StoryboardDocument, StoryboardItem } from '../clip-storyboard/contract.ts';

/** UI items that can be promoted to offline HTML Demo surfaces. */
export const DEMO_UI_ITEM_TYPES = new Set([
  'ui-dropfiles',
  'ui-prompt-input',
  'ui-render-loading',
  'ui-video-preview',
]);

/** Prefer one input beat and one result beat when capping HTML demos. */
const DEMO_UI_TYPE_PRIORITY = [
  'ui-prompt-input',
  'ui-video-preview',
  'ui-dropfiles',
  'ui-render-loading',
] as const;

/** Default ceiling: LLM HTML is expensive; the rest fall back to built-in React UI. */
export const DEFAULT_MAX_DEMO_UI_TARGETS = 2;

export interface DemoUiTarget {
  clipIndex: number;
  itemIndex: number;
  item: StoryboardItem;
}

export interface DemoUiReference {
  clipIndex: number;
  itemIndex: number;
  htmlFile: string;
  /** Same-run URL, injected for browser consumers. */
  url?: string;
}

/** Match a short snippet around the first regex hit for repair logs. */
function matchSnippet(html: string, pattern: RegExp, ahead = 96): string | null {
  const match = pattern.exec(html);
  if (!match || match.index === undefined) return null;
  const end = Math.min(html.length, match.index + Math.max(match[0].length, ahead));
  return html.slice(match.index, end).replace(/\s+/g, ' ').trim();
}

/**
 * Detect real offline-breaking resource loads.
 * Intentionally allows JS `//` comments, SVG/XML xmlns URLs, and plain text
 * mentioning https://example.com — those are not network dependencies.
 */
export function findExternalNetworkDependency(html: string): string | null {
  const patterns: Array<{ pattern: RegExp; label: string }> = [
    {
      // Resource attributes that pull remote (or protocol-relative) assets.
      pattern: /\b(?:src|href|srcset|poster|action|formaction|xlink:href)\s*=\s*['"]\s*(?:https?:)?\/\//i,
      label: 'remote resource attribute',
    },
    {
      // CSS url(...) loading remote assets.
      pattern: /url\s*\(\s*['"]?\s*(?:https?:)?\/\//i,
      label: 'remote CSS url()',
    },
    {
      // @import with a remote stylesheet (plain @import of local is unused here).
      pattern: /@import\b[^;'\n]{0,200}(?:['"]\s*(?:https?:)?\/\/|url\s*\(\s*['"]?\s*(?:https?:)?\/\/)/i,
      label: 'remote @import',
    },
    {
      // <link> / <script src> / <iframe> style tags that still slip past attr checks.
      pattern: /<(?:link|script|iframe|object|embed)\b[^>]*(?:src|href)\s*=\s*['"]\s*(?:https?:)?\/\//i,
      label: 'remote link/script/iframe',
    },
  ];
  for (const { pattern, label } of patterns) {
    const snippet = matchSnippet(html, pattern);
    if (snippet) return label + ': ' + JSON.stringify(snippet);
  }
  return null;
}

export function findBrowserNetworkApi(html: string): string | null {
  const pattern = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*(?:\(|\.|=)/;
  const snippet = matchSnippet(html, pattern);
  return snippet ? JSON.stringify(snippet) : null;
}

/**
 * Peel LLM packaging (markdown fences, leading prose) down to the HTML document.
 * Doctype is optional for Chromium file:// loads; we do not invent one.
 */
export function normalizeDemoHtml(htmlValue: unknown): string {
  let html = String(htmlValue ?? '').replace(/^\uFEFF/, '').trim();
  if (!html) return '';

  const fenced = html.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
  if (fenced?.[1]) html = fenced[1].trim();

  const start = html.search(/<!doctype\s+html\b|<html\b/i);
  if (start > 0) html = html.slice(start).trim();

  // Drop a trailing fence or prose after </html>.
  const end = html.search(/<\/html>/i);
  if (end >= 0) html = html.slice(0, end + '</html>'.length).trim();

  return html;
}

/** Validate one generated offline HTML document before the renderer writes it. */
export function validateDemoHtml(
  htmlValue: unknown,
  target: DemoUiTarget,
  maxLength = 400_000,
): string[] {
  const html = normalizeDemoHtml(htmlValue);
  const errors: string[] = [];
  if (html.length === 0) errors.push('HTML is empty.');
  if (html.length > maxLength) errors.push('HTML exceeds the ' + maxLength + '-character limit.');
  if (!/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html)) {
    errors.push('HTML must contain html, head, and body elements.');
  }
  if (!/<style\b[^>]*>/i.test(html)) errors.push('HTML must contain an inline style block.');
  if (!/data-demo-ui(?:\s|=|>)/i.test(html)) errors.push('HTML is missing the data-demo-ui marker.');

  const networkDependency = findExternalNetworkDependency(html);
  if (networkDependency) {
    errors.push('HTML must not contain external network dependencies (' + networkDependency + ').');
  }
  const networkApi = findBrowserNetworkApi(html);
  if (networkApi) {
    errors.push('HTML must not depend on browser network APIs (' + networkApi + ').');
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

function isExplicitDemoUi(item: any): boolean {
  return item?.demoUi === true || item?.demo === true
    || (item?.demoUi && typeof item.demoUi === 'object');
}

/** Every storyboard item that is eligible for Demo UI HTML (uncapped). */
export function listDemoUiCandidates(document: StoryboardDocument | any): DemoUiTarget[] {
  const targets: DemoUiTarget[] = [];
  for (const [clipIndex, clip] of (document?.clips || []).entries()) {
    for (const [itemIndex, item] of (clip?.items || []).entries()) {
      if (isExplicitDemoUi(item) || DEMO_UI_ITEM_TYPES.has(String(item?.type || ''))) {
        targets.push({ clipIndex, itemIndex, item: item as StoryboardItem });
      }
    }
  }
  return targets;
}

/**
 * Pick at most `maxTargets` Demo UI surfaces for LLM HTML.
 * Remaining ui-* items keep the built-in React clip renderers.
 */
export function selectDemoUiTargets(
  candidates: DemoUiTarget[],
  maxTargets = DEFAULT_MAX_DEMO_UI_TARGETS,
): DemoUiTarget[] {
  const limit = Math.max(0, Math.floor(Number(maxTargets) || 0));
  if (candidates.length <= limit) return candidates.slice();

  const selected: DemoUiTarget[] = [];
  const selectedKeys = new Set<string>();
  const keyOf = (target: DemoUiTarget) => target.clipIndex + ':' + target.itemIndex;
  const take = (target: DemoUiTarget | undefined) => {
    if (!target || selected.length >= limit) return;
    const key = keyOf(target);
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push(target);
  };

  // Explicit marks win first (storyboard asked for a real HTML surface).
  for (const target of candidates) {
    if (isExplicitDemoUi(target.item)) take(target);
  }
  // Then diversify by type priority (prompt + preview beats loading spam).
  for (const type of DEMO_UI_TYPE_PRIORITY) {
    take(candidates.find((target) => String(target.item?.type || '') === type));
  }
  // Fill remaining slots in storyboard order.
  for (const target of candidates) take(target);

  return selected.sort((a, b) => (
    a.clipIndex - b.clipIndex || a.itemIndex - b.itemIndex
  ));
}

/** Find storyboard items that receive LLM HTML for this run. */
export function findDemoUiTargets(
  document: StoryboardDocument | any,
  maxTargets = DEFAULT_MAX_DEMO_UI_TARGETS,
): DemoUiTarget[] {
  return selectDemoUiTargets(listDemoUiCandidates(document), maxTargets);
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
