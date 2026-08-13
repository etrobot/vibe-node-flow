import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  createNodeLogger,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { DEFAULT_EDGE_TTS_NARRATION_CONFIG, type EdgeTtsNarrationConfig } from './config.ts';
import {
  EdgeTtsError,
  isVoiceShortName,
  listVoices,
  normalizePitch,
  normalizeRate,
  normalizeVolume,
  resolveProxyUrl,
  synthesizeSpeech,
  voiceLocale,
  type WordBoundary,
} from './edge-tts.ts';
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

function normalizeConfig(value: unknown): EdgeTtsNarrationConfig {
  const raw = value && typeof value === 'object' ? value as Partial<EdgeTtsNarrationConfig> : {};
  const tolerance = Number(raw.durationTolerance);
  const minItemSeconds = Number(raw.minItemSeconds);
  const config: EdgeTtsNarrationConfig = {
    ...DEFAULT_EDGE_TTS_NARRATION_CONFIG,
    voice: String(raw.voice ?? DEFAULT_EDGE_TTS_NARRATION_CONFIG.voice).trim()
      || DEFAULT_EDGE_TTS_NARRATION_CONFIG.voice,
    writeCombined: raw.writeCombined === undefined
      ? DEFAULT_EDGE_TTS_NARRATION_CONFIG.writeCombined
      : Boolean(raw.writeCombined),
    applyTiming: raw.applyTiming === undefined
      ? DEFAULT_EDGE_TTS_NARRATION_CONFIG.applyTiming
      : Boolean(raw.applyTiming),
    minItemSeconds: Number.isFinite(minItemSeconds)
      ? Math.max(0.05, Math.min(3, minItemSeconds))
      : DEFAULT_EDGE_TTS_NARRATION_CONFIG.minItemSeconds,
    concurrency: integer(raw.concurrency, DEFAULT_EDGE_TTS_NARRATION_CONFIG.concurrency, 1, 6),
    timeoutMs: integer(raw.timeoutMs, DEFAULT_EDGE_TTS_NARRATION_CONFIG.timeoutMs, 5_000, 300_000),
    durationTolerance: Number.isFinite(tolerance)
      ? Math.max(0.05, Math.min(2, tolerance))
      : DEFAULT_EDGE_TTS_NARRATION_CONFIG.durationTolerance,
    rate: DEFAULT_EDGE_TTS_NARRATION_CONFIG.rate,
    volume: DEFAULT_EDGE_TTS_NARRATION_CONFIG.volume,
    pitch: DEFAULT_EDGE_TTS_NARRATION_CONFIG.pitch,
  };
  try {
    config.rate = normalizeRate(raw.rate ?? DEFAULT_EDGE_TTS_NARRATION_CONFIG.rate);
    config.volume = normalizeVolume(raw.volume ?? DEFAULT_EDGE_TTS_NARRATION_CONFIG.volume);
    config.pitch = normalizePitch(raw.pitch ?? DEFAULT_EDGE_TTS_NARRATION_CONFIG.pitch);
  } catch (error) {
    throw new NodeValidationError(error instanceof Error ? error.message : String(error));
  }
  if (!isVoiceShortName(config.voice)) {
    throw new NodeValidationError(
      `voice ${JSON.stringify(config.voice)} is not a Microsoft Edge short name `
      + `(for example ${DEFAULT_EDGE_TTS_NARRATION_CONFIG.voice}).`,
    );
  }
  return config;
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
  if (!trimmed) throw new NodeInputError('Edge TTS Narration received an empty upstream output.');

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

/** Run tasks with a bounded number in flight so the service is not flooded. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Turn a voice failure into a message that names usable voices for the locale. */
async function describeVoiceFailure(voice: string, proxyUrl: string | undefined, error: unknown): Promise<string> {
  const base = error instanceof Error ? error.message : String(error);
  const locale = voiceLocale(voice);
  if (!locale) return base;
  try {
    const voices = await listVoices(proxyUrl);
    if (voices.some((entry) => entry.shortName === voice)) return base;
    const options = voices
      .filter((entry) => entry.locale === locale)
      .map((entry) => entry.shortName)
      .slice(0, 8);
    if (!options.length) return `${base} No Edge voices are published for locale ${locale}.`;
    return `${base} Voice ${voice} is not published; available ${locale} voices include: ${options.join(', ')}.`;
  } catch {
    return base;
  }
}

export interface ClipTimeline {
  clipIndex: number;
  startSeconds: number;
  durationSeconds: number;
  measured: boolean;
  items: ItemTiming[];
}

/**
 * Push the measured shot lengths back into the run assets the render reads, so the
 * cut points in `chapter-N.json` are the ones the voice actually produced.
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
      `Edge TTS Narration requires exactly one non-empty upstream node; received ${values.length}.`,
    );
  }
  const source = readNarrationSource(values[0]);
  const proxyUrl = resolveProxyUrl();
  onResourceAccess?.({ kind: 'environment', operation: 'read', detail: 'Edge TTS proxy configuration' });
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
    `Synthesizing ${source.clips.length} clip(s) with ${config.voice} `
    + `(rate ${config.rate}, volume ${config.volume}, pitch ${config.pitch}, `
    + `concurrency ${config.concurrency}, timeout ${config.timeoutMs}ms).`,
  );
  if (proxyUrl) log.push(`Routing Edge TTS through proxy ${proxyUrl}.`);
  else log.push('No HTTP proxy configured for Edge TTS; connecting directly.');

  let firstFailure: unknown;
  let completedClips = 0;
  const synthesized = await mapWithConcurrency(source.clips, config.concurrency, async (clip, index) => {
    log.push(`Synthesizing clip ${index + 1}/${source.clips.length}...`);
    const started = Date.now();
    try {
      const result = await synthesizeSpeech({
        // Anchors mark where the picture cuts; the voice must not read them.
        text: stripAnchors(clip.speech).plain,
        voice: config.voice,
        rate: config.rate,
        volume: config.volume,
        pitch: config.pitch,
        proxyUrl,
        timeoutMs: config.timeoutMs,
      });
      completedClips += 1;
      log.push(
        `Clip ${index + 1}/${source.clips.length} synthesized in ${Date.now() - started}ms `
        + `(${result.durationSeconds.toFixed(2)}s audio, ${result.audio.length} bytes).`,
      );
      return result;
    } catch (error) {
      firstFailure = firstFailure ?? error;
      log.push(
        `Clip ${index + 1}/${source.clips.length} failed after ${Date.now() - started}ms: `
        + (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  });

  if (firstFailure) {
    const detail = firstFailure instanceof EdgeTtsError
      ? await describeVoiceFailure(config.voice, proxyUrl, firstFailure)
      : (firstFailure instanceof Error ? firstFailure.message : String(firstFailure));
    const failure = new NodeValidationError(`Edge TTS synthesis failed: ${detail}`);
    (failure as Error & { logs?: string[] }).logs = log.logs;
    throw failure;
  }

  log.push(`All ${completedClips} clip(s) synthesized; writing assets to ${outputDir}.`);

  const warnings: string[] = [];
  const parts: Buffer[] = [];
  const entries = [];
  const timeline: ClipTimeline[] = [];
  let measuredClips = 0;

  for (let index = 0; index < source.clips.length; index += 1) {
    const clip = source.clips[index];
    const result = synthesized[index]!;
    const file = clipFileName(index);
    await fs.writeFile(path.join(outputDir, file), result.audio);

    const startSeconds = parts.reduce((total, part) => total + part.length, 0) * 8 / 48_000;
    parts.push(result.audio);

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
      boundaries: result.boundaries,
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
      words: result.boundaries.map((boundary: WordBoundary) => ({
        text: boundary.text,
        offsetSeconds: Number(boundary.offsetSeconds.toFixed(3)),
        durationSeconds: Number(boundary.durationSeconds.toFixed(3)),
      })),
    });
  }

  const combined = Buffer.concat(parts);
  if (config.writeCombined) {
    await fs.writeFile(path.join(outputDir, 'narration.mp3'), combined);
    log.push(`Wrote narration.mp3 (${(combined.length / 1024).toFixed(0)} KB).`);
  }

  const totalSeconds = combined.length * 8 / 48_000;
  const finalDocument = config.applyTiming && source.document
    ? applyTimingToDocument(source.document, timeline)
    : source.document;
  const manifest = {
    slug: source.slug,
    assetDir: source.assetDir,
    chapterFiles: source.chapterFiles,
    ...(finalDocument ? { document: finalDocument } : {}),
    voice: config.voice,
    rate: config.rate,
    volume: config.volume,
    pitch: config.pitch,
    format: 'audio-24khz-48kbitrate-mono-mp3',
    clipCount: entries.length,
    totalSeconds: Number(totalSeconds.toFixed(3)),
    combinedFile: config.writeCombined ? 'narration.mp3' : null,
    combinedUrl: config.writeCombined
      ? `/api/workflows/${workflowId}/assets/${assetId}/narration.mp3`
      : null,
    /** Where the clip MP3s always exist. */
    audioDir: outputDir,
    /** Measured shot boundaries, the timing source of truth for the render. */
    timeline,
    clips: entries,
  };

  if (config.applyTiming && source.assetDir && source.chapterFiles.length) {
    const patched = await applyTimingToRunAssets(source.assetDir, source.chapterFiles, timeline);
    log.push(
      `Applied measured shot timing to ${patched} clip(s) across ${source.chapterFiles.length} chapter file(s).`,
    );
  }

  log.push(`Resolved shot timing from anchors for ${measuredClips}/${entries.length} clip(s).`);

  await fs.writeFile(
    path.join(outputDir, 'narration.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  log.push(
    `Synthesized ${entries.length} clip(s), ${totalSeconds.toFixed(1)}s total.`,
    `Assets written to ${outputDir}.`,
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
  type: 'edge-tts-narration',
  capabilities: ['tts', 'filesystem'],
  execute,
};
