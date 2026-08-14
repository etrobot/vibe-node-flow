export interface MermaidEnHtmlConfig {
  outputLanguage: 'English';
  translateLabels: false;
  width: number;
  height: number;
  maxTargets: number;
  maxHtmlLength: number;
}

export const DEFAULT_MERMAID_EN_HTML_CONFIG: MermaidEnHtmlConfig = {
  outputLanguage: 'English',
  translateLabels: false,
  width: 1920,
  height: 1080,
  maxTargets: 3,
  maxHtmlLength: 400_000,
};
