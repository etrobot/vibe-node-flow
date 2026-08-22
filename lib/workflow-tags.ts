export const DEFAULT_NODE_TAG_CATALOG = ['DB', 'ENV', 'FS', 'LLM'] as const;

export const MAX_NODE_TAG_LENGTH = 24;

export interface NodeTagColors {
  background: string;
  border: string;
  foreground: string;
}

const MACARON_TAG_COLORS: NodeTagColors[] = [
  { background: '#FBE3E8', border: '#F4C3CE', foreground: '#7D3E4C' },
  { background: '#DFF3E7', border: '#BFE3CE', foreground: '#2F6950' },
  { background: '#E2ECFA', border: '#C5D8F2', foreground: '#365A82' },
  { background: '#EEE5F8', border: '#D9C9ED', foreground: '#604B7A' },
  { background: '#FCE8D8', border: '#F3CEB1', foreground: '#805135' },
  { background: '#FFF2C9', border: '#F1DFA1', foreground: '#765F24' },
  { background: '#DDF3F2', border: '#B9DEDC', foreground: '#316967' },
  { background: '#F5E3F0', border: '#E5C4DC', foreground: '#744A68' },
];

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function normalizeNodeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_NODE_TAG_LENGTH);
}

export function uniqueNodeTags(tags: readonly string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags ?? []) {
    const tag = normalizeNodeTag(rawTag);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }

  return result;
}

/** Workflow discovery tags reuse the same trim / length / case-insensitive uniqueness rules. */
export const uniqueWorkflowTags = uniqueNodeTags;
export const normalizeWorkflowTag = normalizeNodeTag;

export function workflowHasTag(tags: readonly string[] | undefined, tag: string): boolean {
  const key = normalizeWorkflowTag(tag).toLocaleLowerCase();
  if (!key) return false;
  return uniqueWorkflowTags(tags).some((candidate) => candidate.toLocaleLowerCase() === key);
}

export function workflowHasAnyTag(
  tags: readonly string[] | undefined,
  selectedTags: readonly string[],
): boolean {
  if (selectedTags.length === 0) return true;
  return selectedTags.some((tag) => workflowHasTag(tags, tag));
}

export function mergeNodeTagCatalog(
  catalog?: readonly string[],
  selectedTags?: readonly string[],
): string[] {
  return uniqueNodeTags([
    ...DEFAULT_NODE_TAG_CATALOG,
    ...(catalog ?? []),
    ...(selectedTags ?? []),
  ]);
}

export function isDefaultNodeTag(tag: string): boolean {
  const key = normalizeNodeTag(tag).toLocaleUpperCase();
  return DEFAULT_NODE_TAG_CATALOG.some((defaultTag) => defaultTag === key);
}

export function getNodeTagColors(tag: string): NodeTagColors {
  const normalized = normalizeNodeTag(tag).toLocaleUpperCase();
  const defaultIndex = DEFAULT_NODE_TAG_CATALOG.findIndex((defaultTag) => defaultTag === normalized);
  if (defaultIndex >= 0) {
    const colors = MACARON_TAG_COLORS[defaultIndex];
    return { ...colors, background: withAlpha(colors.background, 0.7), border: withAlpha(colors.border, 0.9) };
  }

  let hash = 0;
  for (const character of normalized) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const customColorCount = MACARON_TAG_COLORS.length - DEFAULT_NODE_TAG_CATALOG.length;
  const index = DEFAULT_NODE_TAG_CATALOG.length + (hash % customColorCount);
  const colors = MACARON_TAG_COLORS[index];
  return { ...colors, background: withAlpha(colors.background, 0.7), border: withAlpha(colors.border, 0.9) };
}
