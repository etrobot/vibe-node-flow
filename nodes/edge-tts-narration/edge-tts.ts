/**
 * Node.js port of the Microsoft Edge "Read Aloud" speech protocol — the same
 * service the Python `edge-tts` package talks to. It needs no API key, no
 * Python runtime, and no extra dependency: the WebSocket client comes from
 * undici, which the server already ships.
 *
 * Protocol summary:
 *   1. Open a WSS connection carrying a Sec-MS-GEC token derived from the
 *      current 5-minute window and a fixed trusted client token.
 *   2. Send a `speech.config` text frame declaring the audio output format.
 *   3. Send an `ssml` text frame with the prosody-wrapped narration.
 *   4. Receive binary `audio` frames (2-byte big-endian header length, ASCII
 *      header, then MP3 bytes) plus `audio.metadata` word-boundary frames.
 *   5. A `turn.end` text frame closes the turn.
 */
import crypto from 'node:crypto';
import { ProxyAgent, WebSocket, type Dispatcher } from 'undici';
import { DEFAULT_VOICE } from './config.ts';

const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
export const VOICE_LIST_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

/**
 * Microsoft rejects the handshake with 403 once this version string falls too
 * far behind the shipping Edge build. Bump both constants together when
 * synthesis starts failing with `handshake rejected`.
 */
export const CHROMIUM_FULL_VERSION = '143.0.3650.75';
export const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

// DEFAULT_VOICE is now defined in config.ts to avoid pulling undici into the browser bundle.

/** Constant-bitrate MP3 keeps duration derivable from byte length alone. */
export const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const MP3_BITRATE_BPS = 48_000;
const TICKS_PER_SECOND = 10_000_000;

const WIN_EPOCH_SECONDS = 11_644_473_600n;
const GEC_WINDOW_SECONDS = 300n;

/** Long narration is rejected by the service; split before it gets there. */
export const MAX_CHUNK_CHARS = 1800;

const BASE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
    + `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
};

const WSS_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
};

export interface WordBoundary {
  /** Seconds from the start of the returned audio. */
  offsetSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface SynthesisOptions {
  text: string;
  voice?: string;
  /** Prosody rate, e.g. `+0%`, `-10%`. */
  rate?: string;
  /** Prosody volume, e.g. `+0%`. */
  volume?: string;
  /** Prosody pitch, e.g. `+0Hz`, `-20Hz`. */
  pitch?: string;
  /** HTTP(S) proxy URL. SOCKS proxies are not supported by undici. */
  proxyUrl?: string;
  /** Per-request budget. Defaults to 60000 ms. */
  timeoutMs?: number;
  /** Transient-failure retries per chunk. Defaults to 3. */
  maxAttempts?: number;
}

export interface SynthesisResult {
  audio: Buffer;
  boundaries: WordBoundary[];
  /** Derived from the constant bitrate, so it needs no ffprobe. */
  durationSeconds: number;
  /** Number of service requests used (a long text is split into chunks). */
  requests: number;
}

export class EdgeTtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EdgeTtsError';
  }
}

/**
 * Sec-MS-GEC is the SHA-256 of the current 5-minute window expressed in
 * Windows file-time ticks, concatenated with the trusted client token.
 * BigInt keeps the 18-digit tick count exact.
 */
export function generateSecMsGec(nowMs: number = Date.now()): string {
  const seconds = BigInt(Math.floor(nowMs / 1000)) + WIN_EPOCH_SECONDS;
  const windowStart = seconds - (seconds % GEC_WINDOW_SECONDS);
  const ticks = windowStart * BigInt(TICKS_PER_SECOND);
  return crypto.createHash('sha256')
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase();
}

function connectId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** XML-escape narration and drop control characters the service rejects. */
export function escapeSsmlText(value: string): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSigned(value: unknown, unit: string, fallback: string): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const match = /^([+-]?)(\d+(?:\.\d+)?)\s*(%|hz)?$/i.exec(text);
  if (!match) throw new EdgeTtsError(`Invalid prosody value ${JSON.stringify(text)}; expected e.g. "${fallback}".`);
  const sign = match[1] === '-' ? '-' : '+';
  return `${sign}${match[2]}${unit}`;
}

export function normalizeRate(value: unknown): string {
  return normalizeSigned(value, '%', '+0%');
}

export function normalizeVolume(value: unknown): string {
  return normalizeSigned(value, '%', '+0%');
}

export function normalizePitch(value: unknown): string {
  return normalizeSigned(value, 'Hz', '+0Hz');
}

/** Microsoft voice short names look like `en-US-EmmaMultilingualNeural`. */
export function isVoiceShortName(value: unknown): boolean {
  return /^[a-z]{2,3}(-[A-Za-z]{2,8})+-[A-Za-z0-9]+Neural$/.test(String(value ?? '').trim());
}

export function voiceLocale(voice: string): string {
  const parts = String(voice ?? '').split('-');
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : '';
}

export function buildSsml(options: {
  text: string;
  voice: string;
  rate: string;
  volume: string;
  pitch: string;
}): string {
  const lang = voiceLocale(options.voice) || 'en-US';
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>`
    + `<voice name='${options.voice}'>`
    + `<prosody pitch='${options.pitch}' rate='${options.rate}' volume='${options.volume}'>`
    + escapeSsmlText(options.text)
    + '</prosody></voice></speak>';
}

/**
 * Split on sentence boundaries so each request stays under the service limit
 * and chunk seams land in natural pauses rather than mid-word.
 */
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
      if (current) { chunks.push(current); current = ''; }
      for (let index = 0; index < piece.length; index += maxChars) {
        chunks.push(piece.slice(index, index + maxChars));
      }
      continue;
    }
    if (!current) current = piece;
    else if (current.length + 1 + piece.length <= maxChars) current = `${current} ${piece}`;
    else { chunks.push(current); current = piece; }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** The stream is constant bitrate, so bytes map directly to seconds. */
export function estimateMp3Seconds(byteLength: number): number {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return 0;
  return (byteLength * 8) / MP3_BITRATE_BPS;
}

/** Parse the `Key:Value\r\n...\r\n\r\nbody` envelope used by every frame. */
export function parseMessage(raw: string): { headers: Record<string, string>; body: string } {
  const separator = raw.indexOf('\r\n\r\n');
  const headerBlock = separator === -1 ? raw : raw.slice(0, separator);
  const body = separator === -1 ? '' : raw.slice(separator + 4);
  const headers: Record<string, string> = {};
  for (const line of headerBlock.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

/** Strip the binary frame envelope and return the raw MP3 bytes. */
export function parseAudioFrame(frame: Buffer): { path: string; audio: Buffer } {
  if (frame.length < 2) throw new EdgeTtsError('Edge TTS returned a truncated binary frame.');
  const headerLength = frame.readUInt16BE(0);
  if (headerLength + 2 > frame.length) {
    throw new EdgeTtsError('Edge TTS returned a binary frame with an invalid header length.');
  }
  const header = frame.subarray(2, 2 + headerLength).toString('utf8');
  return {
    path: parseMessage(header).headers.Path || '',
    audio: frame.subarray(2 + headerLength),
  };
}

/** Convert one `audio.metadata` payload into seconds-based word boundaries. */
export function parseBoundaries(body: string): WordBoundary[] {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed?.Metadata) ? parsed.Metadata : [];
  const boundaries: WordBoundary[] = [];
  for (const entry of entries) {
    if (entry?.Type !== 'WordBoundary') continue;
    const offset = Number(entry?.Data?.Offset);
    const duration = Number(entry?.Data?.Duration);
    const text = String(entry?.Data?.text?.Text ?? '');
    if (!Number.isFinite(offset) || !Number.isFinite(duration) || !text) continue;
    boundaries.push({
      offsetSeconds: offset / TICKS_PER_SECOND,
      durationSeconds: duration / TICKS_PER_SECOND,
      text,
    });
  }
  return boundaries;
}

function dateHeader(): string {
  return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

function speechConfigFrame(): string {
  return `X-Timestamp:${dateHeader()}\r\n`
    + 'Content-Type:application/json; charset=utf-8\r\n'
    + 'Path:speech.config\r\n\r\n'
    + JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    });
}

function ssmlFrame(requestId: string, ssml: string): string {
  return `X-RequestId:${requestId}\r\n`
    + 'Content-Type:application/ssml+xml\r\n'
    // The trailing Z on an already-formatted date mirrors the Edge client.
    + `X-Timestamp:${dateHeader()}Z\r\n`
    + 'Path:ssml\r\n\r\n'
    + ssml;
}

function socketUrl(): string {
  return `${WSS_URL}&ConnectionId=${connectId()}`
    + `&Sec-MS-GEC=${generateSecMsGec()}`
    + `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
}

function requestHeaders(): Record<string, string> {
  return { ...WSS_HEADERS, Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};` };
}

function closeReason(code: number): string {
  if (code === 1006) {
    return 'handshake rejected by the service. Update CHROMIUM_FULL_VERSION in nodes/edge-tts-narration/edge-tts.ts, '
      + 'or check the network path to speech.platform.bing.com.';
  }
  return `connection closed with code ${code}`;
}

function synthesizeChunk(
  ssml: string,
  dispatcher: Dispatcher | undefined,
  timeoutMs: number,
): Promise<{ audio: Buffer; boundaries: WordBoundary[] }> {
  return new Promise((resolve, reject) => {
    const options: Record<string, unknown> = { headers: requestHeaders() };
    if (dispatcher) options.dispatcher = dispatcher;

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl(), options as any);
    } catch (error) {
      reject(new EdgeTtsError(`Edge TTS could not open a socket: ${(error as Error).message}`));
      return;
    }
    socket.binaryType = 'arraybuffer';

    const parts: Buffer[] = [];
    const boundaries: WordBoundary[] = [];
    let settled = false;
    let turnEnded = false;

    const timer = setTimeout(
      () => settle(new EdgeTtsError(`Edge TTS timed out after ${timeoutMs} ms.`)),
      timeoutMs,
    );

    function settle(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closing */ }
      if (error) reject(error);
      else resolve({ audio: Buffer.concat(parts), boundaries });
    }

    socket.addEventListener('open', () => {
      try {
        socket.send(speechConfigFrame());
        socket.send(ssmlFrame(connectId(), ssml));
      } catch (error) {
        settle(new EdgeTtsError(`Edge TTS request failed: ${(error as Error).message}`));
      }
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      try {
        if (typeof event.data === 'string') {
          const { headers, body } = parseMessage(event.data);
          if (headers.Path === 'audio.metadata') boundaries.push(...parseBoundaries(body));
          else if (headers.Path === 'turn.end') { turnEnded = true; settle(); }
          return;
        }
        const frame = Buffer.from(event.data as ArrayBuffer);
        const { path, audio } = parseAudioFrame(frame);
        if (path === 'audio' && audio.length) parts.push(audio);
      } catch (error) {
        settle(error instanceof Error ? error : new EdgeTtsError(String(error)));
      }
    });

    // `error` carries no useful detail in undici; the close code does.
    socket.addEventListener('error', () => { /* handled by close */ });

    socket.addEventListener('close', (event: CloseEvent) => {
      if (turnEnded) { settle(); return; }
      settle(new EdgeTtsError(`Edge TTS ${closeReason(event.code)}`));
    });
  });
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|closed with code|handshake rejected|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolve an explicit proxy first, then the standard HTTP(S) proxy vars. */
export function resolveProxyUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.EDGE_TTS_DISABLE_PROXY === '1') return undefined;
  const candidates = [env.EDGE_TTS_PROXY, env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    // undici's ProxyAgent speaks HTTP CONNECT only; SOCKS URLs are ignored.
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return undefined;
}

/** Synthesize one narration string into a single MP3 buffer. */
export async function synthesizeSpeech(options: SynthesisOptions): Promise<SynthesisResult> {
  const voice = String(options.voice ?? DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  if (!isVoiceShortName(voice)) {
    throw new EdgeTtsError(`Invalid voice ${JSON.stringify(voice)}; expected a short name like "${DEFAULT_VOICE}".`);
  }
  const rate = normalizeRate(options.rate);
  const volume = normalizeVolume(options.volume);
  const pitch = normalizePitch(options.pitch);
  const timeoutMs = Math.max(5_000, Math.min(300_000, Number(options.timeoutMs) || 60_000));
  const maxAttempts = Math.max(1, Math.min(6, Number(options.maxAttempts) || 3));

  const chunks = splitTextForSynthesis(options.text);
  if (!chunks.length) throw new EdgeTtsError('Edge TTS received empty narration text.');

  const proxyUrl = options.proxyUrl;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  const parts: Buffer[] = [];
  const boundaries: WordBoundary[] = [];
  try {
    for (const chunk of chunks) {
      // Chunk boundaries are stitched with the constant-bitrate offset so word
      // timings stay continuous across requests.
      const offsetSeconds = estimateMp3Seconds(parts.reduce((total, part) => total + part.length, 0));
      const ssml = buildSsml({ text: chunk, voice, rate, volume, pitch });

      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await synthesizeChunk(ssml, dispatcher, timeoutMs);
          if (!result.audio.length) throw new EdgeTtsError('Edge TTS returned no audio for a narration chunk.');
          parts.push(result.audio);
          boundaries.push(...result.boundaries.map((boundary) => ({
            ...boundary,
            offsetSeconds: boundary.offsetSeconds + offsetSeconds,
          })));
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= maxAttempts || !isRetryable(error)) break;
          await wait(Math.min(4_000, 500 * 2 ** (attempt - 1)));
        }
      }
      if (lastError) throw lastError;
    }
  } finally {
    await dispatcher?.close().catch(() => { /* best effort */ });
  }

  const audio = Buffer.concat(parts);
  return {
    audio,
    boundaries,
    durationSeconds: estimateMp3Seconds(audio.length),
    requests: chunks.length,
  };
}

export interface EdgeVoice {
  shortName: string;
  gender: string;
  locale: string;
  friendlyName: string;
}

/** Fetch the catalog of installed voices; used to explain voice errors. */
export async function listVoices(proxyUrl?: string): Promise<EdgeVoice[]> {
  const url = `${VOICE_LIST_URL}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  try {
    const response = await fetch(url, {
      headers: BASE_HEADERS,
      signal: AbortSignal.timeout(30_000),
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);
    if (!response.ok) throw new EdgeTtsError(`Voice list request failed with status ${response.status}.`);
    const data: any = await response.json();
    if (!Array.isArray(data)) throw new EdgeTtsError('Voice list response was not an array.');
    return data.map((entry: any) => ({
      shortName: String(entry?.ShortName ?? ''),
      gender: String(entry?.Gender ?? ''),
      locale: String(entry?.Locale ?? ''),
      friendlyName: String(entry?.FriendlyName ?? ''),
    })).filter((voice: EdgeVoice) => Boolean(voice.shortName));
  } finally {
    await dispatcher?.close().catch(() => { /* best effort */ });
  }
}
