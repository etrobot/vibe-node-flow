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
  /** Copy clip audio into `<project>/voice/` when the upstream manifest names a project. */
  writeToProject: boolean;
  /** Clips synthesized at the same time. Keep it low; the service throttles. */
  concurrency: number;
  /** Per-request budget in milliseconds. */
  timeoutMs: number;
  /**
   * Warn when a clip's spoken audio exceeds its storyboard duration by more
   * than this ratio, so timing can be corrected in the builder preview.
   */
  durationTolerance: number;
}

export const DEFAULT_EDGE_TTS_NARRATION_CONFIG: EdgeTtsNarrationConfig = {
  voice: DEFAULT_VOICE,
  rate: '+0%',
  volume: '+0%',
  pitch: '+0Hz',
  writeCombined: true,
  writeToProject: true,
  concurrency: 2,
  timeoutMs: 60_000,
  durationTolerance: 0.35,
};
