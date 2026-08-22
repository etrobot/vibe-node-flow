import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FISH_AUDIO_MP3_BITRATE,
  FISH_AUDIO_REFERENCE_ID,
  FISH_AUDIO_SAMPLE_RATE,
  FISH_AUDIO_TTS_MODEL,
  FISH_AUDIO_TTS_URL,
  FishAudioTtsError,
  MAX_CHUNK_CHARS,
  collectTimestampStream,
  mp3DurationSeconds,
  parseSseDataLines,
  resolveFishAudioApiKey,
  resolveProxyUrl,
  scaleWordBoundaries,
  speechRequestBody,
  splitMp3ByDurations,
  splitTextForSynthesis,
  stitchMp3Parts,
  stripLeadingId3,
  synthesizeSpeech,
  type SpeechResponseLike,
} from './fish-audio-tts.ts';

function mp3Frames(count: number): Buffer {
  const parts: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    // MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono. Padding alternates like a
    // normal encoder so both 417-byte and 418-byte frames are exercised.
    const padding = index % 3 === 2;
    const header = Buffer.from([0xff, 0xfb, padding ? 0x92 : 0x90, 0xc4]);
    const length = Math.floor(144 * 128_000 / 44_100 + (padding ? 1 : 0));
    parts.push(Buffer.concat([header, Buffer.alloc(length - header.length)]));
  }
  return Buffer.concat(parts);
}

function arrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

function timestampEvent(audio: Buffer, extra: {
  content?: string;
  chunkSeq?: number;
  offset?: number;
  segments?: Array<{ text: string; start: number; end: number }>;
  alignment?: object | null;
} = {}) {
  const segments = extra.segments ?? [{ text: 'Hello', start: 0, end: 0.4 }];
  return {
    audio_base64: audio.toString('base64'),
    content: extra.content ?? 'Hello',
    chunk_seq: extra.chunkSeq ?? 0,
    chunk_audio_offset_sec: extra.offset ?? 0,
    alignment: extra.alignment === undefined
      ? {
        audio_duration: segments[segments.length - 1]?.end ?? 0,
        segments,
      }
      : extra.alignment,
  };
}

function sseResponse(options: {
  events: unknown[];
  generationId?: string;
  status?: number;
}): SpeechResponseLike {
  const body = sseBody(options.events);
  const headers = new Map<string, string>([['content-type', 'text/event-stream']]);
  if (options.generationId) headers.set('x-generation-id', options.generationId);
  return {
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    async arrayBuffer() { return arrayBuffer(Buffer.from(body)); },
    async text() { return body; },
  };
}

function response(options: {
  status: number;
  contentType?: string;
  audio?: Buffer;
  body?: string;
  generationId?: string;
  retryAfter?: string;
}): SpeechResponseLike {
  const headers = new Map<string, string>();
  if (options.contentType) headers.set('content-type', options.contentType);
  if (options.generationId) headers.set('x-generation-id', options.generationId);
  if (options.retryAfter) headers.set('retry-after', options.retryAfter);
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    async arrayBuffer() { return arrayBuffer(options.audio ?? Buffer.alloc(0)); },
    async text() { return options.body ?? ''; },
  };
}

test('speech request fixes the Fish Audio model, voice, sample rate, latency, and speaking speed', () => {
  assert.deepEqual(speechRequestBody('Hello world'), {
    text: 'Hello world',
    reference_id: FISH_AUDIO_REFERENCE_ID,
    format: 'mp3',
    sample_rate: FISH_AUDIO_SAMPLE_RATE,
    mp3_bitrate: FISH_AUDIO_MP3_BITRATE,
    latency: 'normal',
    prosody: { speed: 1 },
  });
  assert.equal(FISH_AUDIO_TTS_MODEL, 's2.1-pro-free');
  assert.equal(FISH_AUDIO_SAMPLE_RATE, 44_100);
  assert.equal(FISH_AUDIO_TTS_URL, 'https://api.fish.audio/v1/tts/stream/with-timestamp');
});

test('a typical explainer stays in one provider request instead of being split mid-narration', () => {
  const speech = 'This workflow reads a real workflow.json. '.repeat(50);
  assert.ok(speech.length > 1800);
  assert.ok(speech.length < MAX_CHUNK_CHARS);
  assert.equal(splitTextForSynthesis(speech).length, 1);
});

test('long narration splits on sentence boundaries and short narration stays whole', () => {
  assert.deepEqual(splitTextForSynthesis('  Ship it.  Then iterate. '), ['Ship it. Then iterate.']);
  assert.deepEqual(splitTextForSynthesis(''), []);

  const sentence = `${'word '.repeat(19)}end. `;
  const chunks = splitTextForSynthesis(sentence.repeat(30), 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `chunk too long: ${chunk.length}`);
  assert.ok(chunks.every((chunk) => !chunk.startsWith(' ') && !chunk.endsWith(' ')));
  assert.deepEqual(splitTextForSynthesis('a'.repeat(450), 200).map((chunk) => chunk.length), [200, 200, 50]);
});

test('MP3 duration is parsed from MPEG frames and leading ID3 metadata is removable', () => {
  const audio = mp3Frames(148);
  const expected = 148 * 1152 / 44_100;
  assert.ok(Math.abs(mp3DurationSeconds(audio) - expected) < 0.000001);

  const id3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 1, 2, 3, 4]);
  const tagged = Buffer.concat([id3, audio]);
  assert.deepEqual(stripLeadingId3(tagged), audio);
  assert.ok(Math.abs(mp3DurationSeconds(tagged) - expected) < 0.000001);
  assert.equal(mp3DurationSeconds(Buffer.from('not mp3')), 0);
});

test('one continuous MP3 can be split into playable clip files at frame boundaries', () => {
  const audio = mp3Frames(120);
  const parts = splitMp3ByDurations(audio, [1, 2, 3]);
  assert.equal(parts.length, 3);
  assert.equal(Buffer.concat(parts).length, audio.length);
  assert.ok(parts.every((part) => mp3DurationSeconds(part) > 0));
});

test('stitching a single MP3 is a no-op and two parts stay playable', async () => {
  const first = mp3Frames(20);
  const second = mp3Frames(15);
  assert.equal(await stitchMp3Parts([first]), first);
  const stitched = await stitchMp3Parts([first, second]);
  assert.ok(mp3DurationSeconds(stitched) > 0);
  assert.ok(stitched.length > 0);
});

test('API key and proxy resolution use Fish Audio environment names', () => {
  assert.equal(resolveFishAudioApiKey({ FISH_API_KEY: ' key ' }), 'key');
  assert.equal(resolveFishAudioApiKey({}), '');
  assert.equal(resolveProxyUrl({ FISH_AUDIO_TTS_PROXY: 'http://127.0.0.1:7890' }), 'http://127.0.0.1:7890');
  assert.equal(
    resolveProxyUrl({ HTTPS_PROXY: 'http://proxy:8080', FISH_AUDIO_TTS_PROXY: 'http://explicit:1' }),
    'http://explicit:1',
  );
  assert.equal(resolveProxyUrl({ ALL_PROXY: 'socks5://127.0.0.1:7890' }), undefined);
  assert.equal(
    resolveProxyUrl({ HTTPS_PROXY: 'http://proxy:8080', FISH_AUDIO_TTS_DISABLE_PROXY: '1' }),
    undefined,
  );
});

test('timestamp SSE keeps latest alignment per chunk and concatenates audio in order', () => {
  const first = mp3Frames(4);
  const second = mp3Frames(3);
  const third = mp3Frames(2);
  const raw = sseBody([
    timestampEvent(first, {
      chunkSeq: 0,
      segments: [{ text: 'Hello', start: 0, end: 0.2 }],
    }),
    timestampEvent(second, {
      chunkSeq: 0,
      segments: [
        { text: 'Hello', start: 0, end: 0.4 },
        { text: 'world', start: 0.4, end: 0.8 },
      ],
    }),
    timestampEvent(third, {
      chunkSeq: 1,
      offset: 0.8,
      alignment: null,
    }),
    timestampEvent(Buffer.alloc(0), {
      chunkSeq: 1,
      offset: 0.8,
      segments: [{ text: 'again', start: 0, end: 0.3 }],
    }),
  ]);
  const collected = collectTimestampStream(raw);
  assert.deepEqual(collected.audio, Buffer.concat([first, second, third]));
  assert.deepEqual(collected.boundaries, [
    { text: 'Hello', offsetSeconds: 0, durationSeconds: 0.4 },
    { text: 'world', offsetSeconds: 0.4, durationSeconds: 0.4 },
    { text: 'again', offsetSeconds: 0.8, durationSeconds: 0.3 },
  ]);
  assert.deepEqual(parseSseDataLines('data: {"a":1}\n\ndata: [DONE]\n\n'), ['{"a":1}', '[DONE]']);
  assert.deepEqual(
    scaleWordBoundaries(
      [{ text: 'Hello', offsetSeconds: 0, durationSeconds: 0.5 }],
      1,
    ),
    [{ text: 'Hello', offsetSeconds: 0, durationSeconds: 1 }],
  );
});

test('synthesis sends bearer auth, returns MP3 duration, and records generation IDs', async () => {
  const audio = mp3Frames(20);
  let seenUrl = '';
  let seenInit: Record<string, unknown> = {};
  const result = await synthesizeSpeech({
    text: 'A short narration.',
    apiKey: 'test-key',
    maxAttempts: 1,
    fetcher: async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return sseResponse({
        events: [timestampEvent(audio, { segments: [{ text: 'A', start: 0, end: 0.2 }] })],
        generationId: 'gen_test',
      });
    },
  });

  assert.equal(seenUrl, FISH_AUDIO_TTS_URL);
  assert.equal((seenInit.headers as Record<string, string>).Authorization, 'Bearer test-key');
  assert.equal((seenInit.headers as Record<string, string>).Accept, 'text/event-stream');
  assert.deepEqual(JSON.parse(String(seenInit.body)), speechRequestBody('A short narration.'));
  assert.deepEqual(result.audio, audio);
  assert.ok(result.durationSeconds > 0);
  assert.equal(result.requests, 1);
  assert.deepEqual(result.generationIds, ['gen_test']);
  assert.equal(result.boundaries[0].text, 'A');
});

test('retryable Fish Audio responses are retried and provider errors stay readable', async () => {
  const audio = mp3Frames(5);
  let calls = 0;
  const result = await synthesizeSpeech({
    text: 'Retry me.',
    apiKey: 'test-key',
    maxAttempts: 2,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) {
        return response({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'free endpoint is busy' } }),
          retryAfter: '0',
        });
      }
      return sseResponse({ events: [timestampEvent(audio)] });
    },
  });
  assert.equal(calls, 2);
  assert.ok(result.durationSeconds > 0);
  assert.ok(result.boundaries.length > 0);

  await assert.rejects(
    synthesizeSpeech({
      text: 'No key.',
      apiKey: '',
      fetcher: async () => sseResponse({
        events: [timestampEvent(mp3Frames(5))],
      }),
    }),
    (error: unknown) => error instanceof FishAudioTtsError && /FISH_API_KEY/.test(error.message),
  );

  await assert.rejects(
    synthesizeSpeech({
      text: 'Unauthorized.',
      apiKey: 'bad-key',
      maxAttempts: 1,
      fetcher: async () => response({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'invalid key' } }),
      }),
    }),
    /Fish Audio TTS HTTP 401: invalid key/,
  );

  await assert.rejects(
    synthesizeSpeech({
      text: 'Raw audio is not a timestamp stream.',
      apiKey: 'test-key',
      maxAttempts: 1,
      fetcher: async () => response({
        status: 200,
        contentType: 'audio/mpeg',
        audio: mp3Frames(5),
      }),
    }),
    /instead of a timestamp SSE stream/,
  );
});
