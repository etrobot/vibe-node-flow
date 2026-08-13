import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { callLLM } from '../../server/llm.ts';
import { parseStoryboardJson, type StoryboardDocument } from '../clip-storyboard/contract.ts';
import {
  findDemoUiTargets,
  listDemoUiCandidates,
  normalizeDemoHtml,
  validateDemoHtml,
  type DemoUiTarget,
} from './contract.ts';
import {
  DEFAULT_UI_HTML_GENERATION_CONFIG,
  UI_HTML_RETRY_LIMIT,
  type UiHtmlGenerationConfig,
} from './config.ts';

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeConfig(value: unknown): UiHtmlGenerationConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<UiHtmlGenerationConfig>
    : {};
  return {
    ...DEFAULT_UI_HTML_GENERATION_CONFIG,
    ...raw,
    width: Math.round(numberInRange(raw.width, DEFAULT_UI_HTML_GENERATION_CONFIG.width, 320, 7680)),
    height: Math.round(numberInRange(raw.height, DEFAULT_UI_HTML_GENERATION_CONFIG.height, 180, 4320)),
    temperature: numberInRange(raw.temperature, DEFAULT_UI_HTML_GENERATION_CONFIG.temperature, 0, 2),
    retryLimit: Math.round(numberInRange(
      raw.retryLimit,
      DEFAULT_UI_HTML_GENERATION_CONFIG.retryLimit,
      0,
      UI_HTML_RETRY_LIMIT,
    )),
    maxHtmlLength: Math.round(numberInRange(
      raw.maxHtmlLength,
      DEFAULT_UI_HTML_GENERATION_CONFIG.maxHtmlLength,
      2_000,
      1_000_000,
    )),
    maxTargets: Math.round(numberInRange(
      raw.maxTargets,
      DEFAULT_UI_HTML_GENERATION_CONFIG.maxTargets,
      0,
      8,
    )),
    systemPrompt: clean(raw.systemPrompt) || DEFAULT_UI_HTML_GENERATION_CONFIG.systemPrompt,
    repairPrompt: clean(raw.repairPrompt) || DEFAULT_UI_HTML_GENERATION_CONFIG.repairPrompt,
  };
}

interface GenerationInput {
  storyboard: StoryboardDocument;
  brief: string;
}

function readGenerationInput(input: Record<string, string>): GenerationInput {
  let storyboard: StoryboardDocument | undefined;
  const briefSections: string[] = [];
  for (const [id, rawValue] of Object.entries(input || {})) {
    const value = clean(rawValue);
    if (!value) continue;
    let parsed: any;
    try {
      parsed = parseStoryboardJson(value);
    } catch {
      parsed = undefined;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.clips)) {
      if (storyboard) throw new NodeInputError('UI HTML Generation received more than one storyboard document.');
      storyboard = parsed as StoryboardDocument;
    } else {
      briefSections.push('### Upstream ' + id + '\n\n' + value);
    }
  }
  if (!storyboard) throw new NodeInputError('UI HTML Generation requires one storyboard JSON upstream.');
  if (!storyboard.clips.length) {
    throw new NodeValidationError('UI HTML Generation received a storyboard with no clips.');
  }
  return { storyboard, brief: briefSections.join('\n\n') };
}

export function buildUiHtmlPrompt(
  target: DemoUiTarget,
  document: StoryboardDocument,
  brief: string,
  config: Pick<UiHtmlGenerationConfig, 'width' | 'height' | 'maxHtmlLength'>,
): string {
  const clip = document.clips[target.clipIndex];
  return [
    'Generate the complete self-contained HTML for exactly one product Demo UI target.',
    '',
    '## Hard output contract',
    '',
    'Return one complete HTML document with html, head, and body.',
    'Include a data-demo-ui marker and make the document runnable offline in local Chromium.',
    'Use inline <style>, inline SVG, and optional inline <script> only.',
    'Allowed: JS // comments, SVG xmlns="http://www.w3.org/2000/svg", plain text that mentions a URL.',
    'Forbidden: remote src/href/@import/url(), CDN assets, Google Fonts, fetch/XHR/WebSocket/EventSource, innerHTML/document.write.',
    'Escape every user-controlled string before placing it in HTML.',
    'Keep the document within ' + config.width + 'x' + config.height + ' composition and under '
      + config.maxHtmlLength + ' characters.',
    'Do not wrap the HTML in markdown fences.',
    '',
    '## Verified brief and factual boundaries',
    '',
    brief || '(No separate brief supplied; use only the target and clip context.)',
    '',
    '## Target input',
    '',
    JSON.stringify({
      clipIndex: target.clipIndex,
      itemIndex: target.itemIndex,
      item: target.item,
      clipContext: clip ? {
        speech: clip.speech,
        background: clip.background,
      } : null,
    }, null, 2),
    '',
    'Return the HTML document only.',
  ].join('\n');
}

function repairPrompt(template: string, errors: string[], attempt: number, maxAttempts: number): string {
  return template
    .replace(/\{\{\s*error\s*\}\}/gi, errors.map((error) => '- ' + error).join('\n'))
    .replace(/\{\{\s*attempt\s*\}\}/gi, String(attempt))
    .replace(/\{\{\s*maxAttempts\s*\}\}/gi, String(maxAttempts));
}

function targetLabel(target: DemoUiTarget): string {
  return 'clip ' + (target.clipIndex + 1) + ', item ' + (target.itemIndex + 1);
}

async function generateTarget(
  target: DemoUiTarget,
  document: StoryboardDocument,
  brief: string,
  config: UiHtmlGenerationConfig,
  log: { logs: string[]; push: (...lines: string[]) => void },
  targetOrdinal: number,
  targetTotal: number,
): Promise<{ html: string; model: string; attempt: number; providerAttempts: number }> {
  const attemptLimit = config.retryLimit + 1;
  const baseMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: config.systemPrompt },
    {
      role: 'user',
      content: buildUiHtmlPrompt(target, document, brief, config),
    },
  ];
  let previousContent = '';
  let lastErrors: string[] = ['HTML was never produced.'];

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const messages = [...baseMessages];
    if (attempt > 1) {
      messages.push({ role: 'assistant', content: previousContent });
      messages.push({
        role: 'user',
        content: repairPrompt(config.repairPrompt, lastErrors, attempt, attemptLimit),
      });
    }

    log.push(
      'Calling LLM for target ' + targetOrdinal + '/' + targetTotal
      + ' (' + targetLabel(target) + ') attempt ' + attempt + '/' + attemptLimit + '...',
    );
    const requestStarted = Date.now();
    let result;
    try {
      result = await callLLM({ temperature: config.temperature, messages });
    } catch (error) {
      log.push(
        'UI HTML ' + targetLabel(target) + ' attempt ' + attempt + '/' + attemptLimit
        + ' provider failure after ' + (Date.now() - requestStarted) + 'ms: '
        + (error instanceof Error ? error.message : String(error)),
      );
      const failure = new NodeValidationError(
        'UI HTML generation failed for ' + targetLabel(target) + ' because the LLM was unavailable: '
        + (error instanceof Error ? error.message : String(error)),
      );
      (failure as Error & { logs?: string[] }).logs = log.logs;
      throw failure;
    }

    previousContent = result.content;
    const html = normalizeDemoHtml(result.content);
    if (html.length !== result.content.trim().length) {
      log.push(
        '[UI ' + targetLabel(target) + ' attempt ' + attempt
        + '] normalized LLM packaging: rawChars=' + result.content.length
        + '; htmlChars=' + html.length + '.',
      );
    }
    log.push(
      '[UI ' + targetLabel(target) + ' attempt ' + attempt + '] model=' + result.model
      + '; providerAttempts=' + result.attempts
      + '; elapsed=' + (Date.now() - requestStarted) + 'ms'
      + '; chars=' + html.length + '.',
    );
    const errors = validateDemoHtml(html, target, config.maxHtmlLength);
    if (!errors.length) {
      log.push(
        'UI HTML ' + targetLabel(target) + ' attempt ' + attempt + '/' + attemptLimit
        + ' passed offline HTML contract.',
      );
      return {
        html,
        model: result.model,
        attempt,
        providerAttempts: result.attempts,
      };
    }

    lastErrors = errors;
    log.push(
      'UI HTML ' + targetLabel(target) + ' attempt ' + attempt + '/' + attemptLimit
      + ' failed validation:',
      ...errors.map((error) => '[UI ' + targetLabel(target) + ' attempt ' + attempt + '] ' + error),
    );
  }

  const failure = new NodeValidationError(
    'UI HTML generation failed for ' + targetLabel(target) + ' after ' + config.retryLimit
    + ' repair retries (' + attemptLimit + ' total attempts):\n'
    + lastErrors.map((error) => '- ' + error).join('\n'),
  );
  (failure as Error & { logs?: string[] }).logs = log.logs;
  throw failure;
}

async function execute({ node, input, onLog, onResourceAccess }: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  onResourceAccess?.({ kind: 'environment', operation: 'read', detail: 'LLM provider configuration' });
  const source = readGenerationInput(input);
  const candidates = listDemoUiCandidates(source.storyboard);
  const targets = findDemoUiTargets(source.storyboard, config.maxTargets);
  const log = createNodeLogger(onLog);
  log.push(
    'UI HTML contract: ' + config.width + 'x' + config.height + ', max '
      + config.maxHtmlLength + ' characters per target, maxTargets=' + config.maxTargets + '.',
    'Each target has an isolated initial prompt and up to ' + config.retryLimit + ' repair retries.',
    'Found ' + candidates.length + ' Demo UI candidate(s); generating HTML for '
      + targets.length + '.',
  );
  if (candidates.length > targets.length) {
    const skipped = candidates.filter((candidate) => (
      !targets.some((target) => (
        target.clipIndex === candidate.clipIndex && target.itemIndex === candidate.itemIndex
      ))
    ));
    log.push(
      'Skipping ' + skipped.length + ' candidate(s) (built-in React UI fallback): '
      + skipped.map((target) => (
        targetLabel(target) + '/' + String(target.item?.type || 'unknown')
      )).join(', ') + '.',
    );
  }
  if (!targets.length) {
    log.push('No Demo UI targets selected; returning an empty demos list.');
  }
  const demos: Array<Record<string, unknown>> = [];

  for (const [index, target] of targets.entries()) {
    log.push(
      'Starting Demo UI target ' + (index + 1) + '/' + targets.length
      + ' (' + targetLabel(target) + ', type=' + String(target.item?.type || 'unknown') + ').',
    );
    const generated = await generateTarget(
      target,
      source.storyboard,
      source.brief,
      config,
      log,
      index + 1,
      targets.length,
    );
    demos.push({
      clipIndex: target.clipIndex,
      itemIndex: target.itemIndex,
      html: generated.html,
      generation: {
        model: generated.model,
        attempt: generated.attempt,
        providerAttempts: generated.providerAttempts,
      },
    });
    log.push(
      'Finished Demo UI target ' + (index + 1) + '/' + targets.length
      + ' on attempt ' + generated.attempt + '.',
    );
  }

  const manifest = {
    kind: 'ui-html-generation',
    slug: String(source.storyboard.slug || '').trim(),
    width: config.width,
    height: config.height,
    document: source.storyboard,
    demos,
  };
  log.push('UI HTML generation completed all ' + demos.length + ' target(s); no files were written by this LLM node.');
  return { output: JSON.stringify(manifest, null, 2), logs: log.logs };
}

export default {
  type: 'ui-html-generation',
  capabilities: ['llm', 'output-validation', 'quality-retry'],
  execute,
};
