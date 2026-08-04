import type {CSSProperties} from 'react';
import type {Clip} from './clipTypes';
import {clamp, getClipDuration} from './clipModel';

export const SCENE_TRANSITION_SECONDS = 0.9;

export type SceneTransitionKind = 'slide-left' | 'slide-vertical' | 'zoom-in';
export type SceneTransitionRole = 'outgoing' | 'incoming';

export interface SceneTransitionState {
  transitionIndex: number;
  fromClipIndex: number;
  toClipIndex: number;
  fromLocalTime: number;
  toLocalTime: number;
  progress: number;
  kind: SceneTransitionKind;
  verticalDirection: 1 | -1;
}

function easeInOutCubic(value: number) {
  const progress = clamp(value, 0, 1);
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function getSceneTransitionState(clips: Clip[], time: number): SceneTransitionState | null {
  if (clips.length < 2) return null;

  const halfDuration = SCENE_TRANSITION_SECONDS / 2;
  let clipStart = 0;

  for (let index = 0; index < clips.length - 1; index++) {
    const fromDuration = getClipDuration(clips[index]);
    const boundary = clipStart + fromDuration;

    if (time >= boundary - halfDuration && time <= boundary + halfDuration) {
      const toDuration = getClipDuration(clips[index + 1]);
      return {
        transitionIndex: index,
        fromClipIndex: index,
        toClipIndex: index + 1,
        fromLocalTime: clamp(time - clipStart, 0, fromDuration),
        toLocalTime: clamp(time - boundary, 0, toDuration),
        progress: clamp((time - (boundary - halfDuration)) / SCENE_TRANSITION_SECONDS, 0, 1),
        kind: index % 3 === 0 ? 'slide-left' : index % 3 === 1 ? 'slide-vertical' : 'zoom-in',
        verticalDirection: Math.floor(index / 3) % 2 === 0 ? 1 : -1,
      };
    }

    clipStart = boundary;
  }

  return null;
}

export function getSceneTransitionStyle(
  transition: SceneTransitionState,
  role: SceneTransitionRole,
): CSSProperties {
  const progress = easeInOutCubic(transition.progress);
  const incoming = role === 'incoming';
  const base: CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: incoming ? 'auto' : 'none',
    transformOrigin: '50% 50%',
    transition: 'none',
    willChange: 'transform, opacity',
    zIndex: incoming ? 2 : 1,
  };

  if (transition.kind === 'slide-left') {
    const x = incoming ? (1 - progress) * 100 : progress * -100;
    return {...base, transform: `translate3d(${x}%, 0, 0)`};
  }

  if (transition.kind === 'slide-vertical') {
    const direction = transition.verticalDirection;
    const y = incoming ? (1 - progress) * 100 * direction : progress * -100 * direction;
    return {...base, transform: `translate3d(0, ${y}%, 0)`};
  }

  if (incoming) {
    return {
      ...base,
      opacity: progress,
      transform: `scale(${0.72 + progress * 0.28})`,
    };
  }

  return {
    ...base,
    opacity: 1 - progress,
    transform: `scale(${1 + progress * 0.16})`,
  };
}

export function getCinematicClipScale(clipIndex: number, localTime: number, duration: number) {
  if (duration <= 0) return 1;
  const progress = clamp(localTime / duration, 0, 1);
  return clipIndex % 2 === 0 ? 1 + progress * 0.1 : 1.1 - progress * 0.1;
}

/**
 * Background-specific fade transition style.
 * During a scene transition, backgrounds cross-fade with opacity only —
 * no slide/zoom, keeping the background visually stationary while the
 * foreground animates independently.
 */
export function getBackgroundFadeStyle(
  transition: SceneTransitionState,
  role: SceneTransitionRole,
): CSSProperties {
  const progress = easeInOutCubic(transition.progress);
  const incoming = role === 'incoming';

  return {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    transition: 'none',
    willChange: 'opacity',
    zIndex: incoming ? 2 : 1,
    opacity: incoming ? progress : 1 - progress,
  };
}
