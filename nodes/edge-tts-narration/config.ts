/** Default voice used when none is specified. Shared between config and server. */
export const DEFAULT_VOICE = 'en-US-EmmaMultilingualNeural';

export interface EdgeTtsNarrationConfig {
  /** Microsoft Edge voice short name, e.g. `en-US-EmmaMultilingualNeural`. */
  voice: string;
  /** Prosody rate, e.g. `+0%`, `+8%`, `-10%`. */
  rate: string;
  /** Prosody volume, e.g. `+0%`. */
  volume: string;
  /** Prosody pitch, e.g. `+0Hz`, `-20Hz`. */
  pitch: string;
  /** Also write a single stitched narration.mp3 covering every clip. */
  writeCombined: boolean;
  /** Clips synthesized at the same time. Keep it low; the service throttles. */
  concurrency: number;
  /** Per-request budget in milliseconds. */
  timeoutMs: number;
  /**
   * Warn when a clip's spoken audio exceeds its storyboard duration by more
   * than this ratio, so timing can be corrected in the builder preview. Only
   * applies to storyboards that authored durations; under anchor timing the
   * narration is the plan, so there is nothing to exceed.
   */
  durationTolerance: number;
  /**
   * Resolve `**anchors**` in the speech against real word boundaries and write
   * the measured seconds back into the project's `chapter-N.json`, so the
   * picture cuts where the voice actually lands.
   */
  applyTiming: boolean;
  /** Floor for one resolved shot. Anchors closer than this are spread apart. */
  minItemSeconds: number;
}

export const DEFAULT_EDGE_TTS_NARRATION_CONFIG: EdgeTtsNarrationConfig = {
  voice: DEFAULT_VOICE,
  rate: '+0%',
  volume: '+0%',
  pitch: '+0Hz',
  writeCombined: true,
  concurrency: 2,
  timeoutMs: 60_000,
  durationTolerance: 0.35,
  applyTiming: true,
  minItemSeconds: 0.35,
};
