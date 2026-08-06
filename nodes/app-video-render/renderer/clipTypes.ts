export type ClipBackground = 'aurora' | 'blur' | 'wave' | 'semrush-glow';
export type ClipEffect = 'shockwave';

export type ClipItemType =
  | 'text-typing'
  | 'text-popup'
  | 'text-shatter'
  | 'text-zoom'
  | 'text-impact'
  | 'text-title'
  | 'text-logo'
  | 'ui-dropfiles'
  | 'ui-prompt-input'
  | 'ui-render-loading'
  | 'ui-video-preview'
  | 'ui-icon-text'
  | 'x-profile'
  | 'flowing-stats'
  | 'element-growth'
  | 'scene-clock'
  | 'swipe-delete'
  | 'chart-bar'
  | 'chart-line'
  | 'chart-pie'
  | 'feedback-cards'
  | 'image'
  | 'video'
  | 'comparison-table'
  | 'pyramid-highlight'
  | 'process-card-highlight'
  | 'semrush-search'
  | 'semrush-ai-badge'
  | 'semrush-logo'
  | 'semrush-workspace'
  | 'semrush-chat'
  | 'semrush-publish'
  | 'semrush-audit'
  | 'semrush-feature-cloud';

export interface ChartDataItem {
  label: string;
  value: number;
  labelPrefix?: string;
  color?: string;
}

export interface LineChartMetric {
  label: string;
  prefix?: string;
  suffix?: string;
  direction?: 'up' | 'down';
  valueStart?: number;
  valueEnd?: number;
}

export interface ComparisonTableColumn {
  label: string;
  featured?: boolean;
}

export interface ComparisonTableRow {
  feature: string;
  values: Array<boolean | string>;
}

export interface ClipItem {
  type: ClipItemType;
  duration: number;
  /**
   * Reference into the storyboard's `global-components`. Present only on
   * documents that have not been hydrated yet; `resolve.ts` replaces it with
   * the structure itself before the renderer sees the item.
   */
  key?: string;
  /** Node inside the referenced component, resolved into `targetIndex`. */
  spot?: string;
  effect?: ClipEffect;
  title?: string;
  label?: string;
  secondaryLabel?: string;
  words?: string[];
  url?: string;
  backgroundUrl?: string;
  subjectUrl?: string;
  foregroundUrl?: string;
  hudLeft?: string;
  hudRight?: string;
  icon?: string;
  typingSpeed?: number;
  prompt?: string;
  ctaText?: string;
  chartData?: ChartDataItem[];
  lineMetrics?: LineChartMetric[];
  lineLeftValueStart?: number;
  lineLeftValueEnd?: number;
  lineRightValueStart?: number;
  lineRightValueEnd?: number;
  chartHeading?: string;
  chartDescription?: string;
  comparisonColumns?: ComparisonTableColumn[];
  comparisonRows?: ComparisonTableRow[];
  sourceBvid?: string;
  sourceStart?: number;
  sourceEnd?: number;
  sourceTitle?: string;
  pan?: number;
  tilt?: number;
  zoom?: number;
  cards?: { key?: string; icon: string; title: string; number?: string }[];
  targetIndex?: number;
  /** A run-scoped, self-contained product UI page composed into this item. */
  demoUi?: {
    clipIndex: number;
    itemIndex: number;
    htmlFile: string;
    url?: string;
  };
}

/** Explicit colors overriding the hue-derived theme, when the storyboard sets them. */
export interface ClipPalette {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  secondary: string;
}

export interface Clip {
  speech: string;
  background: ClipBackground;
  items: ClipItem[];
  hue?: number;
  ctaText?: string;
}

export interface ClipChapter {
  title: string;
  startClip?: number;
  clipCount?: number;
  summary?: string;
  keyPoints?: string[];
}

export interface ClipsDocument {
  clips: Clip[];
  hue?: number;
  palette?: ClipPalette;
  title?: string;
  summary?: string;
  hook?: string;
  closing?: string;
  chapters?: ClipChapter[];
}

export const CLIP_BACKGROUNDS: ClipBackground[] = ['aurora', 'blur', 'wave', 'semrush-glow'];

export const CLIP_BACKGROUND_LABELS: Record<ClipBackground, string> = {
  aurora: 'Aurora',
  blur: 'Blur',
  wave: 'Wave',
  'semrush-glow': 'Semrush Glow',
};

export const CLIP_ITEM_TYPES: ClipItemType[] = [
  'text-typing',
  'text-popup',
  'text-shatter',
  'text-zoom',
  'text-impact',
  'text-title',
  'text-logo',
  'ui-dropfiles',
  'ui-prompt-input',
  'ui-render-loading',
  'ui-video-preview',
  'ui-icon-text',
  'x-profile',
  'flowing-stats',
  'element-growth',
  'scene-clock',
  'swipe-delete',
  'chart-bar',
  'chart-line',
  'chart-pie',
  'feedback-cards',
  'image',
  'video',
  'comparison-table',
  'pyramid-highlight',
  'process-card-highlight',
  'semrush-search',
  'semrush-ai-badge',
  'semrush-logo',
  'semrush-workspace',
  'semrush-chat',
  'semrush-publish',
  'semrush-audit',
  'semrush-feature-cloud',
];

export const CLIP_ITEM_TYPE_LABELS: Record<ClipItemType, string> = {
  'text-typing': 'Text Typing',
  'text-popup': 'Text Popup',
  'text-shatter': 'Text Shatter',
  'text-zoom': 'Text Zoom',
  'text-impact': 'Impact Word',
  'text-title': 'Closing Title',
  'text-logo': 'Logo Punchline',
  'ui-dropfiles': 'Drop Files',
  'ui-prompt-input': 'Prompt Input',
  'ui-render-loading': 'Render Loading',
  'ui-video-preview': 'Video Preview',
  'ui-icon-text': 'Icon Text',
  'x-profile': 'X Profile',
  'flowing-stats': 'Flowing Stats',
  'element-growth': 'Element Growth',
  'scene-clock': 'Scene Clock',
  'swipe-delete': 'Swipe Delete',
  'chart-bar': 'Bar Chart',
  'chart-line': 'Line Chart',
  'chart-pie': 'Pie Chart',
  'feedback-cards': 'Feedback Cards',
  image: 'Image',
  video: 'Video',
  'comparison-table': 'Comparison Table',
  'pyramid-highlight': 'Pyramid Highlight',
  'process-card-highlight': 'Process Card Highlight',
  'semrush-search': 'Semrush Search Results',
  'semrush-ai-badge': 'AI Readability Badge',
  'semrush-logo': 'Semrush Logo',
  'semrush-workspace': 'Semrush Workspace',
  'semrush-chat': 'Semrush Chat',
  'semrush-publish': 'Semrush Publish Close-up',
  'semrush-audit': 'Semrush Audit Panel',
  'semrush-feature-cloud': 'Semrush Feature Cloud',
};
