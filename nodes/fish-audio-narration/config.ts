export interface FishAudioNarrationConfig {
  /** Also write a single stitched narration.mp3 covering every clip. */
  writeCombined: boolean;
  /** Clips synthesized at the same time. Keep it low for the free endpoint. */
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
   * Resolve `**anchors**` against the measured MP3 duration and write the
   * resulting seconds back into the project's `chapter-N.json`.
   */
  applyTiming: boolean;
  /** Floor for one resolved shot. Anchors closer than this are spread apart. */
  minItemSeconds: number;
}

export const DEFAULT_FISH_AUDIO_NARRATION_CONFIG: FishAudioNarrationConfig = {
  writeCombined: true,
  concurrency: 1,
  timeoutMs: 120_000,
  durationTolerance: 0.35,
  applyTiming: true,
  minItemSeconds: 0.35,
};
