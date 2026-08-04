import type {CSSProperties} from 'react';
import type {Clip} from './clipTypes';
import {clamp, getClipItemRanges} from './clipModel';
import ClipTypeRenderer from './ClipTypeRenderer';

interface ClipRendererProps {
  clip: Clip;
  localTime: number;
  projectName?: string | null;
}

const ITEM_OVERLAP_SECONDS = 0.38;

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function easeOutCubic(progress: number) {
  const p = clamp01(progress);
  return 1 - Math.pow(1 - p, 3);
}

function easeInCubic(progress: number) {
  const p = clamp01(progress);
  return p * p * p;
}

function getItemStageStyle(params: {
  clipLocalTime: number;
  itemStart: number;
  itemEnd: number;
  hasPrevious: boolean;
  hasNext: boolean;
  index: number;
}): CSSProperties {
  const {clipLocalTime, itemStart, itemEnd, hasPrevious, hasNext, index} = params;
  const enterLead = hasPrevious ? ITEM_OVERLAP_SECONDS : 0;
  const exitTail = hasNext ? ITEM_OVERLAP_SECONDS : 0;
  const visibleStart = itemStart - enterLead;
  const visibleEnd = itemEnd + exitTail;
  const inWindow = clipLocalTime >= visibleStart && clipLocalTime <= visibleEnd;

  const enterProgress = hasPrevious
    ? easeOutCubic((clipLocalTime - visibleStart) / ITEM_OVERLAP_SECONDS)
    : 1;
  const exitProgress = hasNext
    ? easeInCubic((visibleEnd - clipLocalTime) / ITEM_OVERLAP_SECONDS)
    : 1;
  const opacity = inWindow ? Math.min(enterProgress, exitProgress) : 0;
  const direction = index % 2 === 0 ? 1 : -1;
  const enterOffset = lerp(30 * direction, 0, enterProgress);
  const exitOffset = lerp(0, -28 * direction, 1 - exitProgress);
  const scale = Math.min(1, lerp(0.985, 1, enterProgress)) * lerp(0.985, 1, exitProgress);

  return {
    opacity,
    visibility: inWindow ? 'visible' : 'hidden',
    pointerEvents: opacity > 0.98 ? 'auto' : 'none',
    transform: `translate3d(${enterOffset + exitOffset}px, 0, 0) scale(${scale})`,
    transition: 'none',
    zIndex: index + (hasPrevious && clipLocalTime >= itemStart ? 10 : 0),
  };
}

export default function ClipRenderer({clip, localTime, projectName}: ClipRendererProps) {
  const ranges = getClipItemRanges(clip);
  if (ranges.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {ranges.map((range) => {
        const itemLocalTime = clamp(localTime - range.start, 0, range.duration);
        const hasPrevious = range.index > 0;
        const hasNext = range.index < ranges.length - 1;

        return (
          <div
            key={`${range.index}-${range.item.type}`}
            className="absolute inset-0"
            style={getItemStageStyle({
              clipLocalTime: localTime,
              itemStart: range.start,
              itemEnd: range.end,
              hasPrevious,
              hasNext,
              index: range.index,
            })}
          >
            <ClipTypeRenderer
              clip={clip}
              item={range.item}
              localTime={itemLocalTime}
              duration={range.duration}
              projectName={projectName}
            />
          </div>
        );
      })}
    </div>
  );
}
