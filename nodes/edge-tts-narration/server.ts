import fs from 'node:fs/promises';
import path from 'node:path';
import {
  NodeInputError,
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { assertSafeId } from '../../server/paths.ts';
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

interface NarrationClip {
  index: number;
  speech: string;
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
  const config: EdgeTtsNarrationConfig = {
    ...DEFAULT_EDGE_TTS_NARRATION_CONFIG,
    voice: String(raw.voice ?? DEFAULT_EDGE_TTS_NARRATION_CONFIG.voice).trim()
      || DEFAULT_EDGE_TTS_NARRATION_CONFIG.voice,
    writeCombined: raw.writeCombined === undefined
      ? DEFAULT_EDGE_TTS_NARRATION_CONFIG.writeCombined
      : Boolean(raw.writeCombined),
    writeToProject: raw.writeToProject === undefined
      ? DEFAULT_EDGE_TTS_NARRATION_CONFIG.writeToProject
      : Boolean(raw.writeToProject),
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

/**
 * Accept either the project manifest from `app-video-project` or a raw
 * storyboard document, so this node can also sit directly after generation.
 */
export function readNarrationSource(raw: string): { clips: NarrationClip[]; projectDir: string | null; slug: string | null } {
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
    plannedSeconds: Number(clip?.plannedSeconds) || clipSeconds(clip),
  }));

  const missing = clips.filter((clip) => !clip.speech).map((clip) => clip.index + 1);
  if (missing.length) {
    throw new NodeValidationError(`Clips ${missing.join(', ')} have no speech to narrate.`);
  }

  return {
    clips,
    projectDir: typeof parsed.projectDir === 'string' && parsed.projectDir ? parsed.projectDir : null,
    slug: typeof parsed.slug === 'string' && parsed.slug ? parsed.slug : null,
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

async function execute({ node, input, assetsDir, workflowId }: NodePluginContext): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const values = Object.values(input).map((value) => String(value ?? '').trim()).filter(Boolean);
  if (values.length !== 1) {
    throw new NodeInputError(
      `Edge TTS Narration requires exactly one non-empty upstream node; received ${values.length}.`,
    );
  }
  const source = readNarrationSource(values[0]);
  const proxyUrl = resolveProxyUrl();

  const assetId = assertSafeId(node.id);
  const outputDir = path.join(assetsDir, assetId);
  await fs.mkdir(outputDir, { recursive: true });

  const logs: string[] = [
    `Synthesizing ${source.clips.length} clip(s) with ${config.voice} `
    + `(rate ${config.rate}, volume ${config.volume}, pitch ${config.pitch}).`,
  ];
  if (proxyUrl) logs.push(`Routing Edge TTS through proxy ${proxyUrl}.`);

  let firstFailure: unknown;
  const synthesized = await mapWithConcurrency(source.clips, config.concurrency, async (clip) => {
    try {
      return await synthesizeSpeech({
        text: clip.speech,
        voice: config.voice,
        rate: config.rate,
        volume: config.volume,
        pitch: config.pitch,
        proxyUrl,
        timeoutMs: config.timeoutMs,
      });
    } catch (error) {
      firstFailure = firstFailure ?? error;
      return null;
    }
  });

  if (firstFailure) {
    const detail = firstFailure instanceof EdgeTtsError
      ? await describeVoiceFailure(config.voice, proxyUrl, firstFailure)
      : (firstFailure instanceof Error ? firstFailure.message : String(firstFailure));
    throw new NodeValidationError(`Edge TTS synthesis failed: ${detail}`);
  }

  const warnings: string[] = [];
  const parts: Buffer[] = [];
  const entries = [];

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

    entries.push({
      index,
      file,
      url: `/api/workflows/${workflowId}/assets/${assetId}/${file}`,
      speech: clip.speech,
      bytes: result.audio.length,
      durationSeconds: Number(result.durationSeconds.toFixed(3)),
      plannedSeconds: clip.plannedSeconds ? Number(clip.plannedSeconds.toFixed(3)) : null,
      startSeconds: Number(startSeconds.toFixed(3)),
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
    logs.push(`Wrote narration.mp3 (${(combined.length / 1024).toFixed(0)} KB).`);
  }

  const totalSeconds = combined.length * 8 / 48_000;
  const manifest = {
    slug: source.slug,
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
    projectVoiceDir: null as string | null,
    clips: entries,
  };

  if (config.writeToProject && source.projectDir) {
    const voiceDir = path.join(source.projectDir, 'voice');
    await fs.mkdir(voiceDir, { recursive: true });
    for (const entry of entries) {
      await fs.copyFile(path.join(outputDir, entry.file), path.join(voiceDir, entry.file));
    }
    if (config.writeCombined) {
      await fs.copyFile(path.join(outputDir, 'narration.mp3'), path.join(voiceDir, 'narration.mp3'));
    }
    manifest.projectVoiceDir = voiceDir;
    logs.push(`Copied clip audio into ${voiceDir}.`);
  }

  await fs.writeFile(
    path.join(outputDir, 'narration.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  logs.push(
    `Synthesized ${entries.length} clip(s), ${totalSeconds.toFixed(1)}s total.`,
    `Assets written to ${outputDir}.`,
  );

  if (warnings.length) {
    return {
      output: JSON.stringify(manifest, null, 2),
      logs: [...logs, ...warnings.map((warning) => `[Timing] ${warning}`)],
      status: 'warning',
      error: `Narration is longer than the storyboard plan for ${warnings.length} clip(s).`,
    };
  }

  return { output: JSON.stringify(manifest, null, 2), logs };
}

export default {
  type: 'edge-tts-narration',
  capabilities: ['tts', 'filesystem'],
  execute,
};
