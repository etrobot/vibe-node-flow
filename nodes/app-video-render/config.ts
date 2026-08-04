/** Output size presets accepted by the builder's `--resolution` flag. */
export const RENDER_RESOLUTIONS = ['1080p', '4k'] as const;

/** x264 speed presets. Slower presets cost render time for a small size win. */
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;

export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number];

export const RESOLUTION_SIZES: Record<RenderResolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export interface AppVideoRenderConfig {
  /** Project slug to render. Blank takes the slug from the upstream manifest. */
  slug: string;
  resolution: RenderResolution;
  fps: number;
  /** x264 quality. Lower is clearer and larger; default is 18. */
  crf: number;
  /** x264 speed preset. Playwright frame capture dominates, but this still matters. */
  x264Preset: string;
  /** AAC bitrate for the muxed audio track. */
  audioBitrate: string;
  /**
   * Lay each clip's narration MP3 on the timeline at that clip's start offset.
   */
  narration: boolean;
  /** Mix `<project>/music/bgm.*` underneath the narration if present. */
  music: boolean;
  /** Linear gain applied to the background music before mixing. */
  musicVolume: number;
  /** Validate project shape before spending render time. */
  validateProject: boolean;
  /**
   * Delete the silent master once `final.mp4` exists.
   */
  cleanIntermediates: boolean;
  /** Budget for one render. Every frame is a screenshot, so keep this generous. */
  timeoutMs: number;
  /** Report toolchain state without rendering. */
  dryRun: boolean;
}

export const DEFAULT_APP_VIDEO_RENDER_CONFIG: AppVideoRenderConfig = {
  slug: '',
  resolution: '1080p',
  fps: 30,
  crf: 18,
  x264Preset: 'medium',
  audioBitrate: '192k',
  narration: true,
  music: true,
  musicVolume: 0.18,
  validateProject: true,
  cleanIntermediates: true,
  timeoutMs: 1_800_000,
  dryRun: false,
};
