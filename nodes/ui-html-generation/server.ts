import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { callLLM } from '../../server/llm.ts';
import { parseStoryboardJson, type StoryboardDocument } from '../clip-storyboard/contract.ts';
import {
  findDemoUiTargets,
  validateDemoHtml,
  type DemoUiTarget,
} from '../app-video-demo-ui/contract.ts';
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
    '<!doctype html> must be the first document marker.',
    'Include a data-demo-ui marker and make the document runnable offline in local Chromium.',
    'Use inline style and optional inline script only; never use external URLs, imports, assets, or network APIs.',
    'Escape every user-controlled string before placing it in HTML. Do not use innerHTML or document.write.',
    'Keep the document within ' + config.width + 'x' + config.height + ' composition and under '
      + config.maxHtmlLength + ' characters.',
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
  logs: string[],
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

    let result;
    try {
      result = await callLLM({ temperature: config.temperature, messages });
    } catch (error) {
      logs.push(
        'UI HTML ' + targetLabel(target) + ' attempt ' + attempt + '/' + attemptLimit
        + ' provider failure: ' + (error instanceof Error ? error.message : String(error)),
      );
      const failure = new NodeValidationError(
        'UI HTML generation failed for ' + targetLabel(target) + ' because the LLM was unavailable: '
        + (error instanceof Error ? error.message : String(error)),
      );
      (failure as Error & { logs?: string[] }).logs = logs;
      throw failure;
    }

    previousContent = result.content;
    logs.push(
      '[UI ' + targetLabel(target) + ' attempt ' + attempt + '] model=' + result.model
      + '; providerAttempts=' + result.attempts + '.',
    );
    const errors = validateDemoHtml(result.content, target, config.maxHtmlLength);
    if (!errors.length) {
      logs.push(
        'UI HTML ' + targetLabel(target) + ' attempt ' + attempt + '/' + attemptLimit
        + ' passed offline HTML contract.',
      );
      return {
        html: result.content,
        model: result.model,
        attempt,
        providerAttempts: result.attempts,
      };
    }

    lastErrors = errors;
    logs.push(
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
  (failure as Error & { logs?: string[] }).logs = logs;
  throw failure;
}

async function execute({ node, input }: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const source = readGenerationInput(input);
  const targets = findDemoUiTargets(source.storyboard);
  const logs: string[] = [
    'UI HTML contract: ' + config.width + 'x' + config.height + ', max '
      + config.maxHtmlLength + ' characters per target.',
    'Each target has an isolated initial prompt and up to ' + config.retryLimit + ' repair retries.',
    'Found ' + targets.length + ' Demo UI target(s).',
  ];
  const demos: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const generated = await generateTarget(target, source.storyboard, source.brief, config, logs);
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
  }

  const manifest = {
    kind: 'ui-html-generation',
    slug: String(source.storyboard.slug || '').trim(),
    width: config.width,
    height: config.height,
    document: source.storyboard,
    demos,
  };
  logs.push('UI HTML generation completed all ' + demos.length + ' target(s); no files were written by this LLM node.');
  return { output: JSON.stringify(manifest, null, 2), logs };
}

export default {
  type: 'ui-html-generation',
  capabilities: ['llm', 'output-validation', 'quality-retry'],
  execute,
};
