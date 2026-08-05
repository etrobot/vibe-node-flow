import React, { useMemo } from 'react';
import type { NodeModule, NodeModuleEditorProps } from '@/App/types.node-module';
import { DEFAULT_EDGE_TTS_NARRATION_CONFIG } from './config';

interface NarrationClipEntry {
  index: number;
  file: string;
  url: string;
  speech: string;
  durationSeconds: number;
  plannedSeconds: number | null;
}

interface NarrationManifest {
  voice?: string;
  rate?: string;
  clipCount?: number;
  totalSeconds?: number;
  combinedUrl?: string | null;
  clips?: NarrationClipEntry[];
}

function parseManifest(output: unknown): NarrationManifest | null {
  if (!output) return null;
  if (typeof output === 'object') return output as NarrationManifest;
  try {
    const parsed = JSON.parse(String(output));
    return parsed && typeof parsed === 'object' ? parsed as NarrationManifest : null;
  } catch {
    return null;
  }
}

function seconds(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? `${(value as number).toFixed(1)}s` : '—';
}

/** Play the generated clip audio without leaving the run inspector. */
const NarrationOutputView: React.FC<NodeModuleEditorProps> = ({ node }) => {
  const manifest = useMemo(() => parseManifest(node.output), [node.output]);
  const clips = manifest?.clips ?? [];

  if (!manifest || !clips.length) {
    return (
      <p className="text-sm text-muted">
        Run this node to generate clip narration. The output manifest and audio players appear here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{manifest.voice}</span>
        <span>{manifest.rate}</span>
        <span>{clips.length} clips</span>
        <span>{seconds(manifest.totalSeconds)} total</span>
      </div>

      {manifest.combinedUrl ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted">Full narration</span>
          <audio controls preload="none" src={manifest.combinedUrl} className="w-full" />
        </div>
      ) : null}

      <ol className="flex flex-col gap-3">
        {clips.map((clip) => {
          const overrun = clip.plannedSeconds !== null
            && Number.isFinite(clip.plannedSeconds)
            && clip.durationSeconds > (clip.plannedSeconds as number);
          return (
            <li key={clip.file} className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">Clip {clip.index + 1}</span>
                <span className={`text-xs ${overrun ? 'text-amber-600' : 'text-muted'}`}>
                  {seconds(clip.durationSeconds)}
                  {clip.plannedSeconds !== null ? ` / planned ${seconds(clip.plannedSeconds)}` : ''}
                </span>
              </div>
              <p className="text-sm text-ink">{clip.speech}</p>
              <audio controls preload="none" src={clip.url} className="w-full" />
            </li>
          );
        })}
      </ol>

    </div>
  );
};

export const edgeTtsNarrationModule: NodeModule = {
  type: 'edge-tts-narration',
  label: 'Edge TTS Narration',
  menuLabel: 'Edge TTS Narration',
  description: 'Synthesize per-clip MP3 narration with the Microsoft Edge Read Aloud service. No API key, no Python.',
  icon: 'AudioLines',
  color: '#15803d',
  badge: 'Voice',
  menuOrder: 40,
  createConfig: () => ({ ...DEFAULT_EDGE_TTS_NARRATION_CONFIG }),
  OutputView: NarrationOutputView,
};
