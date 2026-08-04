import type {Clip, ClipBackground, ClipItem} from './clipTypes';

export interface LocatedClip {
  clip: Clip;
  clipIndex: number;
  localTime: number;
  start: number;
  end: number;
  duration: number;
  totalDuration: number;
}

export interface ClipItemRange {
  item: ClipItem;
  index: number;
  start: number;
  end: number;
  duration: number;
}

export interface LocatedClipItem extends ClipItemRange {
  localTime: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export function getItemDuration(item: ClipItem) {
  if (!Number.isFinite(item.duration) || item.duration <= 0) return 0.1;
  return item.duration;
}

export function getClipItemRanges(clip: Clip): ClipItemRange[] {
  let cursor = 0;
  return clip.items.map((item, index) => {
    const duration = getItemDuration(item);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return {item, index, start, end, duration};
  });
}

export function getClipDuration(clip: Clip) {
  return getClipItemRanges(clip).reduce((duration, item) => item.end, 0);
}

export function getTotalDuration(clips: Clip[]) {
  return clips.reduce((sum, clip) => sum + getClipDuration(clip), 0);
}

export function locateClip(clips: Clip[], time: number): LocatedClip | null {
  if (clips.length === 0) return null;

  const totalDuration = getTotalDuration(clips);
  let start = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const duration = getClipDuration(clip);
    const end = start + duration;

    if (time >= start && time < end) {
      return {
        clip,
        clipIndex: i,
        localTime: time - start,
        start,
        end,
        duration,
        totalDuration,
      };
    }

    start = end;
  }

  const clipIndex = clips.length - 1;
  const clip = clips[clipIndex];
  const duration = getClipDuration(clip);
  return {
    clip,
    clipIndex,
    localTime: duration,
    start: Math.max(0, totalDuration - duration),
    end: totalDuration,
    duration,
    totalDuration,
  };
}

export function locateClipItem(clip: Clip, localTime: number): LocatedClipItem | null {
  const ranges = getClipItemRanges(clip);
  if (ranges.length === 0) return null;

  for (const range of ranges) {
    if (localTime >= range.start && localTime < range.end) {
      return {
        ...range,
        localTime: localTime - range.start,
      };
    }
  }

  const last = ranges[ranges.length - 1];
  return {
    ...last,
    localTime: last.duration,
  };
}

export function getClipBackground(clip: Clip): ClipBackground {
  return clip.background || 'blur';
}

export function getClipSignature(clip: Clip) {
  return `${clip.background}:${clip.speech}:${clip.items
    .map((item) => `${item.type}:${item.duration}:${item.title || ''}:${item.url || ''}:${item.prompt || ''}:${item.effect || ''}`)
    .join(',')}`;
}
