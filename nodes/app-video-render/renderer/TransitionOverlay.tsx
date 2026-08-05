import {useMemo} from 'react';
import {getTransitionBlobColors} from './theme';
import type {ClipPalette} from './clipTypes';

interface TransitionOverlayProps {
  progress: number;
  hue?: number;
  palette?: ClipPalette;
  quality?: 'light' | 'soft';
}

interface BlobStyle {
  colorIndex: number;
  /** Offsets are in % of the block's own size (translate %). */
  startX: number;
  startY: number;
  peakX: number;
  peakY: number;
  endX: number;
  endY: number;
  peakScale: number;
  startRotation: number;
  peakRotation: number;
  endRotation: number;
}

// Five blocks sweep in, cover separate screen regions at the peak, then scatter
// out along the opposite vector. Keeping distinct peak positions prevents the
// theme colors from collapsing into a single muddy patch.
const BLOBS: BlobStyle[] = [
  {colorIndex: 0, startX: -172, startY: -150, peakX: -46, peakY: -32, endX: 172, endY: 150, peakScale: 1.98, startRotation: -22, peakRotation: -9, endRotation: 16},
  {colorIndex: 1, startX: 172, startY: -150, peakX: 46, peakY: -32, endX: -172, endY: 150, peakScale: 1.98, startRotation: 18, peakRotation: 8, endRotation: -18},
  {colorIndex: 2, startX: -172, startY: 150, peakX: -46, peakY: 32, endX: 172, endY: -150, peakScale: 1.92, startRotation: 16, peakRotation: 7, endRotation: -20},
  {colorIndex: 3, startX: 172, startY: 150, peakX: 46, peakY: 32, endX: -172, endY: -150, peakScale: 1.92, startRotation: -18, peakRotation: -7, endRotation: 21},
  {colorIndex: 4, startX: 0, startY: -195, peakX: 0, peakY: 0, endX: 0, endY: 195, peakScale: 1.84, startRotation: 0, peakRotation: 2, endRotation: -8},
];

const START_SCALE = 0.2;
const END_SCALE = 0.2;
const ORGANIC_RADII = [
  '46% 54% 50% 44% / 58% 46% 54% 42%',
  '56% 44% 52% 48% / 44% 58% 42% 56%',
  '50% 48% 56% 44% / 52% 42% 58% 48%',
  '44% 56% 46% 54% / 58% 48% 52% 42%',
  '52% 48% 44% 56% / 46% 56% 44% 54%',
];

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

// Smoothstep — eases both ends of each half so the gather/scatter feels snappy
// rather than the linear drift of a plain crossfade.
function easeInOut(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// Fade the whole overlay in/out at the very edges so blobs never pop on screen.
function fadeEnvelope(progress: number) {
  if (progress < 0.16) return progress / 0.16;
  if (progress > 0.84) return (1 - progress) / 0.16;
  return 1;
}

export default function TransitionOverlay({progress, hue, palette, quality = 'soft'}: TransitionOverlayProps) {
  const colors = useMemo(() => getTransitionBlobColors(hue, palette), [hue, palette]);
  const p = clamp01(progress);
  const envelope = fadeEnvelope(p);
  const peak = Math.sin(p * Math.PI); // 0 → 1 → 0, maxed at the midpoint

  const gathering = p <= 0.5;
  const half = easeInOut(gathering ? p * 2 : (p - 0.5) * 2);

  // The live "light" pass paints over real clip content, so keep GPU hints lean;
  // the standalone "soft" pass renders alone and can afford promotion hints.
  const willChange = quality === 'soft' ? 'transform, filter, opacity' : 'transform';

  return (
    <div
      className="absolute inset-0 z-50 pointer-events-none overflow-hidden select-none"
      style={{
        opacity: envelope,
        filter: 'saturate(0.72) brightness(0.72) contrast(0.96)',
        contain: 'layout paint style',
        containerType: 'size',
        transform: 'translateZ(0)',
      }}
    >
      {/* Dark cover sits behind the blobs to fill any gaps and fully mask the
          underlying cut as the blobs overlap at the peak. */}
      <div
        className="absolute inset-0 bg-zinc-950"
        style={{opacity: peak * 0.5, willChange: 'opacity'}}
      />

      {BLOBS.map((blob, index) => {
        const x = gathering ? lerp(blob.startX, blob.peakX, half) : lerp(blob.peakX, blob.endX, half);
        const y = gathering ? lerp(blob.startY, blob.peakY, half) : lerp(blob.peakY, blob.endY, half);
        const scale = gathering
          ? lerp(START_SCALE, blob.peakScale, half)
          : lerp(blob.peakScale, END_SCALE, half);
        const rotation = gathering
          ? lerp(blob.startRotation, blob.peakRotation, half)
          : lerp(blob.peakRotation, blob.endRotation, half);
        const color = colors[blob.colorIndex] ?? '#8b5cf6';

        return (
          <div
            key={index}
            className="absolute left-1/2 top-1/2"
            style={{
              width: '78cqw',
              height: '102cqh',
              borderRadius: ORGANIC_RADII[index % ORGANIC_RADII.length],
              backgroundColor: color,
              filter: 'blur(clamp(30px, 3.2cqw, 46px))',
              opacity: 0.88,
              transform: `translate(calc(-50% + ${x}%), calc(-50% + ${y}%)) rotate(${rotation}deg) scale(${scale})`,
              willChange,
            }}
          />
        );
      })}

      {/* Soft white core flash on top for a brief burst of light at the peak. */}
      <div
        className="absolute inset-0"
        style={{
          opacity: peak * 0.1,
          background:
            'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 24%, transparent 56%)',
          willChange: 'opacity',
        }}
      />
    </div>
  );
}
