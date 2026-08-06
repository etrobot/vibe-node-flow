import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { findDemoUiTargets, isSafeDemoFile, type DemoUiReference } from '../app-video-demo-ui/contract.ts';

interface ProjectManifest {
  kind?: string;
  slug?: string;
  assetDir?: string;
  chapterFiles?: string[];
  document?: any;
  storyboard?: any;
  clips?: any[];
  [key: string]: any;
}

interface DemoManifest {
  kind?: string;
  slug?: string;
  assetDir?: string;
  demos?: Array<DemoUiReference & { url?: string }>;
}

function parseManifest(value: string, label: string): any {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new NodeValidationError(
      `${label} output is not a JSON manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readInputs(input: Record<string, string>): { project: ProjectManifest; demo: DemoManifest } {
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (values.length !== 2) {
    throw new NodeInputError(
      `Compose Video Project requires exactly two non-empty upstream manifests; received ${values.length}.`,
    );
  }

  const parsed = values.map((value) => parseManifest(value, 'Upstream'));
  const project = parsed.find((value) => Array.isArray(value.chapterFiles) && value.assetDir) as ProjectManifest | undefined;
  const demo = parsed.find((value) => Array.isArray(value.demos) && value.assetDir) as DemoManifest | undefined;
  if (!project) throw new NodeValidationError('One upstream manifest must contain assetDir and chapterFiles.');
  if (!demo) throw new NodeValidationError('One upstream manifest must contain assetDir and demos.');
  return { project, demo };
}

function safeInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new NodeValidationError(`Asset path escapes the current run directory: ${relative}`);
  }
  return resolved;
}

function chapterPath(assetDir: string, file: string): string {
  if (!/^chapter-\d+\.json$/.test(file)) {
    throw new NodeValidationError(`Invalid chapter file name ${JSON.stringify(file)}.`);
  }
  return safeInside(path.join(assetDir, 'chapter'), file);
}

async function readChapters(project: ProjectManifest): Promise<{ documents: any[]; paths: string[] }> {
  const assetDir = String(project.assetDir ?? '').trim();
  if (!assetDir) throw new NodeValidationError('Video project manifest is missing assetDir.');
  const files = Array.isArray(project.chapterFiles) ? project.chapterFiles : [];
  if (!files.length) throw new NodeValidationError('Video project manifest has no chapterFiles.');
  const paths = files.map((file) => chapterPath(assetDir, String(file)));
  const documents = [];
  for (let index = 0; index < paths.length; index += 1) {
    let parsed: any;
    try {
      parsed = JSON.parse(await fs.readFile(paths[index], 'utf8'));
    } catch (error) {
      throw new NodeValidationError(
        `Chapter ${files[index]} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed?.clips)) {
      throw new NodeValidationError(`Chapter ${files[index]} does not contain a clips array.`);
    }
    documents.push(parsed);
  }
  return { documents, paths };
}

function flattenClips(documents: any[]): any[] {
  return documents.flatMap((document) => Array.isArray(document.clips) ? document.clips : []);
}

function manifestUrl(workflowId: string, runId: string, htmlFile: string): string {
  return `/api/workflows/${encodeURIComponent(workflowId)}/assets/${encodeURIComponent(runId)}/${htmlFile
    .split('/').map(encodeURIComponent).join('/')}`;
}

function documentWithDemoRefs(project: ProjectManifest, demos: Map<string, DemoUiReference>): any {
  const source = project.document && typeof project.document === 'object'
    ? structuredClone(project.document)
    : null;
  if (!source || !Array.isArray(source.clips)) return source;
  source.clips.forEach((clip: any, clipIndex: number) => {
    (clip?.items || []).forEach((item: any, itemIndex: number) => {
      const reference = demos.get(`${clipIndex}:${itemIndex}`);
      if (reference && Array.isArray(source.clips[clipIndex]?.items)) {
        source.clips[clipIndex].items[itemIndex] = {
          ...item,
          demoUi: reference,
        };
      }
    });
  });
  return source;
}

async function execute({ node, input, workflowId, runId }: NodePluginContext): Promise<NodePluginResult> {
  const startedAt = new Date().toISOString();
  const { project, demo } = readInputs(input);
  const projectSlug = String(project.slug ?? '').trim();
  const demoSlug = String(demo.slug ?? '').trim();
  if (!projectSlug || !demoSlug || projectSlug !== demoSlug) {
    throw new NodeValidationError(
      `Project and Demo UI manifests must have the same slug; received ${JSON.stringify(projectSlug)} and ${JSON.stringify(demoSlug)}.`,
    );
  }
  if (String(project.assetDir) !== String(demo.assetDir)) {
    throw new NodeValidationError('Project and Demo UI manifests must point to the same run asset directory.');
  }

  const storyboard = project.storyboard;
  if (!storyboard || !Array.isArray(storyboard.clips)) {
    throw new NodeValidationError('Video project manifest is missing its authored storyboard.');
  }
  const expected = findDemoUiTargets(storyboard);
  const received = Array.isArray(demo.demos) ? demo.demos : [];
  const expectedKeys = new Set(expected.map((target) => `${target.clipIndex}:${target.itemIndex}`));
  const seen = new Set<string>();
  const references = new Map<string, DemoUiReference>();
  const problems: string[] = [];

  for (const entry of received) {
    const clipIndex = Number(entry?.clipIndex);
    const itemIndex = Number(entry?.itemIndex);
    const key = `${clipIndex}:${itemIndex}`;
    if (!Number.isInteger(clipIndex) || !Number.isInteger(itemIndex) || !expectedKeys.has(key)) {
      problems.push(`orphan or out-of-range Demo ${key}`);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`duplicate Demo ${key}`);
      continue;
    }
    const htmlFile = String(entry?.htmlFile ?? '').trim();
    if (!isSafeDemoFile(htmlFile)) {
      problems.push(`unsafe HTML path for Demo ${key}: ${htmlFile || '<empty>'}`);
      continue;
    }
    const file = safeInside(String(project.assetDir), htmlFile);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) throw new Error('not a regular file');
      const html = await fs.readFile(file, 'utf8');
      if (!/^\s*<!doctype html>/i.test(html) || !html.includes('data-demo-ui')) {
        throw new Error('not a self-contained Demo UI HTML document');
      }
    } catch (error) {
      problems.push(`missing or unloadable HTML for clip ${clipIndex + 1}, item ${itemIndex + 1}: ${htmlFile} (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const reference: DemoUiReference = {
      clipIndex,
      itemIndex,
      htmlFile,
      // Always derive the browser URL from this run. An upstream manifest may
      // be replayed or hand-authored, but it cannot redirect composition to a
      // different run or an external origin.
      url: manifestUrl(workflowId, runId, htmlFile),
    };
    seen.add(key);
    references.set(key, reference);
  }

  for (const target of expected) {
    const key = `${target.clipIndex}:${target.itemIndex}`;
    if (!seen.has(key)) problems.push(`missing Demo for clip ${target.clipIndex + 1}, item ${target.itemIndex + 1}`);
  }
  if (received.length !== expected.length) {
    problems.push(`expected ${expected.length} Demo(s), received ${received.length}`);
  }
  if (problems.length) {
    throw new NodeValidationError(`Demo UI/project composition failed: ${problems.join('; ')}.`);
  }

  const { documents, paths } = await readChapters(project);
  const flatClips = flattenClips(documents);
  if (flatClips.length !== storyboard.clips.length) {
    throw new NodeValidationError(
      `Chapter files cover ${flatClips.length} clips but the storyboard has ${storyboard.clips.length}.`,
    );
  }

  // All validation is complete before the first chapter is changed. This keeps
  // a failed composition from leaving a partially associated project behind.
  let clipIndex = 0;
  for (const document of documents) {
    for (const clip of document.clips) {
      (clip.items || []).forEach((item: any, itemIndex: number) => {
        const reference = references.get(`${clipIndex}:${itemIndex}`);
        if (reference) clip.items[itemIndex] = { ...item, demoUi: reference };
      });
      clipIndex += 1;
    }
  }
  for (let index = 0; index < documents.length; index += 1) {
    await fs.writeFile(paths[index], `${JSON.stringify(documents[index], null, 2)}\n`, 'utf8');
  }
  const finishedAt = new Date().toISOString();

  const hydratedDocument = documentWithDemoRefs(project, references);
  const manifest = {
    ...project,
    kind: 'app-video-project-composed',
    composed: true,
    demoManifest: {
      slug: demoSlug,
      demoCount: received.length,
      demos: received,
    },
    document: hydratedDocument,
    clips: (project.clips || []).map((clip: any, index: number) => ({
      ...clip,
      index: Number.isInteger(clip?.index) ? clip.index : index,
    })),
  };

  return {
    output: JSON.stringify(manifest, null, 2),
    logs: [
      `Project composition started at ${startedAt}.`,
      `Validated project slug ${projectSlug} and ${received.length} Demo UI reference(s).`,
      `Associated ${received.length} Demo(s) with ${flatClips.length} clip(s).`,
      `Updated ${paths.length} chapter file(s); speech and duration fields were preserved.`,
      `Project composition finished at ${finishedAt}.`,
    ],
  };
}

export default {
  type: 'app-video-compose',
  capabilities: ['filesystem'],
  execute,
};
