import {type CSSProperties, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import BackgroundLayer from './BackgroundLayer';
import ClipRenderer from './ClipRenderer';
import SceneLayers from './SceneLayers';
import {getDocumentHue, getThemeColors} from './theme';
import TransitionOverlay from './TransitionOverlay';
import {defaultClipsData as clipsData} from './defaultData';
import type {ClipBackground, ClipsDocument} from './clipTypes';
import {clamp, getClipDuration, getTotalDuration} from './clipModel';
import {toRendererDocument} from '../document.ts';

declare global {
  interface Window {
    __renderReady?: boolean;
    __renderError?: string;
    __setRenderTime?: (time: number) => Promise<void>;
    __setPlayerTime?: (time: number) => Promise<void>;
    __syncRenderAnimations?: (time: number) => void;
    __syncBackgroundVideo?: (time: number) => Promise<void>;
    __setBackgroundTime?: (time: number) => Promise<void>;
    __syncTransitionVideo?: (progress: number | null) => Promise<void>;
    __setTransitionProgress?: (progress: number) => Promise<void>;
    __compositeReady?: boolean;
    __setCompositeTime?: (time: number) => Promise<void>;
  }
}

const TRANSITION_SECONDS = 0.6;

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function waitForDemoFrames() {
  const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-demo-ui]'));
  await Promise.all(frames.map((frame) => new Promise<void>((resolve, reject) => {
    if (frame.contentDocument?.readyState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      frame.removeEventListener('load', onLoad);
      frame.removeEventListener('error', onError);
    };
    const onLoad = () => {
      done();
      if (!frame.contentDocument?.querySelector('[data-demo-ui]')) {
        reject(new Error(`Demo UI HTML did not expose a product surface: ${frame.src}`));
        return;
      }
      resolve();
    };
    const onError = () => { done(); reject(new Error(`Demo UI HTML failed to load: ${frame.src}`)); };
    frame.addEventListener('load', onLoad, {once: true});
    frame.addEventListener('error', onError, {once: true});
  })));
}

function useRenderSurface(background = 'transparent') {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      bodyMargin: body.style.margin,
      bodyOverflow: body.style.overflow,
      rootBg: root?.style.background,
    };

    html.style.background = background;
    body.style.background = background;
    body.style.margin = '0';
    body.style.overflow = 'hidden';
    if (root) root.style.background = background;

    return () => {
      html.style.background = previous.htmlBg;
      body.style.background = previous.bodyBg;
      body.style.margin = previous.bodyMargin;
      body.style.overflow = previous.bodyOverflow;
      if (root && previous.rootBg !== undefined) root.style.background = previous.rootBg;
    };
  }, [background]);
}

function useRenderAnimationSync() {
  const animationStartsRef = useRef<WeakMap<Animation, number>>(new WeakMap());

  return useCallback((time: number) => {
    document.documentElement.style.setProperty('--render-time', String(time));

    for (const animation of document.getAnimations()) {
      if (!animationStartsRef.current.has(animation)) {
        animationStartsRef.current.set(animation, time);
      }

      const start = animationStartsRef.current.get(animation) ?? time;
      const elapsedMs = Math.max(0, (time - start) * 1000);
      const timing = animation.effect?.getTiming();
      const duration = typeof timing?.duration === 'number' ? timing.duration : Infinity;
      const iterations = typeof timing?.iterations === 'number' ? timing.iterations : Infinity;
      const delay = typeof timing?.delay === 'number' ? timing.delay : 0;
      const endDelay = typeof timing?.endDelay === 'number' ? timing.endDelay : 0;
      const maxMs = Number.isFinite(duration) && Number.isFinite(iterations)
        ? Math.max(0, delay + duration * iterations + endDelay)
        : Infinity;

      animation.pause();
      animation.currentTime = Math.min(elapsedMs, maxMs);
    }
  }, []);
}

function getQuery() {
  return new URLSearchParams(window.location.search);
}

export function shouldUseRenderEntrypoint() {
  return getQuery().has('render');
}

export function RenderEntrypoint() {
  const mode = getQuery().get('render');
  if (mode === 'player') return <DirectPlayerRenderer />;
  if (mode === 'clip') return <TransparentClipRenderer />;
  if (mode === 'background') return <BackgroundVideoRenderer />;
  if (mode === 'transition') return <TransitionFrameRenderer />;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-primary">
      Unknown render mode.
    </div>
  );
}

function useProjectData(projectName: string | null) {
  const [data, setData] = useState<ClipsDocument | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.__renderReady = false;
    window.__renderError = undefined;
    const runId = getQuery().get('run');

    async function load() {
      try {
        if (!projectName && !runId) {
          if (!cancelled) setData(clipsData);
          return;
        }

        const response = runId
          ? await fetch(`/api/video/spec/${encodeURIComponent(runId)}`)
          : await fetch(`/api/projects/${encodeURIComponent(projectName)}`);
        if (!response.ok) throw new Error(`Failed to load render project: ${response.status}`);
        let payload = await response.json();
        if (typeof payload === 'string') payload = JSON.parse(payload);
        // Same hydration as HTML5 preview: expand global-components onto items.
        // Without this, process/feedback cards fall back to hardcoded defaults.
        const data = toRendererDocument(payload);
        if (!data || !Array.isArray(data.clips)) {
          throw new Error('Project clip data is missing a clips array.');
        }
        if (!cancelled) setData(data as ClipsDocument);
      } catch (err: any) {
        window.__renderError = err?.message || String(err);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  return data;
}

function makeThemeStyle(document?: ClipsDocument | null): CSSProperties {
  const theme = getThemeColors(document ? getDocumentHue(document) : undefined);
  return {
    '--theme-primary': theme.themePrimary,
    '--theme-secondary': theme.themeSecondary,
    '--theme-accent': theme.themeAccent,
    '--theme-glow': theme.themeGlow,
  } as CSSProperties;
}

function getTransitionProgress(clips: ClipsDocument['clips'] | undefined, time: number) {
  if (!clips?.length) return null;

  const halfDuration = TRANSITION_SECONDS / 2;
  let boundary = 0;

  for (let i = 0; i < clips.length - 1; i++) {
    boundary += getClipDuration(clips[i]);
    if (time >= boundary - halfDuration && time <= boundary + halfDuration) {
      return (time - (boundary - halfDuration)) / TRANSITION_SECONDS;
    }
  }

  return null;
}

function DirectPlayerRenderer() {
  useRenderSurface('#000000');
  const query = useMemo(() => getQuery(), []);
  const projectName = query.get('project');
  const projectData = useProjectData(projectName);
  const clips = projectData?.clips;
  const totalDuration = useMemo(() => clips ? getTotalDuration(clips) : 0, [clips]);
  const [time, setTime] = useState(0);
  const themeStyle = useMemo(() => makeThemeStyle(projectData), [projectData]);
  const syncRenderAnimations = useRenderAnimationSync();
  const availableBackgroundVideos = useMemo(() => new Set(
    (query.get('backgroundVideos') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ), [query]);
  const resolveBackgroundVideoUrl = useCallback((background: ClipBackground) => (
    projectName && availableBackgroundVideos.has(background)
      ? `${window.location.origin}/api/projects/${encodeURIComponent(projectName)}/backgrounds/${background}.mp4`
      : undefined
  ), [availableBackgroundVideos, projectName]);

  useEffect(() => {
    if (!clips?.length) return;

    let cancelled = false;
    window.__setPlayerTime = async (nextTime: number) => {
      const clampedTime = clamp(nextTime, 0, totalDuration);
      flushSync(() => {
        setTime(clampedTime);
      });
      syncRenderAnimations(clampedTime);
      await window.__syncBackgroundVideo?.(clampedTime);
    };
    window.__syncRenderAnimations = syncRenderAnimations;

    Promise.resolve(document.fonts?.ready)
      .then(waitForPaint)
      .then(waitForDemoFrames)
      .then(() => {
        if (!cancelled) window.__renderReady = true;
      })
      .catch((err) => {
        window.__renderError = err?.message || String(err);
      });

    return () => {
      cancelled = true;
      window.__renderReady = false;
      window.__setPlayerTime = undefined;
      window.__syncRenderAnimations = undefined;
    };
  }, [clips, totalDuration, syncRenderAnimations]);

  if (!clips?.length) {
    return <div className="fixed inset-0 bg-black" />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden" data-render-root="player">
      <div className="absolute inset-0 overflow-hidden">
        <SceneLayers
          clips={clips}
          time={time}
          hue={projectData ? getDocumentHue(projectData) : undefined}
          projectName={projectName}
          themeStyle={themeStyle}
          resolveBackgroundVideoUrl={resolveBackgroundVideoUrl}
          force2DWithoutVideo
        />
      </div>
    </div>
  );
}

async function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) return;

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onDone);
      video.removeEventListener('error', onDone);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };
    video.addEventListener('loadedmetadata', onDone, {once: true});
    video.addEventListener('error', onDone, {once: true});
  });
}

async function seekTransitionFrame(video: HTMLVideoElement, progress: number | null) {
  video.pause();
  if (progress === null) return;

  await waitForVideoMetadata(video);
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.error) return;

  const target = Math.min(clamp(progress, 0, 1) * video.duration, Math.max(0, video.duration - 1 / 60));
  if (Math.abs(video.currentTime - target) < 1 / 240 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  await new Promise<void>((resolve) => {
    const cleanup = () => {
      video.removeEventListener('seeked', onDone);
      video.removeEventListener('error', onDone);
    };
    const onDone = () => {
      cleanup();
      resolve();
    };

    video.addEventListener('seeked', onDone, {once: true});
    video.addEventListener('error', onDone, {once: true});

    try {
      video.currentTime = target;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < 1 / 240) {
        onDone();
      }
    } catch {
      onDone();
    }
  });
}

function TransitionVideoLayer({videoUrl, progress}: {videoUrl: string; progress: number | null}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const syncTokenRef = useRef(0);

  const syncToProgress = useCallback(async (nextProgress: number | null) => {
    const video = videoRef.current;
    if (!video) return;

    const token = ++syncTokenRef.current;
    await seekTransitionFrame(video, nextProgress);
    if (token !== syncTokenRef.current) return;
  }, []);

  useEffect(() => {
    const sync = (nextProgress: number | null) => syncToProgress(nextProgress);
    window.__syncTransitionVideo = sync;
    return () => {
      if (window.__syncTransitionVideo === sync) {
        window.__syncTransitionVideo = undefined;
      }
    };
  }, [syncToProgress]);

  useEffect(() => {
    syncToProgress(progress).catch(() => undefined);
  }, [progress, syncToProgress, videoUrl]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 z-50 h-full w-full object-cover pointer-events-none"
      src={videoUrl}
      muted
      playsInline
      preload="auto"
      style={{
        display: progress === null ? 'none' : 'block',
      }}
    />
  );
}

function TransparentClipRenderer() {
  useRenderSurface();
  const [localTime, setLocalTime] = useState(0);
  const query = useMemo(() => getQuery(), []);
  const clipIndex = Number(query.get('clip') || '0');
  const projectName = query.get('project');
  const projectData = useProjectData(projectName);
  const clips = projectData?.clips;

  const clip = clips?.[clipIndex];
  const themeStyle = useMemo(() => makeThemeStyle(projectData), [projectData]);
  const syncRenderAnimations = useRenderAnimationSync();

  useEffect(() => {
    if (!clip) return;

    let cancelled = false;
    window.__setRenderTime = async (nextTime: number) => {
      flushSync(() => {
        setLocalTime(clamp(nextTime, 0, getClipDuration(clip)));
      });
      syncRenderAnimations(nextTime);
    };
    window.__syncRenderAnimations = syncRenderAnimations;

    Promise.resolve(document.fonts?.ready)
      .then(waitForPaint)
      .then(() => {
        if (!cancelled) window.__renderReady = true;
      })
      .catch((err) => {
        window.__renderError = err?.message || String(err);
      });

    return () => {
      cancelled = true;
      window.__renderReady = false;
      window.__setRenderTime = undefined;
      window.__syncRenderAnimations = undefined;
    };
  }, [clip, syncRenderAnimations]);

  if (!clip) {
    return <div className="fixed inset-0 bg-transparent" />;
  }

  return (
    <div
      className="fixed inset-0 bg-transparent overflow-hidden"
      data-render-root="clip"
      style={themeStyle}
    >
      <ClipRenderer clip={clip} localTime={localTime} projectName={projectName} />
    </div>
  );
}

function TransitionFrameRenderer() {
  useRenderSurface();
  const query = useMemo(() => getQuery(), []);
  const projectName = query.get('project');
  const projectData = useProjectData(projectName);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!projectData) return;

    let cancelled = false;
    window.__setTransitionProgress = async (nextProgress: number) => {
      flushSync(() => {
        setProgress(clamp(nextProgress, 0, 1));
      });
    };

    Promise.resolve(document.fonts?.ready)
      .then(waitForPaint)
      .then(() => {
        if (!cancelled) window.__renderReady = true;
      })
      .catch((err) => {
        window.__renderError = err?.message || String(err);
      });

    return () => {
      cancelled = true;
      window.__renderReady = false;
      window.__setTransitionProgress = undefined;
    };
  }, [projectData]);

  return (
    <div className="fixed inset-0 bg-transparent overflow-hidden" data-render-root="transition">
      <TransitionOverlay progress={progress} hue={projectData ? getDocumentHue(projectData) : undefined} quality="soft" />
    </div>
  );
}

/** Background renderer for pre-rendering deterministic loop videos. */
function BackgroundVideoRenderer() {
  useRenderSurface();
  const query = useMemo(() => getQuery(), []);
  const bgType = (query.get('type') || 'blur') as ClipBackground;
  const projectName = query.get('project');
  const projectData = useProjectData(projectName);
  const [time, setTime] = useState(0);
  const readyForRender = !projectName || projectData !== null;

  useEffect(() => {
    if (!readyForRender) return;

    window.__setBackgroundTime = async (nextTime: number) => {
      flushSync(() => {
        setTime(Math.max(0, nextTime));
      });
      await waitForPaint();
    };

    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__renderReady = true;
    }));

    return () => {
      window.__renderReady = false;
      window.__setBackgroundTime = undefined;
    };
  }, [readyForRender]);

  if (!readyForRender) {
    return <div className="fixed inset-0 bg-black" />;
  }

  // Pure CSS gradient background — no Three.js
  return <BackgroundLayer background={bgType} hue={projectData ? getDocumentHue(projectData) : undefined} time={time} />;
}
