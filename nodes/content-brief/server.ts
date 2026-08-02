import { NodeValidationError, type NodePluginContext, type NodePluginResult } from '../../server/plugins.ts';
import {
  DEFAULT_CONTENT_BRIEF_CONFIG,
  type ContentBriefConfig,
} from './config.ts';

const URL_PATTERN = /https?:\/\/[^\s)\]}>"'`<]+/gi;

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeConfig(value: unknown): ContentBriefConfig {
  const raw = value && typeof value === 'object' ? value as Partial<ContentBriefConfig> : {};
  const duration = Number(raw.targetDurationSeconds);
  return {
    ...DEFAULT_CONTENT_BRIEF_CONFIG,
    ...raw,
    topic: clean(raw.topic),
    audience: clean(raw.audience),
    objective: clean(raw.objective),
    centralThesis: clean(raw.centralThesis),
    targetLanguage: clean(raw.targetLanguage) || DEFAULT_CONTENT_BRIEF_CONFIG.targetLanguage,
    targetDurationSeconds: Number.isFinite(duration)
      ? duration
      : DEFAULT_CONTENT_BRIEF_CONFIG.targetDurationSeconds,
    sourceNotes: clean(raw.sourceNotes),
    factualBoundaries: clean(raw.factualBoundaries),
    requiredPoints: clean(raw.requiredPoints),
    forbiddenClaims: clean(raw.forbiddenClaims),
  };
}

function section(title: string, value: string, empty = 'None specified'): string {
  return `## ${title}\n\n${value || empty}`;
}

export function buildContentBrief(configValue: unknown, upstreamResearch = ''): {
  markdown: string;
  sourceCount: number;
  config: ContentBriefConfig;
} {
  const config = normalizeConfig(configValue);
  const errors: string[] = [];
  if (!config.topic) errors.push('topic is required');
  if (!config.audience) errors.push('audience is required');
  if (!config.objective) errors.push('content objective is required');
  if (!config.centralThesis) errors.push('central thesis is required');
  if (!config.sourceNotes) errors.push('verified sources and evidence are required');
  if (!config.factualBoundaries) errors.push('factual boundaries are required');
  if (!config.requiredPoints) errors.push('at least one required point is required');
  if (!config.forbiddenClaims) errors.push('forbidden claims must be stated explicitly');
  if (
    !Number.isFinite(config.targetDurationSeconds)
    || config.targetDurationSeconds < 30
    || config.targetDurationSeconds > 900
  ) {
    errors.push('target duration must be between 30 and 900 seconds');
  }

  const configuredSources = [...new Set(config.sourceNotes.match(URL_PATTERN) || [])];
  if (configuredSources.length < 2) {
    errors.push('verified sources must include at least two distinct http/https URLs');
  }
  if (errors.length) {
    throw new NodeValidationError(`Content brief validation failed:\n${errors.map((item) => `- ${item}`).join('\n')}`);
  }

  const supplementalResearch = clean(upstreamResearch);
  const sources = [...new Set(
    `${config.sourceNotes}\n${supplementalResearch}`.match(URL_PATTERN) || [],
  )];
  const markdown = [
    '# Content Production Brief',
    section('Topic', config.topic),
    section('Audience', config.audience),
    section('Objective', config.objective),
    section('Central Thesis', config.centralThesis),
    section('Delivery Contract', [
      `- Language: ${config.targetLanguage}`,
      `- Target duration: ${config.targetDurationSeconds} seconds`,
      '- Evidence policy: distinguish sourced facts, reasoned conclusions, and illustrative examples.',
    ].join('\n')),
    section('Verified Sources and Evidence Notes', config.sourceNotes),
    ...(supplementalResearch
      ? [section('Supplemental Upstream Research', supplementalResearch)]
      : []),
    section('Factual Boundaries', config.factualBoundaries),
    section('Required Points', config.requiredPoints),
    section('Forbidden Claims', config.forbiddenClaims),
  ].join('\n\n');

  return { markdown, sourceCount: sources.length, config };
}

export default {
  type: 'content-brief',
  execute({ node, input }: NodePluginContext): NodePluginResult {
    const upstreamIds = Object.keys(input);
    const upstreamResearch = upstreamIds.flatMap((id) => {
      const value = String(input[id] ?? '').trim();
      return value ? [[`### Research from ${id}`, value].join('\n\n')] : [];
    }).join('\n\n');
    const result = buildContentBrief(node.config, upstreamResearch);
    const logs = [
      `Validated content brief with ${result.sourceCount} source URLs.`,
      `Delivery target: ${result.config.targetLanguage} · ${result.config.targetDurationSeconds}s.`,
    ];
    if (upstreamResearch.trim()) {
      logs.push(`Included supplemental research from ${upstreamIds.length} upstream node(s).`);
    }
    return { output: result.markdown, logs };
  },
};
