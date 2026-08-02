import { spawn, type ChildProcess } from 'node:child_process';

export interface VideoRenderTerminalOptions {
  projectRoot: string;
  runId: string;
  baseUrl: string;
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildVideoRenderCommand({
  projectRoot,
  runId,
  baseUrl,
}: VideoRenderTerminalOptions): string {
  const renderCommand = [
    'npm',
    'run',
    'render:video',
    '--',
    '--run-id',
    runId,
    '--base-url',
    baseUrl,
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

/** Open a visible local terminal running the known MP4 render command. */
export async function openVideoRenderTerminal(options: VideoRenderTerminalOptions): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Opening a render terminal is currently supported on macOS only.');
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
