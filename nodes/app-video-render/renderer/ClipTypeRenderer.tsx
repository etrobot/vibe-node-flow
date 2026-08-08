import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode} from 'react';
import {
  ArrowUp,
  AudioLines,
  BadgeCheck,
  Bell,
  Check,
  CheckCircle,
  Cpu,
  Database,
  Film,
  Flame,
  Hand,
  Heart,
  Lock,
  MessageCircle,
  MoreHorizontal,
  MousePointerClick,
  Play,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  UploadCloud,
  UserPlus,
  Video,
  X,
  X as XIcon,
  Zap,
} from 'lucide-react';
import {AnimatePresence, motion} from 'motion/react';
import * as LucideIcons from 'lucide-react';
import type {ChartDataItem, Clip, ClipItem, LineChartMetric} from './clipTypes';

interface ClipTypeRendererProps {
  clip: Clip;
  item: ClipItem;
  localTime: number;
  duration: number;
  projectName?: string | null;
}

/** Demo HTML is authored for the export composition; scale the iframe into its host. */
const DEMO_UI_DESIGN_WIDTH = 1920;
const DEMO_UI_DESIGN_HEIGHT = 1080;

function DemoUiEmbed({item, localTime}: ClipTypeRendererProps) {
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const url = item.demoUi?.url || '';

  useEffect(() => {
    setLoaded(false);
  }, [url]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateScale = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(width / DEMO_UI_DESIGN_WIDTH, height / DEMO_UI_DESIGN_HEIGHT));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(host);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      `iframe[data-demo-ui="${item.demoUi?.clipIndex}:${item.demoUi?.itemIndex}"]`,
    );
    frame?.contentWindow?.postMessage({type: 'demo-time', time: localTime}, '*');
  }, [item.demoUi?.clipIndex, item.demoUi?.itemIndex, localTime]);

  if (!url) {
    return <div className="absolute inset-0 flex items-center justify-center bg-black text-red-300">Demo UI URL is missing.</div>;
  }

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden bg-black" data-demo-ui-frame>
      {!loaded && <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/60">Loading product UI…</div>}
      <iframe
        title="Generated product UI"
        src={url}
        data-demo-ui={`${item.demoUi?.clipIndex}:${item.demoUi?.itemIndex}`}
        className="border-0"
        style={{
          width: DEMO_UI_DESIGN_WIDTH,
          height: DEMO_UI_DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
        onLoad={(event) => {
          if (!event.currentTarget.contentDocument?.querySelector('[data-demo-ui]')) {
            window.__renderError = `Demo UI HTML did not expose a product surface: ${url}`;
            return;
          }
          setLoaded(true);
          event.currentTarget.contentWindow?.postMessage({type: 'demo-time', time: localTime}, '*');
        }}
        onError={() => {
          window.__renderError = `Demo UI HTML failed to load: ${url}`;
        }}
      />
    </div>
  );
}

interface FrameState {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  blur?: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function easeOutCubic(progress: number) {
  const p = clamp01(progress);
  return 1 - Math.pow(1 - p, 3);
}

function easeInOutCubic(progress: number) {
  const p = clamp01(progress);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function backOut(progress: number) {
  const p = clamp01(progress);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

function wave(time: number, period: number, phase = 0) {
  return Math.sin((time / period) * Math.PI * 2 + phase);
}

function keyframes<T extends number>(time: number, stops: Array<[number, T]>) {
  if (time <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [endTime, endValue] = stops[i];
    const [startTime, startValue] = stops[i - 1];
    if (time <= endTime) {
      const progress = (time - startTime) / Math.max(0.0001, endTime - startTime);
      return lerp(startValue, endValue, easeInOutCubic(progress)) as T;
    }
  }
  return stops[stops.length - 1][1];
}

function frameStyle(frame: FrameState, extra?: CSSProperties): CSSProperties {
  const x = frame.x ?? 0;
  const y = frame.y ?? 0;
  const scale = frame.scale ?? 1;
  const scaleX = frame.scaleX ?? 1;
  const scaleY = frame.scaleY ?? 1;
  const rotate = frame.rotate ?? 0;
  const blur = frame.blur ?? 0;

  return {
    opacity: frame.opacity ?? 1,
    transform: `translate3d(${x}px, ${y}px, 0) rotate(${rotate}deg) scale(${scale * scaleX}, ${scale * scaleY})`,
    filter: blur > 0 ? `blur(${blur}px)` : 'blur(0px)',
    ...extra,
  };
}

function enterStyle(localTime: number, from: FrameState, duration = 0.35, extra?: CSSProperties) {
  const progress = easeOutCubic(localTime / duration);
  return frameStyle({
    opacity: lerp(from.opacity ?? 0, 1, progress),
    x: lerp(from.x ?? 0, 0, progress),
    y: lerp(from.y ?? 0, 0, progress),
    scale: lerp(from.scale ?? 1, 1, progress),
    scaleX: lerp(from.scaleX ?? 1, 1, progress),
    scaleY: lerp(from.scaleY ?? 1, 1, progress),
    rotate: lerp(from.rotate ?? 0, 0, progress),
    blur: lerp(from.blur ?? 0, 0, progress),
  }, extra);
}

function gradientTextStyle(time = 0): CSSProperties {
  const position = 120 - ((time % 2.4) / 2.4) * 240;
  return {'--text-sweep-position': `${position}%`} as CSSProperties;
}

function parseMarkdown(text = '') {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return {
          text: part.slice(2, -2),
          emphasized: true,
          key: index,
        };
      }

      return {
        text: part,
        emphasized: false,
        key: index,
      };
    });
}

function MarkdownText({text, gradientAll = false, time = 0}: {text?: string; gradientAll?: boolean; time?: number}) {
  return (
    <>
      {parseMarkdown(text).map((part) => (
        <span
          key={part.key}
          data-text={part.text}
          style={gradientAll || part.emphasized ? gradientTextStyle(time + part.key * 0.08) : undefined}
          className={
            gradientAll || part.emphasized
              ? 'semrush-text-highlight semrush-display-word font-extrabold'
              : 'text-white drop-shadow-md'
          }
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

function TypingMarkdown({text = '', charsToShow, gradientAll = false, time = 0}: {text?: string; charsToShow: number; gradientAll?: boolean; time?: number}) {
  let usedChars = 0;

  return (
    <>
      {parseMarkdown(text).map((part) => {
        const remaining = charsToShow - usedChars;
        if (remaining <= 0) return null;

        const visibleText = part.text.slice(0, remaining);
        usedChars += visibleText.length;

        return (
          <span
            key={part.key}
            data-text={visibleText}
            style={gradientAll || part.emphasized ? gradientTextStyle(time + part.key * 0.08) : undefined}
            className={
              gradientAll || part.emphasized
                ? 'semrush-text-highlight semrush-display-word font-extrabold'
                : 'text-white drop-shadow-md'
            }
          >
            {visibleText}
          </span>
        );
      })}
    </>
  );
}

function cleanText(text = '') {
  return text.replace(/\*\*/g, '');
}

let forgeHeartSeq = 0;

/** Signature Forge brand mark — a chunky rounded heart with a coral→pink→violet gradient. */
function ForgeHeart({className = '', style}: {className?: string; style?: CSSProperties}) {
  const gradientId = useMemo(() => `forge-heart-${(forgeHeartSeq += 1)}`, []);
  return (
    <svg viewBox="0 0 100 100" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="12%" y1="6%" x2="88%" y2="98%">
          <stop offset="0%" stopColor="#ff9a4d" />
          <stop offset="34%" stopColor="#ff5d7a" />
          <stop offset="70%" stopColor="#ff3d8f" />
          <stop offset="100%" stopColor="#9b5bff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-6 50 50)">
        <path
          d="M50 86C50 86 12 62 12 35.5C12 22 22.5 13 34 13C41.5 13 47 17 50 22.5C53 17 58.5 13 66 13C77.5 13 88 22 88 35.5C88 62 50 86 50 86Z"
          fill={`url(#${gradientId})`}
        />
      </g>
    </svg>
  );
}

/** Crisp white kinetic caption with an optional coral-emphasized span. Evokes the video's b-roll captions. */
function CaptionText({text = '', charsToShow, time = 0}: {text?: string; charsToShow?: number; time?: number}) {
  let used = 0;
  return (
    <>
      {parseMarkdown(text).map((part) => {
        let visible = part.text;
        if (typeof charsToShow === 'number') {
          const remaining = charsToShow - used;
          if (remaining <= 0) return null;
          visible = part.text.slice(0, remaining);
          used += visible.length;
        }
        return (
          <span
            key={part.key}
            className={
              part.emphasized
                ? 'text-gradient-sweep font-black'
                : 'text-white'
            }
            style={
              part.emphasized
                ? gradientTextStyle(time + part.key * 0.08)
                : {textShadow: '0 2px 30px rgba(0,0,0,0.65), 0 0 1px rgba(255,255,255,0.4)'}
            }
          >
            {visible}
          </span>
        );
      })}
    </>
  );
}




function resolveProjectAssetUrl(url: string | undefined, projectName?: string | null) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^(?:https?:|data:|blob:|\/)/i.test(value)) return value;
  if (!projectName) return value;
  return `/api/projects/${encodeURIComponent(projectName)}/${value.split('/').map(encodeURIComponent).join('/')}`;
}

function hasCjkText(text = '') {
  return /[\u4e00-\u9fff]/.test(text);
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('en-US');
}

function stableHash(text = '') {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededScore(seed: number, index: number) {
  const x = Math.sin((seed + index * 9973) * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function formatFastClockParts(localTime: number, duration: number) {
  const progress = clamp01(localTime / Math.max(duration, 0.1));
  const totalSeconds = progress * 3600 * 24 * 3;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((totalSeconds * 100) % 100);

  return {
    hours: hours.toString().padStart(2, '0'),
    minutes: minutes.toString().padStart(2, '0'),
    seconds: seconds.toString().padStart(2, '0'),
    centiseconds: centiseconds.toString().padStart(2, '0'),
  };
}

function TextTyping({item, localTime}: ClipTypeRendererProps) {
  const charsToShow = Math.floor(localTime * (item.typingSpeed || 42));
  const finished = charsToShow >= cleanText(item.title).length;
  const cursorVisible = Math.floor(localTime / 0.16) % 2 === 0;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        style={enterStyle(localTime, {opacity: 0, y: 40, blur: 6}, 0.3)}
        className="absolute inset-0 flex items-center justify-center p-10 text-center font-bold tracking-tight text-5xl md:text-[86px] leading-[1.08]"
      >
        <span className="relative inline">
          <CaptionText text={item.title} charsToShow={charsToShow} time={localTime} />
          {!finished && (
            <span
              style={{opacity: cursorVisible ? 1 : 0}}
              className="inline-block w-2.5 h-[0.9em] bg-white/90 -mb-1 ml-1 rounded-sm shadow-[0_0_20px_rgba(255,255,255,0.6)]"
            />
          )}
        </span>
      </div>
    </div>
  );
}

function TextPopup({item, localTime}: ClipTypeRendererProps) {
  // "Until today" — the pivot into the Forge brand. Coral heart-gradient reveal.
  const progress = backOut(localTime / 0.42);
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        style={frameStyle({
          opacity: clamp01(localTime / 0.16),
          scaleX: lerp(0.62, 1, progress),
          scaleY: lerp(1.5, 1, progress),
          y: lerp(180, 0, progress),
        })}
        className="absolute inset-0 flex items-center justify-center p-8 text-center font-black tracking-tight text-6xl md:text-[104px]"
      >
        <span
          className="leading-tight text-gradient-sweep"
          style={gradientTextStyle(localTime)}
        >
          {cleanText(item.title)}
        </span>
      </div>
    </div>
  );
}

function TextZoom({item, localTime}: ClipTypeRendererProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        style={enterStyle(localTime, {opacity: 0, scale: 4.5, blur: 20}, 0.5)}
        className="absolute inset-0 flex items-center justify-center p-8 text-center font-black italic tracking-tight text-6xl md:text-[100px] leading-tight"
      >
        <span>
          <CaptionText text={item.title} time={localTime} />
        </span>
      </div>
    </div>
  );
}

function TextShatter({item, localTime}: ClipTypeRendererProps) {
  const letters = cleanText(item.title).split('');

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 flex flex-wrap items-center justify-center p-8 text-center font-bold tracking-tight text-4xl md:text-7xl">
        <span className="leading-tight">
          {letters.map((char, index) => {
            const seedX = Math.sin(index * 1.3) * 500;
            const seedY = (Math.cos(index * 1.1) - 0.5) * 350;
            const seedRotate = Math.sin(index * 2.5) * 120;

            return (
              <span
                key={`${char}-${index}`}
                style={{
                  ...enterStyle(Math.max(0, localTime - index * 0.012), {
                    opacity: 0,
                    scale: 2.6,
                    x: seedX * 0.7,
                    y: seedY * 0.7,
                    rotate: seedRotate,
                    blur: 10,
                  }, 0.42),
                  textShadow: '0 2px 30px rgba(0,0,0,0.7)',
                }}
                className="inline-block whitespace-pre text-white"
              >
                {char}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

function TextImpact({item, localTime}: ClipTypeRendererProps) {
  const words = item.words?.length
    ? item.words
    : cleanText(item.title).split(/[\s,，、|]+/).filter(Boolean);

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 md:p-8 text-center overflow-visible">
      <div className="relative w-[95%] flex flex-wrap items-center justify-center gap-x-5 md:gap-x-8 gap-y-3 py-4 select-none">
        {words.map((word, index) => {
          const label = word.replace(/\*\*/g, '');
          const isNewWord = index === words.length - 1;
          const pop = keyframes(Math.min(localTime, 0.24), [
            [0, 0.8],
            [0.14, 1.1],
            [0.24, 1],
          ]);
          const highlight = isNewWord;
          return (
            <span
              key={`${word}-${index}`}
              style={{
                opacity: isNewWord ? clamp01(localTime / 0.08) : 1,
                transform: `scale(${isNewWord ? pop : 1})`,
                ...(highlight ? gradientTextStyle(localTime + index * 0.08) : undefined),
                ...(highlight ? undefined : {textShadow: '0 2px 26px rgba(0,0,0,0.6)'}),
              }}
              className={`whitespace-nowrap font-black text-5xl md:text-[74px] tracking-tight leading-none ${
                highlight ? 'text-gradient-sweep' : 'text-white'
              }`}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TextLogo({clip, item, localTime}: ClipTypeRendererProps) {
  const ctaText = item.ctaText || clip.ctaText || 'Start building';
  const rootStyle = enterStyle(localTime, {opacity: 0, scale: 0.6, blur: 18}, 0.42);
  const heartStyle = enterStyle(localTime, {opacity: 0, scale: 0.2, y: 10, rotate: -30}, 0.5);
  const wordStyle = enterStyle(localTime - 0.12, {opacity: 0, x: -30}, 0.5, gradientTextStyle(localTime));
  const ctaProgress = easeOutCubic((localTime - 0.5) / 0.4);
  const glow = 0.5 + 0.5 * wave(localTime - 0.5, 2);

  return (
    <div
      style={rootStyle}
      className="absolute inset-0 flex flex-col items-center justify-center gap-10 p-8 text-center overflow-hidden"
    >
      <div className="relative z-10 flex items-center gap-5 md:gap-7">
        <ForgeHeart className="h-20 w-20 md:h-32 md:w-32 drop-shadow-[0_0_36px_rgba(255,93,122,0.55)]" style={heartStyle} />
        <div
          style={wordStyle}
          className="text-6xl md:text-[118px] font-black tracking-tight leading-none text-gradient-sweep [overflow-wrap:anywhere]"
        >
          {cleanText(item.title)}
        </div>
      </div>
      <div
        style={{
          opacity: clamp01(ctaProgress),
          transform: `translate3d(0, ${lerp(40, 0, ctaProgress)}px, 0)`,
          boxShadow: `0 0 ${lerp(0, 44, glow)}px ${lerp(0, 12, glow)}px var(--theme-glow)`,
        }}
        className="relative z-10 px-10 py-5 bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-secondary)] text-white font-extrabold text-xl md:text-2xl rounded-full tracking-wide flex items-center gap-3"
      >
        {ctaText}
        <ArrowUp className="w-6 h-6" />
      </div>
    </div>
  );
}

function SemrushMark({className = '', style}: {className?: string; style?: CSSProperties}) {
  return (
    <div style={style} className={`relative inline-flex items-center justify-center ${className}`}>
      <div className="h-full w-full rounded-full bg-[#a855f7]" />
      <div className="absolute left-[8%] top-[28%] h-[42%] w-[78%] rounded-full bg-[#a855f7] -skew-x-[24deg]" />
      <div className="absolute right-[9%] top-[31%] h-[22%] w-[22%] rounded-full bg-[#050508]" />
    </div>
  );
}

type Css3DShot = 'search' | 'workspace' | 'chat' | 'publish' | 'audit';

function Css3DStage({
  children,
  localTime,
  shot,
  className = '',
}: {
  children: ReactNode;
  localTime: number;
  shot: Css3DShot;
  className?: string;
}) {
  const sweep = clamp01(localTime / 0.85);
  const focus = easeOutCubic((localTime - 0.45) / 1.05);
  const drift = wave(localTime, 7);
  const configs: Record<Css3DShot, {x: number; y: number; scale: number; rotateX: number; rotateY: number; rotateZ: number}> = {
    search: {x: -18, y: 8, scale: 1.1, rotateX: 7, rotateY: -14, rotateZ: 0.8},
    workspace: {x: 32, y: 30, scale: 1.04, rotateX: 7, rotateY: -10, rotateZ: 0.8},
    chat: {x: 84, y: 24, scale: 1.04, rotateX: 7, rotateY: 9, rotateZ: -0.6},
    publish: {x: -36, y: 22, scale: 1.24, rotateX: 7, rotateY: -14, rotateZ: 1.2},
    audit: {x: 38, y: 48, scale: 1.22, rotateX: 8, rotateY: 13, rotateZ: -1.0},
  };
  const config = configs[shot];
  const scanX = lerp(config.x + 260, config.x - 90, easeInOutCubic(sweep));
  const scanY = lerp(config.y - 36, config.y + 50, easeInOutCubic(sweep));
  const x = lerp(scanX, config.x + drift * 5, focus);
  const y = lerp(scanY, config.y + Math.cos(localTime * 0.7) * 3, focus);
  const rotateX = lerp(config.rotateX + 7, config.rotateX, focus);
  const rotateY = lerp(config.rotateY * 0.22, config.rotateY, focus);
  const scale = lerp(config.scale * 0.86, config.scale, focus);
  const z = lerp(-170, 0, focus);

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden [perspective:900px] md:[perspective:1050px]">
      <div
        style={{
          opacity: clamp01(localTime / 0.16),
          transform: `translate3d(${x}px, ${y}px, ${z}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${config.rotateZ}deg) scale(${scale})`,
        }}
        className={`semrush-ui-3d ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

function MiniSearchResult({
  title,
  url,
  description,
  delay,
  localTime,
}: {
  title: string;
  url: string;
  description: string;
  delay: number;
  localTime: number;
}) {
  const progress = easeOutCubic((localTime - delay) / 0.35);
  return (
    <div
      style={{
        opacity: clamp01(progress),
        transform: `translate3d(${lerp(-40, 0, progress)}px, ${lerp(24, 0, progress)}px, 0)`,
      }}
      className="rounded-xl border border-white/8 bg-zinc-950/82 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-full bg-white/12 flex items-center justify-center text-xs font-bold text-white/80">
          {title.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-zinc-300">{title}</p>
          <p className="truncate text-xs text-zinc-500">{url}</p>
        </div>
        <MoreHorizontal className="ml-auto h-4 w-4 text-zinc-600" />
      </div>
      <p className="mt-3 text-base font-semibold text-white">{description}</p>
      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-500">
        Manage listings, automate bookings, sync calendars, publish pages, and grow organic traffic.
      </p>
    </div>
  );
}

function SemrushSearch({item, localTime}: ClipTypeRendererProps) {
  return (
    <Css3DStage localTime={localTime} shot="search" className="w-[1120px] aspect-video">
      <div className="relative h-full overflow-hidden rounded-[30px] semrush-panel-glass text-white">
        <div className="absolute inset-x-0 top-0 z-20 h-14 border-b border-white/8 bg-black/55 backdrop-blur-xl">
          <div className="absolute left-5 top-1/2 flex -translate-y-1/2 gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white/18" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/12" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/8" />
          </div>
          <div className="h-full text-center font-mono text-xs font-black tracking-[0.32em] text-[#ff5c86] leading-[56px]">
            FOUND RESULTS
          </div>
        </div>
        <div className="grid h-full grid-cols-[0.34fr_0.66fr] gap-6 px-10 pb-10 pt-20 bg-black/68">
          <div className="semrush-ui-3d rounded-2xl border border-white/8 bg-zinc-950/92 p-4 shadow-2xl" style={{transform: 'translateZ(28px)'}}>
            <div className="mb-4 h-10 rounded-full border border-white/10 bg-white/[0.045] px-4 text-sm text-zinc-400 flex items-center shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              real estate ai management
            </div>
            {Array.from({length: 7}).map((_, index) => (
              <div key={index} className="mb-3 h-3 rounded-full bg-white/[0.045]" style={{width: `${88 - index * 7}%`}} />
            ))}
            <div className="mt-8 grid gap-2">
              {['AI match', 'Search intent', 'Local pages', 'SERP gaps'].map((label, index) => (
                <div key={label} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-zinc-500">
                  <span>{label}</span>
                  <span className="font-bold text-[#ff4da6]">{84 + index * 3}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="semrush-ui-3d flex flex-col justify-center gap-4" style={{transform: 'translateZ(74px)'}}>
            <MiniSearchResult title="Rentra" url="https://www.rentra.co" description="Real Estate Management" delay={0.12} localTime={localTime} />
            <MiniSearchResult title="YourSpace" url="https://www.yourspace.com" description="BnB Management Software" delay={0.32} localTime={localTime} />
            <MiniSearchResult title="Hudson Rentals" url="https://hudson.example" description={item.title || 'Vacation rental operations'} delay={0.52} localTime={localTime} />
          </div>
        </div>
      </div>
    </Css3DStage>
  );
}

function SemrushAiBadge({localTime}: ClipTypeRendererProps) {
  const progress = easeOutCubic(localTime / 0.45);
  const text = 'AI Readability';
  const charsToShow = Math.floor(localTime * 18);
  const aiText = text.slice(0, Math.min(2, charsToShow));
  const readabilityText = text.slice(3, Math.max(3, charsToShow)).trimStart();
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 text-white">
      <div
        style={{
          opacity: clamp01(progress),
          transform: `scale(${lerp(0.8, 1, progress)}) translate3d(0, ${lerp(44, 0, progress)}px, 0)`,
        }}
        className="flex items-center gap-4 text-4xl md:text-7xl font-black"
      >
        <span data-text={aiText} style={gradientTextStyle(localTime)} className="semrush-text-highlight semrush-display-word min-w-[1.2em]">{aiText}</span>
        <div className="relative h-14 w-14 rounded-2xl border border-white/12 bg-zinc-950 shadow-[0_0_32px_rgba(255,66,163,0.38)] flex items-center justify-center">
          <Sparkles className="h-8 w-8 text-[#ff4da6]" />
        </div>
        <span data-text={readabilityText} style={gradientTextStyle(localTime + 0.12)} className="semrush-text-highlight semrush-display-word min-w-[8.6em]">{readabilityText}</span>
        {charsToShow < text.length && (
          <span className="ml-1 h-[0.9em] w-2 bg-[#84a7ff] shadow-[0_0_18px_rgba(132,167,255,0.85),0_0_36px_rgba(255,74,159,0.55)]" />
        )}
      </div>
    </div>
  );
}

function SemrushLogoScene({localTime}: ClipTypeRendererProps) {
  const progress = easeOutCubic(localTime / 0.45);
  const logoText = 'SEMRUSH';
  const visibleLogo = logoText.slice(0, Math.floor(localTime * 12));
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 text-white">
      <div
        style={{
          opacity: clamp01(progress),
          transform: `translate3d(0, ${lerp(72, 0, progress)}px, 0) scale(${lerp(0.9, 1, progress)})`,
        }}
        className="flex items-center gap-5"
      >
        <SemrushMark className="h-24 w-24 md:h-32 md:w-32" />
        <div data-text={visibleLogo} style={gradientTextStyle(localTime)} className="semrush-text-highlight semrush-display-word min-w-[6.3em] text-6xl md:text-8xl font-black">
          {visibleLogo}
          {visibleLogo.length < logoText.length && <span className="ml-1 inline-block h-[0.82em] w-2 bg-[#84a7ff] align-[-0.08em] shadow-[0_0_18px_rgba(132,167,255,0.85),0_0_36px_rgba(255,74,159,0.55)]" />}
        </div>
      </div>
      <div
        style={{opacity: clamp01((localTime - 0.36) / 0.3)}}
        className="text-2xl md:text-4xl font-semibold text-white"
      >
        An Adobe Company
      </div>
    </div>
  );
}

function SitePreview({compact = false}: {compact?: boolean}) {
  return (
    <div className="h-full overflow-hidden rounded-xl bg-[#eef5ff] text-[#0f172a] shadow-[0_20px_50px_rgba(0,0,0,0.32)]">
      <div className="flex h-10 items-center justify-between bg-white px-5 text-xs font-semibold">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-[#f0c989]" />
          YOUR SPACE
        </div>
        <div className="flex gap-4 text-slate-500">
          <span>Listings</span>
          <span>Services</span>
          <span>Contact</span>
        </div>
      </div>
      <div className="px-7 py-6">
        <div className="mx-auto mb-4 h-8 w-36 rounded-full bg-white/80 text-center text-xs leading-8 shadow-sm">Book your stay</div>
        <h3 className="text-center text-4xl font-black text-[#9fb7d3]">{compact ? 'YOUR SPACE' : 'YOUR SPACE'}</h3>
        <p className="mx-auto mt-2 max-w-md text-center text-sm text-slate-500">Vacation rental management, automated booking, and owner reporting in one site.</p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {['Listings', 'Owners', 'Revenue'].map((label, index) => (
            <div key={label} className="rounded-lg bg-white p-3 shadow-sm">
              <div className="mb-2 h-16 rounded-md bg-gradient-to-br from-slate-200 to-slate-100" />
              <p className="text-xs font-bold">{label}</p>
              <p className="text-[10px] text-slate-500">{index === 0 ? 'Hudson Row' : index === 1 ? 'Portal' : '+28%'}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({localTime, expanded = false}: {localTime: number; expanded?: boolean}) {
  const typingTime = Math.max(0, localTime - 0.75);
  const typed = Math.min('Ask Landlord, how findable is my site?'.length, Math.floor(typingTime * 24));
  const prompt = 'Ask Landlord, how findable is my site?'.slice(0, typed);
  return (
    <div className="semrush-ui-3d flex h-full flex-col rounded-xl border border-white/8 bg-[#141416] p-4 text-white shadow-[0_18px_50px_rgba(0,0,0,0.42)]" style={{transform: expanded ? 'translateZ(62px)' : 'translateZ(48px)'}}>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <SemrushMark className="h-4 w-4" />
        Semrush
      </div>
      {expanded && (
        <div className="semrush-ui-3d mb-auto rounded-xl bg-white/[0.035] p-4 text-sm" style={{transform: 'translateZ(34px)'}}>
          <p className="mb-3 text-zinc-400">Thought for 6s</p>
          <p className="text-white">Looking good. Here is the picture:</p>
          <div className="mt-4 overflow-hidden rounded-lg border border-white/8">
            {['US', 'UK', 'CA', 'AU'].map((row, index) => (
              <div key={row} className="grid grid-cols-3 border-b border-white/5 px-3 py-2 text-xs last:border-0">
                <span>{row}</span>
                <span>{index + 2}</span>
                <span>{[10000, 6000, 4000, 3800][index].toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="semrush-ui-3d mt-auto rounded-2xl border border-white/10 bg-[#202024] p-4 shadow-[0_20px_52px_rgba(0,0,0,0.44),0_0_42px_rgba(133,96,255,0.12)]" style={{transform: 'translateZ(86px)'}}>
        <p className="min-h-6 text-sm text-zinc-200">{prompt}<span className="text-[#8b5cf6]">|</span></p>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>Visual edits</span>
          <span>Chat</span>
        </div>
      </div>
    </div>
  );
}

function SemrushWorkspace({localTime}: ClipTypeRendererProps) {
  return (
    <Css3DStage localTime={localTime} shot="workspace" className="w-[1120px] aspect-video">
      <div className="relative grid h-full grid-cols-[0.37fr_0.63fr] gap-5 overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_80%_18%,rgba(93,126,255,0.9),transparent_25%),radial-gradient(circle_at_92%_78%,rgba(255,93,31,0.9),transparent_35%),radial-gradient(circle_at_52%_90%,rgba(255,50,153,0.82),transparent_32%),#08080b] p-5 shadow-[0_35px_110px_rgba(0,0,0,0.68)]">
        <div className="semrush-ui-3d h-full" style={{transform: 'translateZ(62px)'}}>
          <ChatPanel localTime={localTime} />
        </div>
        <div className="semrush-ui-3d h-full" style={{transform: 'translateZ(18px) rotateY(-3deg)'}}>
          <SitePreview />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,rgba(255,255,255,0.12),transparent_18%,transparent_70%,rgba(255,255,255,0.08))]" />
      </div>
    </Css3DStage>
  );
}

function SemrushChat({localTime}: ClipTypeRendererProps) {
  const claim = 'Run competitive analysis to find keyword gaps you can win.';
  const claimChars = Math.floor(Math.max(0, localTime - 0.8) * 34);
  const claimText = claim.slice(0, claimChars);
  return (
    <Css3DStage localTime={localTime} shot="chat" className="w-[1120px] aspect-video">
      <div className="grid h-full grid-cols-[0.46fr_0.54fr] gap-5 overflow-hidden rounded-3xl bg-[#08080b] p-6 shadow-[0_35px_110px_rgba(0,0,0,0.72)]">
        <ChatPanel localTime={localTime} expanded />
        <div className="semrush-ui-3d flex flex-col justify-center rounded-2xl border border-white/8 bg-white/[0.035] p-8 text-white shadow-[0_22px_80px_rgba(0,0,0,0.5)]" style={{transform: 'translateZ(24px)'}}>
          <p className="mb-4 text-lg text-zinc-400">What I would do next</p>
          <h3 className="min-h-[4.1em] text-4xl font-black leading-tight">
            {claimText}
            {claimChars < claim.length && <span className="ml-1 inline-block h-[0.88em] w-2 bg-[#84a7ff] align-[-0.08em] shadow-[0_0_18px_rgba(132,167,255,0.85),0_0_36px_rgba(255,74,159,0.55)]" />}
          </h3>
          <button className="mt-8 w-fit rounded-full bg-white px-6 py-3 font-bold text-black shadow-[0_0_36px_rgba(255,255,255,0.18)]">Let's do it!</button>
        </div>
      </div>
    </Css3DStage>
  );
}

function SemrushPublish({localTime}: ClipTypeRendererProps) {
  const progress = easeOutCubic(localTime / 0.45);
  return (
    <Css3DStage localTime={localTime} shot="publish" className="w-[1120px] aspect-video">
      <div className="relative h-full overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_90%_20%,rgba(91,121,255,0.95),transparent_28%),radial-gradient(circle_at_86%_86%,rgba(255,88,24,0.95),transparent_35%),radial-gradient(circle_at_55%_84%,rgba(255,42,151,0.86),transparent_34%),#050507] p-5 shadow-[0_35px_120px_rgba(0,0,0,0.72)]">
        <div
          className="semrush-ui-3d absolute right-24 top-6 z-30 flex items-center gap-3 rounded-xl bg-zinc-950/92 p-3 shadow-[0_20px_70px_rgba(0,0,0,0.62),0_0_40px_rgba(37,99,235,0.25)]"
          style={{transform: `translateZ(${lerp(60, 150, progress)}px) scale(${lerp(0.94, 1.08, progress)})`}}
        >
          <div className="h-9 w-9 rounded-full bg-violet-700 text-center text-xs font-bold leading-9 text-white">N</div>
          <button className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-white">Share</button>
          <button className="rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white">GitHub</button>
          <button className="rounded-md bg-blue-600 px-5 py-2 text-sm font-black text-white shadow-[0_0_30px_rgba(37,99,235,0.62)]">Publish</button>
        </div>
        <div
          style={{
            transform: `translate3d(${lerp(130, -8, progress)}px, ${lerp(96, 72, progress)}px, 72px) rotateY(-4deg) scale(${lerp(1.18, 1.06, progress)})`,
          }}
          className="semrush-ui-3d absolute right-4 top-20 h-[74%] w-[73%]"
        >
          <SitePreview compact />
        </div>
        <div className="semrush-ui-3d absolute bottom-12 right-20 z-20 rounded-full border border-black/20 bg-white px-9 py-5 text-xl font-bold text-black shadow-[0_22px_60px_rgba(0,0,0,0.32)]" style={{transform: 'translateZ(128px)'}}>
          Take the first step
        </div>
      </div>
    </Css3DStage>
  );
}

function SemrushAudit({localTime}: ClipTypeRendererProps) {
  const done = localTime > 1.3;
  return (
    <Css3DStage localTime={localTime} shot="audit" className="w-[1120px] aspect-video">
      <div className="relative h-full overflow-hidden rounded-3xl bg-[#050507] p-8 text-white shadow-[0_35px_120px_rgba(0,0,0,0.72)]">
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(circle_at_50%_96%,rgba(255,44,145,0.9),transparent_28%),radial-gradient(circle_at_58%_78%,rgba(72,111,255,0.82),transparent_24%)] blur-xl" />
        <div className="absolute inset-0 opacity-35 [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:100%_5px]" />
        <div className="semrush-ui-3d relative ml-auto mr-16 mt-14 w-[62%] rounded-xl border border-white/10 bg-[#151518]/96 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.62),0_0_50px_rgba(255,65,154,0.16)]" style={{transform: 'translateZ(128px)'}}>
          <div className="mb-5 flex items-center justify-between">
            <h3 className="font-bold">Your SEO review</h3>
            <button className="rounded-md bg-blue-600 px-3 py-1 text-xs font-bold shadow-[0_0_24px_rgba(37,99,235,0.45)]">Run</button>
          </div>
          <div className="rounded-lg border border-white/8 bg-black/32 p-4">
            <div className="flex items-center gap-3">
              {done ? <CheckCircle className="h-5 w-5 text-emerald-400" /> : <XIcon className="h-5 w-5 text-rose-500" />}
              <div className="h-3 flex-1 rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#ff4da6] to-[#6478ff]" style={{width: done ? '86%' : '34%'}} />
              </div>
            </div>
            <p className="mt-3 text-sm text-zinc-400">{done ? 'Fixable technical gaps found.' : 'Search results show transactional loss.'}</p>
          </div>
        </div>
        <div className="semrush-ui-3d absolute bottom-14 left-14 grid grid-cols-2 gap-3 text-sm text-white/75" style={{transform: 'translateZ(40px)'}}>
          {['Audit', 'Keyword analysis', 'AI readability', 'Backlinks'].map((label) => (
            <div key={label} className="rounded-full border border-white/10 bg-black/45 px-5 py-3 shadow-[0_14px_34px_rgba(0,0,0,0.35)]">{label}</div>
          ))}
        </div>
      </div>
    </Css3DStage>
  );
}

function SemrushFeatureCloud({localTime}: ClipTypeRendererProps) {
  const chips = [
    {label: 'AI readability', x: 330, y: -24, delay: 0.52, rotate: -2, z: 78},
    {label: 'Keyword analysis', x: 142, y: 154, delay: 0.82, rotate: 1, z: 112},
    {label: 'Audit backlinks', x: -188, y: 154, delay: 1.05, rotate: -1.5, z: 88},
    {label: 'Search', x: -352, y: 18, delay: 0.36, rotate: 2.2, z: 40},
    {label: 'Semrush data', x: -238, y: -120, delay: 0.68, rotate: -1, z: 96},
    {label: 'robots.txt', x: 28, y: -188, delay: 1.22, rotate: 0.5, z: 62},
    {label: 'Optimize for search', x: 316, y: -110, delay: 1.42, rotate: -2.5, z: 104},
  ];
  const coreProgress = easeOutCubic(localTime / 0.7);
  const buttonProgress = backOut((localTime - 1.9) / 0.55);
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 md:p-10 text-white [perspective:980px]">
      <div className="semrush-ui-3d relative h-full w-full" style={{transform: `rotateX(${lerp(12, 0, coreProgress)}deg) rotateY(${lerp(-10, 0, coreProgress)}deg)`}}>
        <div
          className="absolute left-1/2 top-[53%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-[44px] bg-[radial-gradient(circle_at_32%_28%,#ff7a1a,transparent_24%),radial-gradient(circle_at_70%_38%,#5d77ff,transparent_34%),radial-gradient(circle_at_46%_78%,#ff39a1,transparent_36%),#15151a] shadow-[0_0_80px_rgba(255,53,156,0.36)]"
          style={{
            opacity: clamp01(coreProgress),
            transform: `translate(-50%, -50%) translateZ(${lerp(-80, 64, coreProgress)}px) scale(${lerp(0.72, 1, coreProgress)})`,
          }}
        />
        <SemrushMark
          className="absolute left-1/2 top-[53%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 opacity-90"
          style={{
            opacity: clamp01(coreProgress),
          } as CSSProperties}
        />
        {chips.map((chip, index) => {
          const progress = easeOutCubic((localTime - chip.delay) / 0.48);
          const entryX = chip.x + (index % 2 === 0 ? -180 : 160);
          const entryY = chip.y + (index % 3 === 0 ? 95 : -90);
          return (
            <div
              key={chip.label}
              style={{
                opacity: clamp01(progress),
                transform: `translate(-50%, -50%) translate3d(${lerp(entryX, chip.x, progress)}px, ${lerp(entryY, chip.y, progress)}px, ${lerp(-90, chip.z, progress)}px) rotate(${lerp(chip.rotate * 3, chip.rotate, progress)}deg) scale(${lerp(0.72, 1, progress)})`,
              }}
              className="semrush-ui-3d absolute left-1/2 top-[53%] rounded-full border border-white/12 bg-black/62 px-7 py-4 text-lg font-semibold shadow-[0_14px_36px_rgba(0,0,0,0.38),0_0_28px_rgba(255,65,154,0.08)] backdrop-blur-xl"
            >
              {chip.label}
            </div>
          );
        })}
        <div
          className="absolute bottom-16 left-1/2 rounded-lg bg-blue-600 px-6 py-3 font-bold shadow-[0_16px_40px_rgba(37,99,235,0.35),0_0_36px_rgba(37,99,235,0.32)]"
          style={{
            opacity: clamp01(buttonProgress),
            transform: `translateX(-50%) translateY(${lerp(38, 0, buttonProgress)}px) translateZ(${lerp(-40, 126, buttonProgress)}px) scale(${lerp(0.76, 1, buttonProgress)})`,
          }}
        >
          Fix all
        </div>
      </div>
    </div>
  );
}

function WindowFrame({
  title,
  children,
  noPadding = false,
  localTime = 0,
  wide = false,
  translucent = false,
}: {
  title?: string;
  children: ReactNode;
  noPadding?: boolean;
  localTime?: number;
  wide?: boolean;
  translucent?: boolean;
}) {
  const progress = easeOutCubic(localTime / 0.42);
  const cutoutClass = 'left-2 right-2 bottom-2 top-11 md:left-3 md:right-3 md:bottom-3 md:top-14 rounded-[10px]';
  const frameBg = translucent ? 'bg-black/40' : 'bg-black/72';
  const cutoutBg = translucent ? 'bg-black/40' : 'bg-black';
  const maskAlpha = translucent ? '0.42' : '0.70';
  return (
    <div
      style={{
        opacity: clamp01(localTime / 0.18),
        transform: `translate3d(calc(-50% + ${lerp(180, 0, progress)}px), -50%, 0) scale(${lerp(0.96, 1, progress)})`,
      }}
      className={`${wide ? 'w-[96%] md:w-[94%] max-w-7xl' : 'w-[90%] md:w-[85%] max-w-5xl'} aspect-video absolute top-1/2 left-1/2 rounded-[28px] overflow-hidden ${frameBg} backdrop-blur-2xl shadow-[0_26px_90px_rgba(0,0,0,0.58),0_0_70px_var(--theme-glow)]`}
    >
      <div className={`absolute ${cutoutClass} overflow-hidden ${cutoutBg} z-10`}>
        <div className={`relative w-full h-full overflow-hidden ${noPadding ? 'p-0' : 'p-4 md:p-8'}`}>
          {children}
        </div>
      </div>

      <div className="absolute inset-x-0 top-0 h-11 md:h-14 pointer-events-none bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025)_42%,rgba(0,0,0,0.26)_100%)] z-20" />
      <div
        className={`absolute ${cutoutClass} pointer-events-none bg-transparent z-20`}
        style={{
          boxShadow: `inset 0 0 0 1px rgba(4,4,5,${maskAlpha}), inset 0 0 20px rgba(0,0,0,0.45)`,
        }}
      />
      <div
        className="absolute inset-0 rounded-[28px] pointer-events-none z-30"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      />
      <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent pointer-events-none z-30" />

      <div className="absolute left-0 right-0 top-0 h-11 md:h-14 flex items-center justify-center px-4 z-40">
        <div className="absolute left-4 flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-white/20 border border-black/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/12 border border-black/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-white/8 border border-black/70" />
        </div>
        <div className="max-w-[70%] font-mono text-xs md:text-sm text-[var(--theme-primary)] font-bold tracking-widest whitespace-nowrap truncate drop-shadow-[0_0_12px_var(--theme-glow)]">
          {title}
        </div>
      </div>
    </div>
  );
}

function FramelessSurface({
  children,
  localTime = 0,
  wide = false,
}: {
  children: ReactNode;
  localTime?: number;
  wide?: boolean;
}) {
  const progress = easeOutCubic(localTime / 0.42);
  return (
    <div
      style={{
        opacity: clamp01(localTime / 0.18),
        transform: `translate3d(calc(-50% + ${lerp(180, 0, progress)}px), -50%, 0) scale(${lerp(0.96, 1, progress)})`,
      }}
      className={`${wide ? 'w-[96%] md:w-[94%] max-w-7xl' : 'w-[90%] md:w-[85%] max-w-5xl'} aspect-video absolute top-1/2 left-1/2 overflow-visible`}
    >
      {children}
    </div>
  );
}

function MediaPlaceholder({kind}: {kind: 'image' | 'video'}) {
  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-500 font-mono text-sm">
      Missing {kind} URL
    </div>
  );
}

function MediaSurface({
  children,
  localTime = 0,
}: {
  children: ReactNode;
  localTime?: number;
}) {
  const progress = easeOutCubic(localTime / 0.42);
  return (
    <div
      style={{
        opacity: clamp01(localTime / 0.18),
        transform: `translate3d(calc(-50% + ${lerp(180, 0, progress)}px), -50%, 0) scale(${lerp(0.96, 1, progress)})`,
      }}
      className="w-[96%] md:w-[94%] max-w-7xl aspect-video absolute top-1/2 left-1/2 overflow-hidden rounded-lg bg-black/20 shadow-[0_18px_48px_rgba(0,0,0,0.28)]"
    >
      {children}
    </div>
  );
}

function ImageEmbed({item, localTime, projectName}: ClipTypeRendererProps) {
  const mediaUrl = resolveProjectAssetUrl(item.url, projectName);
  return (
    <div className="absolute inset-0 p-2 md:p-4 z-20 overflow-hidden flex items-center justify-center">
      <MediaSurface localTime={localTime}>
        <div className="w-full h-full flex items-center justify-center overflow-hidden">
          {mediaUrl ? (
            <img
              src={mediaUrl}
              alt={cleanText(item.title) || 'embedded image'}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <MediaPlaceholder kind="image" />
          )}
        </div>
      </MediaSurface>
    </div>
  );
}

function VideoEmbed({item, localTime, projectName}: ClipTypeRendererProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaUrl = resolveProjectAssetUrl(item.url, projectName);
  const syncVideoTime = (video: HTMLVideoElement) => {
    video.muted = true;
    video.pause();
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const targetTime = localTime % video.duration;
    try {
      video.currentTime = targetTime;
    } catch {
      /* ignore seek failures for remote streams */
    }
  };

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    syncVideoTime(video);
  }, [mediaUrl, localTime]);

  return (
    <div className="absolute inset-0 p-2 md:p-4 z-20 overflow-hidden flex items-center justify-center">
      <MediaSurface localTime={localTime}>
        <div className="w-full h-full flex items-center justify-center overflow-hidden">
          {mediaUrl ? (
            <video
              ref={videoRef}
              src={mediaUrl}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => syncVideoTime(event.currentTarget)}
            />
          ) : (
            <MediaPlaceholder kind="video" />
          )}
        </div>
      </MediaSurface>
    </div>
  );
}

function UiDropFiles({item, localTime}: ClipTypeRendererProps) {
  const fileDropped = localTime > 1.35;
  const emptyLabel = item.label || item.title || 'Drop files';
  const uploadedLabel = item.secondaryLabel || item.ctaText || 'Files uploaded';
  const sinkIn = easeInOutCubic((localTime - 1.05) / 0.28);
  const settle = easeOutCubic((localTime - 1.45) / 0.42);
  const sinkScale = localTime < 1.45 ? lerp(1, 0.9, sinkIn) : lerp(0.9, 0.96, settle);
  const sinkY = localTime < 1.45 ? lerp(0, 12, sinkIn) : lerp(12, 4, settle);
  const sinkShadow = localTime < 1.45 ? sinkIn : lerp(1, 0.55, settle);
  const files = [
    {ext: 'jpg', color: 'bg-blue-500', initX: 400, initY: 150, rot: -15, delay: 0},
    {ext: 'png', color: 'bg-green-500', initX: 350, initY: -200, rot: 12, delay: 0.1},
    {ext: 'md', color: 'bg-zinc-700', initX: -400, initY: 200, rot: -25, delay: 0.2},
    {ext: 'docx', color: 'bg-indigo-500', initX: -300, initY: -250, rot: 18, delay: 0.15},
    {ext: 'pptx', color: 'bg-orange-500', initX: 500, initY: -50, rot: -8, delay: 0.05},
  ];

  return (
    <div className="absolute inset-0 p-6 md:p-12 z-20 overflow-hidden flex items-center justify-center">
      <FramelessSurface localTime={localTime}>
        <div className="w-full h-full flex items-center justify-center relative">
          <div
            style={enterStyle(localTime, {opacity: 0, scale: 0.92}, 0.32)}
            className="w-full max-w-2xl aspect-video z-10"
          >
            <div
              style={{
                transform: `translate3d(0, ${sinkY}px, 0) scale(${sinkScale})`,
                boxShadow: `inset 0 ${lerp(0, 18, sinkShadow)}px ${lerp(0, 42, sinkShadow)}px rgba(0,0,0,${lerp(0, 0.46, sinkShadow)}), 0 0 ${lerp(0, 34, sinkShadow)}px var(--theme-glow)`,
              }}
              className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-6 ${
                fileDropped ? 'border-[var(--theme-primary)] bg-[var(--theme-primary)]/10' : 'border-zinc-700 bg-zinc-800/30'
              }`}
            >
              <div
                style={{
                  transform: fileDropped
                    ? `scale(1.18) rotate(${wave(localTime - 1.35, 0.32) * 10}deg)`
                    : 'scale(1) rotate(0deg)',
                }}
              >
                <UploadCloud className={`w-20 h-20 ${fileDropped ? 'text-[var(--theme-secondary)]' : 'text-zinc-600'}`} />
              </div>
              <p className={`text-xl font-semibold ${fileDropped ? 'text-[var(--theme-secondary)]' : 'text-zinc-400'}`}>
                {fileDropped ? uploadedLabel : emptyLabel}
              </p>
            </div>
          </div>

          {localTime < 2.4 && files.map((file, index) => (
            <div
              key={file.ext}
              style={(() => {
                const start = 0.2 + file.delay;
                const flyProgress = easeInOutCubic((localTime - start) / 0.9);
                const pullStart = 1.08 + index * 0.035;
                const pullProgress = easeInOutCubic((localTime - pullStart) / 0.5);
                const fadeProgress = easeOutCubic((localTime - pullStart - 0.22) / 0.26);
                return frameStyle({
                  x: lerp(file.initX, 0, flyProgress),
                  y: lerp(lerp(file.initY, 0, flyProgress), 26, pullProgress),
                  scale: lerp(lerp(0.8, 1, flyProgress), 0.12, pullProgress),
                  opacity: flyProgress * lerp(1, 0, fadeProgress),
                  rotate: lerp(lerp(file.rot, (index - 2) * 8, flyProgress), 0, pullProgress),
                  blur: lerp(0, 5, fadeProgress),
                });
              })()}
              className="absolute z-20 pointer-events-none drop-shadow-xl"
            >
              <div className="w-28 h-36 bg-white rounded-xl shadow-2xl flex flex-col items-center justify-center overflow-hidden border-2 border-zinc-200">
                <div className="w-full h-6 bg-zinc-100 border-b flex items-center px-2">
                  <div className="w-1.5 h-1.5 bg-red-400 rounded-full mr-1" />
                  <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mr-1" />
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full" />
                </div>
                <div className="flex-1 w-full bg-slate-50 flex items-center justify-center p-2">
                  <span className={`${file.color} text-white font-black text-lg px-2 py-1 rounded shadow-sm`}>
                    .{file.ext}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </FramelessSurface>
    </div>
  );
}

function UiPromptInput({item, localTime, duration}: ClipTypeRendererProps) {
  const promptText = item.prompt || 'Describe what you want to create...';
  const buttonText = item.ctaText || 'Build';

  const typeSpeed = 26;
  const charsToShow = Math.min(promptText.length, Math.floor(Math.max(0, localTime - 0.5) * typeSpeed));
  const typingDone = charsToShow >= promptText.length;
  const typeEndTime = 0.5 + promptText.length / typeSpeed;

  // Cursor glides to the submit button once typing finishes, then presses it.
  const pressTime = Math.max(typeEndTime + 0.55, duration - 0.55);
  const approach = clamp01((localTime - typeEndTime) / 0.5);
  const pressed = localTime >= pressTime && localTime < pressTime + 0.22;
  const submitted = localTime >= pressTime + 0.14;

  const cursorBlink = Math.floor(localTime / 0.18) % 2 === 0;
  const cardEnter = enterStyle(localTime, {opacity: 0, scale: 0.92, y: 40, blur: 8}, 0.42);

  return (
    <div className="absolute inset-0 z-20 overflow-hidden flex items-center justify-center">
      <div className="relative w-[86%] md:w-[74%] max-w-4xl" style={cardEnter}>
        <div
          className="relative rounded-[30px] bg-[#141418]/95 border border-white/10 p-6 md:p-8 backdrop-blur-xl"
          style={{
            boxShadow: '0 40px 120px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
            transform: `scale(${submitted ? 0.985 : 1})`,
          }}
        >
          <div className="flex items-start gap-4 min-h-[132px] md:min-h-[150px]">
            <ForgeHeart className="h-11 w-11 md:h-14 md:w-14 shrink-0 mt-1 drop-shadow-[0_0_18px_rgba(255,93,122,0.5)]" />
            <p className="text-white font-semibold text-2xl md:text-[38px] leading-snug tracking-tight [overflow-wrap:anywhere]">
              {promptText.slice(0, charsToShow)}
              {!typingDone && (
                <span
                  style={{opacity: cursorBlink ? 1 : 0.15}}
                  className="inline-block w-[3px] h-[0.9em] bg-white align-[-0.08em] ml-0.5 rounded-full"
                />
              )}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="px-4 py-2 rounded-full bg-white/8 text-white/70 text-sm md:text-base font-medium">Chat</span>
              <span className="h-10 w-10 md:h-11 md:w-11 rounded-full bg-white/8 flex items-center justify-center text-white/70">
                <AudioLines className="w-5 h-5" />
              </span>
            </div>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-secondary)] text-white font-bold text-base md:text-lg px-6 md:px-7 py-3 md:py-3.5"
              style={{
                transform: `scale(${pressed ? 0.9 : 1})`,
                boxShadow: `0 0 ${submitted ? 44 : 24}px var(--theme-glow)`,
              }}
            >
              {buttonText}
              <span className="h-7 w-7 rounded-full bg-white/25 flex items-center justify-center">
                <ArrowUp className="w-4 h-4" />
              </span>
            </button>
          </div>
        </div>

        {/* Hand cursor gliding to the submit button */}
        <div
          className="absolute pointer-events-none"
          style={{
            right: '7%',
            bottom: '9%',
            opacity: clamp01((localTime - typeEndTime + 0.1) / 0.3) * clamp01((pressTime + 0.5 - localTime) / 0.3),
            transform: `translate3d(${lerp(90, 6, easeOutCubic(approach))}px, ${lerp(70, 6, easeOutCubic(approach))}px, 0) scale(${pressed ? 0.86 : 1})`,
          }}
        >
          <div className="h-10 w-10 rounded-full bg-white/15 backdrop-blur-md border border-white/40 shadow-2xl flex items-center justify-center text-white">
            <Hand className="w-5 h-5 rotate-12 fill-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

function AppPreviewMock({localTime, revealFrom = 0}: {localTime: number; revealFrom?: number}) {
  const rise = easeOutCubic((localTime - revealFrom) / 0.55);
  return (
    <div
      className="w-full h-full overflow-hidden rounded-2xl bg-white text-[#0f172a]"
      style={{transform: `translateY(${lerp(24, 0, rise)}px)`, opacity: clamp01(rise)}}
    >
      <div className="flex h-9 items-center gap-2 border-b border-slate-200 px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <div className="ml-4 h-4 flex-1 max-w-md rounded-full bg-slate-100" />
      </div>
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 font-black tracking-tight">
          <ForgeHeart className="h-5 w-5" /> Marketplace
        </div>
        <div className="flex gap-4 text-xs font-semibold text-slate-500">
          <span>Listings</span><span>Chat</span><span>Payments</span>
          <span className="rounded-full bg-[var(--theme-primary)] px-3 py-1 text-white">Sign in</span>
        </div>
      </div>
      <div className="grid grid-cols-[1.1fr_1fr] gap-5 px-6 py-5">
        <div className="flex flex-col justify-center gap-3">
          <div className="w-fit rounded-full bg-[var(--theme-primary)]/10 px-3 py-1 text-[11px] font-bold text-[var(--theme-primary)]">New listings daily</div>
          <h3 className="text-3xl font-black leading-tight tracking-tight">Buy & sell, <br />with built-in chat.</h3>
          <p className="text-sm text-slate-500 max-w-xs">A real marketplace with listings, messaging and secure checkout — generated for you.</p>
          <div className="flex gap-3">
            <div className="rounded-lg bg-[var(--theme-primary)] px-4 py-2 text-sm font-bold text-white">Browse</div>
            <div className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold">Sell item</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
              <div className={`h-16 ${['bg-gradient-to-br from-rose-200 to-orange-200', 'bg-gradient-to-br from-indigo-200 to-sky-200', 'bg-gradient-to-br from-violet-200 to-fuchsia-200', 'bg-gradient-to-br from-emerald-200 to-lime-200'][i]}`} />
              <div className="p-2">
                <div className="h-2 w-3/4 rounded bg-slate-200" />
                <div className="mt-1.5 h-2 w-1/2 rounded bg-slate-100" />
                <div className="mt-2 text-xs font-black text-[var(--theme-primary)]">${[42, 128, 79, 215][i]}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UiRenderLoading({item, localTime, duration}: ClipTypeRendererProps) {
  const buildDuration = Math.min(duration * 0.5, 1.3);
  const progressPercent = Math.min(100, (localTime / buildDuration) * 100);
  const building = localTime < buildDuration;
  const orbSpin = localTime * 40;

  const featureChips = [
    {label: 'Auth', Icon: Lock},
    {label: 'Database', Icon: Database},
    {label: 'Security', Icon: ShieldCheck},
  ];

  return (
    <div className="absolute inset-0 z-20 overflow-hidden flex items-center justify-center">
      <div className="relative w-[86%] md:w-[76%] max-w-4xl aspect-video" style={enterStyle(localTime, {opacity: 0, scale: 0.94, blur: 8}, 0.4)}>
        <div className="absolute inset-0 rounded-[26px] overflow-hidden bg-[#0d0d12] border border-white/12 shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
          {building ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-7 p-8">
              <div
                className="h-28 w-28 rounded-[42%] bg-[conic-gradient(from_0deg,#ff9a4d,#ff5d7a,#ff3d8f,#9b5bff,#5b8bff,#ff9a4d)] blur-[1px]"
                style={{transform: `rotate(${orbSpin}deg) scale(${1 + 0.06 * wave(localTime, 0.8)})`, filter: 'blur(2px)'}}
              />
              <div className="w-full max-w-md">
                <div className="mb-2 flex items-center justify-between text-sm font-medium text-white/70">
                  <span>{cleanText(item.title) || 'Building your app'}…</span>
                  <span className="font-mono">{Math.floor(progressPercent)}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-[var(--theme-secondary)] to-[var(--theme-primary)]" style={{width: `${progressPercent}%`}} />
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full w-full p-3 md:p-4">
              <AppPreviewMock localTime={localTime} revealFrom={buildDuration} />
            </div>
          )}
        </div>

        {/* Feature chips popping in over the finished app */}
        {!building && (
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex gap-3">
            {featureChips.map((chip, index) => {
              const chipIn = backOut((localTime - buildDuration - 0.25 - index * 0.14) / 0.4);
              return (
                <div
                  key={chip.label}
                  style={{opacity: clamp01(chipIn), transform: `translateY(${lerp(16, 0, clamp01(chipIn))}px) scale(${lerp(0.8, 1, clamp01(chipIn))})`}}
                  className="flex items-center gap-2 rounded-full bg-[#141418] border border-white/12 px-4 py-2.5 text-white font-semibold text-sm md:text-base shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
                >
                  <chip.Icon className="w-4 h-4 text-[var(--theme-primary)]" />
                  {chip.label}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UiVideoPreview({localTime}: ClipTypeRendererProps) {
  const rootStyle = enterStyle(localTime, {opacity: 0, scale: 0.8, y: 100}, 0.45);
  const rigProgress = easeOutCubic(localTime / 2);
  const engageProgress = easeOutCubic((localTime - 0.5) / 0.4);
  const convertProgress = easeOutCubic((localTime - 1.3) / 0.4);

  return (
    <div
      style={rootStyle}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95%] md:w-[90%] max-w-6xl aspect-video bg-zinc-950 z-30 overflow-hidden rounded-xl shadow-[0_0_100px_var(--theme-glow)] border border-white/10"
    >
      <div className="absolute inset-0 flex items-center justify-center p-8 pointer-events-none" style={{perspective: '1200px'}}>
        <div
          className="relative w-full h-full max-w-4xl"
          style={{
            transformStyle: 'preserve-3d',
            transform: `translateZ(${lerp(200, 0, rigProgress)}px) rotateX(${lerp(30, 0, rigProgress)}deg) rotateY(${lerp(-30, 0, rigProgress)}deg) rotateZ(${lerp(10, 0, rigProgress)}deg)`,
          }}
        >
          <div
            className="absolute top-[10%] left-[20%] w-[60%] h-[80%] bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-6 flex flex-col gap-4 overflow-hidden"
            style={{
              opacity: clamp01(localTime / 1),
              transform: `translateZ(${lerp(-200, 0, easeOutCubic(localTime / 1))}px)`,
            }}
          >
            <div className="flex gap-4 items-center">
              <div className="h-8 w-24 bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-accent)] rounded-lg" />
              <div
                className="h-4 w-32 bg-white/10 rounded"
                style={{opacity: 0.5 + 0.5 * (0.5 + 0.5 * wave(localTime, 1))}}
              />
            </div>
            <div className="flex-1 bg-zinc-800/50 rounded-xl flex items-end p-4 relative overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 w-full bg-gradient-to-t from-[var(--theme-primary)]/30 to-transparent border-t-2 border-[var(--theme-primary)]"
                style={{height: `${keyframes(localTime, [[0, 0], [1.05, 100], [1.5, 80]])}%`}}
              />
            </div>
          </div>
        </div>
      </div>

      {localTime > 0.5 && localTime < 1.2 && (
          <div
            style={frameStyle({
              opacity: engageProgress,
              scale: lerp(3, 1, engageProgress),
              blur: lerp(20, 0, engageProgress),
            })}
            className="absolute inset-0 flex items-center justify-center font-black text-white/90 text-7xl md:text-[120px] italic tracking-tight drop-shadow-2xl mix-blend-overlay z-40 pointer-events-none"
          >
            ENGAGE
          </div>
        )}
        {localTime > 1.3 && (
          <div
            style={frameStyle({
              opacity: convertProgress,
              scale: lerp(3, 1, convertProgress),
              blur: lerp(20, 0, convertProgress),
            })}
            className="absolute inset-0 flex items-center justify-center font-black text-transparent bg-clip-text bg-gradient-to-br from-[var(--theme-accent)] to-[var(--theme-primary)] text-7xl md:text-[132px] italic tracking-tight drop-shadow-[0_0_50px_var(--theme-glow)] z-40 pointer-events-none"
          >
            CONVERT
          </div>
        )}

      <div className="absolute bottom-6 left-6 right-6 flex justify-between items-center z-50 pointer-events-none">
        <div className="flex items-center gap-4 w-full">
          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-xl border border-white/20 flex justify-center items-center shrink-0 shadow-lg">
            <Play className="w-5 h-5 text-white ml-1 shadow-sm" />
          </div>
          <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden backdrop-blur-md">
            <div
              style={{width: `${clamp01(localTime / 2) * 100}%`}}
              className="h-full bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-accent)] shadow-[0_0_15px_var(--theme-primary)]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function UiIconText({item, localTime}: ClipTypeRendererProps) {
  const IconComponent =
    ((item.icon ? (LucideIcons as unknown as Record<string, ComponentType<{className?: string}>>)[item.icon] : null) ||
      Sparkles);
  const parts = parseMarkdown(item.title);
  const emphasizedIndex = parts.findIndex((p) => p.emphasized);
  const badgePop = backOut((localTime - 0.15) / 0.42);
  const badgeFloat = wave(localTime, 3.4) * 4;

  const iconBadge = (
    <span
      key="icon-badge"
      className="inline-flex items-center justify-center align-middle mx-2 md:mx-3 h-[0.92em] w-[0.92em] rounded-[0.22em] bg-gradient-to-br from-[var(--theme-primary)] to-[var(--theme-accent)] shadow-[0_0_28px_var(--theme-glow)]"
      style={{opacity: clamp01(badgePop), transform: `translateY(${badgeFloat}px) scale(${lerp(0.4, 1, clamp01(badgePop))})`}}
    >
      <IconComponent className="w-[0.58em] h-[0.58em] text-white" />
    </span>
  );

  return (
    <div
      style={enterStyle(localTime, {opacity: 0, scale: 0.97, y: 26, blur: 6}, 0.5)}
      className="absolute inset-0 flex items-center justify-center p-8 md:p-16 select-none overflow-hidden"
    >
      <div className="relative text-center font-black tracking-tight leading-[1.08] text-4xl md:text-[76px] [text-wrap:balance]">
        {parts.map((part, index) => (
          <span key={part.key} className="inline">
            {index === emphasizedIndex && iconBadge}
            <span
              className={part.emphasized ? 'text-gradient-sweep' : 'text-white'}
              style={part.emphasized ? gradientTextStyle(localTime + index * 0.06) : {textShadow: '0 3px 30px rgba(0,0,0,0.55)'}}
            >
              {part.text}
            </span>
          </span>
        ))}
        {emphasizedIndex === -1 && iconBadge}
      </div>
    </div>
  );
}

function XProfile({item, localTime}: ClipTypeRendererProps) {
  const profileName = cleanText(item.title) || 'Semrush AI';
  const followerProgress = easeOutCubic((localTime - 0.72) / 1.05);
  const followers = formatNumber(1280 + 84720 * followerProgress);
  const following = formatNumber(38 + 204 * followerProgress);
  const posts = [
    {body: 'Launch video ready in minutes.', stats: ['2.4K', '18K', '91K']},
    {body: 'Drop assets. Describe the mood. Ship the story.', stats: ['846', '7.8K', '42K']},
  ];

  return (
    <div className="absolute inset-0 p-3 md:p-5 z-20 overflow-hidden flex items-start justify-center">
      <div
        style={enterStyle(localTime, {opacity: 0, scale: 0.96, y: 20, blur: 8}, 0.36)}
        className="relative h-[118%] md:h-[122%] max-h-none aspect-[9/19.5] bg-zinc-950 text-white overflow-hidden select-none rounded-[2rem] border border-white/10 shadow-[0_28px_90px_rgba(0,0,0,0.45),0_0_60px_var(--theme-glow)]"
      >
          <div className="h-full flex flex-col">
            <div className="h-12 px-5 flex items-center justify-between border-b border-white/10 bg-black/90">
              <div className="flex items-center gap-4 min-w-0">
                <XIcon className="w-5 h-5 text-white/80" />
                <div className="min-w-0">
                  <div className="text-sm font-extrabold truncate">{profileName}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">
                    {formatNumber(1240 + 9360 * followerProgress)} posts
                  </div>
                </div>
              </div>
              <MoreHorizontal className="w-5 h-5 text-zinc-400" />
            </div>

            <div className="relative h-24 md:h-32 shrink-0 overflow-hidden bg-zinc-900">
              <div
                className="absolute inset-0"
                style={{
                  opacity: 0.88,
                  background:
                    'linear-gradient(135deg, var(--theme-primary), var(--theme-secondary) 42%, var(--theme-accent))',
                  transform: `translate3d(${wave(localTime, 5) * 10}px, 0, 0) scale(1.08)`,
                }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.22),transparent)]" />
            </div>

            <div className="relative px-5 pb-3 border-b border-white/10">
              <div
                style={enterStyle(localTime - 0.15, {opacity: 0, scale: 0.78, y: 12}, 0.4)}
                className="absolute -top-10 left-5 w-20 h-20 rounded-2xl bg-black p-1 shadow-2xl"
              >
                <div className="w-full h-full rounded-[18px] bg-gradient-to-br from-[var(--theme-primary)] via-[var(--theme-secondary)] to-[var(--theme-accent)] flex items-center justify-center text-3xl font-black italic">
                  FL
                </div>
              </div>

              <div className="flex justify-end py-3 gap-2">
                <button
                  type="button"
                  className="w-9 h-9 rounded-full border border-white/15 flex items-center justify-center text-zinc-300 bg-black"
                >
                  <Bell className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  style={{transform: `scale(${1 + clamp01((localTime - 0.95) / 0.22) * 0.08})`}}
                  className="h-9 px-4 rounded-full bg-white text-black text-sm font-extrabold flex items-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  Follow
                </button>
              </div>

              <div className="pt-1">
                <div className="flex items-center gap-1.5 text-xl md:text-2xl font-black tracking-tight">
                  {profileName}
                  <BadgeCheck className="w-5 h-5 text-[var(--theme-accent)]" />
                </div>
                <div className="text-sm text-zinc-500 font-mono">@semrushai</div>
                <p className="mt-2 text-sm md:text-base text-zinc-200 leading-snug">
                  Music-backed launch videos for product teams that move fast.
                </p>
                <div className="mt-3 flex items-center gap-5 text-sm">
                  <span><b className="text-white">{following}</b> <span className="text-zinc-500">Following</span></span>
                  <span><b className="text-white">{followers}</b> <span className="text-zinc-500">Followers</span></span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {posts.slice(0, 1).map((post, index) => {
                const rowTime = localTime - 0.52 - index * 0.12;
                return (
                  <div
                    key={post.body}
                    style={enterStyle(rowTime, {opacity: 0, y: 28, blur: 6}, 0.42)}
                    className="px-5 py-3 border-b border-white/10 flex gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--theme-primary)] to-[var(--theme-accent)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="font-bold truncate">{profileName}</span>
                        <BadgeCheck className="w-3.5 h-3.5 text-[var(--theme-accent)] shrink-0" />
                        <span className="text-zinc-500 font-mono truncate">@semrushai</span>
                      </div>
                      <p className="text-sm md:text-base text-zinc-200 mt-1">{post.body}</p>
                      <div className="mt-3 grid grid-cols-3 gap-3 text-zinc-500 text-xs">
                        <span className="flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />{post.stats[0]}</span>
                        <span className="flex items-center gap-1.5"><Repeat2 className="w-3.5 h-3.5" />{post.stats[1]}</span>
                        <span className="flex items-center gap-1.5"><Heart className="w-3.5 h-3.5" />{post.stats[2]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
      </div>
    </div>
  );
}

function FlowingStats({item, localTime}: ClipTypeRendererProps) {
  const countProgress = easeOutCubic((localTime - 0.5) / 1.45);
  const surge = Math.pow(clamp01(countProgress), 0.42);
  const count = formatNumber(420 + (928400 - 420) * surge);
  const buttonScale = localTime > 0.35 && localTime < 0.68 ? 0.96 : 1;
  const shineX = -120 + ((localTime % 1.4) / 1.4) * 340;
  const numberScale = 1 + (1 - countProgress) * Math.abs(wave(localTime, 0.18)) * 0.1;

  return (
    <div
      style={enterStyle(localTime, {opacity: 0, scale: 0.92, y: 30, blur: 10}, 0.34)}
      className="absolute inset-0 flex items-center justify-center p-8 overflow-hidden select-none"
    >
      <div className="relative w-full max-w-3xl h-[72%] min-h-[360px] flex flex-col items-center justify-center">
        <div className="absolute inset-x-6 top-8 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="absolute inset-x-12 bottom-8 h-px bg-gradient-to-r from-transparent via-[var(--theme-accent)]/45 to-transparent" />

        <button
          type="button"
          style={{
            transform: `scale(${buttonScale})`,
            background:
              'linear-gradient(105deg, var(--theme-primary), var(--theme-secondary), #ffffff, var(--theme-accent), var(--theme-primary))',
            backgroundSize: '260% auto',
            backgroundPosition: `${200 - ((localTime % 2) / 2) * 300}% center`,
          }}
          className="relative overflow-hidden h-20 md:h-24 px-14 md:px-20 rounded-full text-black font-black text-3xl md:text-5xl tracking-tight shadow-[0_0_70px_var(--theme-glow)] border border-white/40"
        >
          <span
            className="absolute -inset-y-8 w-24 bg-white/55 blur-2xl"
            style={{transform: `translate3d(${shineX}%, 0, 0) rotate(18deg)`}}
          />
          <span className="relative z-10">{cleanText(item.title) || 'Flowing'}</span>
        </button>

        <div
          className="mt-10 md:mt-12 text-center"
          style={{
            opacity: clamp01((localTime - 0.42) / 0.25),
            transform: `translate3d(0, ${lerp(28, 0, countProgress)}px, 0) scale(${numberScale})`,
          }}
        >
          <div
            className="font-black leading-none text-6xl md:text-[120px] text-gradient-sweep tabular-nums"
            style={gradientTextStyle(localTime)}
          >
            +{count}
          </div>
        </div>

        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-xl h-20 flex items-end justify-center gap-2 opacity-80">
          {Array.from({length: 18}).map((_, index) => {
            const phase = (index / 18) * Math.PI * 2;
            const barProgress = clamp01((localTime - 0.5) / 1.2);
            const height = lerp(10, 34 + 38 * (0.5 + 0.5 * wave(localTime, 0.72, phase)), barProgress);
            return (
              <span
                key={index}
                className="w-2 rounded-full bg-[var(--theme-accent)] shadow-[0_0_16px_var(--theme-glow)]"
                style={{
                  height,
                  opacity: lerp(0.2, 0.9, barProgress),
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ElementGrowth({clip, item, localTime}: ClipTypeRendererProps) {
  const [manualTriggerAt, setManualTriggerAt] = useState<number | null>(null);
  const autoTriggerAt = 0.25;
  const manualTriggered = manualTriggerAt !== null;
  const isTriggered = manualTriggered || localTime >= autoTriggerAt;
  const triggerStart = manualTriggerAt ?? autoTriggerAt;
  const triggerAge = isTriggered ? Math.max(0, localTime - triggerStart) : 0;
  const traceProgress = isTriggered ? easeInOutCubic(triggerAge / 1) : 0;
  const buttonPulse = isTriggered
    ? keyframes(Math.min(triggerAge, 0.5), [
      [0, 1],
      [0.1, 1.08],
      [0.2, 0.96],
      [0.32, 1.03],
      [0.5, 1],
    ])
    : 1;
  const kicker = item.ctaText || 'READY';
  const headline = cleanText(item.title) || 'Ready to hit the market?';

  const allNodes = useMemo(() => [
    {
      id: 1,
      left: '18%',
      top: '18%',
      icon: Sparkles,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 400 500 L 400 180 L 180 180',
    },
    {
      id: 2,
      left: '22%',
      top: '48%',
      icon: Zap,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 400 500 L 400 480 L 220 480',
    },
    {
      id: 3,
      left: '17%',
      top: '82%',
      icon: Flame,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 400 500 L 400 820 L 170 820',
    },
    {
      id: 4,
      left: '83%',
      top: '18%',
      icon: TrendingUp,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 600 500 L 600 180 L 830 180',
    },
    {
      id: 5,
      left: '78%',
      top: '52%',
      icon: Cpu,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 600 500 L 600 520 L 780 520',
    },
    {
      id: 6,
      left: '82%',
      top: '78%',
      icon: Sparkles,
      color: 'var(--theme-primary)',
      bg: 'var(--theme-glow)',
      path: 'M 500 500 L 600 500 L 600 780 L 820 780',
    },
  ], []);

  const nodes = useMemo(() => {
    const seed = stableHash(`${clip.speech}:${item.title || ''}`);
    return [...allNodes]
      .sort((a, b) => seededScore(seed, a.id) - seededScore(seed, b.id))
      .slice(0, 4);
  }, [allNodes, clip.speech, item.title]);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-40 overflow-hidden select-none">
<svg
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
      >
        {nodes.map((node) => (
          <g key={node.id}>
            <path
              d={node.path}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={node.path}
              fill="none"
              stroke={node.color}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset={1 - traceProgress}
              style={{
                opacity: traceProgress,
                filter: `drop-shadow(0 0 6px ${node.color})`,
              }}
            />
          </g>
        ))}
      </svg>

      <div className="relative z-20 flex flex-col items-center">
        <button
          type="button"
          onClick={() => setManualTriggerAt((current) => current ?? localTime)}
          className={`px-8 py-5 md:px-10 md:py-6 rounded-3xl border flex flex-col items-center justify-center gap-3 backdrop-blur-xl transition-colors duration-300 cursor-pointer ${
            isTriggered
              ? 'bg-black border-[var(--theme-primary)]'
              : 'bg-black border-white/20 hover:border-white/45 hover:bg-zinc-900'
          }`}
          style={{
            transform: `scale(${buttonPulse})`,
            borderColor: isTriggered ? 'var(--theme-primary)' : 'rgba(255,255,255,0.15)',
            boxShadow: isTriggered
              ? `0 0 ${32 + 18 * (0.5 + 0.5 * wave(localTime, 1.4))}px var(--theme-glow)`
              : '0 0 0 rgba(0,0,0,0)',
          }}
        >
          <span className="text-zinc-400 font-bold tracking-widest text-lg md:text-xl uppercase flex items-center gap-2">
            <MousePointerClick
              className={`w-5 h-5 transition-colors ${
                isTriggered ? 'text-[var(--theme-accent)] animate-pulse' : 'text-zinc-500'
              }`}
            />
            {kicker}
          </span>
          <span
            className={`text-2xl md:text-4xl font-black tracking-tight transition-all duration-300 leading-none ${
              isTriggered
                ? 'text-transparent text-gradient-sweep drop-shadow-[0_0_15px_var(--theme-glow)]'
                : 'text-white'
            }`}
            style={isTriggered ? gradientTextStyle(localTime) : undefined}
          >
            {headline}
          </span>
        </button>
      </div>

      {nodes.map((node, index) => {
        const NodeIcon = node.icon;
        const nodeProgress = isTriggered ? backOut((triggerAge - index * 0.1) / 0.45) : 0;

        return (
          <div
            key={node.id}
            style={{left: node.left, top: node.top}}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 z-20"
          >
            <div
              className="w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center border backdrop-blur-md transition-colors duration-500 bg-black"
              style={{
                opacity: nodeProgress,
                transform: `scale(${nodeProgress})`,
                borderColor: isTriggered ? node.color : 'rgba(255,255,255,0.1)',
                boxShadow: isTriggered
                  ? `0 0 25px ${node.color}, inset 0 0 15px ${node.bg}`
                  : 'none',
              }}
            >
              <NodeIcon
                className="w-6 h-6 md:w-7 md:h-7 transition-all duration-500"
                style={{
                  color: isTriggered ? 'white' : 'rgba(255,255,255,0.35)',
                  filter: isTriggered ? `drop-shadow(0 0 8px ${node.color})` : 'none',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SceneClock({localTime, duration}: ClipTypeRendererProps) {
  const progress = clamp01(localTime / Math.max(duration, 0.1));
  const intro = easeOutCubic(localTime / 0.45);
  const parts = formatFastClockParts(localTime, duration);
  const hourRotate = progress * 360;
  const minuteRotate = progress * 360 * 12;
  const sweepRotate = (localTime / 1.5) * 360;
  const glowPulse = 0.2 + 0.12 * (0.5 + 0.5 * wave(localTime, 4));

  return (
    <div className="absolute inset-0 flex items-center justify-center p-8 text-center z-10 overflow-hidden select-none">
<div
        className="relative flex items-center justify-center z-10 w-full max-w-3xl"
        style={{
          opacity: intro,
          transform: `scale(${lerp(0.9, 1, intro)})`,
        }}
      >
        <div className="relative flex items-center justify-center">
          <div className="w-[200px] h-[200px] md:w-[300px] md:h-[300px] relative flex items-center justify-center rounded-full bg-black/40 backdrop-blur-md border border-white/5 shadow-[0_0_80px_var(--theme-glow)]">
            <div className="absolute inset-0 w-full h-full rounded-full border-[6px] border-[var(--theme-primary)]" />

            <div className="absolute w-full h-full">
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-1.5 h-5 bg-[var(--theme-primary)]" />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-1.5 bg-[var(--theme-primary)]" />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-1.5 h-5 bg-[var(--theme-primary)]" />
              <div className="absolute left-2 top-1/2 -translate-y-1/2 w-5 h-1.5 bg-[var(--theme-primary)]" />
            </div>

            <svg
              className="absolute inset-0 w-full h-full text-[var(--theme-primary)]"
              viewBox="0 0 100 100"
            >
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="0.2 7.65"
                opacity="0.5"
              />
            </svg>

            <div
              className="absolute inset-3 rounded-full z-10 overflow-hidden mix-blend-screen"
              style={{
                background: 'conic-gradient(from 0deg, transparent 70%, var(--theme-glow) 100%)',
                transform: `rotate(${sweepRotate}deg)`,
              }}
            />

            <div
              className="absolute w-2 h-[70px] md:h-[100px] bg-[var(--theme-primary)] origin-bottom bottom-1/2 rounded-full z-20 shadow-[0_0_15px_var(--theme-primary)]"
              style={{transform: `rotate(${hourRotate}deg)`}}
            />

            <div
              className="absolute w-[2px] h-[100px] md:h-[140px] bg-[var(--theme-primary)] origin-bottom bottom-1/2 rounded-full z-20 shadow-[0_0_20px_var(--theme-primary)]"
              style={{transform: `rotate(${minuteRotate}deg)`}}
            >
              <div className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_10px_var(--theme-primary)]" />
            </div>

            <div className="absolute w-3 h-3 md:w-4 md:h-4 rounded-full bg-white shadow-[0_0_20px_rgba(255,255,255,1)] z-30" />
            <div className="absolute w-8 h-8 md:w-10 md:h-10 rounded-full border border-[var(--theme-primary)] bg-zinc-950 z-20 flex items-center justify-center">
              <div
                className="w-1 h-1 rounded-full bg-[var(--theme-primary)]"
                style={{opacity: 0.4 + 0.6 * (0.5 + 0.5 * wave(localTime, 0.9))}}
              />
            </div>
          </div>

          <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl z-40">
            <div className="font-mono text-xl md:text-2xl text-[var(--theme-primary)] font-medium tracking-[0.15em] flex items-center justify-center min-w-[240px] drop-shadow-[0_0_8px_var(--theme-glow)]">
              <span>{parts.hours}</span>
              <span className="mx-1" style={{opacity: 0.55 + 0.45 * (0.5 + 0.5 * wave(localTime, 1))}}>:</span>
              <span>{parts.minutes}</span>
              <span className="mx-1" style={{opacity: 0.55 + 0.45 * (0.5 + 0.5 * wave(localTime, 1))}}>:</span>
              <span>{parts.seconds}</span>
              <span className="mx-1 opacity-50">:</span>
              <span className="text-zinc-500 w-12 text-left">{parts.centiseconds}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SwipeDelete({item, localTime, duration}: ClipTypeRendererProps) {
  // Scale factor: reference animation is designed for 4.0s total
  const scale = duration / 4.0;

  // Timeline phases (scaled to fit clip duration)
  // 0.0s - swipeStart: Static state, pointer appears
  // swipeStart - swipeEnd: Touch and swipe left
  // swipeEnd - collapseStart: Release, triggers swipe-off
  // collapseStart - end: Card collapses / disappears, remaining item slides up
  const pointerAppear = 0.2 * scale;
  const swipeStart = 0.8 * scale;
  const swipeEnd = 2.0 * scale;
  const collapseStart = 2.8 * scale;
  const rowHeight = 84;
  const rowGap = 12;
  const containerPadding = 24;
  const swipedRowCenterY = containerPadding + rowHeight + rowGap + rowHeight / 2;

  // 1. Calculate swipe offset (X translation)
  let swipeX = 0;
  if (localTime >= swipeStart && localTime < swipeEnd) {
    const progress = clamp01((localTime - swipeStart) / (swipeEnd - swipeStart));
    swipeX = -progress * 160;
  } else if (localTime >= swipeEnd && localTime < collapseStart) {
    const progress = clamp01((localTime - swipeEnd) / (collapseStart - swipeEnd));
    swipeX = -160 - progress * 400;
  } else if (localTime >= collapseStart) {
    swipeX = -1000;
  }

  // 2. Calculate cursor/pointer position
  let pointerX = 180;
  let pointerY = swipedRowCenterY;
  let pointerOpacity = 0;
  let isTouching = false;

  if (localTime >= pointerAppear && localTime < swipeStart) {
    const progress = clamp01((localTime - pointerAppear) / (swipeStart - pointerAppear));
    pointerX = 180 - progress * 30;
    pointerY = swipedRowCenterY + 36 - progress * 36;
    pointerOpacity = progress;
  } else if (localTime >= swipeStart && localTime < swipeEnd) {
    const progress = clamp01((localTime - swipeStart) / (swipeEnd - swipeStart));
    pointerX = 150 - progress * 160;
    pointerY = swipedRowCenterY;
    pointerOpacity = 1;
    isTouching = true;
  } else if (localTime >= swipeEnd && localTime < swipeEnd + 0.4 * scale) {
    const progress = clamp01((localTime - swipeEnd) / (0.4 * scale));
    pointerX = -10;
    pointerY = swipedRowCenterY;
    pointerOpacity = 1 - progress;
  }

  // 3. Card height collapse factor
  let cardHeight = 84;
  let cardOpacity = 1;

  if (localTime >= collapseStart) {
    const progress = clamp01((localTime - collapseStart) / (1.0 * scale));
    cardHeight = 84 * (1 - progress);
    cardOpacity = 1 - progress;
  }

  const title = item.title || 'Item';

  return (
    <div className="absolute inset-0 p-6 md:p-12 z-20 overflow-hidden flex items-center justify-center">
      <div
        style={enterStyle(localTime, {opacity: 0, scale: 0.95, y: 30, blur: 8}, 0.36)}
        className="relative w-full max-w-md rounded-3xl bg-zinc-950/80 border border-zinc-800/80 shadow-[0_0_80px_var(--theme-glow)] overflow-hidden select-none backdrop-blur-xl"
      >
        <div className="p-6 space-y-3 relative">
          {/* Item 1 */}
          <div className="h-[84px] bg-zinc-950/50 rounded-2xl p-4 border border-zinc-800/60 flex items-center justify-between transition-all">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Film className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h4 className="font-bold text-sm md:text-base text-zinc-200">{title} 1</h4>
              </div>
            </div>
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          </div>

          {/* Item 2 - The Swiped/Deleted Item */}
          <div
            className="relative rounded-2xl overflow-hidden border border-zinc-800/60"
            style={{height: `${cardHeight}px`, opacity: cardOpacity}}
          >
            {/* Back Red Trash Bin Layer */}
            <div className="absolute inset-0 bg-gradient-to-r from-rose-500 to-red-600 flex items-center justify-end px-6 z-0">
              <div className="flex items-center gap-2 text-white font-bold text-sm md:text-base">
                <Trash2 className="w-5 h-5" />
              </div>
            </div>

            {/* Front Sliding Card Layer */}
            <div
              className="absolute inset-0 bg-zinc-950/95 p-4 flex items-center justify-between border-l-4 border-l-rose-500/50 z-10"
              style={{transform: `translateX(${swipeX}px)`}}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                  <Film className="w-5 h-5 text-rose-400" />
                </div>
                <div>
                  <h4 className="font-bold text-sm md:text-base text-zinc-200">{title} 2</h4>
                </div>
              </div>
            </div>
          </div>

          {/* Item 3 */}
          <div className="h-[84px] bg-zinc-950/50 rounded-2xl p-4 border border-zinc-800/60 flex items-center justify-between transition-all">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[var(--theme-primary)]/10 border border-[var(--theme-primary)]/20 flex items-center justify-center">
                <Film className="w-5 h-5 text-[var(--theme-primary)]" />
              </div>
              <div>
                <h4 className="font-bold text-sm md:text-base text-zinc-200">{title} 3</h4>
              </div>
            </div>
          </div>

          {/* Touch Gesture Pointer Overlay */}
          {pointerOpacity > 0 && (
            <div
              className="absolute pointer-events-none z-50 flex items-center justify-center"
              style={{
                left: `${pointerX}px`,
                top: `${pointerY}px`,
                opacity: pointerOpacity,
                transform: 'translate(-50%, -50%)',
              }}
            >
              {/* Ripple Ring when touching */}
              <div
                className={`absolute rounded-full bg-[var(--theme-primary)]/20 border border-[var(--theme-primary)]/30 transition-all ${
                  isTouching ? 'w-14 h-14 opacity-100 animate-ping' : 'w-0 h-0 opacity-0'
                }`}
              />

              {/* Virtual Touch Indicator Finger Icon */}
              <motion.div
                animate={isTouching ? {scale: 0.9} : {scale: 1}}
                className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md border border-white/40 shadow-2xl flex items-center justify-center text-white"
              >
                <Hand className="w-5 h-5 rotate-12 text-white fill-white/10" />
              </motion.div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeChartData(data?: ChartDataItem[]) {
  if (data?.length) return data;
  return [
    {label: 'Option A', value: 75},
    {label: 'Option B', value: 48},
    {label: 'Option C', value: 28},
    {label: 'Option D', value: 12},
  ];
}

function ChartFrame({item, children, localTime}: {item: ClipItem; children: ReactNode; localTime: number}) {
  const pulse = 0.65 + 0.35 * (0.5 + 0.5 * wave(localTime, 1.8));
  return (
    <div
      style={enterStyle(localTime, {opacity: 0, scale: 0.96, y: 18, blur: 8}, 0.38)}
      className="absolute inset-0 flex flex-col justify-center items-center z-10 p-6 md:p-12 overflow-hidden select-none"
    >
      <div
        className="absolute -top-40 -left-40 w-96 h-96 bg-[var(--theme-primary)]/10 rounded-full blur-[120px] pointer-events-none"
        style={{opacity: pulse}}
      />
      <div
        className="absolute -bottom-40 -right-40 w-96 h-96 bg-[var(--theme-accent)]/10 rounded-full blur-[120px] pointer-events-none"
        style={{opacity: 1.1 - pulse}}
      />
      <div
        style={enterStyle(localTime, {opacity: 0, y: -10}, 0.4)}
        className="text-4xl md:text-5xl font-extrabold text-center text-white tracking-tight mb-8 md:mb-12 max-w-3xl leading-snug"
      >
        <MarkdownText text={item.title} time={localTime} />
      </div>
      <div className="w-full relative flex-1 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

function ChartBar(props: ClipTypeRendererProps) {
  const {item, localTime} = props;
  const data = normalizeChartData(item.chartData);
  const maxVal = Math.max(...data.map((entry) => entry.value), 1);
  const progress = Math.min(localTime / 0.8, 1);

  return (
    <ChartFrame item={item} localTime={localTime}>
      <div className="w-full max-w-2xl mx-auto flex flex-col justify-end h-64 md:h-80 gap-6 px-4">
        <div className="flex justify-between items-end h-full gap-4 md:gap-8">
          {data.map((entry, index) => {
            const currentHeight = ((entry.value / maxVal) * 100) * progress;
            const currentValue = Math.round(entry.value * progress);
            const highlighted = index === data.length - 1;
            const style = entry.color
              ? {background: entry.color}
              : undefined;

            return (
              <div key={`${entry.label}-${index}`} className="flex-1 flex flex-col items-center justify-end h-full group">
                <div
                  style={enterStyle(Math.max(0, localTime - index * 0.04), {opacity: 0, y: 10}, 0.28)}
                  className={`text-xs md:text-sm font-semibold mb-2 ${highlighted ? 'text-cyan-300 text-base scale-110 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]' : 'text-zinc-400'}`}
                >
                  {entry.labelPrefix ?? ''}{currentValue}
                </div>

                <div className="w-full relative bg-zinc-950/50 border border-zinc-900 rounded-xl overflow-hidden flex items-end" style={{height: '70%'}}>
                  <div
                    className={`w-full rounded-t-lg border-t flex items-center justify-center ${highlighted ? 'bg-gradient-to-t from-[var(--theme-primary)] to-[var(--theme-secondary)] border-[var(--theme-accent)] text-white font-bold glow-effect' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}
                    style={{height: `${currentHeight}%`, ...style}}
                  />
                </div>

                <div className={`text-[10px] md:text-xs text-center mt-3 truncate w-full ${highlighted ? 'text-white font-bold' : 'text-zinc-500'}`}>
                  {entry.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ChartFrame>
  );
}

function defaultLineMetrics(): LineChartMetric[] {
  return [
    {label: 'Production Cost', prefix: '-', suffix: '% Less', direction: 'down', valueStart: 0, valueEnd: 95},
    {label: 'Launch Speed', prefix: '+', suffix: 'x Faster', direction: 'up', valueStart: 1, valueEnd: 10},
  ];
}

function ChartLine(props: ClipTypeRendererProps) {
  const {item, localTime} = props;
  const progress = Math.min(localTime / 0.8, 1);
  const width = 500;
  const height = 240;
  const padding = 30;
  const leftStart = item.lineLeftValueStart ?? 90;
  const leftEnd = item.lineLeftValueEnd ?? 5;
  const rightStart = item.lineRightValueStart ?? 10;
  const rightEnd = item.lineRightValueEnd ?? 90;
  const metrics = item.lineMetrics || defaultLineMetrics();

  const getLeftY = (p: number) => {
    const val = leftEnd < leftStart
      ? (leftStart - leftEnd) * Math.exp(-4 * p) + leftEnd
      : leftStart + (leftEnd - leftStart) * (1 - Math.exp(-4 * p));
    return height - (val / 100) * (height - 2 * padding) - padding;
  };
  const getRightY = (p: number) => {
    const diff = rightEnd - rightStart;
    const sCurve = 1 / (1 + Math.exp(-6 * (p - 0.5)));
    const val = rightStart + diff * sCurve;
    return height - (val / 100) * (height - 2 * padding) - padding;
  };

  const linePoints = useMemo(() => {
    const steps = Math.floor(progress * 50);
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const p = i / 50;
      const x = padding + p * (width - 2 * padding);
      left.push(`${x},${getLeftY(p)}`);
      right.push(`${x},${getRightY(p)}`);
    }
    return {left: left.join(' '), right: right.join(' ')};
  }, [progress, leftStart, leftEnd, rightStart, rightEnd]);

  const currentX = padding + progress * (width - 2 * padding);

  return (
    <ChartFrame item={item} localTime={localTime}>
      <div className="w-full max-w-2xl mx-auto bg-zinc-950/40 p-4 md:p-6 rounded-xl border border-zinc-900/80 shadow-inner flex flex-col md:flex-row gap-6 items-center">
        <div className="flex-1 w-full">
          <svg className="w-full h-auto overflow-visible" viewBox={`0 0 ${width} ${height}`}>
            <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#1b1b1f" strokeWidth="1" strokeDasharray="3,3" />
            <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#1b1b1f" strokeWidth="1" strokeDasharray="3,3" />
            <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#27272a" strokeWidth="1.5" />
            <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#27272a" strokeWidth="1.5" />
            <polyline fill="none" stroke="#f43f5e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={linePoints.left} />
            <polyline fill="none" stroke="#06b6d4" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" points={linePoints.right} />
            {progress > 0 && (
              <>
                <circle cx={currentX} cy={getLeftY(progress)} r="5" fill="#f43f5e" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx={currentX} cy={getRightY(progress)} r="5" fill="#06b6d4" stroke="#ffffff" strokeWidth="1.5" />
              </>
            )}
          </svg>
        </div>

        <div className="flex flex-row md:flex-col gap-4 w-full md:w-48 justify-around">
          {metrics.map((metric, index) => {
            const startValue = metric.valueStart ?? (index === 0 ? 0 : 1);
            const endValue = metric.valueEnd ?? (index === 0 ? 95 : 10);
            const computedValue = startValue + (endValue - startValue) * progress;
            const displayValue = metric.suffix?.includes('x')
              ? (Math.round(computedValue * 10) / 10).toFixed(1)
              : Math.round(computedValue);
            const first = index === 0;

            return (
              <div key={`${metric.label}-${index}`} className={`bg-zinc-900/60 p-3 rounded-xl border flex items-center gap-3 flex-1 md:flex-none ${first ? 'border-rose-500/10' : 'border-cyan-500/10'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${first ? 'bg-rose-500/10' : 'bg-cyan-500/10'}`}>
                  {metric.direction === 'down'
                    ? <TrendingDown className={`w-5 h-5 ${first ? 'text-rose-500' : 'text-cyan-400'}`} />
                    : <TrendingUp className={`w-5 h-5 ${first ? 'text-rose-500' : 'text-cyan-400'}`} />}
                </div>
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{metric.label}</div>
                  <div className={`text-sm font-bold mt-0.5 ${first ? 'text-rose-400' : 'text-cyan-400'}`}>
                    {metric.prefix ?? ''}{displayValue}{metric.suffix ?? ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ChartFrame>
  );
}

function ChartPie(props: ClipTypeRendererProps) {
  const {item, localTime} = props;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const progress = Math.min(localTime / 0.8, 1);
  const rawData = item.chartData?.length
    ? item.chartData
    : [
      {label: 'Segment A', value: 45},
      {label: 'Segment B', value: 28},
      {label: 'Segment C', value: 17},
      {label: 'Segment D', value: 10},
    ];
  const total = rawData.reduce((sum, entry) => sum + entry.value, 0) || 1;
  const segments = useMemo(() => {
    const palette = ['#8b5cf6', '#06b6d4', '#f43f5e', '#10b981', '#f59e0b', '#ec4899'];
    let cumulativePercent = 0;
    return rawData.map((entry, index) => {
      const percentage = (entry.value / total) * 100;
      const startPercent = cumulativePercent;
      cumulativePercent += percentage;
      return {
        ...entry,
        percentage,
        startPercent,
        color: entry.color || palette[index % palette.length],
      };
    });
  }, [rawData, total]);
  const activeItem = hoveredIndex !== null ? segments[hoveredIndex] : segments[0];
  const size = 200;
  const radius = 70;
  const circumference = 2 * Math.PI * radius;

  return (
    <ChartFrame item={item} localTime={localTime}>
      <div className="w-full max-w-2xl mx-auto flex flex-col md:flex-row items-center gap-8 justify-center bg-zinc-950/30 p-6 md:p-8 rounded-xl border border-zinc-900/85">
        <div className="relative w-48 h-48 flex items-center justify-center select-none">
          <svg className="w-full h-full overflow-visible transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
            {segments.map((segment, index) => {
              const strokeWidth = hoveredIndex === index ? 26 : 20;
              const strokeLength = (segment.percentage * progress / 100) * circumference;
              const offset = (segment.startPercent / 100) * circumference;

              return (
                <circle
                  key={`${segment.label}-${index}`}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="transparent"
                  stroke={segment.color}
                  strokeWidth={strokeWidth}
                  strokeLinecap={segment.percentage > 4 ? 'round' : 'butt'}
                  strokeDasharray={`${strokeLength} ${circumference}`}
                  strokeDashoffset={-offset}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className="cursor-pointer origin-center opacity-90"
                />
              );
            })}
          </svg>

          {activeItem && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4 text-center">
              <span className="text-2xl font-black text-white tracking-tight">
                {Math.round(activeItem.percentage * progress)}%
              </span>
              <span className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold max-w-[125px] truncate mt-0.5">
                {activeItem.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 flex flex-col gap-4 font-sans text-left min-w-0">
          {item.chartHeading && (
            <h3 className="text-lg font-bold text-white tracking-tight">
              {item.chartHeading}
            </h3>
          )}
          <div className="flex flex-col gap-2 max-h-[140px] overflow-y-auto pr-1 no-scrollbar">
            {segments.map((segment, index) => (
              <div
                key={`${segment.label}-${index}`}
                className={`flex items-center justify-between gap-3 p-1.5 rounded-lg border ${
                  hoveredIndex === index ? 'bg-zinc-900/60 border-zinc-700/80' : 'bg-transparent border-transparent'
                }`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/10" style={{backgroundColor: segment.color}} />
                  <span className={`text-xs truncate ${hoveredIndex === index ? 'text-white font-semibold' : 'text-zinc-400'}`}>
                    {segment.label}
                  </span>
                </div>
                <span className="text-cyan-400 shrink-0 font-mono text-xs font-bold">
                  {Math.round(segment.percentage)}%
                </span>
              </div>
            ))}
          </div>
          {item.chartDescription && (
            <p className="text-xs text-zinc-500 leading-relaxed max-w-sm border-t border-zinc-900 pt-3">
              {item.chartDescription}
            </p>
          )}
        </div>
      </div>
    </ChartFrame>
  );
}

interface FeedbackData {
  name: string;
  handle: string;
  text: string;
  avatarGradient: string;
}

const feedbackGradients = [
  'from-pink-500 to-rose-500',
  'from-purple-500 to-indigo-500',
  'from-cyan-400 to-blue-500',
  'from-yellow-400 to-orange-500',
  'from-emerald-400 to-teal-500',
  'from-red-500 to-pink-500',
  'from-blue-600 to-purple-600',
  'from-fuchsia-500 to-pink-600',
];

const feedbacks: FeedbackData[] = [
  {name: 'Alex J.', handle: '@alexj_design', text: 'Literally saved me 5 hours this week. The results are unbelievably good.', avatarGradient: 'from-pink-500 to-rose-500'},
  {name: 'Sarah Chen', handle: '@sarahcodes', text: 'So simple to use, and the output is clean enough to ship.', avatarGradient: 'from-purple-500 to-indigo-500'},
  {name: 'Mike S.', handle: '@mikesmith12', text: 'I used to pay an agency for this. Now I do it in minutes.', avatarGradient: 'from-cyan-400 to-blue-500'},
  {name: 'Elena R.', handle: '@elena_startups', text: 'The quality and efficiency are exactly what I wanted.', avatarGradient: 'from-yellow-400 to-orange-500'},
  {name: 'David Lee', handle: '@davidtlee', text: 'The final output looks like it took days of professional work.', avatarGradient: 'from-emerald-400 to-teal-500'},
  {name: 'Lisa W.', handle: '@lisaw_create', text: 'Makes my project look so much more polished.', avatarGradient: 'from-red-500 to-pink-500'},
  {name: 'Tom H.', handle: '@tomh_builds', text: 'Just launched with this and the video carried the page.', avatarGradient: 'from-blue-600 to-purple-600'},
  {name: 'Anna K.', handle: '@annak_ux', text: 'The user experience is direct and fast.', avatarGradient: 'from-fuchsia-500 to-pink-600'},
];

function feedbackCardsFromItem(item: ClipItem): FeedbackData[] {
  if (!Array.isArray(item.cards) || item.cards.length === 0) return [];
  return item.cards.map((card, index) => ({
    name: card.number ? `Feedback ${card.number}` : `Feedback ${index + 1}`,
    handle: item.title || 'Launch feedback',
    text: cleanText(card.title),
    avatarGradient: feedbackGradients[index % feedbackGradients.length],
  })).filter((card) => card.text);
}

function FeedbackCard({data}: {data: FeedbackData}) {
  return (
    <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800/50 rounded-xl p-5 flex gap-4 w-full shadow-2xl shrink-0">
      <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${data.avatarGradient} flex items-center justify-center shrink-0 text-white font-bold text-lg shadow-inner`}>
        {data.name.charAt(0)}
      </div>
      <div className="flex-1 space-y-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-zinc-200 truncate">{data.name}</span>
          <span className="text-zinc-500 text-sm truncate">{data.handle}</span>
        </div>
        <p className="text-zinc-400 text-sm leading-relaxed">{data.text}</p>
      </div>
    </div>
  );
}

function FeedbackCards({item, localTime}: ClipTypeRendererProps) {
  const activeFeedbacks = feedbackCardsFromItem(item);
  const sourceFeedbacks = activeFeedbacks.length > 0 ? activeFeedbacks : feedbacks;
  const repeatableFeedbacks = sourceFeedbacks.length >= 8
    ? sourceFeedbacks
    : Array.from({length: 8}, (_, index) => sourceFeedbacks[index % sourceFeedbacks.length]);
  const col1 = [...repeatableFeedbacks.slice(0, 4), ...repeatableFeedbacks.slice(0, 4)];
  const col2 = [...repeatableFeedbacks.slice(4, 8), ...repeatableFeedbacks.slice(4, 8)];
  const col3 = [...repeatableFeedbacks.slice(2, 6), ...repeatableFeedbacks.slice(2, 6)];
  const drift = localTime * 72;

  return (
    <div
      style={enterStyle(localTime, {opacity: 0, scale: 1.04, blur: 8}, 0.35)}
      className="absolute inset-0 flex overflow-hidden justify-center gap-4 md:gap-8 p-4 z-10"
    >
      <div
        style={{transform: `translate3d(0, ${-140 - drift}px, 0)`}}
        className="flex flex-col gap-4 w-72 md:w-96"
      >
        {col1.map((item, index) => <FeedbackCard key={`c1-${index}`} data={item} />)}
      </div>
      <div
        style={{transform: `translate3d(0, ${-560 + drift}px, 0)`}}
        className="flex flex-col gap-4 w-72 md:w-96 mt-12"
      >
        {col2.map((item, index) => <FeedbackCard key={`c2-${index}`} data={item} />)}
      </div>
      <div
        style={{transform: `translate3d(0, ${-240 - drift}px, 0)`}}
        className="flex-col gap-4 w-72 md:w-96 hidden md:flex"
      >
        {col3.map((item, index) => <FeedbackCard key={`c3-${index}`} data={item} />)}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-black to-transparent pointer-events-none" />
    </div>
  );
}

function parseTitleMarkdown2(text: string, isActive: boolean, time = 0) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return (
        <span key={index} className="text-gradient-sweep font-black" style={gradientTextStyle(time + index * 0.08)}>
          {part}
        </span>
      );
    }
    return (
      <span key={index} className={isActive ? "text-gradient-sweep" : ""} style={isActive ? gradientTextStyle(time + index * 0.08) : undefined}>
        {part}
      </span>
    );
  });
}

function renderComparisonValue(value: boolean | string | undefined, active: boolean, rowProgress: number) {
  if (typeof value === 'boolean') {
    if (value) {
      return (
        <motion.div
          animate={{scale: rowProgress > 0 ? 1 : 0}}
          transition={{type: 'spring'}}
          className={`p-1 rounded-full border ${
            active
              ? 'bg-[var(--theme-primary)]/10 border-[var(--theme-primary)]/30'
              : 'bg-emerald-500/10 border-emerald-500/20'
          }`}
          style={active ? {boxShadow: '0 0 15px rgba(var(--theme-primary-rgb, 34,211,238),0.2)'} : undefined}
        >
          <Check className={`${active ? 'text-[var(--theme-primary)]' : 'text-emerald-500'} w-5 h-5 md:w-6 md:h-6 stroke-[3px]`} />
        </motion.div>
      );
    }

    return <X className="text-zinc-600/70 w-5 h-5 md:w-6 md:h-6" />;
  }

  return (
    <span className={`text-xs md:text-sm font-bold text-center ${active ? 'text-[var(--theme-primary)]' : 'text-zinc-300'}`}>
      {value || '-'}
    </span>
  );
}

function SceneComparison({item, localTime}: ClipTypeRendererProps) {
  const columns = item.comparisonColumns?.length
    ? item.comparisonColumns
    : [
      {label: 'Option A'},
      {label: 'Option B'},
      {label: 'Option C', featured: true},
    ];
  const rows = item.comparisonRows?.length
    ? item.comparisonRows
    : [
      {feature: 'Feature 1', values: [false, true, true]},
      {feature: 'Feature 2', values: [false, false, true]},
      {feature: 'Feature 3', values: [true, true, true]},
    ];
  const gridTemplateColumns = `minmax(120px, 1.15fr) repeat(${columns.length}, minmax(78px, 1fr))`;
  const showProgress = clamp01(localTime / 0.3);

  return (
    <motion.div
      animate={{opacity: showProgress, scale: lerp(0.98, 1, showProgress)}}
      transition={{duration: 0.3}}
      className="w-full h-full flex flex-col items-center justify-center p-6 md:p-12 bg-zinc-950/40 backdrop-blur-md rounded-3xl"
    >
      {item.title && (
        <motion.h2
          animate={{opacity: clamp01((localTime - 0.1) / 0.3), y: lerp(-10, 0, clamp01((localTime - 0.1) / 0.3))}}
          transition={{duration: 0.2}}
          className="text-3xl md:text-5xl font-black text-transparent text-gradient-sweep mb-6 md:mb-10 tracking-tighter text-center"
        >
          {cleanText(item.title)}
        </motion.h2>
      )}

      <div className="w-full max-w-5xl bg-zinc-900/85 rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl relative">
        <div
          className="grid gap-2 md:gap-4 p-4 md:p-6 border-b border-zinc-800 bg-zinc-950/60 font-black text-xs md:text-sm text-zinc-400 tracking-wider"
          style={{gridTemplateColumns}}
        >
          <div className="text-zinc-300">{item.label || 'Feature'}</div>
          {columns.map((column, index) => (
            <div
              key={`${column.label}-${index}`}
              className={`text-center relative rounded-lg py-1 ${column.featured ? 'text-[var(--theme-primary)] font-extrabold bg-[var(--theme-primary)]/5' : ''}`}
            >
              {column.label}
              {column.featured && (
                <span className="absolute -top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--theme-accent)] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--theme-accent)]" />
                </span>
              )}
            </div>
          ))}
        </div>

        <motion.div
          animate={{opacity: clamp01((localTime - 0.15) / 0.3)}}
          transition={{duration: 0.2}}
          className="divide-y divide-zinc-800/60"
        >
          {rows.map((row, i) => {
            const rowProgress = clamp01((localTime - 0.2 - i * 0.15) / 0.2);
            return (
              <motion.div
                key={i}
                animate={{opacity: rowProgress, y: lerp(15, 0, rowProgress)}}
                transition={{type: 'spring', stiffness: 100}}
                className="grid gap-2 md:gap-4 p-4 md:p-5 items-center transition-colors hover:bg-zinc-800/30"
                style={{gridTemplateColumns}}
              >
                <div className="font-bold text-sm md:text-lg text-white/95">{row.feature}</div>

                {columns.map((column, index) => (
                  <div
                    key={`${row.feature}-${column.label}-${index}`}
                    className={`min-h-9 flex justify-center items-center rounded-lg ${column.featured ? 'bg-[var(--theme-primary)]/5' : ''}`}
                  >
                    {renderComparisonValue(row.values[index], Boolean(column.featured), rowProgress)}
                  </div>
                ))}
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </motion.div>
  );
}

function PyramidHighlight(props: ClipTypeRendererProps) {
  const {item, localTime} = props;
  const defaultCards = [
    {icon: 'Layers', title: 'Base layer', number: '01'},
    {icon: 'Sparkles', title: 'Effect layer', number: '02'},
    {icon: 'Zap', title: 'Composition layer', number: '03'},
    {icon: 'Trophy', title: '**Launch-ready**', number: '04'},
  ];
  const cards = item.cards?.length ? item.cards : defaultCards;
  const layers = cards.map((c) => ({text: c.title}));
  const totalLayers = layers.length;
  const targetIndex = item.targetIndex ?? (totalLayers - 1);
  const highlightActive = localTime >= 0.75;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-950/40 backdrop-blur-md rounded-3xl p-8 gap-3 relative">

      <div className="flex flex-col items-center w-full max-w-xl gap-3.5">
        {layers.map((layer, index) => {
          const isVisible = localTime >= 0.1;
          const isTarget = highlightActive && index === targetIndex;

          const widthPercent = totalLayers > 1
            ? 55 + (index * (40 / (totalLayers - 1)))
            : 95;
          const width = `${widthPercent}%`;

          return (
            <motion.div
              key={index}
              initial={{opacity: 0, x: -80, scale: 0.95}}
              animate={{
                opacity: isVisible ? 1 : 0,
                x: isVisible ? 0 : -80,
                scale: isTarget ? 1.05 : isVisible ? 1 : 0.95,
              }}
              transition={{duration: 0.45, ease: 'easeOut'}}
              style={{width, opacity: 0}}
              className={`h-16 rounded-2xl flex items-center justify-center font-black border backdrop-blur-md ${
                isTarget
                  ? 'bg-white/[0.08] border-2 border-[var(--theme-accent)]'
                  : 'bg-white/[0.03] border border-white/20'
              }`}
            >
              <span
                className={`truncate px-5 tracking-wide transition-all duration-300 ${
                  isTarget
                    ? 'text-2xl font-black'
                    : 'text-lg text-zinc-400'
                }`}
              >
                {parseTitleMarkdown2(layer.text, isTarget, localTime)}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function ProcessCardHighlight(props: ClipTypeRendererProps) {
  const {item, localTime} = props;
  const defaultCards = [
    {icon: 'FileInput', title: 'Import assets', number: '1'},
    {icon: 'Wand2', title: '**Agent build**', number: '2'},
    {icon: 'Clapperboard', title: 'Tune timing', number: '3'},
    {icon: 'Rocket', title: 'Launch', number: '4'},
  ];
  const cards = item.cards?.length ? item.cards : defaultCards;
  const targetIndex = item.targetIndex ?? (cards.length - 1);

  const isIntroduced = localTime >= 0.1;
  const isFocused = localTime >= 0.45;
  const isHighlighted = localTime >= 0.85;

  let xOffset = '100%';
  if (isFocused) {
    xOffset = `calc(-${targetIndex * (256 + 24)}px + 50% - 128px)`;
  } else if (isIntroduced) {
    const slideProgress = Math.min((localTime - 0.1) / 0.35, 1);
    const startX = 400;
    const endX = 0;
    const currentX = startX - slideProgress * (startX - endX);
    xOffset = `calc(-0px + 50% - 128px + ${currentX}px)`;
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-zinc-950/40 backdrop-blur-md rounded-3xl overflow-hidden p-8 relative">

      <motion.div
        className="flex gap-6 items-center"
        animate={{x: xOffset}}
        transition={{type: 'spring', stiffness: 140, damping: 16}}
      >
        {cards.map((card, index) => {
          const Icon = ((card.icon && (LucideIcons as any)[card.icon]) || Sparkles) as ComponentType<{
            className?: string;
            style?: CSSProperties;
          }>;
          const isActive = isHighlighted && index === targetIndex;

          return (
            <motion.div
              key={index}
              animate={{
                scale: isActive ? 1.15 : 0.9,
                opacity: isHighlighted ? (isActive ? 1 : 0.45) : 0.85,
              }}
              transition={{type: 'spring', stiffness: 150, damping: 14}}
              className={`w-64 h-80 rounded-3xl border flex flex-col items-center justify-center p-6 gap-5 backdrop-blur-md transition-all duration-300 ${
                isActive
                  ? 'bg-white/[0.08] border border-[var(--theme-primary)]/80'
                  : 'bg-transparent border border-white/10'
              }`}
              style={isActive ? {boxShadow: '0 0 45px rgba(var(--theme-primary-rgb,34,211,238),0.35)'} : undefined}
            >
              {Icon && (
                <Icon
                  className={`transition-all duration-300 ${
                    isActive
                      ? 'w-18 h-18 text-[var(--theme-primary)] scale-110'
                      : 'w-14 h-14 text-zinc-500'
                  }`}
                  style={isActive ? {filter: 'drop-shadow(0 0 12px rgba(var(--theme-primary-rgb,34,211,238),0.8))'} : undefined}
                />
              )}
              <h3
                className={`font-black transition-all duration-300 tracking-wide text-center leading-none ${
                  isActive
                    ? 'text-3xl'
                    : 'text-xl text-zinc-400'
                }`}
              >
                {parseTitleMarkdown2(card.title, isActive, localTime)}
              </h3>
              {card.number && (
                <p
                  className={`font-black transition-all duration-300 ${
                    isActive
                      ? 'text-4xl text-white'
                      : 'text-3xl text-zinc-600'
                  }`}
                  style={isActive ? {textShadow: '0 0 10px rgba(255,255,255,0.4)'} : undefined}
                >
                  {card.number}
                </p>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

export default function ClipTypeRenderer(props: ClipTypeRendererProps) {
  if (props.item.demoUi) return <DemoUiEmbed {...props} />;

  switch (props.item.type) {
    case 'text-typing':
    case 'text-title':
      return <TextTyping {...props} />;
    case 'text-popup':
      return <TextPopup {...props} />;
    case 'text-shatter':
      return <TextShatter {...props} />;
    case 'text-zoom':
      return <TextZoom {...props} />;
    case 'text-impact':
      return <TextImpact {...props} />;
    case 'text-logo':
      return <TextLogo {...props} />;
    case 'ui-dropfiles':
      return <UiDropFiles {...props} />;
    case 'ui-prompt-input':
      return <UiPromptInput {...props} />;
    case 'ui-render-loading':
      return <UiRenderLoading {...props} />;
    case 'ui-video-preview':
      return <UiVideoPreview {...props} />;
    case 'ui-icon-text':
      return <UiIconText {...props} />;
    case 'x-profile':
      return <XProfile {...props} />;
    case 'flowing-stats':
      return <FlowingStats {...props} />;
    case 'element-growth':
      return <ElementGrowth {...props} />;
    case 'scene-clock':
      return <SceneClock {...props} />;
    case 'swipe-delete':
      return <SwipeDelete {...props} />;
    case 'chart-bar':
      return <ChartBar {...props} />;
    case 'chart-line':
      return <ChartLine {...props} />;
    case 'chart-pie':
      return <ChartPie {...props} />;
    case 'feedback-cards':
      return <FeedbackCards {...props} />;
    case 'image':
      return <ImageEmbed {...props} />;
    case 'video':
      return <VideoEmbed {...props} />;
    case 'comparison-table':
      return <SceneComparison {...props} />;
    case 'pyramid-highlight':
      return <PyramidHighlight {...props} />;
    case 'process-card-highlight':
      return <ProcessCardHighlight {...props} />;
    case 'semrush-search':
      return <SemrushSearch {...props} />;
    case 'semrush-ai-badge':
      return <SemrushAiBadge {...props} />;
    case 'semrush-logo':
      return <SemrushLogoScene {...props} />;
    case 'semrush-workspace':
      return <SemrushWorkspace {...props} />;
    case 'semrush-chat':
      return <SemrushChat {...props} />;
    case 'semrush-publish':
      return <SemrushPublish {...props} />;
    case 'semrush-audit':
      return <SemrushAudit {...props} />;
    case 'semrush-feature-cloud':
      return <SemrushFeatureCloud {...props} />;
    default:
      return null;
  }
}
