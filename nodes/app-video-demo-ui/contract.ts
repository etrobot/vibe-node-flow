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

