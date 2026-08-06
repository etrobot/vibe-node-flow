export interface UiHtmlGenerationConfig {
  width: number;
  height: number;
  temperature: number;
  /** Number of repair calls for one target after its initial response. */
  retryLimit: number;
  maxHtmlLength: number;
  systemPrompt: string;
  repairPrompt: string;
}

export const UI_HTML_RETRY_LIMIT = 3;
export const UI_HTML_ATTEMPT_LIMIT = UI_HTML_RETRY_LIMIT + 1;

export const DEFAULT_UI_HTML_GENERATION_CONFIG: UiHtmlGenerationConfig = {
  width: 1920,
  height: 1080,
  temperature: 0.45,
  retryLimit: UI_HTML_RETRY_LIMIT,
  maxHtmlLength: 400_000,
  systemPrompt: [
    'You are a product UI designer generating one self-contained HTML document for a local Chromium video render.',
    'Return only the complete HTML document, beginning with <!doctype html>.',
    'Use inline CSS and optional inline JavaScript only. Do not load fonts, images, scripts, styles, or frames from the network.',
  ].join(' '),
  repairPrompt: [
    'The HTML for this one Demo UI target failed deterministic validation.',
    'Return the complete corrected HTML document only.',
    'Keep the target content and visual intent, and fix every reported issue.',
    '',
    'Validation errors:',
    '{{error}}',
  ].join('\n'),
};
