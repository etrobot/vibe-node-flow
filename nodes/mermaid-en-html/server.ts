import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import {
  findDemoUiTargets,
  demoFileName,
  isMermaidMaterialTarget,
  isWorkflowCanvasTarget,
  normalizeDemoHtml,
  parseWorkflowCanvasGraph,
  parseWorkflowMermaidMaterials,
  validateDemoHtml,
  type WorkflowCanvasGraph,
  type WorkflowMermaidMaterial,
} from './demo-html.ts';
import {
  DEFAULT_MERMAID_EN_HTML_CONFIG,
  type MermaidEnHtmlConfig,
} from './config.ts';
import {
  readSourceBrief,
  stripEmbeddedSourceBrief,
} from '../../lib/source-brief-asset.ts';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeConfig(value: unknown): MermaidEnHtmlConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<MermaidEnHtmlConfig>
    : {};
  return {
    ...DEFAULT_MERMAID_EN_HTML_CONFIG,
    ...raw,
    outputLanguage: 'English',
    translateLabels: false,
    width: Math.round(boundedNumber(raw.width, 1920, 320, 7680)),
    height: Math.round(boundedNumber(raw.height, 1080, 180, 4320)),
    maxTargets: Math.round(boundedNumber(raw.maxTargets, 3, 1, 8)),
    maxHtmlLength: Math.round(boundedNumber(raw.maxHtmlLength, 400_000, 2_000, 1_000_000)),
  };
}

function parseStoryboardJson(raw: string): unknown {
  const withoutFences = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Response contains no JSON object.');
  }
  return JSON.parse(withoutFences.slice(start, end + 1));
}

interface GenerationInput {
  storyboard: Record<string, any>;
  brief: string;
}

async function readGenerationInput(
  input: Record<string, string>,
  assetsDir: string,
): Promise<GenerationInput> {
  let storyboard: Record<string, any> | undefined;
  const briefParts: string[] = [];
  for (const [id, raw] of Object.entries(input || {})) {
    const value = clean(raw);
    if (!value) continue;
    let parsed: any;
    try {
      parsed = parseStoryboardJson(value);
    } catch {
      parsed = null;
    }
    if (parsed && Array.isArray(parsed.clips)) {
      if (storyboard) throw new NodeInputError('mermaid-en-html received more than one storyboard document.');
      storyboard = parsed as Record<string, any>;
      const embeddedBrief = await readSourceBrief(parsed, assetsDir);
      if (embeddedBrief) briefParts.push(embeddedBrief);
    } else {
      briefParts.push('### Upstream ' + id + '\n\n' + value);
    }
  }
  if (!storyboard) throw new NodeInputError('mermaid-en-html requires one clip-storyboard upstream document.');
  const brief = briefParts.join('\n\n');
  if (!parseWorkflowCanvasGraph(brief) && !parseWorkflowMermaidMaterials(brief).length) {
    throw new NodeInputError(
      'mermaid-en-html requires verified graph or Mermaid materials via sourceBriefPath (or legacy sourceBrief).',
    );
  }
  return { storyboard, brief };
}

type MermaidSvgMap = Map<string, string>;

export interface MermaidEnHtmlServices {
  renderMermaidSvgs?: (
    materials: Array<{ id: string; source: string }>,
    size: { width: number; height: number },
  ) => Promise<MermaidSvgMap>;
}

function chromiumExecutablePath(): string | null {
  const candidates = [
    clean(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE),
    clean(process.env.CHROME_PATH),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fsSync.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

export async function renderMermaidSvgs(
  materials: Array<{ id: string; source: string }>,
  size: { width: number; height: number },
): Promise<MermaidSvgMap> {
  const output: MermaidSvgMap = new Map();
  if (!materials.length) return output;
  const executablePath = chromiumExecutablePath();
  if (!executablePath) {
    throw new NodeValidationError(
      'Mermaid diagrams require local Chromium. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or CHROME_PATH.',
    );
  }
  const require = createRequire(import.meta.url);
  const mermaidScript = require.resolve('mermaid/dist/mermaid.min.js');
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: size });
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: mermaidScript });
    await page.evaluate(() => {
      (globalThis as any).mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        htmlLabels: false,
        flowchart: { useMaxWidth: true, curve: 'basis' },
      });
    });
    for (const material of materials) {
      try {
        const svg = await page.evaluate(async ({ id, source }) => {
          const renderId = 'video-mermaid-' + id.replace(/[^a-zA-Z0-9_-]/g, '-');
          const rendered = await (globalThis as any).mermaid.render(renderId, source);
          return String(rendered.svg || '');
        }, material);
        if (!svg.trim().startsWith('<svg')) throw new Error('Mermaid returned no SVG document.');
        output.set(material.id, svg);
      } catch (error) {
        throw new NodeValidationError(
          'Mermaid ' + JSON.stringify(material.id) + ' failed to render: '
          + (error instanceof Error ? error.message : String(error)),
        );
      }
    }
  } finally {
    await browser.close();
  }
  return output;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildMermaidHtml(
  material: WorkflowMermaidMaterial,
  source: string,
  svg: string,
  config: MermaidEnHtmlConfig,
): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>',
    '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}',
    'body{width:' + config.width + 'px;height:' + config.height + 'px;background:#070b14;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    'main{position:relative;width:100%;height:100%;overflow:hidden;background:radial-gradient(circle at 20% 10%,rgba(37,99,235,.18),transparent 36%),radial-gradient(circle at 82% 86%,rgba(124,58,237,.16),transparent 38%),#070b14}',
    '.diagram{position:absolute;inset:14% 14%;display:flex;align-items:center;justify-content:center;padding:2%;overflow:visible}.diagram svg{display:block;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain;overflow:visible}',
    '.caption{position:absolute;left:14%;bottom:7%;display:flex;align-items:center;gap:12px;color:rgba(226,232,240,.72);font:600 16px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase}.caption::before{content:"";display:block;width:34px;height:2px;background:#38bdf8;box-shadow:0 0 16px #38bdf8}',
    '</style></head><body data-demo-ui><main data-mermaid-material data-mermaid-material-id="', escapeHtml(material.id), '" data-mermaid-source-sha256="', escapeHtml(material.sourceSha256), '">',
    '<section class="diagram">', svg, '</section><div class="caption">Mermaid diagram · ', escapeHtml(material.nodeType), '</div>',
    '<template data-mermaid-en-source>', escapeHtml(source), '</template></main></body></html>',
  ].join('');
}

function mermaidLabel(value: string): string {
  return value.replace(/"/g, '#quot;').replace(/\n/g, '<br/>');
}

export function buildWorkflowMermaidSource(graph: WorkflowCanvasGraph): string {
  const lanes = graph.workflow.lanes.length ? graph.workflow.lanes : ['Workflow'];
  const nodeKeys = new Map(graph.nodes.map((node, index) => [node.id, 'n' + (index + 1)]));
  const lines = ['flowchart LR'];
  lanes.forEach((lane, laneIndex) => {
    const laneKey = 'lane' + (laneIndex + 1);
    lines.push('  subgraph ' + laneKey + '["' + mermaidLabel(lane) + '"]');
    graph.nodes.filter((node) => node.lane === lane).forEach((node) => {
      lines.push('    ' + nodeKeys.get(node.id) + '["' + mermaidLabel(node.title) + '"]');
    });
    lines.push('  end');
  });
  for (const edge of graph.edges) {
    const from = nodeKeys.get(edge.from);
    const to = nodeKeys.get(edge.to);
    if (from && to) lines.push('  ' + from + ' --> ' + to);
  }
  return lines.join('\n');
}

function buildWorkflowMermaidHtml(
  graph: WorkflowCanvasGraph,
  source: string,
  svg: string,
  config: MermaidEnHtmlConfig,
): string {
  const workflowLabel = 'Workflow graph · ' + graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges';
  const laneMarkers = graph.workflow.lanes.map((lane) => (
    '<i data-lane="' + escapeHtml(lane) + '"></i>'
  )).join('');
  const nodeMarkers = graph.nodes.map((node) => (
    '<i data-node-id="' + escapeHtml(node.id) + '" data-node-title="' + escapeHtml(node.title) + '"></i>'
  )).join('');
  const edgeMarkers = graph.edges.map((edge) => (
    '<i data-edge-from="' + escapeHtml(edge.from) + '" data-edge-to="' + escapeHtml(edge.to) + '"></i>'
  )).join('');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>',
    '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{width:' + config.width + 'px;height:' + config.height + 'px;background:#070b14;color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{position:relative;width:100%;height:100%;overflow:hidden;background:radial-gradient(circle at 20% 10%,rgba(14,165,233,.18),transparent 36%),radial-gradient(circle at 82% 86%,rgba(124,58,237,.16),transparent 38%),#070b14}.diagram{position:absolute;inset:14% 14%;display:flex;align-items:center;justify-content:center;padding:2%;overflow:visible}.diagram svg{display:block;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain;overflow:visible}.caption{position:absolute;left:14%;bottom:7%;display:flex;align-items:center;gap:12px;color:rgba(226,232,240,.72);font:600 16px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.08em;text-transform:uppercase}.caption::before{content:"";display:block;width:34px;height:2px;background:#38bdf8;box-shadow:0 0 16px #38bdf8}.contract{display:none}',
    '</style></head><body data-demo-ui><main data-workflow-canvas data-mermaid-workflow><section class="diagram">', svg, '</section><div class="caption">', workflowLabel, '</div><div class="contract">', laneMarkers, nodeMarkers, edgeMarkers, '</div><template data-mermaid-source>', escapeHtml(source), '</template></main></body></html>',
  ].join('');
}

function normalizeMermaidTargets(
  storyboard: Record<string, any>,
  materials: WorkflowMermaidMaterial[],
): Record<string, any> {
  const document = structuredClone(storyboard);
  const fallbackMaterialId = materials[0]?.id || '';
  for (const clip of document.clips || []) {
    for (const item of clip.items || []) {
      const rawItem = item as any;
      if (rawItem.demoUi === 'workflow-canvas' || rawItem.demoUi === 'node-mermaid') {
        rawItem.demoUi = { state: rawItem.demoUi };
      }
      if (
        rawItem.demoUi
        && typeof rawItem.demoUi === 'object'
        && rawItem.demoUi.state === 'node-mermaid'
        && !clean(rawItem.demoUi.materialId)
        && fallbackMaterialId
      ) {
        rawItem.demoUi.materialId = fallbackMaterialId;
      }
    }
  }
  return document;
}

export async function executeMermaidEnHtml(
  { node, input, onLog, assetsDir, onResourceAccess }: NodePluginContext,
  services: MermaidEnHtmlServices = {},
): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  onResourceAccess?.({ kind: 'filesystem', operation: 'read', detail: 'storyboard source brief asset' });
  const source = await readGenerationInput(input, assetsDir);
  const graph = parseWorkflowCanvasGraph(source.brief);
  const materials = parseWorkflowMermaidMaterials(source.brief);
  const storyboard = normalizeMermaidTargets(source.storyboard, materials);
  const targets = findDemoUiTargets(storyboard, config.maxTargets)
    .filter((target) => isWorkflowCanvasTarget(target) || isMermaidMaterialTarget(target));
  const canvasTargets = targets.filter(isWorkflowCanvasTarget);
  const mermaidTargets = targets.filter(isMermaidMaterialTarget);
  if (canvasTargets.length && !graph) throw new NodeInputError('Workflow canvas target requires a verified graph.');
  const selected = mermaidTargets.map((target) => {
    const id = clean((target.item as any)?.demoUi?.materialId);
    const material = materials.find((candidate) => candidate.id === id);
    if (!material) throw new NodeInputError('Unknown Mermaid materialId ' + JSON.stringify(id) + '.');
    return material;
  });
  const log = createNodeLogger(onLog);
  log.push('mermaid-en-html: ' + targets.length + ' target(s), ' + materials.length + ' verified Mermaid material(s).');
  for (const material of selected) {
    log.push('Using verified Mermaid source without LLM translation for ' + material.id + '.');
  }
  const workflowMermaidSource = graph ? buildWorkflowMermaidSource(graph) : '';
  const renderInputs = [
    ...(graph && canvasTargets.length ? [{ id: 'workflow-canvas', source: workflowMermaidSource }] : []),
    ...selected.map((material) => ({ id: material.id, source: material.source })),
  ];
  const svgs = renderInputs.length
    ? await (services.renderMermaidSvgs || renderMermaidSvgs)(renderInputs, { width: config.width, height: config.height })
    : new Map<string, string>();
  const demos: Array<Record<string, unknown>> = [];
  for (const target of targets) {
    let html: string;
    let generation: Record<string, unknown>;
    if (isWorkflowCanvasTarget(target)) {
      const svg = svgs.get('workflow-canvas');
      if (!svg) throw new NodeValidationError('No Mermaid SVG produced for the workflow canvas.');
      html = buildWorkflowMermaidHtml(graph!, workflowMermaidSource, svg, config);
      generation = { model: 'deterministic-workflow-mermaid', attempts: 1, providerAttempts: 0 };
    } else {
      const id = clean((target.item as any)?.demoUi?.materialId);
      const material = materials.find((candidate) => candidate.id === id)!;
      const svg = svgs.get(id);
      if (!svg) throw new NodeValidationError('No SVG produced for Mermaid material ' + JSON.stringify(id) + '.');
      html = buildMermaidHtml(material, material.source, svg, config);
      generation = { model: 'deterministic-source-mermaid', attempts: 1, providerAttempts: 0 };
    }
    const errors = validateDemoHtml(html, target, config.maxHtmlLength, isWorkflowCanvasTarget(target) ? graph : null, materials);
    if (errors.length) throw new NodeValidationError('Generated Demo UI failed validation:\n' + errors.map((error) => '- ' + error).join('\n'));
    const htmlFile = demoFileName(target.clipIndex, target.itemIndex);
    await fs.mkdir(path.join(assetsDir, 'demo'), { recursive: true });
    await fs.writeFile(path.join(assetsDir, htmlFile), normalizeDemoHtml(html), 'utf8');
    demos.push({ clipIndex: target.clipIndex, itemIndex: target.itemIndex, htmlFile, generation });
  }
  const outputDocument = stripEmbeddedSourceBrief(storyboard as Record<string, any>);
  const sourceBriefPath = clean((storyboard as any).sourceBriefPath);
  return {
    output: JSON.stringify({
      kind: 'mermaid-en-html',
      slug: clean(storyboard.slug),
      width: config.width,
      height: config.height,
      document: outputDocument,
      ...(sourceBriefPath ? { sourceBriefPath } : {}),
      workflowGraph: graph,
      ...(materials.length ? { workflowMermaidMaterials: materials } : {}),
      demos,
    }, null, 2),
    logs: log.logs,
  };
}

export default {
  type: 'mermaid-en-html',
  capabilities: ['filesystem-read', 'output-validation'],
  execute: executeMermaidEnHtml,
};
