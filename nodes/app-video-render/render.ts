/**
 * Deterministic helpers behind `app-video-render`. Everything that decides a
 * path, a command line, or a filter graph lives here so it can be tested
 * without a browser, an encoder, or a 20-minute render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NodeInputError, NodeValidationError } from '../../server/plugins.ts';
import {
  parseWorkflowMermaidMaterials,
  type WorkflowCanvasGraph,
  type WorkflowMermaidMaterial,
} from './demo-html.ts';
import {
  CLIP_BACKGROUNDS,
  CLIP_ITEM_TYPES,
} from './renderer/clipTypes.ts';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;

/** Clip audio file names written by `fish-audio-narration`. */
export const CLIP_AUDIO_PATTERN = /^clip-\d{2,3}\.mp3$/;

/** Background music names auto-detected in project directory. */
export const MUSIC_FILE_NAMES = ['bgm.mp3', 'bgm.wav', 'bgm.mp4', 'bgm.m4a'];

/** Mirrors `getItemDuration`: a non-positive duration still occupies 0.1s. */
export const FALLBACK_ITEM_SECONDS = 0.1;

/**
 * amix refuses inputs whose sample rate or layout differ, and the narration is
 * 24 kHz mono while music is usually 44.1 kHz stereo. Normalize every chain.
 */
const AUDIO_FORMAT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

export interface NarrationClipRef {
  index: number;
  file: string;
  durationSeconds: number;
  /** Clip start on the finished timeline, measured by `fish-audio-narration`. */
  startSeconds: number;
}

/** HTML payloads produced by the LLM Demo UI branch. */
export interface GeneratedDemoHtml {
  clipIndex: number;
  itemIndex: number;
  /** Legacy inline payload; new mermaidCNhtml manifests use htmlFile. */
  html?: string;
  htmlFile?: string;
  generation?: Record<string, unknown>;
}

export interface UpstreamFacts {
  slug: string | null;
  assetDir: string | null;
  /** Original storyboard document when an upstream node carries it. */
  document: Record<string, unknown> | null;
  /** Directory holding the clip MP3s reported by `fish-audio-narration`. */
  audioDir: string | null;
  narrationClips: NarrationClipRef[];
  generatedDemos: GeneratedDemoHtml[];
  /** Exact graph contract carried by a workflow-canvas UI manifest. */
  workflowGraph: WorkflowCanvasGraph | null;
  /** Exact NODE.md Mermaid materials used by deterministic Demo UI targets. */
  workflowMermaidMaterials: WorkflowMermaidMaterial[];
  /** Upstream node ids whose non-empty output was not a supported manifest. */
  unparsedUpstream: string[];
}

const MERMAID_MANIFEST_KINDS = new Set(['mermaidCNhtml', 'mermaid-en-html']);

export interface RenderProjectValidationReport {
  errors: string[];
  warnings: string[];
  metrics: {
    clips: number;
    items: number;
    timedItems: number;
  };
}

export interface TimelineClip {
  index: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface MuxTrack {
  path: string;
  startSeconds: number;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isSafeDemoFile(value: unknown): boolean {
  const file = typeof value === 'string' ? value.trim() : '';
  return Boolean(file)
    && !file.startsWith('/')
    && !file.includes('\\')
    && file.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')
    && file.startsWith('demo/');
}

/** True only when every renderer item already has measured or authored timing. */
export function hasCompleteItemTiming(document: unknown): boolean {
  if (!isRecord(document) || !Array.isArray(document.clips) || !document.clips.length) return false;
  return document.clips.every((clip: unknown) => (
    isRecord(clip)
    && Array.isArray(clip.items)
    && clip.items.length > 0
    && clip.items.every((item: unknown) => isRecord(item) && isPositiveNumber(item.duration))
  ));
}

/**
 * Validate the renderer's own input contract. This intentionally accepts every
 * item implemented by app-video-render and does not apply the upstream LLM
 * author's style rules (closing pairs, chapter coverage, anchor counts, etc.).
 */
export function validateRenderProject(value: unknown): RenderProjectValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let itemCount = 0;
  let timedItems = 0;

  if (!isRecord(value)) {
    return {
      errors: ['Render project must be a JSON object.'],
      warnings,
      metrics: { clips: 0, items: 0, timedItems: 0 },
    };
  }

  if (value['global-components'] !== undefined && !Array.isArray(value['global-components'])) {
    errors.push('global-components must be an array when present.');
  }

  if (!Array.isArray(value.clips) || !value.clips.length) {
    errors.push('clips must be a non-empty array.');
    return {
      errors,
      warnings,
      metrics: { clips: 0, items: 0, timedItems: 0 },
    };
  }

  const backgrounds = new Set<string>(CLIP_BACKGROUNDS);
  const itemTypes = new Set<string>(CLIP_ITEM_TYPES);
  value.clips.forEach((clip: unknown, clipIndex: number) => {
    const label = `Clip ${clipIndex + 1}`;
    if (!isRecord(clip)) {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (typeof clip.speech !== 'string') {
      errors.push(`${label} speech must be a string.`);
    } else if (!clip.speech.trim()) {
      warnings.push(`${label} speech is empty.`);
    }
    if (!backgrounds.has(String(clip.background ?? ''))) {
      errors.push(`${label} background must be one of ${CLIP_BACKGROUNDS.join(', ')}.`);
    }
    if (!Array.isArray(clip.items) || !clip.items.length) {
      errors.push(`${label} items must be a non-empty array.`);
      return;
    }

    clip.items.forEach((item: unknown, itemIndex: number) => {
      itemCount += 1;
      const itemLabel = `${label} item ${itemIndex + 1}`;
      if (!isRecord(item)) {
        errors.push(`${itemLabel} must be an object.`);
        return;
      }
      if (!itemTypes.has(String(item.type ?? ''))) {
        errors.push(`${itemLabel} has unsupported type ${JSON.stringify(item.type ?? null)}.`);
      }
      if (item.duration !== undefined) {
        if (!isPositiveNumber(item.duration)) {
          errors.push(`${itemLabel} duration must be a positive number when present.`);
        } else {
          timedItems += 1;
        }
      }
      if (item.effect !== undefined && item.effect !== 'shockwave') {
        errors.push(`${itemLabel} has unsupported effect ${JSON.stringify(item.effect)}.`);
      }
      if (isRecord(item.demoUi) && item.demoUi.htmlFile !== undefined && !isSafeDemoFile(item.demoUi.htmlFile)) {
        errors.push(`${itemLabel} has an unsafe Demo UI htmlFile.`);
      }
    });
  });

  if (value.chapters !== undefined) {
    if (!Array.isArray(value.chapters)) {
      errors.push('chapters must be an array when present.');
    } else {
      value.chapters.forEach((chapter: unknown, chapterIndex: number) => {
        const label = `Chapter ${chapterIndex + 1}`;
        if (!isRecord(chapter)) {
          errors.push(`${label} must be an object.`);
          return;
        }
        if (chapter.startClip !== undefined
          && (!Number.isInteger(chapter.startClip) || chapter.startClip < 0)) {
          errors.push(`${label} startClip must be a non-negative integer when present.`);
        }
        if (chapter.clipCount !== undefined
          && (!Number.isInteger(chapter.clipCount) || chapter.clipCount <= 0)) {
          errors.push(`${label} clipCount must be a positive integer when present.`);
        }
      });
    }
  }

  if (timedItems < itemCount) {
    warnings.push(
      `${itemCount - timedItems} renderer item(s) have no positive duration; timing must be derived before frame capture.`,
    );
  }

  return {
    errors,
    warnings,
    metrics: { clips: value.clips.length, items: itemCount, timedItems },
  };
}

/**
 * Collect what the render needs from every upstream manifest. The node accepts
 * storyboard, Demo UI, and narration manifests, so parallel workflow branches
 * can fan in here without an intermediate packager node.
 */
export function mergeUpstreamManifests(input: Record<string, string>): UpstreamFacts {
  const entries = Object.entries(input)
    .map(([nodeId, value]) => [nodeId, String(value ?? '').trim()] as const)
    .filter(([, value]) => Boolean(value));
  if (!entries.length) {
    throw new NodeInputError('App Video Render requires at least one non-empty upstream manifest; received none.');
  }

  const facts: UpstreamFacts = {
    slug: null,
    assetDir: null,
    document: null,
    audioDir: null,
    narrationClips: [],
    generatedDemos: [],
    workflowGraph: null,
    workflowMermaidMaterials: [],
    unparsedUpstream: [],
  };

  let recognizedAny = false;
  let selectedDocument: {
    value: Record<string, unknown>;
    score: number;
    source: string;
  } | null = null;
  const demoUiOverrides = new Map<string, unknown>();

  for (const [nodeId, value] of entries) {
    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      facts.unparsedUpstream.push(nodeId);
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      facts.unparsedUpstream.push(nodeId);
      continue;
    }
    let recognized = false;

    const audioDir = trimmed(parsed.audioDir);
    const audioClips = Array.isArray(parsed.clips)
      ? parsed.clips.filter((clip: any) => CLIP_AUDIO_PATTERN.test(trimmed(clip?.file)))
      : [];
    const isNarrationManifest = Boolean(audioDir && audioClips.length);

    if ((parsed.kind === 'ui-html-generation' || MERMAID_MANIFEST_KINDS.has(parsed.kind)) && Array.isArray(parsed.demos)) {
      recognized = true;
      if (!facts.workflowGraph) {
        facts.workflowGraph = readWorkflowCanvasGraph(parsed.workflowGraph);
      }
      if (!facts.workflowMermaidMaterials.length && Array.isArray(parsed.workflowMermaidMaterials)) {
        facts.workflowMermaidMaterials = parsed.workflowMermaidMaterials
          .filter((material: any) => material && typeof material === 'object' && trimmed(material.id) && trimmed(material.source))
          .map((material: any) => ({
            id: trimmed(material.id),
            nodeType: trimmed(material.nodeType),
            title: trimmed(material.title) || trimmed(material.id),
            source: trimmed(material.source),
            sourceSha256: trimmed(material.sourceSha256),
            documentationSource: trimmed(material.documentationSource),
          }));
      }
      if (!facts.workflowMermaidMaterials.length) {
        // Legacy manifests embedded the brief text; prefer structured materials above.
        const sourceBrief = trimmed(parsed.document?.sourceBrief) || trimmed(parsed.sourceBrief);
        if (sourceBrief) facts.workflowMermaidMaterials = parseWorkflowMermaidMaterials(sourceBrief);
      }
      facts.generatedDemos.push(
        ...parsed.demos
          .filter((demo: any) => Number.isInteger(demo?.clipIndex)
            && Number.isInteger(demo?.itemIndex)
            && (typeof demo?.html === 'string' || typeof demo?.htmlFile === 'string'))
          .map((demo: any) => ({
            clipIndex: Number(demo.clipIndex),
            itemIndex: Number(demo.itemIndex),
            ...(typeof demo.html === 'string' ? { html: demo.html } : {}),
            ...(typeof demo.htmlFile === 'string' ? { htmlFile: demo.htmlFile } : {}),
            ...(demo.generation && typeof demo.generation === 'object'
              ? { generation: demo.generation as Record<string, unknown> }
              : {}),
          })),
      );
    }

    const embeddedDocument = parsed.document && typeof parsed.document === 'object'
      ? parsed.document
      : null;
    const candidateDocument = embeddedDocument || parsed;
    if (
      candidateDocument
      && typeof candidateDocument === 'object'
      && !Array.isArray(candidateDocument)
      && Array.isArray(candidateDocument.clips)
      && candidateDocument.clips.some((clip: any) => Array.isArray(clip?.items))
    ) {
      recognized = true;
      if (parsed.kind === 'ui-html-generation' || MERMAID_MANIFEST_KINDS.has(parsed.kind)) {
        for (const [clipIndex, clip] of candidateDocument.clips.entries()) {
          for (const [itemIndex, item] of (Array.isArray(clip?.items) ? clip.items : []).entries()) {
            if (item?.demoUi !== undefined) demoUiOverrides.set(`${clipIndex}:${itemIndex}`, item.demoUi);
          }
        }
      }
      let score = 10;
      if (hasCompleteItemTiming(candidateDocument)) score += 30;
      if (isNarrationManifest) score += 100;
      if (Array.isArray(parsed.timeline) && parsed.timeline.length) score += 20;
      if (parsed.kind === 'ui-html-generation' || MERMAID_MANIFEST_KINDS.has(parsed.kind)) score -= 5;

      if (
        !selectedDocument
        || score > selectedDocument.score
        || (score === selectedDocument.score && nodeId.localeCompare(selectedDocument.source) < 0)
      ) {
        selectedDocument = {
          value: candidateDocument as Record<string, unknown>,
          score,
          source: nodeId,
        };
      }
    }

    if (trimmed(parsed.slug)) {
      recognized = true;
      if (!facts.slug) facts.slug = trimmed(parsed.slug);
    }
    if (!facts.assetDir && trimmed(parsed.assetDir)) {
      recognized = true;
      facts.assetDir = trimmed(parsed.assetDir);
    } else if (trimmed(parsed.assetDir)) {
      recognized = true;
    }

    if (isNarrationManifest && !facts.narrationClips.length) {
      recognized = true;
      // `timeline` is what the narration measured; a clip entry's own
      // `startSeconds` is the same number, kept as the fallback for manifests
      // written before the timeline existed.
      const timeline = new Map<number, number>(
        (Array.isArray(parsed.timeline) ? parsed.timeline : [])
          .filter((entry: any) => Number.isInteger(entry?.clipIndex))
          .map((entry: any) => [Number(entry.clipIndex), Number(entry.startSeconds) || 0]),
      );
      facts.audioDir = audioDir;
      facts.narrationClips = audioClips
        .map((clip: any, position: number) => {
          const index = Number.isInteger(clip.index) ? Number(clip.index) : position;
          return {
            index,
            file: trimmed(clip.file),
            durationSeconds: Number(clip.durationSeconds) || 0,
            startSeconds: timeline.get(index) ?? (Number(clip.startSeconds) || 0),
          };
        })
        .sort((left: NarrationClipRef, right: NarrationClipRef) => left.index - right.index);
    } else if (isNarrationManifest) {
      recognized = true;
    }

    if (recognized) {
      recognizedAny = true;
    } else {
      facts.unparsedUpstream.push(nodeId);
    }
  }

  if (selectedDocument && demoUiOverrides.size) {
    const document = structuredClone(selectedDocument.value) as any;
    for (const [key, demoUi] of demoUiOverrides) {
      const [clipIndex, itemIndex] = key.split(':').map(Number);
      const item = document.clips?.[clipIndex]?.items?.[itemIndex];
      if (item) item.demoUi = demoUi;
    }
    selectedDocument.value = document;
  }
  facts.document = selectedDocument?.value ?? null;

  if (!recognizedAny) {
    const ids = facts.unparsedUpstream.join(', ');
    throw new NodeInputError(
      ids
        ? `No upstream output was recognized as a supported JSON manifest. Unsupported upstream: ${ids}.`
        : 'No upstream output was recognized as a supported JSON manifest.',
    );
  }
  return facts;
}

function readWorkflowCanvasGraph(value: unknown): WorkflowCanvasGraph | null {
  if (!isRecord(value) || !isRecord(value.workflow)) return null;
  if (!Array.isArray(value.workflow.lanes) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }
  const validNodes = value.nodes.every((node: unknown) => (
    isRecord(node)
    && Boolean(trimmed(node.id))
    && Boolean(trimmed(node.title))
    && Boolean(trimmed(node.lane))
  ));
  const validEdges = value.edges.every((edge: unknown) => (
    isRecord(edge)
    && Boolean(trimmed(edge.from))
    && Boolean(trimmed(edge.to))
  ));
  if (!validNodes || !validEdges) return null;
  return value as WorkflowCanvasGraph;
}

/** `chapter-10.json` sorts after `chapter-9.json`, which a string sort gets wrong. */
export function orderChapterFiles(names: string[]): string[] {
  return names
    .map((name) => ({ name, index: Number(/^chapter-(\d+)\.json$/.exec(name)?.[1]) }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.name);
}

/** Cumulative clip start offsets, in the order the renderer concatenates them. */
export function clipTimeline(documents: Array<{ clips?: unknown }>): TimelineClip[] {
  const timeline: TimelineClip[] = [];
  let cursor = 0;
  for (const document of documents) {
    const clips = Array.isArray(document?.clips) ? document.clips : [];
    for (const clip of clips) {
      const items = Array.isArray((clip as any)?.items) ? (clip as any).items : [];
      const duration = items.reduce((total: number, item: any) => {
        const value = Number(item?.duration);
        return total + (Number.isFinite(value) && value > 0 ? value : FALLBACK_ITEM_SECONDS);
      }, 0);
      timeline.push({ index: timeline.length, startSeconds: round(cursor), durationSeconds: round(duration) });
      cursor += duration;
    }
  }
  return timeline;
}

export function timelineSeconds(timeline: TimelineClip[]): number {
  const last = timeline[timeline.length - 1];
  return last ? round(last.startSeconds + last.durationSeconds) : 0;
}

/** Read the run timeline from chapter-N.json files in an asset directory. */
export function readRunAssetTimeline(assetDir: string): TimelineClip[] {
  const chapterDir = path.join(assetDir, 'chapter');
  let names: string[];
  try {
    names = fs.readdirSync(chapterDir);
  } catch {
    throw new NodeValidationError(`Project has no chapter directory: ${chapterDir}`);
  }
  const ordered = orderChapterFiles(names);
  if (!ordered.length) {
    throw new NodeValidationError(`Project has no chapter-N.json files: ${chapterDir}`);
  }
  const documents = ordered.map((name) => {
    const file = path.join(chapterDir, name);
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new NodeValidationError(
        `${name} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  const timeline = clipTimeline(documents);
  if (!timeline.length) {
    throw new NodeValidationError(`Project chapter files contain no clips: ${chapterDir}`);
  }
  return timeline;
}

/** Search for reusable background music in a video node's asset directory. */
export function findNodeMusic(nodeAssetsDir: string): string | null {
  for (const name of MUSIC_FILE_NAMES) {
    const candidate = path.join(nodeAssetsDir, 'music', name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Walk up looking for an installed package. */
export function resolvePackageDir(fromDir: string, packageName: string): string | null {
  let current = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(current, 'node_modules', packageName, 'package.json');
    if (fs.existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export interface RenderArgsOptions {
  slug: string;
  resolution: string;
  fps: number;
  crf: number;
  x264Preset: string;
  outputRelative: string;
}

export function buildRenderArgs(options: RenderArgsOptions): string[] {
  return [
    'run', 'render-video', '--',
    '--project', options.slug,
    '--resolution', options.resolution,
    '--fps', String(options.fps),
    '--crf', String(options.crf),
    '--x264-preset', options.x264Preset,
    '--output', options.outputRelative,
    '--no-audio',
  ];
}

export function buildValidateArgs(slug: string): string[] {
  return ['run', 'validate-project', '--', slug];
}

export interface MuxOptions {
  videoPath: string;
  tracks: MuxTrack[];
  musicPath?: string | null;
  musicVolume: number;
  totalSeconds: number;
  audioBitrate: string;
  outputPath: string;
}

/**
 * Lay every clip MP3 on the timeline with `adelay`, optionally mix looped music
 * underneath.
 */
export function buildMuxArgs(options: MuxOptions): string[] {
  const args = ['-y', '-i', options.videoPath];
  const chains: string[] = [];
  const labels: string[] = [];

  options.tracks.forEach((track, position) => {
    const inputIndex = position + 1;
    const label = `voice${position}`;
    const delayMs = Math.max(0, Math.round(track.startSeconds * 1000));
    args.push('-i', track.path);
    chains.push(`[${inputIndex}:a]${AUDIO_FORMAT},adelay=${delayMs}:all=1[${label}]`);
    labels.push(`[${label}]`);
  });

  if (options.musicPath) {
    const inputIndex = options.tracks.length + 1;
    args.push('-stream_loop', '-1', '-i', options.musicPath);
    chains.push(
      `[${inputIndex}:a]${AUDIO_FORMAT},volume=${options.musicVolume.toFixed(3)}`
      + `,atrim=0:${Math.max(0, options.totalSeconds).toFixed(3)}[music]`,
    );
    labels.push('[music]');
  }

  if (!labels.length) {
    throw new Error('buildMuxArgs requires at least one narration track or a music file.');
  }

  const mix = labels.length > 1
    ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad[out]`
    : `${labels[0]}apad[out]`;

  args.push(
    '-filter_complex', [...chains, mix].join(';'),
    '-map', '0:v:0',
    '-map', '[out]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', options.audioBitrate,
    '-shortest',
    '-movflags', '+faststart',
    options.outputPath,
  );
  return args;
}

/**
 * Narration that outlasts its clip bleeds over the next one.
 */
export function narrationOverruns(
  timeline: TimelineClip[],
  clips: NarrationClipRef[],
  tolerance = 0.15,
): string[] {
  const messages: string[] = [];
  for (const clip of clips) {
    const slot = timeline[clip.index];
    if (!slot || !clip.durationSeconds) continue;
    if (clip.durationSeconds > slot.durationSeconds + tolerance) {
      messages.push(
        `Clip ${clip.index + 1} narration runs ${clip.durationSeconds.toFixed(1)}s inside a `
        + `${slot.durationSeconds.toFixed(1)}s slot; it will bleed into the next clip.`,
      );
    }
  }
  return messages;
}

export function scratchRenderJobs(
  before: string[],
  after: string[],
  keep: string[],
  hasClipsDir: (name: string) => boolean,
): string[] {
  const known = new Set([...before, ...keep]);
  return after.filter((name) => !known.has(name) && hasClipsDir(name));
}

/** Keep the last lines of a long render log so diagnostics stay readable. */
export function tailLines(text: string, maxLines: number): string[] {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  return lines.slice(-Math.max(1, maxLines));
}

/** Render one command as a copy-pasteable line for logs and the output view. */
export function describeCommand(command: string, args: string[]): string {
  return [command, ...args]
    .map((part) => (/[\s"'$`\\]/.test(part) ? JSON.stringify(part) : part))
    .join(' ');
}
