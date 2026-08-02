# Edge TTS Narration

## Design

`edge-tts-narration` is a Node.js port of the Microsoft Edge "Read Aloud" speech protocol — the service the Python `edge-tts` package talks to. It needs no API key, no Python runtime, and no new dependency: the WebSocket client comes from `undici`, which the server already ships. The protocol implementation lives in `edge-tts.ts` beside this node.

The node turns each storyboard clip's `speech` into one MP3 and reports word-level timings, so narration can be checked against the storyboard's planned clip durations before a video is rendered.

## Protocol

1. Open a WSS connection to `speech.platform.bing.com` carrying a `Sec-MS-GEC` token: the SHA-256 of the current 5-minute window in Windows file-time ticks concatenated with the fixed trusted client token.
2. Send a `speech.config` frame declaring `audio-24khz-48kbitrate-mono-mp3`.
3. Send an `ssml` frame with the prosody-wrapped narration.
4. Read binary `audio` frames (2-byte big-endian header length, ASCII header, MP3 bytes) and `audio.metadata` word-boundary frames until `turn.end`.

Because the output stream is constant bitrate, clip duration is derived from byte length and needs no `ffprobe`. Narration longer than one request is split on sentence boundaries and the word offsets of later chunks are shifted by the accumulated audio duration.

`CHROMIUM_FULL_VERSION` in `edge-tts.ts` must stay close to the shipping Edge build. When Microsoft starts rejecting the handshake, the node fails with `handshake rejected` and names that constant.

## Input And Output

- Input: exactly one upstream node emitting either the `app-video-project` manifest or a storyboard document. Both are JSON objects with a `clips` array carrying `speech`.
- Output: JSON manifest with the voice settings, per-clip file name, playable URL, byte size, measured duration, planned duration, start offset, and word boundaries.
- Side effects: writes `clip-NN.mp3` per clip, an optional stitched `narration.mp3`, and `narration.json` into the run's asset directory. When the upstream manifest names a project directory, the same audio is copied into `<project>/voice/`.

## Configuration

`voice` takes a Microsoft short name such as `en-US-EmmaMultilingualNeural`. `rate`, `volume`, and `pitch` accept signed prosody values (`+8%`, `-10%`, `-20Hz`). `concurrency` bounds parallel synthesis, `timeoutMs` bounds one request, `writeCombined` controls the stitched track, and `writeToProject` controls the copy into the builder project. `durationTolerance` sets how far spoken audio may exceed the storyboard's planned clip length before the node warns.

Set `EDGE_TTS_PROXY` (or the standard `HTTPS_PROXY`/`HTTP_PROXY`) when the service needs an HTTP proxy; `EDGE_TTS_DISABLE_PROXY=1` forces a direct connection. SOCKS proxies are ignored because undici speaks HTTP CONNECT only.

## Failure Behavior

Invalid prosody values, an unknown voice short name, a non-JSON upstream payload, a missing `clips` array, or a clip without `speech` are reported as warnings (`⚠️`) before any network call. A synthesis failure is also a warning; when the configured voice is not published, the message lists real voices for that locale. When audio is produced but one or more clips run longer than the storyboard planned, the node returns its manifest with `warning` status so the timing can be corrected in the builder preview.
