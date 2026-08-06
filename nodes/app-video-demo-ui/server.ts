import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { parseStoryboardJson, type StoryboardDocument, type StoryboardItem } from '../clip-storyboard/contract.ts';
import { DEFAULT_APP_VIDEO_DEMO_UI_CONFIG, type AppVideoDemoUiConfig } from './config.ts';
import {
  demoFileName,
  findDemoUiTargets,
  type DemoUiTarget,
} from './contract.ts';

function normalizeConfig(value: unknown): AppVideoDemoUiConfig {
  const raw = value && typeof value === 'object' ? value as Partial<AppVideoDemoUiConfig> : {};
  const width = Math.round(Number(raw.width));
  const height = Math.round(Number(raw.height));
  return {
    width: Number.isFinite(width) ? Math.max(320, Math.min(7680, width)) : DEFAULT_APP_VIDEO_DEMO_UI_CONFIG.width,
    height: Number.isFinite(height) ? Math.max(180, Math.min(4320, height)) : DEFAULT_APP_VIDEO_DEMO_UI_CONFIG.height,
  };
}

function sourceText(input: Record<string, string>): string {
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (values.length !== 1) {
    throw new NodeInputError(
      `Generate Demo UI HTML requires exactly one non-empty upstream storyboard; received ${values.length}.`,
    );
  }
  return values[0];
}

function readStoryboard(raw: string): StoryboardDocument {
  let parsed: any;
  try {
    parsed = parseStoryboardJson(raw);
  } catch (error) {
    throw new NodeValidationError(
      `Upstream output is not a storyboard document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clips) || !parsed.clips.length) {
    throw new NodeValidationError('Storyboard is missing a non-empty clips array.');
  }
  return parsed as StoryboardDocument;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function text(value: unknown, fallback: string): string {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function itemLabels(item: StoryboardItem): { eyebrow: string; heading: string; detail: string; action: string } {
  switch (item.type) {
    case 'ui-prompt-input':
      return {
        eyebrow: 'AI BUILDER',
        heading: 'Describe your product',
        detail: text(item.prompt, 'Tell the builder what you want to create.'),
        action: text(item.ctaText, 'Build'),
      };
    case 'ui-dropfiles':
      return {
        eyebrow: 'PROJECT INPUTS',
        heading: text(item.title, 'Add your project files'),
        detail: text(item.label, 'Drop screenshots, notes, and reference files here.'),
        action: text(item.ctaText, 'Continue'),
      };
    case 'ui-render-loading':
      return {
        eyebrow: 'BUILDING',
        heading: text(item.title, 'Generating your application'),
        detail: text(item.label, 'The builder is turning your description into a working product.'),
        action: 'In progress',
      };
    case 'ui-video-preview':
      return {
        eyebrow: 'LIVE PREVIEW',
        heading: text(item.title, 'Your product is ready'),
        detail: text(item.label, 'Open the generated experience and keep iterating.'),
        action: text(item.ctaText, 'Open preview'),
      };
    default:
      return {
        eyebrow: 'PRODUCT DEMO',
        heading: text(item.title, 'Your product'),
        detail: text(item.label, 'A working product experience.'),
        action: text(item.ctaText, 'Continue'),
      };
  }
}

/** Deterministic, self-contained HTML: no fonts, scripts, or network requests. */
export function renderDemoHtml(target: DemoUiTarget, config: AppVideoDemoUiConfig): string {
  const labels = itemLabels(target.item);
  const prompt = target.item.type === 'ui-prompt-input' ? labels.detail : '';
  const loading = target.item.type === 'ui-render-loading';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${config.width}, height=${config.height}, initial-scale=1">
  <title>${escapeHtml(labels.heading)}</title>
  <style>
    :root { color-scheme: dark; --demo-time: 0; --demo-angle: 0deg; --demo-progress: 22%; --accent: #72e5c4; --violet: #9b8cff; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #070a12; }
    body { display: grid; place-items: center; color: #f5f7fb; font: 500 24px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .shell { width: 100%; height: 100%; padding: 7.5%; background:
      radial-gradient(circle at 82% 8%, rgba(114,229,196,.19), transparent 28%),
      radial-gradient(circle at 14% 94%, rgba(155,140,255,.18), transparent 34%), #070a12; }
    .window { width: 100%; height: 100%; overflow: hidden; border: 1px solid rgba(255,255,255,.14); border-radius: 28px;
      background: rgba(16,22,35,.94); box-shadow: 0 36px 100px rgba(0,0,0,.55), 0 0 80px rgba(114,229,196,.10); }
    .bar { height: 76px; display: flex; align-items: center; gap: 13px; padding: 0 28px; border-bottom: 1px solid rgba(255,255,255,.08); color: #93a1b8; font-size: 18px; }
    .dot { width: 13px; height: 13px; border-radius: 50%; background: #ff6f7d; box-shadow: 25px 0 #f3c969, 50px 0 #72e5c4; margin-right: 58px; }
    .content { display: grid; grid-template-columns: 1.1fr .9fr; gap: 7%; height: calc(100% - 76px); padding: 8%; align-items: center; }
    .eyebrow { color: var(--accent); letter-spacing: .16em; font-size: 16px; font-weight: 800; }
    h1 { margin: 18px 0 16px; max-width: 720px; font-size: clamp(42px, 5vw, 84px); line-height: 1.02; letter-spacing: -.045em; }
    p { max-width: 650px; margin: 0; color: #aeb9cc; font-size: 24px; }
    .card { border: 1px solid rgba(255,255,255,.13); border-radius: 24px; padding: 28px; background: linear-gradient(145deg, rgba(255,255,255,.10), rgba(255,255,255,.035)); box-shadow: 0 20px 60px rgba(0,0,0,.28); }
    .label { display: block; margin-bottom: 12px; color: #8997ae; font-size: 16px; font-weight: 700; }
    .input { min-height: 108px; display: flex; align-items: center; padding: 20px; border-radius: 16px; background: #080d18; border: 1px solid rgba(114,229,196,.42); color: #eef4ff; }
    .button { display: inline-flex; margin-top: 20px; padding: 15px 25px; border-radius: 12px; color: #071019; background: var(--accent); font-size: 19px; font-weight: 800; }
    .status { display: flex; align-items: center; gap: 16px; color: #dce5f3; font-weight: 700; }
    .spinner { width: 34px; height: 34px; border: 4px solid rgba(255,255,255,.18); border-top-color: var(--accent); border-radius: 50%; transform: rotate(var(--demo-angle)); }
    .barline { height: 11px; margin-top: 24px; overflow: hidden; border-radius: 10px; background: #293247; }
    .barline::after { content: ''; display: block; width: var(--demo-progress); height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--violet), var(--accent)); }
    @media (max-width: 900px) { .content { grid-template-columns: 1fr; } .card { display: none; } }
  </style>
</head>
<body data-demo-ui data-clip-index="${target.clipIndex}" data-item-index="${target.itemIndex}">
  <main class="shell"><section class="window">
    <div class="bar"><span class="dot"></span>Forge workspace <span style="margin-left:auto">${escapeHtml(loading ? 'Building' : 'Workspace')}</span></div>
    <div class="content">
      <div><div class="eyebrow">${escapeHtml(labels.eyebrow)}</div><h1>${escapeHtml(labels.heading)}</h1><p>${escapeHtml(labels.detail)}</p></div>
      <div class="card">
        ${loading
          ? `<div class="status"><span class="spinner"></span>${escapeHtml(labels.action)}</div><div class="barline"></div>`
          : `<span class="label">${escapeHtml(target.item.type === 'ui-prompt-input' ? 'PROMPT' : 'NEXT STEP')}</span><div class="input">${escapeHtml(prompt || labels.detail)}</div><div class="button">${escapeHtml(labels.action)}</div>`}
      </div>
    </div>
  </section></main>
  <script>
    window.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'demo-time') {
        var time = Number(event.data.time) || 0;
        document.documentElement.style.setProperty('--demo-time', String(time));
        document.documentElement.style.setProperty('--demo-angle', (time * 240) + 'deg');
        document.documentElement.style.setProperty('--demo-progress', Math.min(92, 22 + time * 18) + '%');
      }
    });
  </script>
</body>
</html>
`;
}

async function execute({ node, input, assetsDir, workflowId, runId }: NodePluginContext): Promise<NodePluginResult> {
  const startedAt = new Date().toISOString();
  const config = normalizeConfig(node.config);
  const document = readStoryboard(sourceText(input));
  const targets = findDemoUiTargets(document);
  const demoDir = path.join(assetsDir, 'demo');
  await fs.mkdir(demoDir, { recursive: true });

  const demos = [];
  for (const target of targets) {
    const htmlFile = demoFileName(target.clipIndex, target.itemIndex);
    const absolute = path.join(assetsDir, htmlFile);
    await fs.writeFile(absolute, renderDemoHtml(target, config), 'utf8');
    demos.push({
      clipIndex: target.clipIndex,
      itemIndex: target.itemIndex,
      htmlFile,
      url: `/api/workflows/${encodeURIComponent(workflowId)}/assets/${encodeURIComponent(runId)}/${htmlFile
        .split('/').map(encodeURIComponent).join('/')}`,
    });
  }

  const manifest = {
    kind: 'app-video-demo-ui',
    slug: String(document.slug ?? '').trim(),
    assetDir: assetsDir,
    width: config.width,
    height: config.height,
    demoCount: demos.length,
    demos,
  };
  await fs.writeFile(path.join(demoDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const finishedAt = new Date().toISOString();

  return {
    output: JSON.stringify(manifest, null, 2),
    logs: [
      `Demo UI generation started at ${startedAt}.`,
      `Generated ${demos.length} Demo UI HTML file(s) for ${document.clips.length} clip(s).`,
      ...demos.map((demo) => `Demo clip ${demo.clipIndex + 1}, item ${demo.itemIndex + 1}: ${demo.htmlFile}`),
      `Demo UI assets written to ${demoDir}.`,
      `Demo UI generation finished at ${finishedAt}.`,
    ],
  };
}

export default {
  type: 'app-video-demo-ui',
  capabilities: ['filesystem'],
  execute,
};
