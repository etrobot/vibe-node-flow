import type { TimingMode } from './contract.ts';

export interface ClipStoryboardConfig {
  /** Project folder name written by the downstream project node. Blank uses the model's slug. */
  slug: string;
  /** Narration language, passed to the model and used to pick a default voice downstream. */
  language: string;
  /** Visual tone hint, e.g. "confident product launch". */
  tone: string;
  /** Minimum visual items in every clip. */
  minItemsPerClip: number;
  /** Distinct component types the storyboard must use, so scenes stay varied. */
  minComponentTypes: number;
  /**
   * `anchor` (default): items carry no seconds and `**anchors**` in the speech
   * mark the shot switches, which `fish-audio-narration` maps onto the measured
   * narration duration. `duration` keeps the older contract where the model writes
   * seconds per item and the speech stays plain.
   */
  timingMode: TimingMode;
  /** Ceiling on reusable structures declared in `global-components`. */
  maxGlobalComponents: number;
  /** Ceiling on product Demo UI HTML placeholders (ui-prompt-input, etc.). */
  maxDemoUiHtmlItems: number;
  temperature: number;
  systemPrompt: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides systemPrompt. */
  systemPromptFile?: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides the built-in prompt. */
  promptFile?: string;
}

/** Fixed factual product sentence requested for the Chinese explainer opening. */
export const OPENING_MODEL_INTRODUCTION_ZH =
  '本次调用的是 Doubao-Seed-Evolving模型，是字节跳动面向高频代码开发、复杂任务编排与长程 Agent 工作流打造的滚动演进大模型，原生支持文本、高分辨率图片及视频分析，适合本次任务。';

/** Suggested English model sentence for the explainer opening. */
export const OPENING_MODEL_INTRODUCTION_EN =
  'This task uses the Doubao-Seed-Evolving model, an evolving model from ByteDance designed for high-frequency code development, complex task orchestration, and long-running Agent workflows; it natively supports text, high-resolution image, and video analysis, making it suitable for this task.';

/** @deprecated Use `openingModelIntroduction(language)` for language-aware copy. */
export const OPENING_MODEL_INTRODUCTION = OPENING_MODEL_INTRODUCTION_ZH;

export function openingModelIntroduction(language: string): string {
  return /^chinese|中文/i.test(String(language || '').trim())
    ? OPENING_MODEL_INTRODUCTION_ZH
    : OPENING_MODEL_INTRODUCTION_EN;
}

/** One initial generation followed by up to four contract-repair calls. */
export const STORYBOARD_RETRY_LIMIT = 4;
export const STORYBOARD_ATTEMPT_LIMIT = STORYBOARD_RETRY_LIMIT + 1;

export const DEFAULT_CLIP_STORYBOARD_CONFIG: ClipStoryboardConfig = {
  slug: '',
  language: 'English',
  tone: 'confident product launch',
  minItemsPerClip: 2,
  minComponentTypes: 6,
  timingMode: 'anchor',
  maxGlobalComponents: 12,
  maxDemoUiHtmlItems: 2,
  temperature: 0.6,
  systemPrompt: [
    'You are a storyboard director for a local 16:9 AE / MG motion-graphics renderer.',
    'Follow the authoring rules from nodes/clip-storyboard/prompt.md'
      + ' (anchors, motion rhythm, component intent), but emit only this node\'s validated JSON shape.',
    'You return one JSON document and nothing else: no Markdown fences, no commentary, no # field notes.',
    'Every claim in the narration must be supported by the upstream brief.',
    'Prefer scale, framing, motion, and on-screen type over static webpage / PPT chrome.',
  ].join(' '),
};
