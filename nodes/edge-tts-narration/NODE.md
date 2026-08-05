# Edge TTS Narration

## Design

`edge-tts-narration` is a Node.js port of the Microsoft Edge "Read Aloud" speech protocol — the service the Python `edge-tts` package talks to. It needs no API key, no Python runtime, and no new dependency: the WebSocket client comes from `undici`, which the server already ships. The protocol implementation lives in `edge-tts.ts` beside this node.

The node turns each storyboard clip's `speech` into one MP3 and reports word-level timings. Those timings are not diagnostics — they are the timeline. The storyboard marks where the picture should cut with `**anchors**` in the speech; this node finds when the voice actually said each anchor and writes the resulting shot lengths back into the project, so picture and narration cannot drift apart.

## Protocol

1. Open a WSS connection to `speech.platform.bing.com` carrying a `Sec-MS-GEC` token: the SHA-256 of the current 5-minute window in Windows file-time ticks concatenated with the fixed trusted client token.
2. Send a `speech.config` frame declaring `audio-24khz-48kbitrate-mono-mp3`.
3. Send an `ssml` frame with the prosody-wrapped narration.
4. Read binary `audio` frames (2-byte big-endian header length, ASCII header, MP3 bytes) and `audio.metadata` word-boundary frames until `turn.end`.

Anchors are stripped before step 3 — they are direction for the timeline, not text for the voice.

Because the output stream is constant bitrate, clip duration is derived from byte length and needs no `ffprobe`. Narration longer than one request is split on sentence boundaries and the word offsets of later chunks are shifted by the accumulated audio duration.

`CHROMIUM_FULL_VERSION` in `edge-tts.ts` must stay close to the shipping Edge build. When Microsoft starts rejecting the handshake, the node fails with `handshake rejected` and names that constant.

## Input And Output

- Input: exactly one upstream node emitting either the `app-video-project` manifest or a storyboard document. Both are JSON objects with a `clips` array carrying `speech`. Each clip's `itemCount` (or its `items` array) tells the node how many shots the anchors must divide the narration into.
- Output: JSON manifest with the voice settings, per-clip file name, playable URL, byte size, measured duration, start offset, resolved per-item timing, and word boundaries, plus a top-level `timeline` that `app-video-render` uses to place each clip's audio. It also carries `audioDir` so the render node can find the MP3s in the same run asset directory.
- Side effects: writes `clip-NN.mp3` per clip, an optional stitched `narration.mp3`, and `narration.json` into `data/assets/<workflow-id>/generated/<run-id>/`. Unless `applyTiming` is off, measured shot lengths are written back into that run's `chapter-N.json` files.

## Configuration

`voice` takes a Microsoft short name such as `en-US-EmmaMultilingualNeural`. `rate`, `volume`, and `pitch` accept signed prosody values (`+8%`, `-10%`, `-20Hz`). `concurrency` bounds parallel synthesis, `timeoutMs` bounds one request, and `writeCombined` controls the stitched track.

`applyTiming` controls whether measured shot lengths are written back into the current run's `chapter-N.json`; turn it off to keep the provisional durations. `minItemSeconds` is the floor for one resolved shot — anchors closer together than this are spread apart, because a shot nobody can see is worse than one slightly off its anchor. `durationTolerance` only applies to storyboards that authored their own durations (`timingMode: "duration"` upstream); under anchor timing the narration *is* the plan, so there is nothing to exceed.

Set `EDGE_TTS_PROXY` (or the standard `HTTPS_PROXY`/`HTTP_PROXY`) when the service needs an HTTP proxy; `EDGE_TTS_DISABLE_PROXY=1` forces a direct connection. SOCKS proxies are ignored because undici speaks HTTP CONNECT only.

## Failure Behavior

Invalid prosody values, an unknown voice short name, a non-JSON upstream payload, a missing `clips` array, or a clip without `speech` are reported as warnings (`⚠️`) before any network call. A synthesis failure is also a warning; when the configured voice is not published, the message lists real voices for that locale.

Anchor resolution never fails a run. When a clip's anchor count does not match its item count, the service reports no word boundaries, or the audio is too short to give every shot its floor, that clip falls back to an even split and the node returns `warning` status naming the clip — the video still renders, and the log says which clip to fix.
