/**
 * Loads `prompt.md` — the authoring reference for clip-storyboard generation.
 * Sections are delimited by `<!-- CREATOR:<NAME>:START|END -->` markers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_MD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompt.md');

export type PromptSection = 'SPEC' | 'COMPONENTS' | 'FULL_VIDEO';

const SECTION_MARKERS: Record<PromptSection, { start: string; end: string }> = {
  SPEC: { start: '<!-- CREATOR:SPEC:START -->', end: '<!-- CREATOR:SPEC:END -->' },
  COMPONENTS: { start: '<!-- CREATOR:COMPONENTS:START -->', end: '<!-- CREATOR:COMPONENTS:END -->' },
  FULL_VIDEO: { start: '<!-- CREATOR:FULL_VIDEO:START -->', end: '<!-- CREATOR:FULL_VIDEO:END -->' },
};

let cachedRaw: string | null = null;

export function readPromptMarkdown(filePath: string = PROMPT_MD): string {
  if (filePath === PROMPT_MD && cachedRaw !== null) return cachedRaw;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath === PROMPT_MD) cachedRaw = raw;
  return raw;
}

/** Extract one CREATOR section from prompt.md. Throws if markers are missing. */
export function extractPromptSection(name: PromptSection, raw?: string): string {
  const source = raw ?? readPromptMarkdown();
  const { start, end } = SECTION_MARKERS[name];
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end);
  if (startAt === -1 || endAt === -1 || endAt <= startAt) {
    throw new Error(`prompt.md is missing CREATOR:${name} section markers.`);
  }
  return source.slice(startAt + start.length, endAt).trim();
}

/**
 * Timeline JSON in prompt.md uses `shots`/`component` and a 11-type catalog.
 * This node validates a renderer contract (`items`/`type` + document chrome).
 * Keep the authoring rules; remap vocabulary so the model emits valid JSON.
 */
function rendererOutputShapeOverlay(language: string): string[] {
  const chinese = /^chinese|中文/i.test(String(language || '').trim());
  if (chinese) {
    return [
      '## 本节点输出形状（覆盖上文 Timeline 草图中的字段名）',
      '',
      '上面的 Timeline 规则（旁白锚点、MG 运动节奏、组件选择原则）全部保留，但本节点落地到可渲染 JSON 时必须遵守：',
      '',
      '- 顶层必须包含：`slug`、`title`、`hook`、`summary`、`closing`、`chapters`；可选 `global-components`。不要输出任何 `hue`、`palette`、`background` 或颜色字段。',
      '- 每个 clip 使用 `items`（不要用 `shots`），每项使用 `type`（不要用 `component`）；背景和全部颜色由 renderer 在 JSON 校验后确定性添加。',
      '- `speech` 仍逐字来自旁白正文；`**锚点**` 规则与上文完全一致（N 个 items → N-1 个锚点；先排画面再选锚点；带 key/spot 时优先加粗对应节点显示名）。',
      '- 只能使用下方 Component menu 列出的 type。把 Timeline 组件意图映射到最近的可渲染类型：',
      '  - flow / loopflow → `process-card-highlight`（节点放 `cards`，shot 用 `key`+`spot`）',
      '  - structure → `pyramid-highlight` 或 `comparison-table`',
      '  - text-lines → `feedback-cards` 或 `text-impact`（`words`）',
      '  - linechart → `chart-line`（`lineMetrics`）',
      '  - clock → `scene-clock`',
      '  - rolling-number / 明确数字 → `flowing-stats`',
      '  - meme / 情绪反转 → `text-shatter` / `text-popup`（不要编造不存在的 meme key）',
      '  - logo → 仅片尾 `text-logo`（与 `text-title` 成对）',
      '  - story 人物痛点叙事 → 用 `feedback-cards` 或可复用的 `process-card-highlight` 表达状态推进，不要输出 `story`/`cast`/`list`',
      '- `#` 注释行与 Markdown 解释绝不能出现在 JSON 输出里。',
    ];
  }

  return [
    '## Renderer output shape (overrides Timeline draft field names)',
    '',
    'Keep the Timeline rules above (speech anchors, motion rhythm, component intent), but the renderable JSON from this node must follow:',
    '',
    '- Top level must include `slug`, `title`, `hook`, `summary`, `closing`, and `chapters`; `global-components` is optional. Do not output `hue`, `palette`, `background`, or color fields.',
    '- Each clip uses `items` (not `shots`); each item uses `type` (not `component`). Backgrounds and all colors are added deterministically after JSON validation.',
    '- `speech` still comes from the narration text. The `**anchor**` rule is unchanged (N items → N-1 anchors; plan visuals first, then anchors; when key/spot is present, bold the matching on-screen label).',
    '- Use only the types listed in the Component menu below. Map Timeline component intent to the nearest renderable type:',
    '  - flow / loopflow → `process-card-highlight` (nodes in `cards`, shot uses `key` + `spot`)',
    '  - structure → `pyramid-highlight` or `comparison-table`',
    '  - text-lines → `feedback-cards` or `text-impact` (`words`)',
    '  - linechart → `chart-line` (`lineMetrics`)',
    '  - clock → `scene-clock`',
    '  - rolling-number / explicit numbers → `flowing-stats`',
    '  - meme / emotional turn → `text-shatter` / `text-popup` (do not invent meme keys)',
    '  - logo → closing `text-logo` only (paired with `text-title`)',
    '  - story beats → express with `feedback-cards` or reusable `process-card-highlight`; do not output `story` / `cast` / `list`',
    '- `#` comment lines and Markdown explanations must never appear in the JSON output.',
  ];
}

export function adaptTimelineSpecForRenderer(spec: string, language = 'English'): string {
  return [
    spec,
    '',
    ...rendererOutputShapeOverlay(language),
  ].join('\n');
}
