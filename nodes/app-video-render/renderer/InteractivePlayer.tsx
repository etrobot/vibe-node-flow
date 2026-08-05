import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {CalendarRange, Pause, Play, RotateCcw, Volume2, VolumeX} from 'lucide-react';
import type {Clip, ClipsDocument} from './clipTypes';
import {
  clamp,
  getClipBackground,
  getClipDuration,
  getTotalDuration,
  locateClip,
  locateClipItem,
} from './clipModel';
import ClipRenderer from './ClipRenderer';
import BackgroundLayer from './BackgroundLayer';
import TransitionOverlay from './TransitionOverlay';
import {getThemeColors} from './theme';

export interface InteractivePlayerProps {
  document: ClipsDocument;
  /** Combined Edge TTS narration for the preview timeline, when available. */
  audioSrc?: string | null;
}

interface TimedClip {
  clip: Clip;
  index: number;
  start: number;
  end: number;
  duration: number;
}

interface TimedChapter {
  title: string;
  summary?: string;
  index: number;
  startClip: number;
  endClip: number;
  start: number;
  end: number;
  duration: number;
}

function formatTime(value: number) {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safeValue / 60).toString().padStart(2, '0');
  const seconds = Math.floor(safeValue % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function clipLabel(clip: Clip, index: number) {
  const itemType = clip.items[0]?.type;
  const label = itemType ? itemType.replace(/^./, (letter) => letter.toUpperCase()).replaceAll('-', ' ') : `Clip ${index + 1}`;
  return clip.items.length > 1 ? `${label} +${clip.items.length - 1}` : label;
}

function getTimedClips(clips: Clip[]): TimedClip[] {
  let start = 0;
  return clips.map((clip, index) => {
    const duration = getClipDuration(clip);
    const timedClip = {clip, index, start, end: start + duration, duration};
    start += duration;
    return timedClip;
  });
}

function getTimedChapters(document: ClipsDocument, clips: TimedClip[], totalDuration: number): TimedChapter[] {
  const configuredChapters = Array.isArray(document.chapters) ? document.chapters : [];
  const chapters = configuredChapters.length > 0
    ? configuredChapters
    : document.clips.length > 3
      ? Array.from({length: Math.ceil(document.clips.length / 3)}, (_, index) => {
        const startClip = index * 3;
        const speech = document.clips[startClip]?.speech?.trim() || '';
        const title = speech.split(/[，。,.]/)[0]?.trim().slice(0, 22);
        return {
          title: title || `Chapter ${index + 1}`,
          summary: speech.slice(0, 90),
          startClip,
          clipCount: Math.min(3, document.clips.length - startClip),
        };
      })
      : [];

  if (chapters.length === 0 || clips.length === 0) return [];

  return chapters.flatMap((chapter, chapterIndex) => {
    const rawStartClip = Number(chapter.startClip);
    if (!Number.isFinite(rawStartClip)) return [];

    const startClip = Math.floor(clamp(rawStartClip, 0, clips.length - 1));
    const nextChapterStart = Number(chapters[chapterIndex + 1]?.startClip);
    const hasClipCount = Number.isFinite(chapter.clipCount) && (chapter.clipCount as number) > 0;
    const endClip = Math.floor(clamp(
      hasClipCount
        ? startClip + Number(chapter.clipCount)
        : Number.isFinite(nextChapterStart) && nextChapterStart > startClip
          ? nextChapterStart
          : clips.length,
      startClip + 1,
      clips.length,
    ));
    const start = clips[startClip]?.start ?? 0;
    const end = endClip < clips.length ? clips[endClip].start : totalDuration;

    return [{
      title: chapter.title || `Chapter ${chapterIndex + 1}`,
      summary: chapter.summary,
      index: chapterIndex,
      startClip,
      endClip,
      start,
      end,
      duration: Math.max(0, end - start),
    }];
  });
}

export const InteractivePlayer = ({document, audioSrc = null}: InteractivePlayerProps) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const lastVolumeRef = useRef(1);
  const [foregroundScale, setForegroundScale] = useState(1);
  const animationFrameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);

  const totalDuration = useMemo(() => getTotalDuration(document.clips), [document.clips]);
  const timedClips = useMemo(() => getTimedClips(document.clips), [document.clips]);
  const timedChapters = useMemo(
    () => getTimedChapters(document, timedClips, totalDuration),
    [document, timedClips, totalDuration],
  );
  const located = useMemo(
    () => locateClip(document.clips, currentTime),
    [document.clips, currentTime],
  );
  const activeClip = located?.clip ?? null;
  const activeClipIndex = located?.clipIndex ?? -1;
  const activeItem = activeClip ? locateClipItem(activeClip, located?.localTime ?? 0) : null;
  const theme = useMemo(() => getThemeColors(document.hue, document.palette), [document.hue, document.palette]);
  const themeStyle = useMemo(() => ({
    '--theme-primary': theme.themePrimary,
    '--theme-secondary': theme.themeSecondary,
    '--theme-accent': theme.themeAccent,
    '--theme-glow': theme.themeGlow,
  }) as CSSProperties, [theme]);

  const transitionProgress = useMemo(() => {
    const halfDuration = 0.5;
    for (let index = 0; index < timedClips.length - 1; index += 1) {
      const boundary = timedClips[index].end;
      if (currentTime >= boundary - halfDuration && currentTime <= boundary + halfDuration) {
        return (currentTime - (boundary - halfDuration)) / (halfDuration * 2);
      }
    }
    return null;
  }, [currentTime, timedClips]);

  const effectKey = located && activeItem?.item.effect === 'shockwave'
    ? `${located.clipIndex}:${activeItem.index}:${activeItem.start}:${activeItem.item.type}`
    : undefined;

  const activeChapterIndex = useMemo(() => {
    const index = timedChapters.findIndex((chapter) => currentTime >= chapter.start && currentTime < chapter.end);
    return index >= 0 ? index : timedChapters.length - 1;
  }, [currentTime, timedChapters]);

  const seek = useCallback((nextTime: number) => {
    const clampedTime = clamp(nextTime, 0, totalDuration);
    setCurrentTime(clampedTime);
    if (audioRef.current && audioSrc) audioRef.current.currentTime = clampedTime;
    lastTickRef.current = null;
  }, [audioSrc, totalDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted;
  }, [isMuted, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(totalDuration);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioSrc, totalDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
  }, [audioSrc]);

  useLayoutEffect(() => {
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      // The motion scenes are authored against a 1120px canvas. The node
      // inspector is usually much narrower than the standalone player, so
      // scale only the foreground to the actual preview width.
      const width = viewport.clientWidth;
      if (width > 0) setForegroundScale(Math.max(0.45, Math.min(1, width / 1120)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isPlaying || totalDuration <= 0) {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const audio = audioRef.current;
    const tick = (now: number) => {
      if (audioSrc && audio) {
        if (audio.paused || audio.ended) {
          setIsPlaying(false);
          return;
        }
        setCurrentTime(Math.min(audio.currentTime, totalDuration));
        animationFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastTickRef.current !== null) {
        const delta = Math.min((now - lastTickRef.current) / 1000, 0.25);
        setCurrentTime((previousTime) => {
          const nextTime = previousTime + delta;
          if (nextTime >= totalDuration) {
            setIsPlaying(false);
            return totalDuration;
          }
          return nextTime;
        });
      }
      lastTickRef.current = now;
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      lastTickRef.current = null;
    };
  }, [audioSrc, isPlaying, totalDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    audio?.pause();
    setCurrentTime((previousTime) => {
      const nextTime = Math.min(previousTime, totalDuration);
      if (audio && audioSrc) audio.currentTime = nextTime;
      return nextTime;
    });
    setIsPlaying(false);
  }, [audioSrc, document.clips, totalDuration]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!playerRef.current?.contains(event.target as Node)) return;
      if (event.key === ' ' || event.key === 'k') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seek(currentTime - 5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seek(currentTime + 5);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const togglePlay = () => {
    if (totalDuration <= 0) return;
    const audio = audioRef.current;
    const startsAtEnd = currentTime >= totalDuration;
    if (startsAtEnd) {
      setCurrentTime(0);
      if (audio && audioSrc) audio.currentTime = 0;
    }

    if (audio && audioSrc) {
      if (isPlaying) {
        audio.pause();
      } else {
        void audio.play().catch(() => setIsPlaying(false));
      }
      return;
    }

    lastTickRef.current = null;
    setIsPlaying((playing) => !playing);
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePlay();
    }
  };

  const handleSeekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * totalDuration);
  };

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = clamp(Number(event.target.value), 0, 1);
    if (nextVolume > 0) lastVolumeRef.current = nextVolume;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
  };

  const toggleMute = () => {
    if (isMuted || volume === 0) {
      const restoredVolume = lastVolumeRef.current > 0 ? lastVolumeRef.current : 1;
      setVolume(restoredVolume);
      setIsMuted(false);
    } else {
      setIsMuted(true);
    }
  };

  if (document.clips.length === 0 || totalDuration <= 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-hairline bg-black text-sm text-muted">
        No clips available for preview.
      </div>
    );
  }

  const currentClipScale = located && located.duration > 0
    ? located.clipIndex % 2 === 0
      ? 1 + clamp(located.localTime / located.duration, 0, 1) * 0.1
      : 1.1 - clamp(located.localTime / located.duration, 0, 1) * 0.1
    : 1;

  return (
    <div ref={playerRef} className="flex w-full flex-col gap-3 text-ink" style={themeStyle}>
      {audioSrc ? <audio ref={audioRef} preload="auto" src={audioSrc} aria-label="Video narration" className="hidden" /> : null}
      <div
        ref={previewViewportRef}
        className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]"
        role="button"
        tabIndex={0}
        aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
        onClick={togglePlay}
        onKeyDown={handlePreviewKeyDown}
      >
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0 h-full w-full ease-out"
            style={{
              transform: `scale(${currentClipScale})`,
              transition: isPlaying ? 'transform 0.08s linear' : 'transform 0.3s ease-out',
            }}
          >
            <BackgroundLayer
              background={activeClip ? getClipBackground(activeClip) : 'blur'}
              effectKey={effectKey}
              effectTime={activeItem?.localTime}
              hue={document.hue}
              palette={document.palette}
              time={currentTime}
            />
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              style={{
                transform: `scale(${foregroundScale})`,
                transformOrigin: 'center center',
              }}
            >
              {activeClip && (
                <ClipRenderer
                  key={`${activeClipIndex}:${activeClip.speech}`}
                  clip={activeClip}
                  localTime={located?.localTime ?? 0}
                />
              )}
            </div>
          </div>

          {transitionProgress !== null && (
            <TransitionOverlay progress={transitionProgress} hue={document.hue} palette={document.palette} />
          )}

          {!isPlaying && currentTime === 0 && (
            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] transition group-hover:bg-black/40">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-black shadow-[0_0_70px_rgba(255,255,255,0.35)] transition-transform group-hover:scale-105 sm:h-24 sm:w-24">
                <Play className="ml-1.5 h-8 w-8 sm:h-10 sm:w-10" />
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[101] h-20 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-1 text-[10px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-[var(--theme-primary)]" />
          <span className="truncate">Click a segment to seek · Use Space to play or pause</span>
        </span>
        <span className="shrink-0 font-mono tabular-nums text-ink">
          {formatTime(currentTime)} <span className="text-muted">/</span> {formatTime(totalDuration)}
        </span>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-canvas p-3 shadow-lg sm:flex-row sm:items-center sm:gap-6 sm:p-4">
        <div className="flex shrink-0 items-center gap-3 sm:min-w-[150px] sm:border-r sm:border-hairline sm:pr-5">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary)] text-white shadow-md transition hover:brightness-110 active:scale-95"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : currentTime >= totalDuration ? <RotateCcw className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
          </button>
          <span className="font-mono text-xs font-semibold tabular-nums text-muted">
            {formatTime(currentTime)} <span className="text-muted/60">/</span> {formatTime(totalDuration)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:border-r sm:border-hairline sm:pr-5" aria-label="Audio controls">
          <button
            type="button"
            onClick={toggleMute}
            disabled={!audioSrc}
            aria-label={isMuted || volume === 0 ? 'Unmute preview' : 'Mute preview'}
            title={audioSrc ? (isMuted || volume === 0 ? 'Unmute preview' : 'Mute preview') : 'Narration audio is not available'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-elevated hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            disabled={!audioSrc}
            aria-label="Preview volume"
            className="h-1.5 w-20 cursor-pointer accent-[var(--theme-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted">
            {Math.round((isMuted ? 0 : volume) * 100)}%
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div
            className="relative h-2 min-w-0 cursor-pointer rounded-full bg-surface-elevated"
            role="slider"
            tabIndex={0}
            aria-label="Video timeline"
            aria-valuemin={0}
            aria-valuemax={totalDuration}
            aria-valuenow={currentTime}
            onPointerDown={handleSeekFromPointer}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') seek(currentTime - 1);
              if (event.key === 'ArrowRight') seek(currentTime + 1);
              if (event.key === 'Home') seek(0);
              if (event.key === 'End') seek(totalDuration);
            }}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-accent)]"
              style={{width: `${(currentTime / totalDuration) * 100}%`}}
            />
            {timedClips.slice(0, -1).map((clip) => (
              <span
                key={clip.index}
                className="absolute inset-y-0 w-px bg-white/30"
                style={{left: `${(clip.end / totalDuration) * 100}%`}}
              />
            ))}
            <span
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--theme-accent)] shadow-[0_0_10px_var(--theme-glow)]"
              style={{left: `${(currentTime / totalDuration) * 100}%`}}
            />
          </div>

          {timedChapters.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {timedChapters.map((chapter, index) => {
              const isActive = index === activeChapterIndex;
              const progress = currentTime <= chapter.start
                ? 0
                : currentTime >= chapter.end
                  ? 100
                  : ((currentTime - chapter.start) / Math.max(chapter.duration, 0.1)) * 100;
              return (
                <button
                  key={`${chapter.index}-${chapter.startClip}-${chapter.title}`}
                  type="button"
                  title={`${chapter.title} (${formatTime(chapter.duration)})${chapter.summary ? ` — ${chapter.summary}` : ''}`}
                  onClick={() => seek(chapter.start)}
                  style={{flexGrow: Math.max(chapter.duration, 1)}}
                  className={`relative min-w-[142px] max-w-[260px] flex-1 overflow-hidden rounded-lg border px-2.5 py-2 text-left transition ${
                    isActive
                      ? 'border-[var(--theme-accent)]/60 bg-[var(--theme-accent)]/10 text-ink shadow-[0_0_18px_var(--theme-glow)]'
                      : 'border-hairline bg-surface-canvas-soft text-muted hover:border-hairline-strong hover:text-ink'
                  }`}
                >
                  <span className="absolute inset-y-0 left-0 bg-[var(--theme-accent)]/10" style={{width: `${progress}%`}} />
                  <span className="relative flex items-center gap-2">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[9px] font-black ${isActive ? 'bg-[var(--theme-accent)] text-black' : 'bg-surface-elevated text-muted'}`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">{chapter.title}</span>
                    <span className="shrink-0 font-mono text-[9px] opacity-70">{formatTime(chapter.duration)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          )}

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {timedClips.map(({clip, index, start, end, duration}) => {
            const isActive = currentTime >= start && currentTime < end;
            const progress = currentTime >= end ? 100 : isActive ? ((currentTime - start) / Math.max(duration, 0.1)) * 100 : 0;
            return (
              <button
                key={index}
                type="button"
                onClick={() => seek(start)}
                style={{flexGrow: Math.max(duration, 0.1)}}
                className={`relative min-w-[76px] flex-1 overflow-hidden rounded-lg border p-2 text-left transition ${
                  isActive
                    ? 'z-10 scale-[1.02] border-[var(--theme-primary)]/70 bg-surface-elevated shadow-[0_0_18px_var(--theme-glow)]'
                    : 'border-hairline bg-surface-canvas-soft hover:border-hairline-strong'
                }`}
                title={`Seek to clip ${index + 1}`}
              >
                <span className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--theme-primary)]/30 to-[var(--theme-accent)]/20" style={{width: `${progress}%`}} />
                <span className="relative flex items-center justify-between gap-2 text-[9px] font-mono text-muted">
                  <span className={isActive ? 'font-bold text-[var(--theme-primary)]' : ''}>{String(index + 1).padStart(2, '0')}</span>
                  <span>{duration.toFixed(1)}s</span>
                </span>
                <span className={`relative mt-1 block truncate text-[10px] font-semibold ${isActive ? 'text-ink' : 'text-muted'}`}>
                  {clipLabel(clip, index)}
                </span>
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
};
