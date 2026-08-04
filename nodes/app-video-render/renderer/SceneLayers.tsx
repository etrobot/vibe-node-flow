import type {CSSProperties} from 'react';
import BackgroundStage from './BackgroundStage';
import ForegroundStage from './ForegroundStage';
import {getSceneTransitionState} from './SceneTransition';
import type {Clip, ClipBackground} from './clipTypes';
import {getClipBackground} from './clipModel';

interface SceneLayersProps {
  clips: Clip[];
  time: number;
  hue?: number;
  projectName?: string | null;
  themeStyle: CSSProperties;
  resolveBackgroundVideoUrl?: (background: ClipBackground) => string | undefined;
  force2DWithoutVideo?: boolean;
}

export function countBackgroundLayersForTransition(
  clips: Clip[],
  time: number,
) {
  const transition = getSceneTransitionState(clips, time);
  if (!transition) return clips.length > 0 ? 1 : 0;

  return getClipBackground(clips[transition.fromClipIndex]) === getClipBackground(clips[transition.toClipIndex])
    ? 1
    : 2;
}

/**
 * Composes independently-transitioned background and foreground stages.
 * The background cross-fades (opacity only); the foreground slides / zooms.
 */
export default function SceneLayers({
  clips,
  time,
  hue,
  projectName,
  themeStyle,
  resolveBackgroundVideoUrl,
  force2DWithoutVideo = false,
}: SceneLayersProps) {
  return (
    <>
      <div className="absolute inset-0 overflow-hidden" data-background-stage>
        <BackgroundStage
          clips={clips}
          time={time}
          hue={hue}
          projectName={projectName}
          resolveBackgroundVideoUrl={resolveBackgroundVideoUrl}
          force2DWithoutVideo={force2DWithoutVideo}
        />
      </div>

      <div className="absolute inset-0 overflow-hidden" data-foreground-stage>
        <ForegroundStage
          clips={clips}
          time={time}
          projectName={projectName}
          themeStyle={themeStyle}
        />
      </div>
    </>
  );
}