import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { WordBoundary } from './timing.ts';

const execFileAsync = promisify(execFile);

/** Timestamped streaming TTS. Returns SSE with audio chunks and word alignments. */
export const FISH_AUDIO_TTS_URL = 'https://api.fish.audio/v1/tts/stream/with-timestamp';
export const FISH_AUDIO_TTS_MODEL = 's2.1-pro-free';
/** Official Fish Audio voice model ID. Keep this fixed for a consistent narrator. */
export const FISH_AUDIO_REFERENCE_ID = '79d0bd3e4e5444b18f7b6d89b5927bf1';
export const FISH_AUDIO_TTS_FORMAT = 'mp3';
export const FISH_AUDIO_SAMPLE_RATE = 44_100;
export const FISH_AUDIO_MP3_BITRATE = 128;

/**
 * Stay under provider text limits without chopping a typical explainer into
 * multiple independent generations. Two generations stitched together drift in
 * speed and timbre — that is the "slowed-down voice change" in preview.
 */
export const MAX_CHUNK_CHARS = 8000;

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 524, 529]);

export interface SpeechResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export type SpeechFetcher = (
  url: string,
  init: Record<string, unknown>,
) => Promise<SpeechResponseLike>;

export interface SynthesisOptions {
  text: string;
  /** Defaults to FISH_API_KEY. */
  apiKey?: string;
  /** HTTP(S) proxy URL. SOCKS proxies are not supported by undici. */
  proxyUrl?: string;
  /** Per-request budget. Defaults to 120000 ms. */
  timeoutMs?: number;
  /** Transient-failure attempts per chunk. Defaults to 3. */
  maxAttempts?: number;
  /** Test seam; production uses undici fetch. */
  fetcher?: SpeechFetcher;
}

export interface SynthesisResult {
  audio: Buffer;
  /** Parsed from MPEG audio frames rather than inferred from file size. */
  durationSeconds: number;
  /** Number of successful provider requests used for this narration. */
  requests: number;
  generationIds: string[];
  /** Word/segment alignments from the timestamp stream. Empty if Fish sent none. */
  boundaries: WordBoundary[];
}

export class FishAudioTtsError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, options: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'FishAudioTtsError';
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function resolveFishAudioApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.FISH_API_KEY ?? '').trim();
}

/** Resolve an explicit TTS proxy first, then the standard HTTP(S) proxy vars. */
export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.FISH_AUDIO_TTS_DISABLE_PROXY === '1') return undefined;
  const candidates = [
    env.FISH_AUDIO_TTS_PROXY,
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

/** Split at sentence boundaries so retries stay small and seams land at pauses. */
export function splitTextForSynthesis(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [normalized];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let index = 0; index < piece.length; index += maxChars) {
        chunks.push(piece.slice(index, index + maxChars));
      }
      continue;
    }
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= maxChars) current = `${current} ${piece}`;
    else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function speechRequestBody(input: string): {
  text: string;
  reference_id: string;
  format: string;
  sample_rate: number;
  mp3_bitrate: number;
  latency: 'normal';
  prosody: { speed: number };
} {
  return {
    text: input,
    reference_id: FISH_AUDIO_REFERENCE_ID,
    format: FISH_AUDIO_TTS_FORMAT,
    // Pin 44.1 kHz so a later chunk cannot arrive as 32 kHz and play back slow.
    sample_rate: FISH_AUDIO_SAMPLE_RATE,
    mp3_bitrate: FISH_AUDIO_MP3_BITRATE,
    // Narration can wait for a stable take; `balanced`/`low` split text earlier.
    latency: 'normal',
    // Lock speaking rate. Omitting this lets S2 drift slower on long chunks,
    // which the model then follows with a lower pitch / different timbre.
    prosody: { speed: 1 },
  };
}

/** Pull JSON payloads out of standard SSE `data:` frames. */
export function parseSseDataLines(raw: string): string[] {
  const payloads: string[] = [];
  let dataLines: string[] = [];
  const flush = () => {
    if (!dataLines.length) return;
    payloads.push(dataLines.join('\n'));
    dataLines = [];
  };
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
      continue;
    }
    if (line === '') flush();
  }
  flush();
  return payloads;
}

function roundSeconds(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * Latest-wins alignment per `chunk_seq`, audio concatenated in event order.
 * Fish Audio replaces snapshots for the same chunk; collecting every snapshot
 * would duplicate words.
 */
export function collectTimestampStream(raw: string): { audio: Buffer; boundaries: WordBoundary[] } {
  const audioParts: Buffer[] = [];
  const byChunk = new Map<number, { offset: number; segments: Array<{ text: string; start: number; end: number }> }>();

  for (const payload of parseSseDataLines(raw)) {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') continue;
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch {
      throw new FishAudioTtsError('Fish Audio timestamp stream returned non-JSON SSE data.');
    }
    if (!event || typeof event !== 'object') continue;

    if (typeof event.audio_base64 === 'string' && event.audio_base64) {
      audioParts.push(Buffer.from(event.audio_base64, 'base64'));
    }

    const alignment = event.alignment;
    if (!alignment || typeof alignment !== 'object' || !Array.isArray(alignment.segments)) continue;
    if (!Number.isInteger(event.chunk_seq)) continue;

    const segments = alignment.segments
      .map((segment: any) => ({
        text: String(segment?.text ?? '').trim(),
        start: Number(segment?.start),
        end: Number(segment?.end),
      }))
      .filter((segment: { text: string; start: number; end: number }) => (
        Boolean(segment.text)
        && Number.isFinite(segment.start)
        && Number.isFinite(segment.end)
      ));
    byChunk.set(Number(event.chunk_seq), {
      offset: Number(event.chunk_audio_offset_sec) || 0,
      segments,
    });
  }

  const boundaries: WordBoundary[] = [];
  for (const seq of [...byChunk.keys()].sort((left, right) => left - right)) {
    const chunk = byChunk.get(seq);
    if (!chunk) continue;
    for (const segment of chunk.segments) {
      const start = chunk.offset + segment.start;
      const end = chunk.offset + segment.end;
      boundaries.push({
        text: segment.text,
        offsetSeconds: roundSeconds(Math.max(0, start)),
        durationSeconds: roundSeconds(Math.max(0, end - start)),
      });
    }
  }

  return {
    audio: stripLeadingId3(Buffer.concat(audioParts)),
    boundaries,
  };
}

/** Stretch/compress word times so they cover the measured MP3, not the alignment clock. */
export function scaleWordBoundaries(boundaries: WordBoundary[], audioSeconds: number): WordBoundary[] {
  if (!boundaries.length || !(audioSeconds > 0)) return boundaries;
  const last = boundaries[boundaries.length - 1];
  const alignedEnd = last.offsetSeconds + last.durationSeconds;
  if (!(alignedEnd > 0)) return boundaries;
  const ratio = audioSeconds / alignedEnd;
  if (Math.abs(ratio - 1) < 0.01) return boundaries;
  return boundaries.map((boundary) => ({
    text: boundary.text,
    offsetSeconds: roundSeconds(boundary.offsetSeconds * ratio),
    durationSeconds: roundSeconds(boundary.durationSeconds * ratio),
  }));
}

/**
 * Independently encoded MP3s cannot be byte-concatenated: each file has encoder
 * delay and a bit reservoir, and a decoder that keeps the first file's clock
 * will play the next file slow or fast (pitch included). Decode to PCM, concat,
 * then re-encode. Fall back to a raw concat when ffmpeg is missing.
 */
export async function stitchMp3Parts(parts: Buffer[]): Promise<Buffer> {
  const clean = parts.map(stripLeadingId3).filter((part) => part.length > 0);
  if (!clean.length) return Buffer.alloc(0);
  if (clean.length === 1) return clean[0];

  const dir = await mkdtemp(path.join(tmpdir(), 'fish-tts-'));
  try {
    const inputs = await Promise.all(clean.map(async (part, index) => {
      const file = path.join(dir, `${index}.mp3`);
      await writeFile(file, part);
      return file;
    }));
    const output = path.join(dir, 'stitched.mp3');
    const labels = inputs.map((_, index) => `[${index}:a]`).join('');
    await execFileAsync('ffmpeg', [
      '-y',
      ...inputs.flatMap((file) => ['-i', file]),
      '-filter_complex', `${labels}concat=n=${inputs.length}:v=0:a=1[a]`,
      '-map', '[a]',
      '-ar', String(FISH_AUDIO_SAMPLE_RATE),
      '-ac', '1',
      '-c:a', 'libmp3lame',
      '-b:a', `${FISH_AUDIO_MP3_BITRATE}k`,
      output,
    ], { timeout: 120_000 });
    const stitched = await readFile(output);
    if (mp3DurationSeconds(stitched) <= 0) {
      throw new FishAudioTtsError('ffmpeg produced an unreadable stitched MP3.');
    }
    return stitched;
  } catch {
    return Buffer.concat(clean);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface Mp3Frame {
  byteLength: number;
  durationSeconds: number;
}

const MPEG1_BITRATES: Record<number, number[]> = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
};

const MPEG2_BITRATES: Record<number, number[]> = {
  1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
};

function mp3Frame(buffer: Buffer, offset: number): Mp3Frame | null {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  const header = buffer.readUInt32BE(offset) >>> 0;
  if (((header >>> 21) & 0x7ff) !== 0x7ff) return null;

  const versionBits = (header >>> 19) & 0x3;
  const layerBits = (header >>> 17) & 0x3;
  const bitrateIndex = (header >>> 12) & 0xf;
  const sampleRateIndex = (header >>> 10) & 0x3;
  const padding = (header >>> 9) & 0x1;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  // The bitrate tables are keyed by the encoded layer bits: 01 -> III,
  // 10 -> II, 11 -> I.
  const layer = layerBits;
  const mpeg1 = versionBits === 3;
  const bitrateKbps = (mpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[layer]?.[bitrateIndex] ?? 0;
  if (!bitrateKbps) return null;

  const divisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex] / divisor;
  const bitrate = bitrateKbps * 1000;

  let samplesPerFrame: number;
  let byteLength: number;
  if (layer === 3) {
    samplesPerFrame = 384;
    byteLength = Math.floor((12 * bitrate / sampleRate + padding) * 4);
  } else if (layer === 2) {
    samplesPerFrame = 1152;
    byteLength = Math.floor(144 * bitrate / sampleRate + padding);
  } else {
    samplesPerFrame = mpeg1 ? 1152 : 576;
    byteLength = Math.floor((mpeg1 ? 144 : 72) * bitrate / sampleRate + padding);
  }
  if (byteLength < 4) return null;
  return { byteLength, durationSeconds: samplesPerFrame / sampleRate };
}

function id3TagBytes(buffer: Buffer, offset: number): number {
  if (offset + 10 > buffer.length || buffer.toString('ascii', offset, offset + 3) !== 'ID3') return 0;
  const sizeBytes = buffer.subarray(offset + 6, offset + 10);
  if ([...sizeBytes].some((value) => value > 0x7f)) return 0;
  const payloadBytes = (
    (sizeBytes[0] << 21)
    | (sizeBytes[1] << 14)
    | (sizeBytes[2] << 7)
    | sizeBytes[3]
  );
  const footerBytes = (buffer[offset + 5] & 0x10) ? 10 : 0;
  return Math.min(buffer.length - offset, 10 + payloadBytes + footerBytes);
}

/** Remove metadata before stitching independently encoded MP3 responses. */
export function stripLeadingId3(audio: Buffer): Buffer {
  const bytes = id3TagBytes(audio, 0);
  return bytes ? audio.subarray(bytes) : audio;
}

/** Sum MPEG frame sample counts, which also works for variable-bitrate MP3. */
export function mp3DurationSeconds(audio: Buffer): number {
  let offset = 0;
  let frames = 0;
  let seconds = 0;

  while (offset + 4 <= audio.length) {
    const tagBytes = id3TagBytes(audio, offset);
    if (tagBytes) {
      offset += tagBytes;
      continue;
    }

    const frame = mp3Frame(audio, offset);
    if (!frame) {
      offset += 1;
      continue;
    }
    if (offset + frame.byteLength > audio.length) break;
    frames += 1;
    seconds += frame.durationSeconds;
    offset += frame.byteLength;
  }

  return frames ? seconds : 0;
}

/**
 * Split one provider response at MPEG frame boundaries. This keeps every clip
 * independently playable while preserving the single provider generation (and
 * therefore the same sampled voice) across the whole narration.
 */
export function splitMp3ByDurations(audio: Buffer, targetDurations: number[]): Buffer[] {
  const clean = stripLeadingId3(audio);
  const frames: Buffer[] = [];
  const frameDurations: number[] = [];
  let offset = 0;
  while (offset + 4 <= clean.length) {
    const frame = mp3Frame(clean, offset);
    if (!frame || offset + frame.byteLength > clean.length) {
      offset += 1;
      continue;
    }
    frames.push(clean.subarray(offset, offset + frame.byteLength));
    frameDurations.push(frame.durationSeconds);
    offset += frame.byteLength;
  }
  if (!frames.length) throw new FishAudioTtsError('Could not split the provider MP3 into MPEG frames.');

  const weights = targetDurations.map((value) => Math.max(0.001, Number(value) || 0));
  if (!weights.length) return [];
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const cumulativeAudio = [0];
  for (const duration of frameDurations) {
    cumulativeAudio.push(cumulativeAudio[cumulativeAudio.length - 1] + duration);
  }
  const totalAudio = cumulativeAudio[cumulativeAudio.length - 1];
  const output: Buffer[] = [];
  let frameIndex = 0;
  let weightCursor = 0;

  for (let index = 0; index < weights.length; index += 1) {
    const isLast = index === weights.length - 1;
    const target = totalAudio * ((weightCursor + weights[index]) / totalWeight);
    const remainingParts = weights.length - index - 1;
    let end = frameIndex + 1;
    while (!isLast && end < frames.length - remainingParts && cumulativeAudio[end] < target) {
      end += 1;
    }
    if (isLast) end = frames.length;
    const part = Buffer.concat(frames.slice(frameIndex, end));
    if (!part.length) throw new FishAudioTtsError('Provider MP3 split produced an empty narration clip.');
    output.push(part);
    frameIndex = end;
    weightCursor += weights[index];
  }
  return output;
}

function retryAfterMs(value: string | null): number | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(60_000, Math.max(0, timestamp - Date.now()));
}

async function responseError(response: SpeechResponseLike): Promise<FishAudioTtsError> {
  const raw = (await response.text()).trim();
  let detail = raw.slice(0, 1000) || 'empty error response';
  try {
    const payload = JSON.parse(raw);
    const message = payload?.error?.message ?? payload?.error ?? payload?.message;
    if (typeof message === 'string' && message.trim()) detail = message.trim();
  } catch {
    // Keep the bounded text response.
  }
  return new FishAudioTtsError(`Fish Audio TTS HTTP ${response.status}: ${detail}`, {
    status: response.status,
    retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
  });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof FishAudioTtsError && error.status !== undefined) {
    return RETRYABLE_STATUSES.has(error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultFetcher(url: string, init: Record<string, unknown>): Promise<SpeechResponseLike> {
  return undiciFetch(url, init as any) as unknown as SpeechResponseLike;
}

async function synthesizeChunk(options: {
  text: string;
  apiKey: string;
  dispatcher?: Dispatcher;
  timeoutMs: number;
  fetcher: SpeechFetcher;
}): Promise<{ audio: Buffer; generationId: string | null; boundaries: WordBoundary[] }> {
  const init: Record<string, unknown> = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      model: FISH_AUDIO_TTS_MODEL,
    },
    body: JSON.stringify(speechRequestBody(options.text)),
    signal: AbortSignal.timeout(options.timeoutMs),
  };
  if (options.dispatcher) init.dispatcher = options.dispatcher;

  const response = await options.fetcher(FISH_AUDIO_TTS_URL, init);
  if (!response.ok) throw await responseError(response);

  const raw = await response.text();
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  const looksLikeSse = contentType.includes('text/event-stream') || /^\s*(?:event:|data:)/m.test(raw);
  if (!looksLikeSse) {
    throw new FishAudioTtsError(
      `Fish Audio TTS returned ${contentType || 'no content type'} instead of a timestamp SSE stream.`,
      { status: response.status },
    );
  }

  const collected = collectTimestampStream(raw);
  if (!collected.audio.length) {
    throw new FishAudioTtsError('Fish Audio timestamp stream returned no audio.');
  }
  if (mp3DurationSeconds(collected.audio) <= 0) {
    throw new FishAudioTtsError('Fish Audio timestamp stream returned audio that is not a valid MP3 stream.');
  }
  return {
    audio: collected.audio,
    generationId: response.headers.get('x-generation-id'),
    boundaries: collected.boundaries,
  };
}

/** Synthesize one narration string into a single stitched MP3 buffer. */
export async function synthesizeSpeech(options: SynthesisOptions): Promise<SynthesisResult> {
  const apiKey = String(options.apiKey ?? resolveFishAudioApiKey()).trim();
  if (!apiKey) {
    throw new FishAudioTtsError('FISH_API_KEY is required for Fish Audio TTS.');
  }

  const chunks = splitTextForSynthesis(options.text);
  if (!chunks.length) throw new FishAudioTtsError('Fish Audio TTS received empty narration text.');

  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(options.timeoutMs) || 120_000));
  const maxAttempts = Math.max(1, Math.min(6, Number(options.maxAttempts) || 3));
  const fetcher = options.fetcher ?? defaultFetcher;
  const dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : undefined;

  const parts: Buffer[] = [];
  const generationIds: string[] = [];
  const boundaries: WordBoundary[] = [];
  let audioCursor = 0;
  try {
    for (const chunk of chunks) {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await synthesizeChunk({
            text: chunk,
            apiKey,
            dispatcher,
            timeoutMs,
            fetcher,
          });
          const chunkSeconds = mp3DurationSeconds(result.audio);
          parts.push(result.audio);
          for (const boundary of result.boundaries) {
            boundaries.push({
              text: boundary.text,
              offsetSeconds: roundSeconds(boundary.offsetSeconds + audioCursor),
              durationSeconds: boundary.durationSeconds,
            });
          }
          audioCursor += chunkSeconds;
          if (result.generationId) generationIds.push(result.generationId);
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= maxAttempts || !isRetryable(error)) break;
          const delay = error instanceof FishAudioTtsError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : Math.min(4_000, 500 * 2 ** (attempt - 1));
          await wait(delay);
        }
      }
      if (lastError) throw lastError;
    }
  } finally {
    await dispatcher?.close().catch(() => { /* best effort */ });
  }

  const audio = await stitchMp3Parts(parts);
  const durationSeconds = mp3DurationSeconds(audio);
  if (!durationSeconds) throw new FishAudioTtsError('Could not determine Fish Audio MP3 duration.');
  return {
    audio,
    durationSeconds,
    requests: chunks.length,
    generationIds,
    boundaries: scaleWordBoundaries(boundaries, durationSeconds),
  };
}
