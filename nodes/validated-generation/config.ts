export type GenerationQualityMode = 'distillation' | 'script' | 'video-spec';

export interface ValidatedGenerationConfig {
  mode: GenerationQualityMode;
  systemPrompt: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides systemPrompt. */
  systemPromptFile?: string;
  prompt: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides prompt. */
  promptFile?: string;
  temperature: number;
  /** Optional JavaScript validation run against the raw model response as `input`. */
  validationCode: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides validationCode. */
  validationFile?: string;
  /** Stage-specific correction request. Supports {{error}}, {{attempt}}, and {{maxAttempts}}. */
  repairPrompt: string;
  /** Optional UTF-8 file relative to the workflow definition directory. Overrides repairPrompt. */
  repairPromptFile?: string;
  failOnWarnings: boolean;
  minWords: number;
  maxWords: number;
  requireRichVisuals: boolean;
  minComponentTypes: number;
}

/** One initial generation followed by exactly five possible quality-repair calls. */
export const QUALITY_RETRY_LIMIT = 5;
export const QUALITY_ATTEMPT_LIMIT = QUALITY_RETRY_LIMIT + 1;

export const DEFAULT_REPAIR_PROMPT = [
  'Revise the previous answer so it satisfies every reported contract.',
  'Preserve valid content, fix every issue, and return only the complete corrected final answer.',
  '',
  'Validation feedback:',
  '{{error}}',
].join('\n');

export const DEFAULT_VALIDATED_GENERATION_CONFIG: ValidatedGenerationConfig = {
  mode: 'distillation',
  systemPrompt: 'You are an evidence-first content editor. Follow the requested output contract exactly.',
  prompt: [
    'Turn the upstream brief into a production-ready editorial direction.',
    '',
    '{{input}}',
    '',
    'Return Markdown with these sections: # Evidence Map, # Surface Narrative, # Breakthrough,',
    '# Candidate Themes, and # Selected Direction. Retain source URLs and do not invent claims.',
  ].join('\n'),
  temperature: 0.35,
  validationCode: '',
  repairPrompt: DEFAULT_REPAIR_PROMPT,
  failOnWarnings: true,
  minWords: 250,
  maxWords: 650,
  requireRichVisuals: true,
  minComponentTypes: 4,
};
