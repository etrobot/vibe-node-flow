import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { stripEmbeddedSourceBrief } from '../../lib/source-brief-asset.ts';
import {
  DEFAULT_FISH_AUDIO_NARRATION_CONFIG,
  type FishAudioNarrationConfig,
} from './config.ts';
import {
  FISH_AUDIO_TTS_FORMAT,
  FISH_AUDIO_TTS_MODEL,
  FISH_AUDIO_REFERENCE_ID,
  FishAudioTtsError,
  resolveFishAudioApiKey,
  resolveProxyUrl,
  stitchMp3Parts,
  synthesizeSpeech,
} from './fish-audio-tts.ts';
import { resolveClipTiming, stripAnchors, type ItemTiming } from './timing.ts';

interface NarrationClip {
  index: number;
  /** Authored speech, still carrying its `**anchors**`. */
  speech: string;
  /** How many shots the anchors have to divide this clip into. */
  itemCount: number;
  /** Storyboard runtime for the clip, when the upstream manifest carries it. */
  plannedSeconds?: number;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeConfig(value: unknown): FishAudioNarrationConfig {
  const raw = value && typeof value === 'object' ? value as Partial<FishAudioNarrationConfig> : {};
  const defaults = DEFAULT_FISH_AUDIO_NARRATION_CONFIG;
  const tolerance = Number(raw.durationTolerance);
  const minItemSeconds = Number(raw.minItemSeconds);
  return {
    ...defaults,
    writeCombined: raw.writeCombined === undefined
      ? defaults.writeCombined
      : Boolean(raw.writeCombined),
    applyTiming: raw.applyTiming === undefined
      ? defaults.applyTiming
      : Boolean(raw.applyTiming),
    minItemSeconds: Number.isFinite(minItemSeconds)
      ? Math.max(0.05, Math.min(3, minItemSeconds))
      : defaults.minItemSeconds,
    concurrency: integer(raw.concurrency, defaults.concurrency, 1, 3),
    timeoutMs: integer(raw.timeoutMs, defaults.timeoutMs, 5_000, 300_000),
    durationTolerance: Number.isFinite(tolerance)
      ? Math.max(0.05, Math.min(2, tolerance))
      : defaults.durationTolerance,
  };
}

function clipSeconds(clip: any): number | undefined {
  if (!Array.isArray(clip?.items)) return undefined;
  const total = clip.items.reduce((sum: number, item: any) => sum + (Number(item?.duration) || 0), 0);
  return total > 0 ? total : undefined;
}

/** How many shots the clip's anchors must divide the narration into. */
function clipItemCount(clip: any): number {
  if (Array.isArray(clip?.items)) return Math.max(1, clip.items.length);
  const declared = Number(clip?.itemCount);
  return Number.isInteger(declared) && declared > 0 ? declared : 1;
}

/**
 * Accept either a run asset manifest or a raw storyboard document, so this
 * node can sit directly after storyboard generation.
 */
export function readNarrationSource(raw: string): {
  clips: NarrationClip[];
  assetDir: string | null;
  slug: string | null;
  chapterFiles: string[];
  document: Record<string, unknown> | null;
} {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new NodeInputError('Fish Audio Narration received an empty upstream output.');

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new NodeValidationError(
      `Upstream output is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.clips) || !parsed.clips.length) {
    throw new NodeValidationError('Upstream output must be a JSON object with a non-empty clips array.');
  }

  const clips: NarrationClip[] = parsed.clips.map((clip: any, index: number) => ({
    index: Number.isInteger(clip?.index) ? Number(clip.index) : index,
    speech: String(clip?.speech ?? '').trim(),
    itemCount: clipItemCount(clip),
    plannedSeconds: Number(clip?.plannedSeconds) || clipSeconds(clip),
  }));

  const missing = clips.filter((clip) => !clip.speech).map((clip) => clip.index + 1);
  if (missing.length) {
    throw new NodeValidationError(`Clips ${missing.join(', ')} have no speech to narrate.`);
  }

  return {
    clips,
    assetDir: typeof parsed.assetDir === 'string' && parsed.assetDir ? parsed.assetDir : null,
    slug: typeof parsed.slug === 'string' && parsed.slug ? parsed.slug : null,
    chapterFiles: Array.isArray(parsed.chapterFiles)
      ? parsed.chapterFiles.filter((file: unknown) => typeof file === 'string' && file)
      : [],
    // A direct storyboard edge is the compact five-node workflow's project
    // handoff. Preserve it so the render node can carry measured shot timing
    // forward without requiring an intermediate project packager.
    document: parsed.document && typeof parsed.document === 'object' && !Array.isArray(parsed.document)
      ? parsed.document as Record<string, unknown>
      : parsed as Record<string, unknown>,
  };
}

export function clipFileName(index: number): string {
  return `clip-${String(index + 1).padStart(2, '0')}.mp3`;
}

export interface ClipTimeline {
  clipIndex: number;
  startSeconds: number;
  durationSeconds: number;
  measured: boolean;
  items: ItemTiming[];
}

/**
 * Push the resolved shot lengths back into the run assets the render reads, so
 * `chapter-N.json` follows the generated narration duration.
 * Returns how many clips were rewritten.
 */
export async function applyTimingToRunAssets(
  assetDir: string,
  chapterFiles: string[],
  timeline: ClipTimeline[],
): Promise<number> {
  const byClip = new Map(timeline.map((entry) => [entry.clipIndex, entry]));
  let cursor = 0;
  let patched = 0;

  for (const file of chapterFiles) {
    const target = path.join(assetDir, 'chapter', file);
    let document: any;
    try {
      document = JSON.parse(await fs.readFile(target, 'utf8'));
    } catch {
      // A chapter the upstream node never wrote is not this node's failure to report.
      continue;
    }
    if (!Array.isArray(document?.clips)) continue;

    for (const clip of document.clips) {
      const entry = byClip.get(cursor);
      cursor += 1;
      if (!entry || !Array.isArray(clip?.items)) continue;
      clip.items.forEach((item: any, itemIndex: number) => {
        const slot = entry.items.find((candidate) => candidate.index === itemIndex);
        if (slot && slot.durationSeconds > 0) item.duration = slot.durationSeconds;
      });
      patched += 1;
    }
    await fs.writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
  return patched;
}

/** Keep the manifest's embedded preview in lockstep with the chapter files. */
function applyTimingToDocument(document: Record<string, any>, timeline: ClipTimeline[]): Record<string, any> {
  const copy = structuredClone(document);
  if (!Array.isArray(copy?.clips)) return copy;
  copy.clips.forEach((clip: any, clipIndex: number) => {
    const entry = timeline[clipIndex];
    if (!entry || !Array.isArray(clip?.items)) return;
    clip.items.forEach((item: any, itemIndex: number) => {
      const slot = entry.items.find((candidate) => candidate.index === itemIndex);
      if (slot && slot.durationSeconds > 0) item.duration = slot.durationSeconds;
    });
  });
  return copy;
}

/** Run async work over a list with a bounded worker pool. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => runWorker()),
  );
  return results;
}

async function execute({
  node,
  input,
  assetsDir,
  workflowId,
  runId,
  onLog,
  onResourceAccess,
}: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (values.length !== 1) {
    throw new NodeInputError(
      `Fish Audio Narration requires exactly one non-empty upstream node; received ${values.length}.`,
    );
  }
  const source = readNarrationSource(values[0]);
  const apiKey = resolveFishAudioApiKey();
  if (!apiKey) {
    throw new NodeValidationError(
      `FISH_API_KEY is required for ${FISH_AUDIO_TTS_MODEL}.`,
    );
  }
  const proxyUrl = resolveProxyUrl();
  onResourceAccess?.({ kind: 'environment', operation: 'read', detail: 'Fish Audio TTS configuration' });
  if (source.assetDir && source.chapterFiles.length) {
    onResourceAccess?.({ kind: 'filesystem', operation: 'read', detail: 'run chapter assets' });
    onResourceAccess?.({ kind: 'filesystem', operation: 'write', detail: 'updated chapter timing' });
  }
  onResourceAccess?.({ kind: 'filesystem', operation: 'write', detail: 'run audio and narration assets' });

  const assetId = runId;
  const outputDir = assetsDir;
  await fs.mkdir(outputDir, { recursive: true });

  const log = createNodeLogger(onLog);
  log.push(
    `Synthesizing ${source.clips.length} clip(s) with Fish Audio ${FISH_AUDIO_TTS_MODEL} `
    + `(one request per clip, concurrency ${config.concurrency}).`,
    `Fixed voice: ${FISH_AUDIO_REFERENCE_ID}. Each clip is its own take so chapter boundaries can breathe.`,
  );
  if (proxyUrl) log.push(`Routing Fish Audio TTS through proxy ${proxyUrl}.`);

  let synthesized;
  try {
    synthesized = await mapWithConcurrency(source.clips, config.concurrency, async (clip, index) => {
      const plain = stripAnchors(clip.speech).plain;
      const words = plain.split(/\s+/).filter(Boolean).length;
      log.push(`Clip ${index + 1}: ${plain.length} characters, ${words} word(s).`);
      return synthesizeSpeech({
        text: plain,
        apiKey,
        proxyUrl,
        timeoutMs: config.timeoutMs,
      });
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const failure = new NodeValidationError(
      `${error instanceof FishAudioTtsError ? 'Fish Audio TTS' : 'Narration'} synthesis failed: ${detail}`,
    );
    (failure as Error & { logs?: string[] }).logs = log.logs;
    throw failure;
  }

  const warnings: string[] = [];
  const parts: Buffer[] = [];
  const entries = [];
  const timeline: ClipTimeline[] = [];
  let measuredClips = 0;
  let elapsedSeconds = 0;

  for (let index = 0; index < source.clips.length; index += 1) {
    const clip = source.clips[index];
    const result = synthesized[index]!;
    const file = clipFileName(index);
    await fs.writeFile(path.join(outputDir, file), result.audio);

    const startSeconds = elapsedSeconds;
    parts.push(result.audio);
    elapsedSeconds += result.durationSeconds;

    if (clip.plannedSeconds && clip.plannedSeconds > 0) {
      const ratio = result.durationSeconds / clip.plannedSeconds;
      if (ratio > 1 + config.durationTolerance) {
        warnings.push(
          `Clip ${index + 1} narration runs ${result.durationSeconds.toFixed(1)}s against a planned `
          + `${clip.plannedSeconds.toFixed(1)}s; lengthen the clip or shorten the speech.`,
        );
      }
    }

    const timing = resolveClipTiming({
      speech: clip.speech,
      itemCount: clip.itemCount,
      // Fish Audio's speech endpoint returns audio only, without word timings.
      boundaries: [],
      audioSeconds: result.durationSeconds,
      minItemSeconds: config.minItemSeconds,
      label: `Clip ${index + 1}`,
    });
    warnings.push(...timing.warnings);
    if (timing.measured) measuredClips += 1;
    timeline.push({
      clipIndex: index,
      startSeconds: Number(startSeconds.toFixed(3)),
      durationSeconds: Number(result.durationSeconds.toFixed(3)),
      measured: timing.measured,
      items: timing.items,
    });

    entries.push({
      index,
      file,
      url: `/api/workflows/${workflowId}/assets/${assetId}/${file}`,
      speech: stripAnchors(clip.speech).plain,
      bytes: result.audio.length,
      durationSeconds: Number(result.durationSeconds.toFixed(3)),
      plannedSeconds: clip.plannedSeconds ? Number(clip.plannedSeconds.toFixed(3)) : null,
      startSeconds: Number(startSeconds.toFixed(3)),
      items: timing.items,
      words: [],
      requests: result.requests,
      generationIds: result.generationIds,
    });
  }

  const combined = await stitchMp3Parts(parts);
  if (config.writeCombined) {
    await fs.writeFile(path.join(outputDir, 'narration.mp3'), combined);
    log.push(`Wrote narration.mp3 (${(combined.length / 1024).toFixed(0)} KB).`);
  }

  const totalSeconds = elapsedSeconds;
  const spokenWords = source.clips.reduce((sum, clip) => (
    sum + stripAnchors(clip.speech).plain.split(/\s+/).filter(Boolean).length
  ), 0);
  const totalRequests = synthesized.reduce((sum, result) => sum + result.requests, 0);
  const rawDocument = config.applyTiming && source.document
    ? applyTimingToDocument(source.document, timeline)
    : source.document;
  const finalDocument = rawDocument ? stripEmbeddedSourceBrief(rawDocument) : null;
  const manifest = {
    slug: source.slug,
    assetDir: source.assetDir,
    chapterFiles: source.chapterFiles,
    ...(finalDocument ? { document: finalDocument } : {}),
    provider: 'fish-audio',
    model: FISH_AUDIO_TTS_MODEL,
    referenceId: FISH_AUDIO_REFERENCE_ID,
    format: FISH_AUDIO_TTS_FORMAT,
    clipCount: entries.length,
    totalSeconds: Number(totalSeconds.toFixed(3)),
    combinedFile: config.writeCombined ? 'narration.mp3' : null,
    combinedUrl: config.writeCombined
      ? `/api/workflows/${workflowId}/assets/${assetId}/narration.mp3`
      : null,
    /** Where the clip MP3s always exist. */
    audioDir: outputDir,
    /** Resolved shot boundaries, the timing source of truth for the render. */
    timeline,
    clips: entries,
  };

  if (config.applyTiming && source.assetDir && source.chapterFiles.length) {
    const patched = await applyTimingToRunAssets(source.assetDir, source.chapterFiles, timeline);
    log.push(
      `Applied resolved shot timing to ${patched} clip(s) across ${source.chapterFiles.length} chapter file(s).`,
    );
  }

  log.push(
    `Provider returned ${totalSeconds.toFixed(1)}s from ${totalRequests} request(s) `
    + `(${(spokenWords / Math.max(0.001, totalSeconds)).toFixed(2)} words/s).`,
  );
  log.push(
    `Measured MP3 duration for ${entries.length} clip(s); `
    + `${measuredClips}/${entries.length} clip timeline(s) needed no estimated anchor placement.`,
  );

  await fs.writeFile(
    path.join(outputDir, 'narration.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  if (warnings.length) {
    log.push(...warnings.map((warning) => `[Timing] ${warning}`));
    return {
      output: JSON.stringify(manifest, null, 2),
      logs: log.logs,
      status: 'warning',
      error: `Narration timing needs attention for ${warnings.length} clip(s).`,
    };
  }

  return { output: JSON.stringify(manifest, null, 2), logs: log.logs };
}

export default {
  type: 'fish-audio-narration',
  capabilities: ['tts', 'filesystem'],
  execute,
};
