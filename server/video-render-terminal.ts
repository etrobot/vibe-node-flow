import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * The file name a node must ship to be launchable from the render button. The
 * host never learns what is inside it — only that the node with the
 * `video-spec` capability provides it.
 */
export const VIDEO_RENDER_SCRIPT = 'render-video.sh';

export interface VideoRenderTerminalOptions {
  projectRoot: string;
  /** Absolute path to the node-owned script, from `nodePluginScript`. */
  scriptPath: string;
  runId: string;
  baseUrl: string;
  /** Where the host wants the MP4, so the node need not know the asset layout. */
  outputPath: string;
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Run the node's own script directly. Going through `npm run <name>` would mean
 * the host `package.json` has to declare a command on the node's behalf, which
 * breaks the moment the node is uninstalled or a second node wants the same
 * step. The script is invoked by absolute path from the project root, so it
 * still resolves `node_modules` while owning its own arguments.
 */
export function buildVideoRenderCommand({
  projectRoot,
  scriptPath,
  runId,
  baseUrl,
  outputPath,
}: VideoRenderTerminalOptions): string {
  const renderCommand = [
    scriptPath,
    '--run-id',
    runId,
    '--base-url',
    baseUrl,
    '--out',
    outputPath,
  ].map(quoteShellArg).join(' ');
  return [
    `cd ${quoteShellArg(projectRoot)} && ${renderCommand}`,
    'render_status=$?',
    `printf '\\nVideo render finished with exit code %s.\\n' "$render_status"`,
    'exec "${SHELL:-/bin/zsh}" -l',
  ].join('; ');
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

/** Open a visible local terminal running the node's render script. */
export async function openVideoRenderTerminal(options: VideoRenderTerminalOptions): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Opening a render terminal is currently supported on macOS only.');
  }
  if (!path.isAbsolute(options.scriptPath)) {
    throw new Error(`Render script path must be absolute: ${options.scriptPath}`);
  }
  const command = buildVideoRenderCommand(options);
  const child = spawn('osascript', [
    '-e', 'on run argv',
    '-e', 'set commandText to item 1 of argv',
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', 'do script commandText',
    '-e', 'end tell',
    '-e', 'end run',
    command,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  await waitForSpawn(child);
  child.unref();
}
