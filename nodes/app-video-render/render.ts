/**
 * Deterministic helpers behind `app-video-render`. Everything that decides a
 * path, a command line, or a filter graph lives here so it can be tested
 * without a browser, an encoder, or a 20-minute render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NodeInputError, NodeValidationError } from '../../server/plugins.ts';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;

/** Clip audio file names written by `edge-tts-narration`. */
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
  /** Clip start on the finished timeline, measured by `edge-tts-narration`. */
  startSeconds: number;
}

export interface UpstreamFacts {
  slug: string | null;
  assetDir: string | null;
  /** Original storyboard document when an upstream node carries it. */
  document: Record<string, unknown> | null;
  /** Directory holding the clip MP3s reported by `edge-tts-narration`. */
  audioDir: string | null;
  narrationClips: NarrationClipRef[];
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

/**
 * Collect what the render needs from every upstream manifest. The node accepts
 * the `app-video-project` manifest, the `edge-tts-narration` manifest, or both,
 * so it works whether it is chained after narration or fanned in from earlier.
 */
export function mergeUpstreamManifests(input: Record<string, string>): UpstreamFacts {
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (!values.length) {
    throw new NodeInputError('App Video Render requires at least one non-empty upstream manifest; received none.');
  }

  const facts: UpstreamFacts = {
    slug: null,
    assetDir: null,
    document: null,
    audioDir: null,
    narrationClips: [],
  };

  let parsedAny = false;
  for (const value of values) {
    let parsed: any;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    parsedAny = true;

    const embeddedDocument = parsed.document && typeof parsed.document === 'object'
      ? parsed.document
      : null;
    const candidateDocument = embeddedDocument || parsed;
    if (
      !facts.document
      && candidateDocument
      && Array.isArray(candidateDocument.clips)
      && candidateDocument.clips.some((clip: any) => Array.isArray(clip?.items))
    ) {
      facts.document = candidateDocument as Record<string, unknown>;
    }

    if (!facts.slug && trimmed(parsed.slug)) facts.slug = trimmed(parsed.slug);
    if (!facts.assetDir && trimmed(parsed.assetDir)) {
      facts.assetDir = trimmed(parsed.assetDir);
    }

    const audioDir = trimmed(parsed.audioDir);
    const clips = Array.isArray(parsed.clips)
      ? parsed.clips.filter((clip: any) => CLIP_AUDIO_PATTERN.test(trimmed(clip?.file)))
      : [];
    if (audioDir && clips.length && !facts.narrationClips.length) {
      // `timeline` is what the narration measured; a clip entry's own
      // `startSeconds` is the same number, kept as the fallback for manifests
      // written before the timeline existed.
      const timeline = new Map<number, number>(
        (Array.isArray(parsed.timeline) ? parsed.timeline : [])
          .filter((entry: any) => Number.isInteger(entry?.clipIndex))
          .map((entry: any) => [Number(entry.clipIndex), Number(entry.startSeconds) || 0]),
      );
      facts.audioDir = audioDir;
      facts.narrationClips = clips
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
    }
  }

  if (!parsedAny) {
    throw new NodeValidationError('No upstream output parsed as a JSON manifest.');
  }
  return facts;
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
