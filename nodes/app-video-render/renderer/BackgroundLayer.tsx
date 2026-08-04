import {type CSSProperties, useCallback, useEffect, useRef, useState} from 'react';
import type {ClipBackground} from './clipTypes';
import {getThemeColors} from './theme';

interface BackgroundLayerProps {
  background: ClipBackground;
  effectKey?: string;
  effectTime?: number;
  hue?: number;
  time: number;
  /** Pre-rendered background video URL. When provided, CSS gradient is replaced by <video>. */
  backgroundVideoUrl?: string;
  /** Force the independent 2D fallback background. Kept for API compatibility. */
  force2D?: boolean;
}

type BackgroundVideoSync = (time: number) => Promise<void>;

const backgroundVideoSyncs = new Set<BackgroundVideoSync>();

function refreshBackgroundVideoSync() {
  if (backgroundVideoSyncs.size === 0) {
    (window as any).__syncBackgroundVideo = undefined;
    return;
  }

  (window as any).__syncBackgroundVideo = async (time: number) => {
    await Promise.all(Array.from(backgroundVideoSyncs, (sync) => sync(time)));
  };
}

const BG_COLORS: Record<ClipBackground, string> = {
  aurora: '#070b1a',
  wave: '#07101a',
  blur: '#040409',
  'semrush-glow': '#030306',
};

export default function BackgroundLayer({
  background,
  effectKey,
  effectTime = 0,
  hue,
  time,
  backgroundVideoUrl,
  force2D = false,
}: BackgroundLayerProps) {
  // --- Path A: pre-rendered background video (main render pipeline) ---
  if (backgroundVideoUrl) {
    return (
      <BackgroundVideo
        background={background}
        backgroundVideoUrl={backgroundVideoUrl}
        time={time}
        hue={hue}
        effectKey={effectKey}
        effectTime={effectTime}
      />
    );
  }

  // --- Path B: pure CSS gradient background (no Three.js) ---
  return <GradientBackground background={background} hue={hue} effectKey={effectKey} effectTime={effectTime} time={time} />;
}

// ---- Internal ----

function hueFromBackground(background: ClipBackground, hue?: number) {
  if (Number.isFinite(hue)) return hue as number;
  if (background === 'semrush-glow') return 330;
  if (background === 'wave') return 205;
  if (background === 'aurora') return 280;
  return 280;
}

function GradientBackground({
  background,
  hue,
  effectKey,
  effectTime,
  time,
}: {
  background: ClipBackground;
  hue?: number;
  effectKey?: string;
  effectTime: number;
  time: number;
}) {
  const baseHue = hueFromBackground(background, hue);
  const secondaryHue = (baseHue + 42) % 360;
  const accentHue = (baseHue + 178) % 360;
  const drift = (time * 4) % 360;
  const shockwaveProgress = effectKey ? Math.max(0, Math.min(1, effectTime / 0.8)) : 0;
  const shockwaveOpacity = shockwaveProgress > 0 && shockwaveProgress < 1
    ? Math.sin(shockwaveProgress * Math.PI) * 0.26
    : 0;

  if (background === 'semrush-glow') {
    return (
      <div className="absolute inset-0 z-0 overflow-hidden bg-[#030306]">
        <div
          className="absolute inset-0 opacity-95"
          style={{
            backgroundImage: [
              `radial-gradient(ellipse at ${24 + Math.sin(time * 0.18) * 10}% ${88 + Math.cos(time * 0.2) * 5}%, rgba(255,44,145,0.92), transparent 28%)`,
              `radial-gradient(ellipse at ${43 + Math.cos(time * 0.14) * 8}% ${79 + Math.sin(time * 0.22) * 6}%, rgba(83,118,255,0.88), transparent 30%)`,
              `radial-gradient(ellipse at ${74 + Math.sin(time * 0.16) * 7}% ${74 + Math.cos(time * 0.17) * 7}%, rgba(255,97,25,0.78), transparent 31%)`,
              'linear-gradient(180deg, rgba(0,0,0,0.98) 0%, rgba(0,0,0,0.78) 50%, rgba(0,0,0,0.38) 100%)',
            ].join(', '),
            filter: 'blur(22px) saturate(1.35)',
            transform: `scale(1.12) translate3d(${Math.sin(time * 0.12) * 18}px, ${Math.cos(time * 0.14) * 12}px, 0)`,
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_34%,rgba(0,0,0,0.72)_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.08] mix-blend-screen"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '100% 4px',
          }}
        />
        {shockwaveOpacity > 0 && (
          <div
            className="absolute rounded-full border pointer-events-none"
            style={{
              left: '50%',
              top: '50%',
              width: `${18 + shockwaveProgress * 118}vmax`,
              height: `${18 + shockwaveProgress * 118}vmax`,
              transform: 'translate(-50%, -50%)',
              opacity: shockwaveOpacity,
              borderColor: 'rgba(255,66,163,0.92)',
              boxShadow: '0 0 54px rgba(84,115,255,0.32)',
            }}
          />
        )}
      </div>
    );
  }

  // Aurora / wave / blur — all use the same gradient engine with different hue mappings
  if (background === 'wave') {
    // Wave: teal/cyan mountain-like feel
    const colors = getThemeColors(baseHue);
    return (
      <div className="absolute inset-0 z-0 overflow-hidden" style={{backgroundColor: BG_COLORS[background]}}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              `radial-gradient(circle at ${28 + Math.sin(time * 0.32) * 8}% ${32 + Math.cos(time * 0.27) * 7}%, hsla(${baseHue}, 86%, 56%, 0.34), transparent 34%)`,
              `radial-gradient(circle at ${76 + Math.cos(time * 0.22) * 7}% ${64 + Math.sin(time * 0.3) * 6}%, hsla(${secondaryHue}, 82%, 58%, 0.26), transparent 38%)`,
              `radial-gradient(circle at ${52 + Math.sin(time * 0.18) * 6}% ${80 + Math.cos(time * 0.25) * 5}%, hsla(${accentHue}, 76%, 48%, 0.22), transparent 42%)`,
              `linear-gradient(${128 + drift * 0.08}deg, hsl(${baseHue}, 48%, 8%) 0%, hsl(${accentHue}, 42%, 10%) 54%, hsl(${secondaryHue}, 48%, 7%) 100%)`,
            ].join(', '),
          }}
        />
        {/* Mountain-like wireframe grid */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            transform: `translate3d(${-(time * 6) % 48}px, ${-(time * 4) % 48}px, 0)`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, transparent 26%, rgba(0,0,0,0.52) 72%, rgba(0,0,0,0.86) 100%)',
          }}
        />
        {shockwaveOpacity > 0 && (
          <div
            className="absolute rounded-full border pointer-events-none"
            style={{
              left: '50%',
              top: '50%',
              width: `${18 + shockwaveProgress * 118}vmax`,
              height: `${18 + shockwaveProgress * 118}vmax`,
              transform: 'translate(-50%, -50%)',
              opacity: shockwaveOpacity,
              borderColor: `hsla(${accentHue}, 96%, 68%, 0.9)`,
              boxShadow: `0 0 48px hsla(${accentHue}, 96%, 62%, 0.28)`,
            }}
          />
        )}
      </div>
    );
  }

  if (background === 'aurora') {
    // Aurora: purple/indigo blob-like feel
    const colors = getThemeColors(baseHue);
    return (
      <div className="absolute inset-0 z-0 overflow-hidden" style={{backgroundColor: BG_COLORS[background]}}>
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              `radial-gradient(circle at ${30 + Math.sin(time * 0.28) * 10}% ${28 + Math.cos(time * 0.22) * 8}%, hsla(${baseHue}, 88%, 62%, 0.38), transparent 36%)`,
              `radial-gradient(circle at ${70 + Math.cos(time * 0.18) * 8}% ${68 + Math.sin(time * 0.32) * 6}%, hsla(${secondaryHue}, 84%, 54%, 0.28), transparent 40%)`,
              `radial-gradient(circle at ${50 + Math.sin(time * 0.14) * 12}% ${50 + Math.cos(time * 0.2) * 10}%, hsla(${(baseHue + 90) % 360}, 78%, 50%, 0.18), transparent 46%)`,
              `linear-gradient(${160 + drift * 0.06}deg, hsl(${baseHue}, 52%, 6%) 0%, hsl(${secondaryHue}, 46%, 9%) 50%, hsl(${accentHue}, 48%, 7%) 100%)`,
            ].join(', '),
          }}
        />
        <div
          className="absolute inset-0 opacity-45"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
            transform: `translate3d(${-(time * 8) % 64}px, ${-(time * 5) % 64}px, 0)`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, transparent 26%, rgba(0,0,0,0.52) 72%, rgba(0,0,0,0.86) 100%)',
          }}
        />
        {shockwaveOpacity > 0 && (
          <div
            className="absolute rounded-full border pointer-events-none"
            style={{
              left: '50%',
              top: '50%',
              width: `${18 + shockwaveProgress * 118}vmax`,
              height: `${18 + shockwaveProgress * 118}vmax`,
              transform: 'translate(-50%, -50%)',
              opacity: shockwaveOpacity,
              borderColor: `hsla(${accentHue}, 96%, 68%, 0.9)`,
              boxShadow: `0 0 48px hsla(${accentHue}, 96%, 62%, 0.28)`,
            }}
          />
        )}
      </div>
    );
  }

  // blur (default)
  return (
    <div
      className="absolute inset-0 z-0 overflow-hidden"
      style={{
        backgroundColor: BG_COLORS[background],
        backgroundImage: [
          `radial-gradient(circle at ${28 + Math.sin(time * 0.32) * 8}% ${32 + Math.cos(time * 0.27) * 7}%, hsla(${baseHue}, 86%, 56%, 0.34), transparent 34%)`,
          `radial-gradient(circle at ${76 + Math.cos(time * 0.22) * 7}% ${64 + Math.sin(time * 0.3) * 6}%, hsla(${secondaryHue}, 82%, 58%, 0.26), transparent 38%)`,
          `linear-gradient(${128 + drift * 0.08}deg, hsl(${baseHue}, 48%, 8%) 0%, hsl(${accentHue}, 42%, 10%) 54%, hsl(${secondaryHue}, 48%, 7%) 100%)`,
        ].join(', '),
      }}
    >
      <div
        className="absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          transform: `translate3d(${-(time * 8) % 64}px, ${-(time * 5) % 64}px, 0)`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, transparent 26%, rgba(0,0,0,0.52) 72%, rgba(0,0,0,0.86) 100%)',
        }}
      />
      {shockwaveOpacity > 0 && (
        <div
          className="absolute rounded-full border pointer-events-none"
          style={{
            left: '50%',
            top: '50%',
            width: `${18 + shockwaveProgress * 118}vmax`,
            height: `${18 + shockwaveProgress * 118}vmax`,
            transform: 'translate(-50%, -50%)',
            opacity: shockwaveOpacity,
            borderColor: `hsla(${accentHue}, 96%, 68%, 0.9)`,
            boxShadow: `0 0 48px hsla(${accentHue}, 96%, 62%, 0.28)`,
          }}
        />
      )}
    </div>
  );
}

function videoTargetTime(time: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const looped = ((time % duration) + duration) % duration;
  return Math.min(looped, Math.max(0, duration - 1 / 60));
}

async function waitForMetadata(video: HTMLVideoElement) {
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

async function seekVideoFrame(video: HTMLVideoElement, time: number) {
  video.pause();
  await waitForMetadata(video);

  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.error) return;

  const target = videoTargetTime(time, video.duration);
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

function BackgroundVideo({
  background,
  backgroundVideoUrl,
  time,
  hue,
  effectKey,
  effectTime,
}: {
  background: ClipBackground;
  backgroundVideoUrl: string;
  time: number;
  hue?: number;
  effectKey?: string;
  effectTime: number;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const syncTokenRef = useRef(0);
  const [failed, setFailed] = useState(false);
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none',
    filter: background === 'wave' ? 'brightness(1.55) saturate(1.35) contrast(1.08)' : undefined,
  };

  useEffect(() => {
    setFailed(false);
  }, [backgroundVideoUrl]);

  if (failed) {
    return <GradientBackground background={background} hue={hue} effectKey={effectKey} effectTime={effectTime} time={time} />;
  }

  const syncToTime = useCallback(async (nextTime: number) => {
    const video = videoRef.current;
    if (!video) return;

    const token = ++syncTokenRef.current;
    await seekVideoFrame(video, nextTime);
    if (token !== syncTokenRef.current) return;
  }, []);

  useEffect(() => {
    const sync: BackgroundVideoSync = (nextTime: number) => syncToTime(nextTime);
    backgroundVideoSyncs.add(sync);
    refreshBackgroundVideoSync();
    return () => {
      backgroundVideoSyncs.delete(sync);
      refreshBackgroundVideoSync();
    };
  }, [syncToTime]);

  useEffect(() => {
    syncToTime(time).catch(() => undefined);
  }, [backgroundVideoUrl, syncToTime, time]);

  return (
    <>
      <GradientBackground background={background} hue={hue} effectKey={effectKey} effectTime={effectTime} time={time} />
      <video
        ref={videoRef}
        className="absolute inset-0 z-0 w-full h-full object-cover"
        src={backgroundVideoUrl}
        muted
        playsInline
        preload="auto"
        style={style}
        onError={(e) => {
          (e.target as HTMLVideoElement).style.display = 'none';
          setFailed(true);
        }}
      />
    </>
  );
}