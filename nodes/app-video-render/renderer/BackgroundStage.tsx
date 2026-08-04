import BackgroundLayer from './BackgroundLayer';
import {
  getBackgroundFadeStyle,
  getSceneTransitionState,
  type SceneTransitionRole,
} from './SceneTransition';
import type {Clip, ClipBackground} from './clipTypes';
import {getClipBackground, locateClip, locateClipItem} from './clipModel';

interface BackgroundStageProps {
  clips: Clip[];
  time: number;
  hue?: number;
  projectName?: string | null;
  resolveBackgroundVideoUrl?: (background: ClipBackground) => string | undefined;
  force2DWithoutVideo?: boolean;
}

function getEffectState(clip: Clip, clipIndex: number, localTime: number) {
  const item = locateClipItem(clip, localTime);
  return {
    effectKey: item?.item.effect === 'shockwave'
      ? `${clipIndex}:${item.index}:${item.start}:${item.item.type}`
      : undefined,
    effectTime: item?.localTime,
  };
}

/**
 * Background stage — renders background layers with cross-fade transitions.
 * During a scene transition, outgoing and incoming backgrounds cross-fade
 * using opacity only (no slide/zoom), keeping the background visually
 * stationary while the foreground animates independently.
 */
export default function BackgroundStage({
  clips,
  time,
  hue,
  projectName,
  resolveBackgroundVideoUrl,
  force2DWithoutVideo = false,
}: BackgroundStageProps) {
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

    const background = getClipBackground(clip);
    const backgroundVideoUrl = resolveBackgroundVideoUrl?.(background);
    const {effectKey, effectTime} = getEffectState(clip, clipIndex, localTime);

    const content = (
      <BackgroundLayer
        background={background}
        effectKey={effectKey}
        effectTime={effectTime}
        hue={hue}
        time={time}
        backgroundVideoUrl={backgroundVideoUrl}
        force2D={force2DWithoutVideo && !backgroundVideoUrl}
      />
    );

    if (!transition || !role) {
      return (
        <div
          className="absolute inset-0 overflow-hidden"
          data-background-layer="shared"
          data-background={background}
        >
          {content}
        </div>
      );
    }

    return (
      <div
        key={`background-${role}-${background}`}
        style={getBackgroundFadeStyle(transition, role)}
        data-background-layer={role}
        data-background={background}
      >
        {content}
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