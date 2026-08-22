# Fish Audio Narration

This node turns each storyboard clip's `speech` into MP3 narration with Fish Audio
S2.1 Pro Free and a fixed official voice. Its persisted node type is
`fish-audio-narration`.

## API

The implementation calls:

```text
POST https://api.fish.audio/v1/tts/stream/with-timestamp
Authorization: Bearer $FISH_API_KEY
Content-Type: application/json
Accept: text/event-stream
model: s2.1-pro-free

{
  "text": "Narration text",
  "reference_id": "79d0bd3e4e5444b18f7b6d89b5927bf1",
  "format": "mp3",
  "sample_rate": 44100,
  "mp3_bitrate": 128,
  "latency": "normal",
  "prosody": { "speed": 1 }
}
```

The endpoint returns `text/event-stream`. Each SSE `data:` payload carries a
base64 audio chunk and, when ready, a cumulative `alignment` snapshot for that
`chunk_seq`. Audio chunks are concatenated in arrival order; alignment snapshots
replace the previous snapshot for the same chunk. `start`/`end` are seconds from
the start of that text chunk; `chunk_audio_offset_sec` shifts them onto the full
clip. Each storyboard clip is synthesized in its own request so the narrator can
finish a thought and pause before the next clip or chapter. Every request includes
the same `reference_id`, pins `sample_rate` to 44100, locks `prosody.speed` to 1,
and uses `latency: normal` so the take is stable rather than first-audio-fast.
A single clip longer than 8000 characters is still split internally; those MP3
parts are decoded to PCM and re-encoded rather than byte-concatenated. Optional
`narration.mp3` stitches every clip MP3 the same way. Transient 429 and 5xx
responses are retried with bounded backoff. The old Edge `voice`, `rate`,
`volume`, and `pitch` settings are intentionally absent.

## Timing

- MP3 duration is measured by parsing MPEG frame headers and summing their sample
  counts. This works for constant- and variable-bitrate output and does not require
  `ffprobe`.
- Word timestamps come from `alignment.segments`. `**anchors**` are stripped before
  synthesis, then matched onto those segments so each shot cut lands on the spoken
  word. Segment clocks are scaled to the measured MP3 duration when the two clocks
  disagree. These per-item splits are marked `measured: true` when every anchor
  hits a timestamp.
- If Fish Audio sends audio but no alignments, or a clip has the wrong number of
  anchors, or `minItemSeconds` cannot be satisfied, the existing character-offset
  or even-split fallback is used and recorded in logs. That is not treated as a
  silent success.

## Inputs and outputs

- Input: exactly one upstream JSON object with a non-empty `clips` array. Each clip
  needs `speech`; `items.length` (or `itemCount`) determines how many shots the
  anchors divide.
- Output files: `clip-NN.mp3`, optional stitched `narration.mp3`, and
  `narration.json` in the current run's asset directory.
- The manifest records `provider`, `model`, `referenceId`, exact MP3 durations,
  request generation IDs, clip offsets, and the resolved item timeline consumed by
  `app-video-render`. Embedded storyboard documents omit prompt-sized `sourceBrief`
  text; a `sourceBriefPath` reference may remain.

## Configuration

- `writeCombined`: write `narration.mp3` in addition to per-clip files.
- `concurrency`: how many clip requests run in parallel (default `1` for the free endpoint).
- `timeoutMs`: per-request timeout (default `120000`).
- `durationTolerance`: warn when narration exceeds an authored clip duration.
- `applyTiming`: write resolved item durations into the embedded/project document.
- `minItemSeconds`: minimum visible time for one shot.

Set `FISH_API_KEY` in `.env`. `FISH_AUDIO_TTS_PROXY` can provide an HTTP(S)
proxy and falls back to `HTTPS_PROXY`/`HTTP_PROXY`; set
`FISH_AUDIO_TTS_DISABLE_PROXY=1` to force a direct connection.
