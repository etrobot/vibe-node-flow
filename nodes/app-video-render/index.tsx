import React, { useMemo, useState } from 'react';
import type { NodeModule, NodeModuleEditorProps } from '@/App/types.node-module';
import { api } from '@/App/utils/api';
import { DEFAULT_APP_VIDEO_RENDER_CONFIG } from './config';
import { hydrateDocument } from '../clip-storyboard/resolve.ts';
import { InteractivePlayer } from './renderer/InteractivePlayer';
import { RenderEntrypoint } from './renderer/RenderEntrypoints';
import type { ClipsDocument } from './renderer/clipTypes';
import { Film, Play, Terminal, Loader2 } from 'lucide-react';

interface RenderClipEntry {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  narrationFile: string | null;
  narrationSeconds: number | null;
}

interface RenderManifest {
  slug?: string;
  dryRun?: boolean;
  ready?: boolean;
  problems?: string[];
  videoUrl?: string;
  narrationUrl?: string | null;
  combinedUrl?: string | null;
  projectVideoPath?: string;
  bytes?: number;
  durationSeconds?: number;
  measured?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  crf?: number;
  x264Preset?: string;
  renderSeconds?: number;
  document?: ClipsDocument;
  audio?: {
    narrationClips?: number;
    music?: string | null;
    musicVolume?: number | null;
  };
  clips?: RenderClipEntry[];
  commands?: string[];
}

function parseManifest(output: unknown): RenderManifest | null {
  if (!output) return null;
  if (typeof output === 'object') return output as RenderManifest;
  try {
    const parsed = JSON.parse(String(output));
    return parsed && typeof parsed === 'object' ? parsed as RenderManifest : null;
  } catch {
    return null;
  }
}

function parseObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, any>
      : null;
  } catch {
    return null;
  }
}

/**
 * A compact storyboard still carries `key`/`spot` references and no seconds.
 * The player reads the flat shape, so expand before previewing.
 */
function needsHydration(candidate: Record<string, any>): boolean {
  if (Array.isArray(candidate['global-components']) && candidate['global-components'].length) return true;
  return candidate.clips.some((clip: any) => (clip?.items || []).some(
    (item: any) => item?.key || !(Number(item?.duration) > 0),
  ));
}

/** Convert a full storyboard or an older project summary into a preview document. */
function toPreviewDocument(value: unknown): ClipsDocument | null {
  const parsed = parseObject(value);
  if (!parsed) return null;

  const candidate = parseObject(parsed.document) || parsed;
  if (!Array.isArray(candidate.clips) || candidate.clips.length === 0) return null;

  const hasRendererItems = candidate.clips.some((clip: any) => Array.isArray(clip?.items));
  if (hasRendererItems) {
    return (needsHydration(candidate)
      ? hydrateDocument(candidate as any)
      : candidate) as ClipsDocument;
  }

  // app-video-project manifests written before document persistence contain
  // speech/background summaries only. Keep those historical runs previewable.
  const clips = candidate.clips.map((clip: any) => {
    const speech = String(clip?.speech ?? '').trim();
    const duration = Number(clip?.plannedSeconds ?? clip?.durationSeconds ?? 2);
    return {
      speech,
      background: clip?.background || 'blur',
      items: [{
        type: 'text-typing',
        title: speech || 'Video clip',
        duration: Number.isFinite(duration) && duration > 0 ? duration : 2,
      }],
    };
  });

  return {
    title: candidate.title || 'App Video',
    hue: Number.isFinite(Number(candidate.hue)) ? Number(candidate.hue) : 220,
    chapters: Array.isArray(candidate.chapters) ? candidate.chapters : undefined,
    clips,
  } as ClipsDocument;
}

function seconds(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? `${(value as number).toFixed(1)}s` : '—';
}

function megabytes(value: number | undefined): string {
  return Number.isFinite(value as number) ? `${((value as number) / 1024 / 1024).toFixed(1)} MB` : '—';
}

/** CustomView with Tabs: Preview vs Exported MP4 Video, and Render Button */
const RenderCustomView: React.FC<NodeModuleEditorProps> = ({
  node,
  allNodes,
  readOnly,
  runId,
}) => {
  const [activeTab, setActiveTab] = useState<'preview' | 'mp4'>('preview');
  const [openingRenderTerminal, setOpeningRenderTerminal] = useState(false);
  const [renderTerminalError, setRenderTerminalError] = useState<string | null>(null);
  const manifest = useMemo(() => parseManifest(node.output), [node.output]);

  // Prefer the render manifest's embedded document. This is essential for
  // historical single-node runs where upstream execution records are absent.
  const upstreamDocument = useMemo<ClipsDocument | null>(() => {
    const embeddedDocument = toPreviewDocument(manifest?.document);
    if (embeddedDocument) return embeddedDocument;

    // Search for a full storyboard first.
    const storyboardNode = allNodes.find((n) => n.type === 'clip-storyboard' && n.output);
    const storyboardDocument = toPreviewDocument(storyboardNode?.output);
    if (storyboardDocument) return storyboardDocument;

    // Then recover from an app-video-project summary, including old manifests
    // that predate the embedded document field.
    const projectNode = allNodes.find((n) => n.type === 'app-video-project' && n.output);
    const projectDocument = toPreviewDocument(projectNode?.output);
    if (projectDocument) return projectDocument;

    // A few legacy runs only retained a generic manifest on the render node.
    // Its clips are still enough to build a lightweight preview.
    const renderDocument = toPreviewDocument(manifest);
    if (renderDocument) return renderDocument;

    return null;
  }, [manifest, allNodes]);

  const narrationUrl = useMemo(() => {
    if (manifest?.narrationUrl) return manifest.narrationUrl;
    const narrationNode = allNodes.find((n) => n.type === 'edge-tts-narration' && n.output);
    const narrationManifest = parseManifest(narrationNode?.output);
    return narrationManifest?.combinedUrl || null;
  }, [allNodes, manifest]);

  const canOpenRenderTerminal = Boolean(runId && node.output && node.status !== 'running');

  const openRenderTerminal = async () => {
    if (!runId || openingRenderTerminal) return;
    setOpeningRenderTerminal(true);
    setRenderTerminalError(null);
    try {
      await api.openVideoRenderTerminal(runId);
    } catch (error) {
      setRenderTerminalError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningRenderTerminal(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header Tabs and Manual Render Button */}
      <div className="flex items-center justify-between border-b border-hairline pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'preview'
                ? 'bg-surface-elevated text-ink border border-hairline'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            HTML5 Preview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mp4')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'mp4'
                ? 'bg-surface-elevated text-ink border border-hairline'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            Exported MP4
            {manifest?.videoUrl ? (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            ) : null}
          </button>
        </div>

        {/* Extra capability: rendering is intentionally outside workflow execution. */}
        {canOpenRenderTerminal ? (
          <button
            type="button"
            disabled={openingRenderTerminal}
            onClick={() => void openRenderTerminal()}
            title="Open a terminal and run the MP4 render script"
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors cursor-pointer"
          >
            {openingRenderTerminal ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Opening terminal...
              </>
            ) : (
              <>
                <Terminal className="w-3.5 h-3.5" />
                Render MP4
              </>
            )}
          </button>
        ) : !readOnly ? (
          <span className="text-[11px] text-muted" title="Run the workflow first to create a render context.">
            Run workflow to enable MP4 render
          </span>
        ) : null}
      </div>

      {renderTerminalError ? (
        <div className="rounded-lg border border-semantic-error/30 bg-semantic-error/5 px-3 py-2 text-xs text-semantic-error">
          Could not open the render terminal: {renderTerminalError}
        </div>
      ) : null}

      {/* Tab 1: Interactive Motion Preview */}
      {activeTab === 'preview' && (
        <div className="flex flex-col gap-3">
          {upstreamDocument ? (
            <InteractivePlayer
              document={upstreamDocument}
              audioSrc={narrationUrl}
              onRenderMp4={() => void openRenderTerminal()}
              isRenderingMp4={openingRenderTerminal}
              canRenderMp4={canOpenRenderTerminal}
            />
          ) : (
            <div className="rounded-xl border border-hairline bg-surface-canvas p-8 text-center text-sm text-muted">
              Run the upstream Clip Storyboard or App Video Project node to load the interactive preview.
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Exported Video Player */}
      {activeTab === 'mp4' && (
        <div className="flex flex-col gap-3">
          {manifest?.videoUrl ? (
            <div className="flex flex-col gap-3">
              <video controls preload="metadata" src={manifest.videoUrl} className="w-full rounded-xl bg-black" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>{manifest.width ?? 1920}×{manifest.height ?? 1080}</span>
                <span>{manifest.fps ?? 30} fps</span>
                <span>CRF {manifest.crf ?? 18}</span>
                <span>{seconds(manifest.durationSeconds)}</span>
                <span>{megabytes(manifest.bytes)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-hairline bg-surface-canvas p-8 text-center text-sm text-muted">
              No MP4 video exported yet. Click the <span className="font-semibold text-ink">Render MP4</span> button above to render this video.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const appVideoRenderModule: NodeModule = {
  type: 'app-video-render',
  label: 'App Video Render',
  menuLabel: 'App Video Render',
  description: 'Interactive HTML5 Motion Canvas Preview and Playwright/ffmpeg MP4 exporter.',
  icon: 'Film',
  color: '#7c3aed',
  menuOrder: 50,
  createConfig: () => ({ ...DEFAULT_APP_VIDEO_RENDER_CONFIG }),
  RenderPage: RenderEntrypoint,
  CustomView: RenderCustomView,
  OutputView: RenderCustomView,
};
