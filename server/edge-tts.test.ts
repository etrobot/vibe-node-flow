import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  TRUSTED_CLIENT_TOKEN,
  buildSsml,
  escapeSsmlText,
  estimateMp3Seconds,
  generateSecMsGec,
  isVoiceShortName,
  normalizePitch,
  normalizeRate,
  normalizeVolume,
  parseAudioFrame,
  parseBoundaries,
  parseMessage,
  resolveProxyUrl,
  splitTextForSynthesis,
  voiceLocale,
} from '../nodes/edge-tts-narration/edge-tts.ts';

test('Sec-MS-GEC hashes the current five-minute window in Windows file-time ticks', () => {
  // 2026-08-02T14:03:35Z rounds down to 14:00:00Z.
  const nowMs = Date.UTC(2026, 7, 2, 14, 3, 35, 500);
  const windowSeconds = BigInt(Date.UTC(2026, 7, 2, 14, 0, 0) / 1000) + 11_644_473_600n;
  const expected = crypto
    .createHash('sha256')
    .update(`${windowSeconds * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase();

  assert.equal(generateSecMsGec(nowMs), expected);
  assert.match(generateSecMsGec(nowMs), /^[0-9A-F]{64}$/);
  // Every timestamp inside the same window produces the same token.
  assert.equal(generateSecMsGec(nowMs), generateSecMsGec(Date.UTC(2026, 7, 2, 14, 4, 59, 999)));
  assert.notEqual(generateSecMsGec(nowMs), generateSecMsGec(Date.UTC(2026, 7, 2, 14, 5, 0)));
});

test('SSML escapes markup, strips control characters, and carries prosody', () => {
  assert.equal(escapeSsmlText('Ship <fast> & win  now'), 'Ship &lt;fast&gt; &amp; win now');

  const ssml = buildSsml({
    text: 'Ideas are everywhere.',
    voice: 'en-US-EmmaMultilingualNeural',
    rate: '+6%',
    volume: '+0%',
    pitch: '-2Hz',
  });
  assert.match(ssml, /xml:lang='en-US'/);
  assert.match(ssml, /<voice name='en-US-EmmaMultilingualNeural'>/);
  assert.match(ssml, /<prosody pitch='-2Hz' rate='\+6%' volume='\+0%'>Ideas are everywhere\.<\/prosody>/);
});

test('prosody values are normalized to signed units and invalid input is rejected', () => {
  assert.equal(normalizeRate('10%'), '+10%');
  assert.equal(normalizeRate('-10'), '-10%');
  assert.equal(normalizeRate(''), '+0%');
  assert.equal(normalizeVolume('+25%'), '+25%');
  assert.equal(normalizePitch('-20hz'), '-20Hz');
  assert.throws(() => normalizeRate('fast'), /Invalid prosody value/);
});

test('voice short names are validated and their locale extracted', () => {
  assert.ok(isVoiceShortName('en-US-EmmaMultilingualNeural'));
  assert.ok(isVoiceShortName('zh-CN-XiaoxiaoNeural'));
  assert.ok(!isVoiceShortName('emma'));
  assert.ok(!isVoiceShortName('en-US-Emma'));
  assert.equal(voiceLocale('zh-CN-XiaoxiaoNeural'), 'zh-CN');
});

test('long narration splits on sentence boundaries and short narration stays whole', () => {
  assert.deepEqual(splitTextForSynthesis('  Ship it.  Then iterate. '), ['Ship it. Then iterate.']);
  assert.deepEqual(splitTextForSynthesis(''), []);

  const sentence = `${'word '.repeat(19)}end. `;
  const chunks = splitTextForSynthesis(sentence.repeat(30), 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `chunk too long: ${chunk.length}`);
  assert.ok(chunks.every((chunk) => !chunk.startsWith(' ') && !chunk.endsWith(' ')));

  // A single sentence longer than the limit is still split rather than dropped.
  const long = splitTextForSynthesis('a'.repeat(450), 200);
  assert.deepEqual(long.map((chunk) => chunk.length), [200, 200, 50]);
});

test('constant-bitrate audio maps bytes to seconds', () => {
  assert.equal(estimateMp3Seconds(6_000), 1);
  assert.equal(estimateMp3Seconds(0), 0);
  assert.equal(estimateMp3Seconds(-5), 0);
});

test('frame envelopes split into headers and body', () => {
  const { headers, body } = parseMessage(
    'X-RequestId:abc\r\nContent-Type:application/json\r\nPath:audio.metadata\r\n\r\n{"Metadata":[]}',
  );
  assert.equal(headers.Path, 'audio.metadata');
  assert.equal(headers['X-RequestId'], 'abc');
  assert.equal(body, '{"Metadata":[]}');
});

test('binary frames yield their path and raw audio payload', () => {
  const header = Buffer.from('Path:audio\r\n\r\n', 'utf8');
  const audio = Buffer.from([0xff, 0xf3, 0x64, 0x00]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(header.length, 0);

  const frame = parseAudioFrame(Buffer.concat([length, header, audio]));
  assert.equal(frame.path, 'audio');
  assert.deepEqual([...frame.audio], [...audio]);
  assert.throws(() => parseAudioFrame(Buffer.from([0x01])), /truncated binary frame/);

  const bogus = Buffer.alloc(4);
  bogus.writeUInt16BE(999, 0);
  assert.throws(() => parseAudioFrame(bogus), /invalid header length/);
});

test('word boundaries convert 100-nanosecond ticks to seconds and skip other events', () => {
  const boundaries = parseBoundaries(JSON.stringify({
    Metadata: [
      { Type: 'WordBoundary', Data: { Offset: 5_000_000, Duration: 2_500_000, text: { Text: 'Ideas' } } },
      { Type: 'SentenceBoundary', Data: { Offset: 0, Duration: 0, text: { Text: 'ignored' } } },
      { Type: 'WordBoundary', Data: { Offset: 7_500_000, Duration: 1_000_000, text: { Text: '' } } },
    ],
  }));
  assert.deepEqual(boundaries, [{ offsetSeconds: 0.5, durationSeconds: 0.25, text: 'Ideas' }]);
  assert.deepEqual(parseBoundaries('not json'), []);
});

test('proxy resolution prefers the explicit variable and ignores SOCKS URLs', () => {
  assert.equal(resolveProxyUrl({ EDGE_TTS_PROXY: 'http://127.0.0.1:7890' }), 'http://127.0.0.1:7890');
  assert.equal(
    resolveProxyUrl({ HTTPS_PROXY: 'http://proxy:8080', EDGE_TTS_PROXY: 'http://explicit:1' }),
    'http://explicit:1',
  );
  assert.equal(resolveProxyUrl({ ALL_PROXY: 'socks5://127.0.0.1:7890' }), undefined);
  assert.equal(resolveProxyUrl({ HTTPS_PROXY: 'http://proxy:8080', EDGE_TTS_DISABLE_PROXY: '1' }), undefined);
  assert.equal(resolveProxyUrl({}), undefined);
});
