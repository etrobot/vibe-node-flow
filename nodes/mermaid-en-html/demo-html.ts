/** Local storyboard shapes so this node does not import another node. */
export type StoryboardItem = Record<string, any>;
export type StoryboardDocument = {
  clips?: Array<{ items?: StoryboardItem[] }>;
  [key: string]: unknown;
};

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

export interface WorkflowCanvasNode {
  id: string;
  title: string;
  lane: string;
}

export interface WorkflowCanvasEdge {
  from: string;
  to: string;
}

export interface WorkflowCanvasGraph {
  workflow: {
    id: string;
    name: string;
    lanes: string[];
  };
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
}

export interface WorkflowMermaidMaterial {
  id: string;
  nodeType: string;
  title: string;
  source: string;
  sourceSha256: string;
  documentationSource: string;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function isWorkflowCanvasTarget(target: DemoUiTarget): boolean {
  const demoUi = (target.item as any)?.demoUi;
  return Boolean(
    demoUi
    && typeof demoUi === 'object'
    && text(demoUi.state) === 'workflow-canvas',
  );
}

export function isMermaidMaterialTarget(target: DemoUiTarget): boolean {
  const demoUi = (target.item as any)?.demoUi;
  return Boolean(
    demoUi
    && typeof demoUi === 'object'
    && text(demoUi.state) === 'node-mermaid',
  );
}

/** Stable semantic key used when material generation runs without storyboard clip indexes. */
export function demoMaterialKey(target: DemoUiTarget): string | null {
  const demoUi = (target.item as any)?.demoUi;
  if (!demoUi || typeof demoUi !== 'object') return null;
  const state = text(demoUi.state);
  if (state === 'workflow-canvas') return 'workflow-canvas';
  if (state === 'node-mermaid') {
    const materialId = text(demoUi.materialId);
    return materialId ? 'node-mermaid:' + materialId : null;
  }
  return null;
}

function parseMachineReadableWorkflowGraph(briefValue: unknown): any | null {
  const brief = String(briefValue ?? '');
  const marker = '## Machine-Readable Workflow Graph';
  const markerIndex = brief.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const section = brief.slice(markerIndex + marker.length);
  const tildeFence = section.match(/~~~json\s*([\s\S]*?)~~~/i);
  const backtickFence = section.match(new RegExp('\\x60{3}json\\s*([\\s\\S]*?)\\x60{3}', 'i'));
  const body = tildeFence?.[1] || backtickFence?.[1] || '';
  if (!body.trim()) return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Read the exact graph emitted by workflow-json-brief. */
export function parseWorkflowCanvasGraph(briefValue: unknown): WorkflowCanvasGraph | null {
  const parsed = parseMachineReadableWorkflowGraph(briefValue);
  if (!parsed) return null;
  try {
    const nodes = Array.isArray(parsed?.nodes)
      ? parsed.nodes.map((node: any) => ({
        id: text(node?.id),
        title: text(node?.title),
        lane: text(node?.lane),
      }))
      : [];
    const edges = Array.isArray(parsed?.edges)
      ? parsed.edges.map((edge: any) => ({
        from: text(edge?.from),
        to: text(edge?.to),
      }))
      : [];
    const lanes = Array.isArray(parsed?.workflow?.lanes)
      ? parsed.workflow.lanes.map(text).filter(Boolean)
      : [];
    const nodeIds = nodes.map((node: WorkflowCanvasNode) => node.id);
    const edgeKeys = edges.map((edge: WorkflowCanvasEdge) => edge.from + '->' + edge.to);
    if (
      !text(parsed?.workflow?.id)
      || !text(parsed?.workflow?.name)
      || !nodes.length
      || nodes.some((node: WorkflowCanvasNode) => !node.id || !node.title || !node.lane)
      || edges.some((edge: WorkflowCanvasEdge) => !edge.from || !edge.to)
      || new Set(nodeIds).size !== nodeIds.length
      || edges.some((edge: WorkflowCanvasEdge) => !nodeIds.includes(edge.from) || !nodeIds.includes(edge.to))
      || new Set(edgeKeys).size !== edgeKeys.length
    ) {
      return null;
    }
    return {
      workflow: {
        id: text(parsed.workflow.id),
        name: text(parsed.workflow.name),
        lanes,
      },
      nodes,
      edges,
    };
  } catch {
    return null;
  }
}

/** Read bounded Mermaid sources extracted from the selected NODE.md files. */
export function parseWorkflowMermaidMaterials(briefValue: unknown): WorkflowMermaidMaterial[] {
  const parsed = parseMachineReadableWorkflowGraph(briefValue);
  if (!parsed || !Array.isArray(parsed.mermaidMaterials)) return [];
  return parsed.mermaidMaterials
    .slice(0, 32)
    .map((material: any) => ({
      id: text(material?.id),
      nodeType: text(material?.nodeType),
      title: text(material?.title),
      source: String(material?.source ?? '').trim(),
      sourceSha256: text(material?.sourceSha256),
      documentationSource: text(material?.documentationSource),
    }))
    .filter((material: WorkflowMermaidMaterial) => (
      Boolean(material.id)
      && Boolean(material.nodeType)
      && Boolean(material.title)
      && Boolean(material.source)
      && material.source.length <= 12_000
      && /^[a-f0-9]{64}$/i.test(material.sourceSha256)
    ));
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
  workflowGraph?: WorkflowCanvasGraph | null,
  mermaidMaterials: WorkflowMermaidMaterial[] = [],
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

  if (isWorkflowCanvasTarget(target)) {
    if (!workflowGraph) {
      errors.push('Workflow canvas target requires a verified machine-readable workflow graph in the brief.');
      return errors;
    }
    if (!/data-workflow-canvas(?:\s|=|>)/i.test(html)) {
      errors.push('Workflow canvas HTML is missing the data-workflow-canvas marker.');
    }
    for (const lane of workflowGraph.workflow.lanes) {
      if (!hasExactAttribute(html, 'data-lane', lane)) {
        errors.push('Workflow canvas is missing lane marker ' + JSON.stringify(lane) + '.');
      }
    }
    for (const node of workflowGraph.nodes) {
      if (!hasExactAttribute(html, 'data-node-id', node.id)) {
        errors.push('Workflow canvas is missing node marker ' + JSON.stringify(node.id) + '.');
      }
      const escapedTitle = escapeHtmlText(node.title);
      if (!html.includes(node.title) && !html.includes(escapedTitle)) {
        errors.push(
          'Workflow canvas is missing exact node title ' + JSON.stringify(node.title) + '.',
        );
      }
    }
    for (const edge of workflowGraph.edges) {
      if (!hasEdgeMarker(html, edge.from, edge.to)) {
        errors.push(
          'Workflow canvas is missing directed edge marker '
          + JSON.stringify(edge.from + ' -> ' + edge.to) + '.',
        );
      }
    }
  }
  if (isMermaidMaterialTarget(target)) {
    const materialId = text((target.item as any)?.demoUi?.materialId);
    const material = mermaidMaterials.find((candidate) => candidate.id === materialId);
    if (!materialId || !material) {
      errors.push('Mermaid target requires an exact materialId from the workflow brief.');
      return errors;
    }
    if (!/data-mermaid-material(?:\s|=|>)/i.test(html)) {
      errors.push('Mermaid material HTML is missing the data-mermaid-material marker.');
    }
    if (!hasExactAttribute(html, 'data-mermaid-material-id', material.id)) {
      errors.push('Mermaid material HTML is missing material marker ' + JSON.stringify(material.id) + '.');
    }
    if (!hasExactAttribute(html, 'data-mermaid-source-sha256', material.sourceSha256)) {
      errors.push('Mermaid material HTML is missing source hash ' + JSON.stringify(material.sourceSha256) + '.');
    }
    if (!/<svg\b/i.test(html)) {
      errors.push('Mermaid material HTML must contain the rendered SVG diagram.');
    }
  }
  return errors;
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasExactAttribute(html: string, attribute: string, value: string): boolean {
  const pattern = new RegExp(
    "\\b" + escapeRegExp(attribute) + "\\s*=\\s*([\"'])"
    + escapeRegExp(value) + '\\1',
  );
  return pattern.test(html);
}

function hasEdgeMarker(html: string, from: string, to: string): boolean {
  const fromAttribute = "data-edge-from\\s*=\\s*([\"'])" + escapeRegExp(from) + '\\1';
  const toAttribute = "data-edge-to\\s*=\\s*([\"'])" + escapeRegExp(to) + '\\1';
  return new RegExp('<[^>]*' + fromAttribute + '[^>]*' + toAttribute + '[^>]*>', 'i').test(html)
    || new RegExp('<[^>]*' + toAttribute + '[^>]*' + fromAttribute + '[^>]*>', 'i').test(html);
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
