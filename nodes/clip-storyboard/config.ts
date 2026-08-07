import type { TimingMode } from './contract.ts';

export interface ClipStoryboardConfig {
  /** Project folder name written by the downstream project node. Blank uses the model's slug. */
  slug: string;
  /** Narration language, passed to the model and used to pick a default voice downstream. */
  language: string;
  /** Visual tone hint, e.g. "confident product launch". */
  tone: string;
  minClips: number;
  maxClips: number;
  /** Distinct component types the storyboard must use, so scenes stay varied. */
  minComponentTypes: number;
  targetDurationSeconds: number;
  /** Fraction of targetDurationSeconds the estimated runtime may deviate. */
  durationTolerance: number;
  /**
   * `anchor` (default): items carry no seconds and `**anchors**` in the speech
   * mark the shot switches, which `edge-tts-narration` resolves against real
   * word boundaries. `duration` keeps the older contract where the model writes
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

/** One initial generation followed by up to four contract-repair calls. */
export const STORYBOARD_RETRY_LIMIT = 4;
export const STORYBOARD_ATTEMPT_LIMIT = STORYBOARD_RETRY_LIMIT + 1;

export const DEFAULT_CLIP_STORYBOARD_CONFIG: ClipStoryboardConfig = {
  slug: '',
  language: 'English',
  tone: 'confident product launch',
  minClips: 8,
  maxClips: 14,
  minComponentTypes: 6,
  targetDurationSeconds: 60,
  durationTolerance: 0.25,
  timingMode: 'anchor',
  maxGlobalComponents: 12,
  maxDemoUiHtmlItems: 2,
  temperature: 0.6,
  systemPrompt: [
    'You are a storyboard director for a local motion-graphics video renderer.',
    'You return one JSON document and nothing else: no Markdown fences, no commentary.',
    'Every claim in the narration must be supported by the upstream brief.',
  ].join(' '),
};
