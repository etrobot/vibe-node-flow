import type {CSSProperties} from 'react';
import ClipRenderer from './ClipRenderer';
import {
  getCinematicClipScale,
  getSceneTransitionState,
  getSceneTransitionStyle,
  RENDER_COMPONENT_SCALE,
  type SceneTransitionRole,
} from './SceneTransition';
import type {Clip} from './clipTypes';
import {getClipDuration, locateClip} from './clipModel';

interface ForegroundStageProps {
  clips: Clip[];
  time: number;
  projectName?: string | null;
  themeStyle: CSSProperties;
}

/**
 * Foreground stage — renders clip content with slide/zoom transitions.
 * During a scene transition, outgoing and incoming foregrounds animate
 * with translate3d (slide) or scale+opacity (zoom), independent of the
 * background which cross-fades separately.
 */
export default function ForegroundStage({
  clips,
  time,
  projectName,
  themeStyle,
}: ForegroundStageProps) {
  const located = locateClip(clips, time);
  if (!located) return null;

  const transition = getSceneTransitionState(clips, time);

  const renderLayer = (
    clipIndex: number,
    localTime: number,
    role?: SceneTransitionRole,
  ) => {
    const clip = clips[clipIndex];
    if (!clip) return null;

    const duration = getClipDuration(clip);
    const stageStyle = transition && role
      ? getSceneTransitionStyle(transition, role)
      : {position: 'absolute', inset: 0, overflow: 'hidden'} as CSSProperties;

    return (
      <div
        key={`foreground-${clipIndex}`}
        style={stageStyle}
        data-foreground-scene={clipIndex}
      >
        <div
          className="absolute inset-0 h-full w-full"
          style={{transform: `scale(${getCinematicClipScale(clipIndex, localTime, duration) * RENDER_COMPONENT_SCALE})`}}
        >
          <div className="absolute inset-0 overflow-hidden pointer-events-none" style={themeStyle}>
            <div className="absolute inset-0 pointer-events-auto">
              <ClipRenderer
                key={`${clipIndex}:${clip.speech}`}
                clip={clip}
                localTime={localTime}
                projectName={projectName ?? undefined}
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (transition) {
    return (
      <>
        {renderLayer(transition.fromClipIndex, transition.fromLocalTime, 'outgoing')}
        {renderLayer(transition.toClipIndex, transition.toLocalTime, 'incoming')}
      </>
    );
  }

  return renderLayer(located.clipIndex, located.localTime);
}
