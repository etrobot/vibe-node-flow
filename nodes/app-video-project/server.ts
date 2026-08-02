import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { assertSafeId, DATA_DIR } from '../../server/paths.ts';
import {
  estimateDurationSeconds,
  parseStoryboardJson,
  type StoryboardChapter,
  type StoryboardClip,
  type StoryboardDocument,
} from '../clip-storyboard/contract.ts';
import { DEFAULT_APP_VIDEO_PROJECT_CONFIG, type AppVideoProjectConfig } from './config.ts';

function normalizeConfig(value: unknown): AppVideoProjectConfig {
  const raw = value && typeof value === 'object' ? value as Partial<AppVideoProjectConfig> : {};
  return {
    builderProjectsDir: String(raw.builderProjectsDir ?? DEFAULT_APP_VIDEO_PROJECT_CONFIG.builderProjectsDir).trim(),
    overwrite: raw.overwrite === undefined ? DEFAULT_APP_VIDEO_PROJECT_CONFIG.overwrite : Boolean(raw.overwrite),
    writeDescription: raw.writeDescription === undefined
      ? DEFAULT_APP_VIDEO_PROJECT_CONFIG.writeDescription
      : Boolean(raw.writeDescription),
  };
}

/** Accept the storyboard from exactly one upstream node. */
function storyboardText(input: Record<string, string>): string {
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (values.length !== 1) {
    throw new NodeInputError(
      `App Video Project requires exactly one non-empty upstream storyboard; received ${values.length}.`,
    );
  }
  return values[0];
}

function readStoryboard(raw: string): StoryboardDocument {
  let parsed: any;
  try {
    parsed = parseStoryboardJson(raw);
  } catch (error) {
    throw new NodeValidationError(
      `Upstream output is not a storyboard document: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed?.clips) || !parsed.clips.length) {
    throw new NodeValidationError('Storyboard is missing a non-empty clips array.');
  }
  if (!Array.isArray(parsed?.chapters) || !parsed.chapters.length) {
    throw new NodeValidationError('Storyboard is missing a non-empty chapters array.');
  }
  return parsed as StoryboardDocument;
}

/** Split clips into one file per chapter, matching the builder's chapter-N.json layout. */
export function chapterFiles(document: StoryboardDocument): Array<{ file: string; clips: StoryboardClip[] }> {
  const files: Array<{ file: string; clips: StoryboardClip[] }> = [];
  let cursor = 0;
  document.chapters.forEach((chapter: StoryboardChapter, index: number) => {
    const count = Number(chapter?.clipCount);
    if (!Number.isInteger(count) || count <= 0) {
      throw new NodeValidationError(`Chapter ${index + 1} has an invalid clipCount.`);
    }
    const clips = document.clips.slice(cursor, cursor + count);
    if (clips.length !== count) {
      throw new NodeValidationError(
        `Chapter ${index + 1} claims ${count} clips but only ${clips.length} remain in the storyboard.`,
      );
    }
    files.push({ file: `chapter-${index + 1}.json`, clips });
    cursor += count;
  });
  if (cursor !== document.clips.length) {
    throw new NodeValidationError(
      `Chapters cover ${cursor} clips but the storyboard has ${document.clips.length}.`,
    );
  }
  return files;
}

export function buildDescription(document: StoryboardDocument, seconds: number): string {
  return [
    `# ${document.title}`,
    '',
    document.summary,
    '',
    '## Hook',
    '',
    document.hook,
    '',
    '## Closing',
    '',
    document.closing,
    '',
    '## Chapters',
    '',
    ...document.chapters.map((chapter, index) => `${index + 1}. **${chapter.title}** — ${chapter.summary}`),
    '',
    '## Runtime',
    '',
    `${document.clips.length} clips, about ${seconds.toFixed(1)} seconds at the durations written by the storyboard node.`,
  ].join('\n');
}

/** Resolve the builder workspace, refusing any path outside the data directory. */
function resolveBuilderDir(relative: string, slug: string): string {
  if (path.isAbsolute(relative)) {
    throw new NodeValidationError('builderProjectsDir must be relative to the data directory.');
  }
  const root = path.resolve(DATA_DIR);
  const target = path.resolve(root, relative, slug);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new NodeValidationError(`builderProjectsDir escapes the data directory: ${relative}`);
  }
  return target;
}

async function writeProject(
  projectDir: string,
  document: StoryboardDocument,
  files: Array<{ file: string; clips: StoryboardClip[] }>,
  config: AppVideoProjectConfig,
  seconds: number,
): Promise<void> {
  const chapterDir = path.join(projectDir, 'chapter');
  if (config.overwrite) await fs.rm(chapterDir, { recursive: true, force: true });
  await fs.mkdir(chapterDir, { recursive: true });

  await fs.writeFile(
    path.join(projectDir, 'chapters.json'),
    `${JSON.stringify({
      title: document.title,
      hook: document.hook,
      summary: document.summary,
      closing: document.closing,
      hue: document.hue,
      chapters: document.chapters,
    }, null, 2)}\n`,
    'utf8',
  );
  for (const entry of files) {
    await fs.writeFile(
      path.join(chapterDir, entry.file),
      `${JSON.stringify({ clips: entry.clips }, null, 2)}\n`,
      'utf8',
    );
  }
  if (config.writeDescription) {
    await fs.writeFile(path.join(projectDir, 'description.md'), `${buildDescription(document, seconds)}\n`, 'utf8');
  }
}

async function execute({ node, input, assetsDir }: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const document = readStoryboard(storyboardText(input));
  const slug = String(document.slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(slug)) {
    throw new NodeValidationError(`Storyboard slug ${JSON.stringify(slug)} is not lowercase kebab-case.`);
  }

  const files = chapterFiles(document);
  const seconds = estimateDurationSeconds(document.clips);
  const runProjectDir = path.join(assetsDir, assertSafeId(node.id), 'project');
  await fs.mkdir(runProjectDir, { recursive: true });
  await writeProject(runProjectDir, document, files, config, seconds);

  const logs = [
    `Wrote ${files.length} chapter file(s) and ${document.clips.length} clip(s) to ${runProjectDir}.`,
    `Estimated runtime: ${seconds.toFixed(1)}s.`,
  ];

  let builderProjectDir: string | null = null;
  if (config.builderProjectsDir) {
    builderProjectDir = resolveBuilderDir(config.builderProjectsDir, slug);
    const exists = await fs.stat(builderProjectDir).then(() => true).catch(() => false);
    if (exists && !config.overwrite) {
      throw new NodeValidationError(
        `Builder project already exists and overwrite is disabled: ${builderProjectDir}`,
      );
    }
    await fs.mkdir(builderProjectDir, { recursive: true });
    await writeProject(builderProjectDir, document, files, config, seconds);
    logs.push(`Mirrored the project to the builder workspace at ${builderProjectDir}.`);
    logs.push(`Preview or render it with: npm run validate-project -- ${slug}`);
  }

  const manifest = {
    slug,
    title: document.title,
    hue: document.hue,
    projectDir: runProjectDir,
    builderProjectDir,
    chapterFiles: files.map((entry) => entry.file),
    clipCount: document.clips.length,
    estimatedSeconds: Number(seconds.toFixed(1)),
    clips: document.clips.map((clip, index) => ({
      index,
      speech: String(clip.speech ?? '').trim(),
      background: clip.background,
    })),
  };

  return { output: JSON.stringify(manifest, null, 2), logs };
}

export default {
  type: 'app-video-project',
  capabilities: ['filesystem'],
  execute,
};
