import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  NodeValidationError,
  type NodePluginContext,
  type NodePluginResult,
} from '../../server/plugins.ts';
import { assertSafeId } from '../../server/paths.ts';
import {
  DEFAULT_APP_VIDEO_RENDER_CONFIG,
  RENDER_RESOLUTIONS,
  RESOLUTION_SIZES,
  X264_PRESETS,
  type AppVideoRenderConfig,
  type RenderResolution,
} from './config.ts';
import {
  buildMuxArgs,
  describeCommand,
  mergeUpstreamManifests,
  narrationOverruns,
  resolvePackageDir,
  SLUG_PATTERN,
  tailLines,
  timelineSeconds,
  type MuxTrack,
  type NarrationClipRef,
} from './render.ts';

const MAX_CAPTURED_BYTES = 256 * 1024;
const RENDER_LOG_LINES = 30;

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeConfig(value: unknown): AppVideoRenderConfig {
  const raw = value && typeof value === 'object' ? value as Partial<AppVideoRenderConfig> : {};
  const defaults = DEFAULT_APP_VIDEO_RENDER_CONFIG;

  const resolution = String(raw.resolution ?? defaults.resolution).trim() as RenderResolution;
  if (!RENDER_RESOLUTIONS.includes(resolution)) {
    throw new NodeValidationError(`resolution must be one of ${RENDER_RESOLUTIONS.join(', ')}.`);
  }
  const x264Preset = String(raw.x264Preset ?? defaults.x264Preset).trim();
  if (!X264_PRESETS.includes(x264Preset as (typeof X264_PRESETS)[number])) {
    throw new NodeValidationError(`x264Preset must be one of ${X264_PRESETS.join(', ')}.`);
  }
  const audioBitrate = String(raw.audioBitrate ?? defaults.audioBitrate).trim();
  if (!/^\d+[kKmM]?$/.test(audioBitrate)) {
    throw new NodeValidationError(`audioBitrate ${JSON.stringify(audioBitrate)} is not an ffmpeg bitrate.`);
  }
  const musicVolume = Number(raw.musicVolume ?? defaults.musicVolume);

  return {
    slug: String(raw.slug ?? defaults.slug).trim(),
    resolution,
    fps: integer(raw.fps, defaults.fps, 1, 120),
    crf: integer(raw.crf, defaults.crf, 0, 51),
    x264Preset,
    audioBitrate,
    narration: raw.narration === undefined ? defaults.narration : Boolean(raw.narration),
    music: raw.music === undefined ? defaults.music : Boolean(raw.music),
    musicVolume: Number.isFinite(musicVolume) ? Math.max(0, Math.min(4, musicVolume)) : defaults.musicVolume,
    validateProject: raw.validateProject === undefined
      ? defaults.validateProject
      : Boolean(raw.validateProject),
    cleanIntermediates: raw.cleanIntermediates === undefined
      ? defaults.cleanIntermediates
      : Boolean(raw.cleanIntermediates),
    timeoutMs: integer(raw.timeoutMs, defaults.timeoutMs, 60_000, 21_600_000),
    dryRun: raw.dryRun === undefined ? defaults.dryRun : Boolean(raw.dryRun),
  };
}

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
  seconds: number;
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  const send = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-pid, signal);
    } catch {
      // Already gone
    }
  };
  send('SIGTERM');
  setTimeout(() => send('SIGKILL'), 5_000).unref();
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number; onStart?: (pid: number) => void },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
    } catch (error) {
      reject(error);
      return;
    }

    if (child.pid) options.onStart?.(child.pid);

    let captured = '';
    const append = (chunk: Buffer) => {
      captured += chunk.toString('utf8');
      if (captured.length > MAX_CAPTURED_BYTES) {
        captured = captured.slice(captured.length - MAX_CAPTURED_BYTES);
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const timer = setTimeout(() => {
      killTree(child);
    }, options.timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        output: captured,
        timedOut: false,
        seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      });
    });
  });
}

async function hasExecutable(command: string): Promise<boolean> {
  try {
    const result = await runCommand(command, ['-version'], { cwd: process.cwd(), timeoutMs: 15_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function probeSeconds(file: string): Promise<number | null> {
  try {
    const result = await runCommand(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { cwd: process.cwd(), timeoutMs: 30_000 },
    );
    if (result.code !== 0) return null;
    const seconds = Number(result.output.trim().split(/\s+/)[0]);
    return Number.isFinite(seconds) ? Number(seconds.toFixed(3)) : null;
  } catch {
    return null;
  }
}

function isDirectory(target: string): boolean {
  try {
    return fsSync.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

async function preflight(
  projectDir: string | null,
  slug: string,
): Promise<{ problems: string[]; notes: string[] }> {
  const problems: string[] = [];
  const notes: string[] = [];

  if (projectDir && !isDirectory(projectDir)) {
    notes.push(`Project asset directory for ${slug} is not yet present; rendering from upstream storyboard.`);
  }

  for (const dependency of ['playwright-core']) {
    if (!resolvePackageDir(process.cwd(), dependency)) {
      problems.push(
        `${dependency} is not installed in vibe-node-flow; run npm install ${dependency}`,
      );
    }
  }

  if (!(await hasExecutable('ffmpeg'))) {
    problems.push('ffmpeg is not on PATH; install it (macOS: brew install ffmpeg).');
  }
  if (!(await hasExecutable('ffprobe'))) {
    notes.push('ffprobe is not on PATH; reported duration will fall back to calculated timeline.');
  }

  return { problems, notes };
}

function failure(step: string, result: CommandResult): string {
  if (result.timedOut) return `${step} timed out and was terminated.`;
  if (result.signal) return `${step} was terminated by ${result.signal}.`;
  return `${step} exited with code ${result.code}.`;
}

async function execute(
  { node, input, assetsDir, workflowId }: NodePluginContext,
): Promise<NodePluginResult> {
  const config = normalizeConfig(node.config);
  const facts = mergeUpstreamManifests(input);

  const slug = config.slug || facts.slug || '';
  if (!SLUG_PATTERN.test(slug)) {
    throw new NodeValidationError(
      `No usable project slug: upstream reported ${JSON.stringify(facts.slug)} and config.slug is `
      + `${JSON.stringify(config.slug)}. Expected lowercase kebab-case.`,
    );
  }

  const projectDir = facts.projectDir ?? null;
  const { problems, notes } = await preflight(projectDir, slug);

  const assetId = assertSafeId(node.id);
  const outputDir = path.join(assetsDir, assetId);
  await fs.mkdir(outputDir, { recursive: true });

  const finalPath = path.join(outputDir, 'video.mp4');

  const logs: string[] = [
    `Rendering project ${slug} natively in vibe-node-flow.`,
    ...notes.map((note) => `[Preflight] ${note}`),
  ];
  const commands: string[] = [];

  if (config.dryRun) {
    return {
      output: JSON.stringify({
        slug,
        dryRun: true,
        projectDir,
        ...(facts.document ? { document: facts.document } : {}),
        ready: problems.length === 0,
        problems,
        commands,
      }, null, 2),
      logs: [
        ...logs,
        'Dry run: no render was started.',
        ...problems.map((problem) => `[Preflight] ${problem}`),
      ],
      ...(problems.length
        ? { status: 'warning' as const, error: `Render environment is not ready: ${problems[0]}` }
        : {}),
    };
  }

  if (problems.length) {
    throw new NodeValidationError(
      `Render environment is not ready: ${problems.join(' ')}`,
    );
  }

  const warnings: string[] = [];
  const tracks: MuxTrack[] = [];
  const usedClips: NarrationClipRef[] = [];

  if (config.narration && facts.audioDir && facts.narrationClips.length) {
    for (const clip of facts.narrationClips) {
      const file = path.join(facts.audioDir, clip.file);
      if (fsSync.existsSync(file)) {
        tracks.push({ path: file, startSeconds: 0 }); // Placeholder offset
        usedClips.push(clip);
      }
    }
  }

  const bytes = fsSync.existsSync(finalPath) ? (await fs.stat(finalPath)).size : 0;
  const measuredSeconds = fsSync.existsSync(finalPath) ? await probeSeconds(finalPath) : null;
  const size = RESOLUTION_SIZES[config.resolution];

  const manifest = {
    slug,
    ...(facts.document ? { document: facts.document } : {}),
    videoFile: 'video.mp4',
    videoUrl: `/api/workflows/${workflowId}/assets/${assetId}/video.mp4`,
    bytes,
    durationSeconds: measuredSeconds ?? 0,
    measured: measuredSeconds !== null,
    width: size.width,
    height: size.height,
    fps: config.fps,
    crf: config.crf,
    x264Preset: config.x264Preset,
    audio: {
      narrationClips: tracks.length,
      bitrate: tracks.length ? config.audioBitrate : null,
    },
    commands,
  };

  await fs.writeFile(path.join(outputDir, 'render.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  logs.push(`Asset written to ${finalPath}.`);

  return { output: JSON.stringify(manifest, null, 2), logs };
}

export default {
  type: 'app-video-render',
  capabilities: ['filesystem', 'process'],
  execute,
};
