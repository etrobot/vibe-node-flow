import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG,
  type WorkflowJsonBriefConfig,
} from './config.ts';

const MAX_WORKFLOW_NODES = 100;
const MAX_WORKFLOW_EDGES = 500;
const MAX_MERMAID_MATERIALS_PER_NODE = 4;
const MAX_MERMAID_SOURCE_CHARS = 12_000;
const IMPORTANT_DOC_SECTIONS = new Set([
  'design',
  'input',
  'output',
  'input and output',
  'processing',
  'configuration',
  'failure behavior',
]);

export class WorkflowBriefInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowBriefInputError';
  }
}

export class WorkflowBriefValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super('Workflow JSON validation failed:\n' + issues.map((issue) => '- ' + issue).join('\n'));
    this.name = 'WorkflowBriefValidationError';
    this.issues = issues;
  }
}

export interface WorkflowNodeDocument {
  id: string;
  type: string;
  title: string;
  lane: string;
  icon?: string;
  color?: string;
  tags?: string[];
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorkflowEdgeDocument {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  [key: string]: unknown;
}

export interface WorkflowDocument {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  tags?: string[];
  laneLabels?: string[];
  nodes: WorkflowNodeDocument[];
  edges: WorkflowEdgeDocument[];
  [key: string]: unknown;
}

export interface WorkflowGraphAnalysis {
  waves: string[][];
  roots: string[];
  leaves: string[];
  branchPoints: string[];
  joinPoints: string[];
  isolated: string[];
  longestPathNodes: number;
  inbound: Map<string, string[]>;
  outbound: Map<string, string[]>;
}

export interface WorkflowBriefSource {
  document: WorkflowDocument;
  sourceLabel: string;
  sourceFile?: string;
  sourceBytes: number;
  sourceSha256: string;
}

export interface BuildWorkflowBriefOptions {
  projectRoot: string;
  workflowDefinitionDir?: string;
  config: WorkflowJsonBriefConfig;
  source: WorkflowBriefSource;
}

export interface BuiltWorkflowBrief {
  markdown: string;
  /** Compact graph/evidence context intended for the storyboard model. */
  compactBrief: string;
  analysis: WorkflowGraphAnalysis;
  documentedTypes: string[];
  missingDocumentedTypes: string[];
  mermaidMaterials: WorkflowMermaidMaterial[];
  redactedConfigValues: number;
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

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeWorkflowJsonBriefConfig(value: unknown): WorkflowJsonBriefConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<WorkflowJsonBriefConfig>
    : {};
  return {
    ...DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG,
    ...raw,
    sourceWorkflowPath: text(raw.sourceWorkflowPath),
    targetLanguage: text(raw.targetLanguage) || DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.targetLanguage,
    targetAudience: text(raw.targetAudience) || DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.targetAudience,
    targetDurationSeconds: integer(
      raw.targetDurationSeconds,
      DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.targetDurationSeconds,
      30,
      900,
    ),
    explanationFocus: text(raw.explanationFocus) || DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.explanationFocus,
    includeNodeDocs: raw.includeNodeDocs !== false,
    includeNodeConfig: raw.includeNodeConfig !== false,
    maxWorkflowBytes: integer(
      raw.maxWorkflowBytes,
      DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.maxWorkflowBytes,
      1_000,
      10_000_000,
    ),
    maxNodeDocChars: integer(
      raw.maxNodeDocChars,
      DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.maxNodeDocChars,
      200,
      20_000,
    ),
    maxConfigValueChars: integer(
      raw.maxConfigValueChars,
      DEFAULT_WORKFLOW_JSON_BRIEF_CONFIG.maxConfigValueChars,
      40,
      5_000,
    ),
  };
}

function ensureInside(root: string, candidate: string, label: string): void {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new WorkflowBriefInputError(label + ' must stay inside the project root.');
  }
}

export async function loadWorkflowSourceFile(
  projectRootValue: string,
  sourceWorkflowPath: string,
  maxBytes: number,
): Promise<WorkflowBriefSource> {
  const configuredPath = text(sourceWorkflowPath);
  if (!configuredPath) {
    throw new WorkflowBriefInputError('sourceWorkflowPath is required.');
  }
  const projectRoot = await fs.realpath(path.resolve(projectRootValue));
  const lexicalTarget = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(projectRoot, configuredPath);
  ensureInside(projectRoot, lexicalTarget, 'Workflow path');

  let sourceFile: string;
  try {
    sourceFile = await fs.realpath(lexicalTarget);
  } catch (error) {
    throw new WorkflowBriefInputError(
      'Workflow JSON cannot be resolved (' + configuredPath + '): '
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  ensureInside(projectRoot, sourceFile, 'Resolved workflow path');

  const stat = await fs.stat(sourceFile);
  if (!stat.isFile()) {
    throw new WorkflowBriefInputError('Workflow path is not a file: ' + configuredPath);
  }
  if (stat.size > maxBytes) {
    throw new WorkflowBriefInputError(
      'Workflow JSON is ' + stat.size + ' bytes; keep it within ' + maxBytes + ' bytes.',
    );
  }

  const raw = await fs.readFile(sourceFile, 'utf8');
  const document = parseWorkflowJson(raw);
  return {
    document,
    sourceLabel: path.relative(projectRoot, sourceFile) || path.basename(sourceFile),
    sourceFile,
    sourceBytes: Buffer.byteLength(raw),
    sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  };
}

export function parseWorkflowJson(rawValue: unknown): WorkflowDocument {
  const raw = text(rawValue);
  if (!raw) throw new WorkflowBriefInputError('Workflow JSON is empty.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkflowBriefInputError(
      'Workflow JSON cannot be parsed: ' + (error instanceof Error ? error.message : String(error)),
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorkflowBriefInputError('Workflow JSON must contain one object.');
  }
  return parsed as WorkflowDocument;
}

export function workflowSourceFromManualJson(raw: string): WorkflowBriefSource {
  const document = parseWorkflowJson(raw);
  return {
    document,
    sourceLabel: 'manual-input',
    sourceBytes: Buffer.byteLength(raw),
    sourceSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  };
}

export function validateWorkflowDocument(document: WorkflowDocument): string[] {
  const issues: string[] = [];
  if (!text(document?.id)) issues.push('id is required.');
  if (!text(document?.name)) issues.push('name is required.');
  if (!Array.isArray(document?.nodes) || document.nodes.length === 0) {
    issues.push('nodes must be a non-empty array.');
    return issues;
  }
  if (document.nodes.length > MAX_WORKFLOW_NODES) {
    issues.push('nodes contains ' + document.nodes.length + ' entries; keep at most ' + MAX_WORKFLOW_NODES + '.');
  }
  if (!Array.isArray(document?.edges)) {
    issues.push('edges must be an array.');
    return issues;
  }
  if (document.edges.length > MAX_WORKFLOW_EDGES) {
    issues.push('edges contains ' + document.edges.length + ' entries; keep at most ' + MAX_WORKFLOW_EDGES + '.');
  }

  const nodeIds = new Set<string>();
  document.nodes.forEach((node, index) => {
    const label = 'Node ' + (index + 1);
    const id = text(node?.id);
    if (!id) issues.push(label + ' id is required.');
    else if (nodeIds.has(id)) issues.push(label + ' duplicates node id ' + JSON.stringify(id) + '.');
    else nodeIds.add(id);
    if (!text(node?.type)) issues.push(label + ' (' + (id || 'unknown') + ') type is required.');
    if (!text(node?.title)) issues.push(label + ' (' + (id || 'unknown') + ') title is required.');
    if (!text(node?.lane)) issues.push(label + ' (' + (id || 'unknown') + ') lane is required.');
    if (node?.config !== undefined && (
      !node.config || typeof node.config !== 'object' || Array.isArray(node.config)
    )) {
      issues.push(label + ' (' + (id || 'unknown') + ') config must be an object when present.');
    }
  });

  const edgeIds = new Set<string>();
  const edgePairs = new Set<string>();
  document.edges.forEach((edge, index) => {
    const label = 'Edge ' + (index + 1);
    const id = text(edge?.id);
    const from = text(edge?.fromNodeId);
    const to = text(edge?.toNodeId);
    if (!id) issues.push(label + ' id is required.');
    else if (edgeIds.has(id)) issues.push(label + ' duplicates edge id ' + JSON.stringify(id) + '.');
    else edgeIds.add(id);
    if (!from) issues.push(label + ' fromNodeId is required.');
    if (!to) issues.push(label + ' toNodeId is required.');
    if (from && !nodeIds.has(from)) issues.push(label + ' references missing source node ' + JSON.stringify(from) + '.');
    if (to && !nodeIds.has(to)) issues.push(label + ' references missing target node ' + JSON.stringify(to) + '.');
    if (from && to && from === to) issues.push(label + ' cannot connect a node to itself.');
    const pair = from + '->' + to;
    if (from && to && edgePairs.has(pair)) issues.push(label + ' duplicates connection ' + pair + '.');
    else if (from && to) edgePairs.add(pair);
  });

  if (!issues.length) {
    try {
      analyzeWorkflowGraph(document);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return issues;
}

export function analyzeWorkflowGraph(document: WorkflowDocument): WorkflowGraphAnalysis {
  const nodeIds = document.nodes.map((node) => text(node.id));
  const nodeOrder = new Map(nodeIds.map((id, index) => [id, index]));
  const inbound = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const outbound = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));

  for (const edge of document.edges) {
    const from = text(edge.fromNodeId);
    const to = text(edge.toNodeId);
    if (!inbound.has(to) || !outbound.has(from)) continue;
    inbound.get(to)?.push(from);
    outbound.get(from)?.push(to);
    inDegree.set(to, (inDegree.get(to) || 0) + 1);
  }

  const remaining = new Set(nodeIds);
  const waves: string[][] = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => (inDegree.get(id) || 0) === 0)
      .sort((left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0));
    if (!ready.length) {
      throw new Error('workflow graph contains a cycle.');
    }
    waves.push(ready);
    for (const id of ready) {
      remaining.delete(id);
      for (const target of outbound.get(id) || []) {
        inDegree.set(target, (inDegree.get(target) || 1) - 1);
      }
    }
  }

  const distance = new Map<string, number>(nodeIds.map((id) => [id, 1]));
  for (const wave of waves) {
    for (const id of wave) {
      const current = distance.get(id) || 1;
      for (const target of outbound.get(id) || []) {
        distance.set(target, Math.max(distance.get(target) || 1, current + 1));
      }
    }
  }

  return {
    waves,
    roots: nodeIds.filter((id) => (inbound.get(id) || []).length === 0),
    leaves: nodeIds.filter((id) => (outbound.get(id) || []).length === 0),
    branchPoints: nodeIds.filter((id) => (outbound.get(id) || []).length > 1),
    joinPoints: nodeIds.filter((id) => (inbound.get(id) || []).length > 1),
    isolated: nodeIds.filter((id) => (
      (inbound.get(id) || []).length === 0 && (outbound.get(id) || []).length === 0
    )),
    longestPathNodes: Math.max(...distance.values()),
    inbound,
    outbound,
  };
}

function nodeBundleRoot(sourceFile: string | undefined): string | null {
  if (!sourceFile) return null;
  let cursor = path.dirname(sourceFile);
  while (true) {
    if (path.basename(cursor) === 'workflows') return path.dirname(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

async function findNodeDirectory(nodesRoot: string, type: string): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(nodesRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries.slice(0, 500)) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const directory = path.join(nodesRoot, entry.name);
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'node.json'), 'utf8'));
      if (text(manifest?.type) === type) return directory;
    } catch {
      // An unrelated or incomplete node directory is not evidence for this type.
    }
  }
  return null;
}

function mermaidFencePattern(): RegExp {
  return new RegExp(
    '(^|\\n)((?:\\x60){3,}|~{3,})[ \\t]*mermaid[^\\n]*\\n([\\s\\S]*?)\\n\\2[ \\t]*(?=\\n|$)',
    'gi',
  );
}

export function extractMermaidSources(markdownValue: string): string[] {
  const sources: string[] = [];
  for (const match of String(markdownValue || '').replace(/\r/g, '').matchAll(mermaidFencePattern())) {
    const source = String(match[3] || '').trim();
    if (source) sources.push(source);
  }
  return sources;
}

function excerptNodeDoc(markdownValue: string, maxChars: number): string {
  const cleaned = String(markdownValue || '')
    .replace(/\r/g, '')
    .replace(mermaidFencePattern(), '$1')
    .trim();
  if (!cleaned) return '';

  const sections = cleaned.split(/^##\s+/m);
  const selected: string[] = [];
  const intro = sections.shift()?.replace(/^#\s+.*\n+/, '').trim();
  if (intro) selected.push(intro);
  for (const docSection of sections) {
    const newline = docSection.indexOf('\n');
    const heading = (newline >= 0 ? docSection.slice(0, newline) : docSection).trim().toLowerCase();
    if (!IMPORTANT_DOC_SECTIONS.has(heading)) continue;
    selected.push('## ' + docSection.trim());
  }
  const result = (selected.length ? selected.join('\n\n') : cleaned)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return result.length <= maxChars ? result : result.slice(0, Math.max(0, maxChars - 14)).trimEnd() + '\n[truncated]';
}

async function loadNodeDocExcerpts(
  projectRoot: string,
  sourceFile: string | undefined,
  types: string[],
  maxChars: number,
): Promise<Map<string, {
  excerpt: string;
  source: string;
  mermaidMaterials: WorkflowMermaidMaterial[];
}>> {
  const roots = [
    projectRoot,
    // A workflow may be loaded from a snapshot or backup bundle. Prefer the
    // active workspace's NODE.md so the visual material follows the current
    // node implementation; use the bundle only as a fallback for external
    // workflow packages that are not installed in this workspace.
    nodeBundleRoot(sourceFile),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  const result = new Map<string, {
    excerpt: string;
    source: string;
    mermaidMaterials: WorkflowMermaidMaterial[];
  }>();
  for (const type of types) {
    for (const root of roots) {
      const nodeDirectory = await findNodeDirectory(path.join(root, 'nodes'), type);
      if (!nodeDirectory) continue;
      try {
        const documentFile = path.join(nodeDirectory, 'NODE.md');
        const documentationSource = path.relative(projectRoot, documentFile) || documentFile;
        const markdown = await fs.readFile(documentFile, 'utf8');
        const excerpt = excerptNodeDoc(markdown, maxChars);
        const mermaidMaterials = extractMermaidSources(markdown)
          .filter((source) => source.length <= MAX_MERMAID_SOURCE_CHARS)
          .slice(0, MAX_MERMAID_MATERIALS_PER_NODE)
          .map((source, index) => {
            const sourceSha256 = crypto.createHash('sha256').update(source).digest('hex');
            const safeType = type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'node';
            return {
              id: safeType + '-diagram-' + (index + 1) + '-' + sourceSha256.slice(0, 8),
              nodeType: type,
              title: type + ' · NODE.md diagram ' + (index + 1),
              source,
              sourceSha256,
              documentationSource,
            };
          });
        if (!excerpt && !mermaidMaterials.length) continue;
        result.set(type, {
          excerpt,
          source: documentationSource,
          mermaidMaterials,
        });
        break;
      } catch {
        // Missing documentation is reported in the brief; it does not invalidate the workflow graph.
      }
    }
  }
  return result;
}

function isSensitiveConfigKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /(apikey|accesstoken|refreshtoken|password|secret|authorization|privatekey|credential)/.test(normalized);
}

interface SanitizeState {
  redacted: number;
}

function sanitizeConfigValue(
  value: unknown,
  maxStringChars: number,
  state: SanitizeState,
  key = '',
  depth = 0,
): unknown {
  if (isSensitiveConfigKey(key)) {
    state.redacted += 1;
    return '[REDACTED]';
  }
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value ?? null;
  }
  if (typeof value === 'string') {
    return value.length <= maxStringChars
      ? value
      : value.slice(0, Math.max(0, maxStringChars - 14)) + ' [truncated]';
  }
  if (depth >= 5) return '[nested value omitted]';
  if (Array.isArray(value)) {
    const selected = value.slice(0, 20).map((item) => sanitizeConfigValue(
      item,
      maxStringChars,
      state,
      key,
      depth + 1,
    ));
    if (value.length > selected.length) selected.push('[' + (value.length - selected.length) + ' more items]');
    return selected;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of entries.slice(0, 40)) {
      output[childKey] = sanitizeConfigValue(childValue, maxStringChars, state, childKey, depth + 1);
    }
    if (entries.length > 40) output.__omittedKeys = entries.length - 40;
    return output;
  }
  return String(value);
}

function humanList(ids: string[], nodeById: Map<string, WorkflowNodeDocument>): string {
  if (!ids.length) return 'None';
  return ids.map((id) => {
    const node = nodeById.get(id);
    return node ? node.title + ' [' + id + ']' : id;
  }).join('; ');
}

function section(title: string, body: string): string {
  return '## ' + title + '\n\n' + body;
}

export async function buildWorkflowExplanationBrief(
  options: BuildWorkflowBriefOptions,
): Promise<BuiltWorkflowBrief> {
  const issues = validateWorkflowDocument(options.source.document);
  if (issues.length) throw new WorkflowBriefValidationError(issues);
  const document = options.source.document;
  const analysis = analyzeWorkflowGraph(document);
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot));
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const nodeTypes = [...new Set(document.nodes.map((node) => node.type))];
  const docs = options.config.includeNodeDocs
    ? await loadNodeDocExcerpts(
      projectRoot,
      options.source.sourceFile,
      nodeTypes,
      options.config.maxNodeDocChars,
    )
    : new Map<string, {
      excerpt: string;
      source: string;
      mermaidMaterials: WorkflowMermaidMaterial[];
    }>();
  const mermaidMaterials = [...docs.values()].flatMap((doc) => doc.mermaidMaterials);
  const sanitizeState: SanitizeState = { redacted: 0 };

  const lanes = [...new Set([
    ...(Array.isArray(document.laneLabels) ? document.laneLabels.map(text) : []),
    ...document.nodes.map((node) => text(node.lane)),
  ].filter(Boolean))];
  const waveLines = analysis.waves.map((wave, index) => (
    '- Wave ' + (index + 1) + ': ' + humanList(wave, nodeById)
  ));
  const connectionLines = document.edges.length
    ? document.edges.map((edge) => {
      const from = nodeById.get(edge.fromNodeId);
      const to = nodeById.get(edge.toNodeId);
      return '- ' + (from?.title || edge.fromNodeId) + ' [' + edge.fromNodeId + '] -> '
        + (to?.title || edge.toNodeId) + ' [' + edge.toNodeId + ']';
    })
    : ['- No edges: this is a single-node workflow.'];

  const nodeSections = document.nodes.map((node, index) => {
    const config = options.config.includeNodeConfig
      ? sanitizeConfigValue(
        node.config || {},
        options.config.maxConfigValueChars,
        sanitizeState,
      )
      : '[omitted by workflow-json-brief configuration]';
    return [
      '### ' + (index + 1) + '. ' + node.title,
      '',
      '- ID: ' + node.id,
      '- Type: ' + node.type,
      '- Lane: ' + node.lane,
      '- Upstream: ' + humanList(analysis.inbound.get(node.id) || [], nodeById),
      '- Downstream: ' + humanList(analysis.outbound.get(node.id) || [], nodeById),
      '- Tags: ' + (Array.isArray(node.tags) && node.tags.length ? node.tags.join(', ') : 'None'),
      '- Configuration (sensitive values redacted, long values truncated):',
      '',
      '~~~json',
      JSON.stringify(config, null, 2),
      '~~~',
    ].join('\n');
  });

  const docSections = nodeTypes.map((type) => {
    const doc = docs.get(type);
    return doc
      ? [
        '### ' + type,
        '',
        'Documentation source: ' + doc.source,
        '',
        doc.excerpt || '(This NODE.md contributes Mermaid material only.)',
      ].join('\n')
      : [
        '### ' + type,
        '',
        'No NODE.md evidence was found for this node type. Explain only what the workflow title, graph, and configuration prove.',
      ].join('\n');
  });

  const machineGraph = {
    workflow: {
      id: document.id,
      name: document.name,
      description: text(document.description),
      lanes,
      tags: Array.isArray(document.tags) ? document.tags : [],
    },
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      lane: node.lane,
      icon: text(node.icon),
      color: text(node.color),
    })),
    edges: document.edges.map((edge) => ({
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
    })),
    mermaidMaterials,
    executionWaves: analysis.waves,
    roots: analysis.roots,
    leaves: analysis.leaves,
    branchPoints: analysis.branchPoints,
    joinPoints: analysis.joinPoints,
  };

  const compactNodeLines = document.nodes.map((node) => {
    const doc = docs.get(node.type);
    const evidence = (doc?.excerpt || 'No NODE.md evidence.')
      .replace(/\s+/g, ' ')
      .slice(0, 520);
    return '- ' + node.title + ' [' + node.id + '] · type=' + node.type
      + ' · lane=' + node.lane
      + ' · upstream=' + (analysis.inbound.get(node.id) || []).join(',')
      + ' · downstream=' + (analysis.outbound.get(node.id) || []).join(',')
      + ' · evidence=' + evidence;
  });
  const compactStoryboardContext = [
    'Workflow: ' + document.name + ' [' + document.id + ']',
    'Problem: ' + (text(document.description) || 'Not provided'),
    'Scale: ' + document.nodes.length + ' nodes, ' + document.edges.length + ' edges, '
      + lanes.length + ' lanes, ' + analysis.waves.length + ' execution waves.',
    'Lanes: ' + (lanes.length ? lanes.join(' -> ') : 'None declared'),
    'Execution waves:',
    ...waveLines,
    'Nodes and evidence:',
    ...compactNodeLines,
    'Directed connections:',
    ...connectionLines,
    'Verified Mermaid material IDs:',
    mermaidMaterials.length
      ? mermaidMaterials.map((material) => '- ' + material.id + ' · ' + material.title).join('\n')
      : '- None',
  ].join('\n');
  const compactBrief = [
    section('Compact Storyboard Context', compactStoryboardContext),
    section('Machine-Readable Workflow Graph', [
      'Use this exact graph to draw the workflow overview. Do not add, remove, or reconnect nodes.',
      '',
      '~~~json',
      JSON.stringify(machineGraph, null, 2),
      '~~~',
    ].join('\n')),
  ].join('\n\n');

  const markdown = [
    '# Workflow Explainer Video Brief',
    '',
    section('Source and Delivery Contract', [
      '- Source: ' + options.source.sourceLabel,
      '- SHA-256: ' + options.source.sourceSha256,
      '- Source bytes: ' + options.source.sourceBytes,
      '- Workflow ID: ' + document.id,
      '- Workflow name: ' + document.name,
      '- Workflow description: ' + (text(document.description) || 'Not provided'),
      '- Target language: ' + options.config.targetLanguage,
      '- Target audience: ' + options.config.targetAudience,
      '- Target duration: ' + options.config.targetDurationSeconds + ' seconds',
      '- Explanation focus: ' + options.config.explanationFocus,
    ].join('\n')),
    section('Accuracy Boundary', [
      '- Treat this brief as the sole factual source for narration and on-screen text.',
      '- The source proves graph structure and configured intent; it does not prove that a run succeeded.',
      '- Do not invent performance, cost, popularity, runtime results, external product behavior, or user outcomes.',
      '- Keep exact workflow, node, and lane names when they are shown on screen.',
      '- Explain redacted or truncated config only at the level explicitly visible here.',
    ].join('\n')),
    section('Structural Overview', [
      '- Scale: ' + document.nodes.length + ' nodes, ' + document.edges.length + ' edges, '
        + lanes.length + ' lanes, ' + analysis.waves.length + ' execution waves',
      '- Lanes: ' + (lanes.length ? lanes.join(' -> ') : 'None declared'),
      '- Entry nodes: ' + humanList(analysis.roots, nodeById),
      '- Terminal nodes: ' + humanList(analysis.leaves, nodeById),
      '- Branch points: ' + humanList(analysis.branchPoints, nodeById),
      '- Join points: ' + humanList(analysis.joinPoints, nodeById),
      '- Isolated nodes: ' + humanList(analysis.isolated, nodeById),
      '- Longest dependency path: ' + analysis.longestPathNodes + ' node(s)',
    ].join('\n')),
    section('Execution Waves', waveLines.join('\n')),
    section('Directed Connections', connectionLines.join('\n')),
    compactBrief,
    section('Node-by-Node Evidence', nodeSections.join('\n\n')),
    section('Node Type Reference', docSections.join('\n\n')),
    section('Mermaid Materials', mermaidMaterials.length
      ? mermaidMaterials.map((material) => (
        '- ' + material.id + ': ' + material.title + ' (' + material.documentationSource + ')'
      )).join('\n')
      : '- No Mermaid diagrams were found in the selected NODE.md files.'),
    section('Required Story Arc', [
      '1. Open with the problem stated by the workflow name and description; do not use a generic app-launch hook.',
      '2. Show a faithful workflow-canvas overview using the machine-readable graph below.',
      '3. Explain the entry data or trigger, then walk nodes in dependency-wave order.',
      '4. For every node, state its responsibility, important configuration, upstream input, and downstream handoff.',
      '5. Call out branches, joins, parallel waves, or isolated nodes when present.',
      '6. Explain the terminal output and documented warning/error boundary without claiming a successful run.',
      '7. Close by summarizing the end-to-end transformation in one sentence.',
    ].join('\n')),
    section('Machine-Readable Workflow Graph', [
      'Use this exact graph to draw the workflow overview. Do not add, remove, or reconnect nodes.',
      '',
      '~~~json',
      JSON.stringify(machineGraph, null, 2),
      '~~~',
    ].join('\n')),
  ].join('\n\n');

  return {
    markdown,
    compactBrief,
    analysis,
    documentedTypes: nodeTypes.filter((type) => docs.has(type)),
    missingDocumentedTypes: nodeTypes.filter((type) => !docs.has(type)),
    mermaidMaterials,
    redactedConfigValues: sanitizeState.redacted,
  };
}
