/*
 * story-presets — state/metadata tables + actor artwork resolver for the
 * `story` video component.
 *
 * Real actor art (one dark-deco silhouette set per preset × state) lives in
 * nodes/video-preview/story-assets/actors and is resolved by
 * getStoryActorAsset(); any missing preset/state degrades to a generated
 * rim-lit shadow figure. Preset keys and states follow data/video-prompt.md
 * §three (story). `tone` values line up with TONE_COLORS in
 * nodes/video-preview/cinematic-video/story-item.tsx.
 */

export type StoryTone = "danger" | "warning" | "search" | "value" | "chaos" | "ideal";

export type StoryActorKey =
  | "protagonist"
  | "interior-designer"
  | "consultant"
  | "doctor"
  | "lawyer"
  | "accountant"
  | "financial-advisor"
  | "executive"
  | "fitness-woman"
  | "office-worker-woman"
  | "silver-haired-expert"
  | "homemaker"
  | "small-business-owner"
  | "athletic-man";

export type StoryActorStateKey =
  | "neutral"
  | "worried"
  | "overwhelmed"
  | "frustrated"
  | "determined"
  | "confident";

export type StoryObjectStateKey = "idle" | "active" | "strained" | "broken" | "gone";

export const STORY_ACTORS: Record<StoryActorKey, { label: string }> = {
  protagonist: { label: "Protagonist" },
  "interior-designer": { label: "Interior Designer" },
  consultant: { label: "Consultant" },
  doctor: { label: "Doctor" },
  lawyer: { label: "Lawyer" },
  accountant: { label: "Accountant" },
  "financial-advisor": { label: "Financial Advisor" },
  executive: { label: "Executive" },
  "fitness-woman": { label: "Fitness Trainer" },
  "office-worker-woman": { label: "Office Worker" },
  "silver-haired-expert": { label: "Senior Expert" },
  homemaker: { label: "Homemaker" },
  "small-business-owner": { label: "Small Business Owner" },
  "athletic-man": { label: "Athlete" },
};

export const STORY_ACTOR_STATES: Record<
  StoryActorStateKey,
  { label: string; tone: StoryTone }
> = {
  neutral: { label: "Neutral", tone: "search" },
  worried: { label: "Worried", tone: "warning" },
  overwhelmed: { label: "Overwhelmed", tone: "danger" },
  frustrated: { label: "Frustrated", tone: "danger" },
  determined: { label: "Determined", tone: "value" },
  confident: { label: "Confident", tone: "ideal" },
};

export const STORY_OBJECT_STATES: Record<
  StoryObjectStateKey,
  { label: string; tone: StoryTone; jitter: number; transform: string; filter: string }
> = {
  idle: { label: "Idle", tone: "search", jitter: 0, transform: "scale(1)", filter: "none" },
  active: {
    label: "Active",
    tone: "ideal",
    jitter: 0.2,
    transform: "scale(1.03)",
    filter: "saturate(1.12) brightness(1.05)",
  },
  strained: {
    label: "Strained",
    tone: "warning",
    jitter: 0.55,
    transform: "rotate(-1.5deg) scale(0.99)",
    filter: "saturate(0.85) brightness(0.95)",
  },
  broken: {
    label: "Broken",
    tone: "danger",
    jitter: 0.9,
    transform: "rotate(3deg) scale(0.95)",
    filter: "grayscale(0.25) saturate(0.7) brightness(0.82)",
  },
  gone: {
    label: "Gone",
    tone: "chaos",
    jitter: 0,
    transform: "scale(0.82)",
    filter: "grayscale(0.55) brightness(0.7) opacity(0.55)",
  },
};

// New preparations use one ethnicity-neutral set at <preset>/<state>.png.
// Keep reading the legacy <preset>/<variant>/<state>.png layout so existing
// local data remains usable without an expensive regeneration.
const actorUrls = {
  ...import.meta.glob(
    "../../nodes/video-preview/Assets/story-assets/actors/*/*.png",
    { eager: true, query: "?url", import: "default" },
  ),
  ...import.meta.glob(
  "../../nodes/video-preview/Assets/story-assets/actors/*/*/*.png",
  { eager: true, query: "?url", import: "default" },
  ),
} as Record<string, string>;

const ACTOR_BY_KEY: Record<string, string> = {};
for (const [path, url] of Object.entries(actorUrls)) {
  const directMatch = path.match(/actors\/([^/]+)\/([^/]+)\.png$/);
  const legacyMatch = path.match(/actors\/([^/]+)\/[^/]+\/([^/]+)\.png$/);
  const match = directMatch || legacyMatch;
  // Skip atlas spritesheets, only keep individual state PNGs
  if (match && match[2] !== "atlas") {
    const key = `${match[1]}/${match[2]}`;
    // Direct prepared data wins; otherwise keep the first legacy variant.
    if (directMatch) ACTOR_BY_KEY[key] = url;
    if (!ACTOR_BY_KEY[key]) ACTOR_BY_KEY[key] = url;
  }
}

// The bundled art covers neutral/worried/overwhelmed/frustrated/confident; map
// the remaining character state onto the closest available frame.
const STATE_ALIAS: Partial<Record<StoryActorStateKey, StoryActorStateKey>> = {
  determined: "confident",
};

function resolveActorAsset(
  preset: StoryActorKey,
  state: StoryActorStateKey,
): string | undefined {
  const resolved = STATE_ALIAS[state] ?? state;
  const candidates = [`${preset}/${resolved}`, `${preset}/neutral`];
  for (const key of candidates) {
    if (ACTOR_BY_KEY[key]) return ACTOR_BY_KEY[key];
  }
  return undefined;
}

const DARK_DECO_RIMS = ["#67e8f9", "#a5b4fc", "#fcd34d", "#5eead4"] as const;

function silhouetteFor(preset: StoryActorKey): string {
  const seed = [...preset].reduce(
    (hash, character) => (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0,
    2166136261,
  );
  const rim = DARK_DECO_RIMS[seed % DARK_DECO_RIMS.length];
  const shoulderWidth = 70 + (seed % 13);
  const headTilt = ((seed >>> 4) % 7) - 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320">
<defs>
  <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#05070d"/><stop offset="0.55" stop-color="#0b1020"/><stop offset="1" stop-color="#1b2234"/>
  </linearGradient>
  <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${rim}" stop-opacity="0.95"/><stop offset="0.5" stop-color="#f8fafc" stop-opacity="0.35"/><stop offset="1" stop-color="${rim}" stop-opacity="0.12"/>
  </linearGradient>
  <filter id="edge" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="2.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<g transform="rotate(${headTilt} 120 86)">
  <path d="M83 88 C83 48 98 27 121 27 C146 27 158 50 156 91 C154 121 142 139 120 141 C98 139 85 119 83 88 Z" fill="url(#body)" stroke="url(#rim)" stroke-width="3" filter="url(#edge)"/>
  <path d="M91 55 C103 31 139 28 154 58 C142 50 131 47 118 48 C106 49 99 53 91 55 Z" fill="#02040a" stroke="${rim}" stroke-opacity="0.45" stroke-width="2"/>
</g>
<path d="M${120 - shoulderWidth} 320 C${120 - shoulderWidth + 5} 226 77 177 103 164 L137 164 C164 177 ${120 + shoulderWidth - 5} 226 ${120 + shoulderWidth} 320 Z" fill="url(#body)" stroke="url(#rim)" stroke-width="3" filter="url(#edge)"/>
<path d="M69 222 L111 185 L120 320 L79 320 Z" fill="#070b15" stroke="${rim}" stroke-opacity="0.38" stroke-width="2"/>
<path d="M171 222 L139 185 L130 320 L168 320 Z" fill="#11182a" stroke="#f8fafc" stroke-opacity="0.18" stroke-width="1.5"/>
<path d="M151 210 L189 229 L178 280 L143 257 Z" fill="#050913" stroke="${rim}" stroke-opacity="0.7" stroke-width="2"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function getStoryActorAsset(
  preset: StoryActorKey,
  state: StoryActorStateKey,
): string {
  return resolveActorAsset(preset, state) ?? silhouetteFor(preset);
}
