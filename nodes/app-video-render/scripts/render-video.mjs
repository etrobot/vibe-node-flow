import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const runId = argument('--run-id');
const baseUrl = argument('--base-url');
const output = argument('--out');
const specFile = argument('--spec');
if (!runId || !baseUrl || !output || !specFile) {
  throw new Error('render-video.mjs requires --run-id, --base-url, --out, and --spec');
}

function parseJsonFile(file) {
  let value = JSON.parse(fsSync.readFileSync(file, 'utf8'));
  if (typeof value === 'string') value = JSON.parse(value);
  return value;
}

function durationOfDocument(document) {
  return (document.clips || []).reduce((total, clip) => total + (clip.items || []).reduce((sum, item) => {
    const duration = Number(item.duration);
    return sum + (Number.isFinite(duration) && duration > 0 ? duration : 0.1);
  }, 0), 0);
}

function executable(name) {
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function chromiumPath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    executable('chromium'),
    executable('chromium-browser'),
    executable('google-chrome'),
  ].filter(Boolean);
  const found = candidates.find((candidate) => {
    try { return fsSync.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!found) throw new Error('No Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE or CHROME_PATH.');
  return found;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${error.message}\n${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

async function captureFrames(page, document, spec, silentPath) {
  const width = Number(spec.width) || 1920;
  const height = Number(spec.height) || 1080;
  const fps = Number(spec.fps) || 30;
  const crf = Number(spec.crf) || 18;
  const preset = String(spec.x264Preset || 'medium');
  const totalSeconds = durationOfDocument(document);
  const frameCount = Math.max(1, Math.ceil(totalSeconds * fps));
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-f', 'image2pipe', '-vcodec', 'png', '-r', String(fps), '-i', '-',
    '-an', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silentPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const close = new Promise((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg frame encode failed (${code}): ${stderr.slice(-4000)}`)));
  });

  for (let index = 0; index < frameCount; index += 1) {
    const time = Math.min(totalSeconds, index / fps);
    await page.evaluate(async (nextTime) => {
      if (typeof window.__setPlayerTime !== 'function') throw new Error('Render page did not expose __setPlayerTime.');
      await window.__setPlayerTime(nextTime);
    }, time);
    const image = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(image)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    if ((index + 1) % Math.max(1, Math.floor(fps)) === 0) {
      console.log(`[render-video] captured ${index + 1}/${frameCount} frames`);
    }
  }
  ffmpeg.stdin.end();
  await close;
  return { totalSeconds, frameCount, width, height, fps };
}

async function muxAudio(spec, silentPath, outputPath, totalSeconds) {
  const audio = spec.audio || {};
  const audioDir = String(audio.audioDir || '');
  const tracks = (audio.clips || []).filter((clip) => clip?.file && audioDir)
    .map((clip) => ({
      path: path.join(audioDir, clip.file),
      startSeconds: Number(clip.startSeconds) || 0,
    }))
    .filter((track) => fsSync.existsSync(track.path));
  const musicPath = audio.musicPath && fsSync.existsSync(audio.musicPath) ? audio.musicPath : '';
  if (!tracks.length && !musicPath) {
    await fs.rename(silentPath, outputPath);
    return;
  }

  const args = ['-y', '-i', silentPath];
  const filters = [];
  const labels = [];
  tracks.forEach((track, index) => {
    args.push('-i', track.path);
    const label = `voice${index}`;
    filters.push(`[${index + 1}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,adelay=${Math.max(0, Math.round(track.startSeconds * 1000))}:all=1[${label}]`);
    labels.push(`[${label}]`);
  });
  if (musicPath) {
    const index = tracks.length + 1;
    args.push('-stream_loop', '-1', '-i', musicPath);
    filters.push(`[${index}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${Math.max(0, Number(audio.musicVolume) || 0).toFixed(3)},atrim=0:${totalSeconds.toFixed(3)}[music]`);
    labels.push('[music]');
  }
  const mix = labels.length > 1
    ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad[out]`
    : `${labels[0]}apad[out]`;
  args.push(
    '-filter_complex', [...filters, mix].join(';'),
    '-map', '0:v:0', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac',
    '-b:a', String(audio.bitrate || '192k'), '-t', totalSeconds.toFixed(3),
    '-movflags', '+faststart', outputPath,
  );
  await run('ffmpeg', args);
  await fs.rm(silentPath, { force: true });
}

const spec = parseJsonFile(specFile);
const document = spec?.document && typeof spec.document === 'object' ? spec.document : spec;
if (!document || !Array.isArray(document.clips) || !document.clips.length) throw new Error('Render spec has no clips.');

const outputDir = path.dirname(output);
await fs.mkdir(outputDir, { recursive: true });
const silentPath = path.join(outputDir, `.silent-${runId}.mp4`);
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
  const page = await browser.newPage({ viewport: { width: Number(spec.width) || 1920, height: Number(spec.height) || 1080 }, deviceScaleFactor: 1 });
  const url = `${baseUrl.replace(/\/$/, '')}/?videoRender=1&render=player&run=${encodeURIComponent(runId)}`;
  console.log(`[render-video] opening ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__renderReady === true || Boolean(window.__renderError), null, { timeout: 120_000 });
  const renderError = await page.evaluate(() => window.__renderError || '');
  if (renderError) throw new Error(renderError);
  const result = await captureFrames(page, document, spec, silentPath);
  console.log(`[render-video] encoded ${result.frameCount} frames (${result.totalSeconds.toFixed(2)}s)`);
  await browser.close();
  browser = undefined;
  await muxAudio(spec, silentPath, output, result.totalSeconds);
  console.log(`[render-video] wrote ${output}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (fsSync.existsSync(silentPath)) await fs.rm(silentPath, { force: true });
}
