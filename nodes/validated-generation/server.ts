import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeTextInput } from '../../lib/node-io.ts';
import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { callLLM } from '../../server/llm.ts';
import { runScript, safeStringify } from '../../server/node-runtime.ts';
import { getScriptingPromptFramework, SCRIPTING_PROMPT_MARKER } from '../../server/scripting-prompt.ts';
import { getVideoPromptFramework, VIDEO_PROMPT_MARKER } from '../../server/video-prompt.ts';
import {
  DEFAULT_REPAIR_PROMPT,
  DEFAULT_VALIDATED_GENERATION_CONFIG,
  QUALITY_ATTEMPT_LIMIT,
  QUALITY_RETRY_LIMIT,
  type GenerationQualityMode,
  type ValidatedGenerationConfig,
} from './config.ts';


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function optionalText(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeConfig(value: unknown): ValidatedGenerationConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<ValidatedGenerationConfig>
    : {};
  const supported = new Set<GenerationQualityMode>(['distillation', 'script', 'video-spec']);
  const minWords = Math.round(positiveNumber(raw.minWords, DEFAULT_VALIDATED_GENERATION_CONFIG.minWords));
  const maxWords = Math.max(
    minWords,
    Math.round(positiveNumber(raw.maxWords, DEFAULT_VALIDATED_GENERATION_CONFIG.maxWords)),
  );
  const temperature = Number(raw.temperature);
  return {
    ...DEFAULT_VALIDATED_GENERATION_CONFIG,
    mode: supported.has(raw.mode as GenerationQualityMode)
      ? raw.mode as GenerationQualityMode
      : DEFAULT_VALIDATED_GENERATION_CONFIG.mode,
    systemPrompt: String(raw.systemPrompt ?? DEFAULT_VALIDATED_GENERATION_CONFIG.systemPrompt),
    systemPromptFile: optionalText(raw.systemPromptFile),
    prompt: String(raw.prompt ?? DEFAULT_VALIDATED_GENERATION_CONFIG.prompt),
    promptFile: optionalText(raw.promptFile),
    temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : DEFAULT_VALIDATED_GENERATION_CONFIG.temperature,
    validationCode: String(raw.validationCode ?? ''),
    validationFile: optionalText(raw.validationFile),
    repairPrompt: String(raw.repairPrompt ?? DEFAULT_REPAIR_PROMPT),
    repairPromptFile: optionalText(raw.repairPromptFile),
    failOnWarnings: raw.failOnWarnings === undefined
      ? DEFAULT_VALIDATED_GENERATION_CONFIG.failOnWarnings
      : Boolean(raw.failOnWarnings),
    minWords,
    maxWords,
    requireRichVisuals: raw.requireRichVisuals === undefined
      ? DEFAULT_VALIDATED_GENERATION_CONFIG.requireRichVisuals
      : Boolean(raw.requireRichVisuals),
    minComponentTypes: Math.max(
      1,
      Math.min(11, Math.round(positiveNumber(
        raw.minComponentTypes,
        DEFAULT_VALIDATED_GENERATION_CONFIG.minComponentTypes,
      ))),
    ),
  };
}

function directInputText(input: NodeTextInput): string {
  const keys = Object.keys(input || {});
  if (keys.length !== 1) {
    throw new NodeInputError(`Validated Generation requires exactly one upstream node; received ${keys.length}.`);
  }
  const value = String(input[keys[0]] ?? '');
  if (!value.trim()) throw new NodeInputError('Validated Generation received an empty upstream output.');
  return value;
}

async function configText(
  workflowDir: string,
  fileValue: unknown,
  inlineValue: unknown,
  label: string,
): Promise<string> {
  const relativeFile = String(fileValue ?? '').trim();
  if (!relativeFile) return String(inlineValue ?? '');
  if (path.isAbsolute(relativeFile)) throw new NodeValidationError(`${label} file must be relative to the workflow directory`);
  const root = path.resolve(workflowDir);
  const target = path.resolve(root, relativeFile);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new NodeValidationError(`${label} file escapes the workflow directory: ${relativeFile}`);
  }
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    throw new NodeValidationError(`${label} file cannot be read (${relativeFile}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function substitutePrompt(
  template: string,
  input: string,
  nodeOutputs: Record<string, string>,
  workflowDir: string,
): string {
  let output = template || '';
  const scriptingFramework = getScriptingPromptFramework(workflowDir);
  const videoFramework = getVideoPromptFramework(workflowDir);
  output = output.replace(/\{\{\s*SCRIPTING_PROMPT_FRAMEWORK\s*\}\}/gi, scriptingFramework);
  output = output.replace(new RegExp(escapeRegExp(SCRIPTING_PROMPT_MARKER), 'g'), scriptingFramework);
  output = output.replace(/\{\{\s*VIDEO_PROMPT_FRAMEWORK\s*\}\}/gi, videoFramework);
  output = output.replace(new RegExp(escapeRegExp(VIDEO_PROMPT_MARKER), 'g'), videoFramework);
  output = output.replace(/\{\{\s*input\s*\}\}/g, input);
  for (const [key, value] of Object.entries(nodeOutputs)) {
    const serialized = typeof value === 'object' ? safeStringify(value, 2) : String(value ?? '');
    output = output.replace(
      new RegExp(`\\{\\{\\s*\\$nodes\\[["']${escapeRegExp(key)}["']\\]\\.output\\s*\\}\\}`, 'g'),
      serialized,
    );
    output = output.replace(
      new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\.output\\s*\\}\\}`, 'g'),
      serialized,
    );
  }
  return output;
}

function validationMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface QualityReport {
  mode: GenerationQualityMode;
  errors: string[];
  warnings: string[];
  metrics: Record<string, string | number>;
}

function validateContentQuality(
  mode: GenerationQualityMode,
  content: string,
  options: {
    reference?: string;
    minWords: number;
    maxWords: number;
    requireRichVisuals: boolean;
    minComponentTypes: number;
  },
): QualityReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, string | number> = {};

  const words = content.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  metrics.wordCount = wordCount;

  if (wordCount < options.minWords) {
    errors.push(`Content has ${wordCount} words, below the minimum of ${options.minWords}.`);
  }
  if (wordCount > options.maxWords) {
    warnings.push(`Content has ${wordCount} words, exceeding the maximum of ${options.maxWords}.`);
  }

  if (options.requireRichVisuals) {
    const hasImage = /!\[.*?\]\(.*?\)/.test(content) || /<img[\s>]/i.test(content);
    const hasVideo = /<video[\s>]/i.test(content) || /\[.*?\]\(.*?\.mp4\)/.test(content);
    if (!hasImage && !hasVideo) {
      warnings.push('Content lacks rich visual elements (images or videos).');
    }
    metrics.hasRichVisuals = (hasImage || hasVideo) ? 'yes' : 'no';
  }

  if (mode === 'script' || mode === 'video-spec') {
    const componentPatterns = [
      /<Scene[\s>]/i,
      /<Component[\s>]/i,
      /<Overlay[\s>]/i,
      /<Transition[\s>]/i,
      /<Caption[\s>]/i,
      /<Audio[\s>]/i,
      /<Voiceover[\s>]/i,
      /<Narration[\s>]/i,
      /<TitleCard[\s>]/i,
      /<LowerThird[\s>]/i,
      /# /,
    ];
    const matchedTypes = componentPatterns.filter((p) => p.test(content)).length;
    metrics.componentTypes = matchedTypes;
    if (matchedTypes < options.minComponentTypes) {
      errors.push(`Content has ${matchedTypes} component types, below the minimum of ${options.minComponentTypes}.`);
    }
  }

  return { mode, errors, warnings, metrics };
}

async function auditCandidate(
  content: string,
  upstream: string,
  nodeOutputs: Record<string, string>,
  validationCode: string,
  config: ValidatedGenerationConfig,
): Promise<{ blocking: string[]; logs: string[] }> {
  const blocking: string[] = [];
  const logs: string[] = [];

  if (validationCode.trim()) {
    try {
      const result = await runScript(validationCode, content, nodeOutputs, upstream);
      logs.push(
        'Workflow JavaScript contract passed.',
        ...result.logs.map((log) => `[JavaScript validation] ${log}`),
      );
    } catch (error: any) {
      blocking.push(`Workflow JavaScript contract: ${validationMessage(error)}`);
      logs.push(...((error?.logs || []) as string[]).map((log) => `[JavaScript validation] ${log}`));
    }
  }

  const report = validateContentQuality(config.mode, content, {
    reference: upstream,
    minWords: config.minWords,
    maxWords: config.maxWords,
    requireRichVisuals: config.requireRichVisuals,
    minComponentTypes: config.minComponentTypes,
  });
  blocking.push(...report.errors.map((issue) => `Quality contract: ${issue}`));
  if (config.failOnWarnings) {
    blocking.push(...report.warnings.map((issue) => `Quality warning: ${issue}`));
  }
  logs.push(
    `Deterministic quality contract: ${report.mode}`,
    ...Object.entries(report.metrics).map(([key, value]) => `[Metric] ${key}: ${value}`),
    ...report.warnings.map((warning) => `[Quality warning] ${warning}`),
  );
  if (!report.errors.length && (!config.failOnWarnings || !report.warnings.length)) {
    logs.push('Deterministic quality contract passed.');
  }

  return { blocking, logs };
}

async function execute({
  node,
  input,
  nodeOutputs,
  workflowDir,
  workflowDefinitionDir,
}: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const upstream = directInputText(input);
  const definitionRoot = workflowDefinitionDir || workflowDir;
  const [systemPrompt, promptTemplate, validationSource, repairSource] = await Promise.all([
    configText(definitionRoot, config.systemPromptFile, config.systemPrompt, 'System prompt'),
    configText(definitionRoot, config.promptFile, config.prompt, 'User prompt'),
    configText(definitionRoot, config.validationFile, config.validationCode, 'Validation'),
    configText(definitionRoot, config.repairPromptFile, config.repairPrompt, 'Repair prompt'),
  ]);
  if (!promptTemplate.trim()) {
    throw new NodeValidationError('Validated Generation requires a non-empty user prompt or prompt file.');
  }

  const processedPrompt = substitutePrompt(promptTemplate, upstream, nodeOutputs, workflowDir);
  const baseMessages: Array<{ role: string; content: string }> = [];
  if (systemPrompt.trim()) baseMessages.push({ role: 'system', content: systemPrompt.trim() });
  baseMessages.push({ role: 'user', content: processedPrompt });

  const logs: string[] = [
    `Generation contract: ${config.mode}`,
    `Quality policy: initial generation plus up to ${QUALITY_RETRY_LIMIT} repair retries.`,
  ];
  let previousContent = '';
  let lastValidationError = 'Output did not satisfy the quality contract.';

  for (let attempt = 1; attempt <= QUALITY_ATTEMPT_LIMIT; attempt += 1) {
    const messages = [...baseMessages];
    if (attempt > 1) {
      messages.push({ role: 'assistant', content: previousContent });
      const repairTemplate = repairSource.trim() || DEFAULT_REPAIR_PROMPT;
      messages.push({
        role: 'user',
        content: repairTemplate
          .replace(/\{\{\s*error\s*\}\}/gi, lastValidationError)
          .replace(/\{\{\s*attempt\s*\}\}/gi, String(attempt))
          .replace(/\{\{\s*maxAttempts\s*\}\}/gi, String(QUALITY_ATTEMPT_LIMIT)),
      });
    }

    const { content, attempts: providerAttempts } = await callLLM({
      temperature: config.temperature,
      messages,
      prompt: processedPrompt,
    });
    if (providerAttempts > 1) {
      logs.push(`[Attempt ${attempt}] Model provider recovered after ${providerAttempts} request attempts.`);
    }
    previousContent = content;

    const audit = await auditCandidate(content, upstream, nodeOutputs, validationSource, config);
    if (!audit.blocking.length) {
      logs.push(
        `Generation attempt ${attempt}/${QUALITY_ATTEMPT_LIMIT} passed all validation.`,
        ...audit.logs.map((log) => `[Attempt ${attempt}] ${log}`),
      );
      return { output: content, logs };
    }

    lastValidationError = audit.blocking.map((issue) => `- ${issue}`).join('\n');
    logs.push(
      `Generation attempt ${attempt}/${QUALITY_ATTEMPT_LIMIT} failed validation:`,
      ...audit.blocking.map((issue) => `[Attempt ${attempt}] ${issue}`),
      ...audit.logs.map((log) => `[Attempt ${attempt}] ${log}`),
    );
  }

  const error = new NodeValidationError(
    `Validated generation failed after ${QUALITY_RETRY_LIMIT} repair retries `
    + `(${QUALITY_ATTEMPT_LIMIT} total attempts):\n${lastValidationError}`,
  );
  (error as Error & { logs?: string[] }).logs = logs;
  throw error;
}

export default {
  type: 'validated-generation',
  capabilities: ['llm', 'output-validation', 'quality-retry'],
  execute,
};
