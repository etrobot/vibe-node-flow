# App Video Render

## Design

`app-video-render` turns the builder project written by `app-video-project` into a finished MP4. It performs no model call. It drives the local toolchain in `data/idea-to-app-builder`: Playwright screenshots every frame of every clip, ffmpeg concatenates them, and this node then mixes the audio.

The audio mix is the part the builder cannot do. `scripts/render-video.ts` supports exactly one looped background track (`--music`), which is wrong for narration: a stitched voice track would loop when it is shorter than the video and drift out of sync with the clips. So the node always renders silent (`--no-audio`) and builds the mix itself, placing each clip's MP3 at that clip's real start offset.

Clip offsets are a plain cumulative sum of clip durations. That is exact, not an estimate: `render-video.ts` advances its timeline by `getClipDuration(clip)` per clip and draws transitions inside clip time, so a clip's start in `final.mp4` is the sum of the durations before it. The offsets are read from `projects/<slug>/chapter/chapter-N.json` rather than from the upstream storyboard, so timings edited by hand in the builder preview are respected.

## Toolchain

The builder workspace is a separate, git-ignored install. Before rendering, the node checks for `scripts/render-video.ts`, the project directory, `playwright-core`, `vite`, and `ffmpeg`, and reports each missing piece with its own fix:

```sh
cd data/idea-to-app-builder && npm install
brew install ffmpeg
```

`render-video.ts` also needs a local Chromium-family browser (Chrome, Edge, Brave, or Chromium), or `PLAYWRIGHT_BROWSER_PATH` pointing at one. That check belongs to the renderer and surfaces in the render log.

## Input And Output

- Input: one or more upstream JSON manifests. The `edge-tts-narration` manifest supplies the clip MP3s; the `app-video-project` manifest supplies the slug. Either alone is enough — without narration the node renders a silent or music-only video.
- Output: JSON manifest with the video path and playable URL, byte size, measured and planned duration, encode settings, the audio mix summary, per-clip start offsets with their narration file, and the exact commands that ran.
- Side effects: writes `projects/<slug>/renders/flow-<timestamp>/silent.mp4` and `final.mp4` into the builder workspace, then copies the final file to `video.mp4` in the run's asset directory alongside `render.json`.

## Audio Mix

Each clip MP3 becomes one ffmpeg input, normalized to 48 kHz stereo (`amix` rejects inputs whose rate or layout differ) and delayed with `adelay` to its clip start. Background music from `projects/<slug>/music/bgm.*` is looped, scaled by `musicVolume`, and trimmed to the timeline length. The mix is padded with `apad` so `-shortest` trims the audio to the video instead of cutting the video down to a shorter narration.

## Configuration

`builderDir` is resolved relative to the server data directory and defaults to `idea-to-app-builder`. `slug` overrides the slug from the upstream manifest; blank uses the upstream value. `resolution` (`1080p` or `4k`), `fps`, `crf`, and `x264Preset` map to the builder's own flags — the defaults trade a little quality for render time, since the builder's own defaults (`crf 12`, `slow`) are tuned for a final master.

`narration` and `music` toggle the two audio sources, `musicVolume` sets the music gain, and `audioBitrate` sets the AAC bitrate. `validateProject` runs the builder's `validate-project` first so a contract error costs seconds instead of a full render. `timeoutMs` bounds the render; the whole process group is terminated on expiry, because `npm run` is only the parent of the renderer.

`cleanIntermediates` deletes the silent master and the working directory `render-video.ts` fills with one MP4 per clip. Those intermediates are created on every render regardless of `--output`, so leaving them costs roughly the size of the finished video again per run. Only directories that appeared during this run and contain a `clips/` folder are removed.

`dryRun` reports the planned commands and the toolchain state without rendering. Use it to check a machine before committing to a render that captures every frame through a browser.

## Failure Behavior

Missing upstream input, an unusable slug, a `builderDir` outside the data directory, an unready builder workspace, an unreadable project, and a failed `validate-project` are warnings (`⚠️`). A non-zero exit from `render-video` or `ffmpeg`, a timeout, and a missing output file are errors, because at that point the toolchain itself failed. When the video renders but narration is longer than its clip slot or a clip's MP3 is missing, the node returns its manifest with `warning` status so the timing can be corrected in the builder preview.

The editor's **Stop** action terminates the server-side Worker, which does not reach processes that Worker spawned. A render already in flight keeps running to completion. The node logs its process group id at spawn time so it can be stopped by hand:

```sh
kill -- -<pid>
```

`timeoutMs` is the automatic bound on that: the whole process group is signalled, not just `npm`.
