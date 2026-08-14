/**
 * Anchor timing: turning `**anchors**` in the narration into real seconds.
 *
 * The storyboard no longer guesses how long a shot lasts. It marks where the
 * picture should change — `"Ideas are everywhere. **Building** was the
 * bottleneck."`. Providers with word timings can place that cut exactly.
 * Fish Audio's speech endpoint returns audio only, so its fallback maps the
 * anchor's position in the spoken text onto the measured MP3 duration.
 *
 * The mapping is positional, not textual: word boundaries arrive in order, so
 * walking them with a cursor through the spoken string gives each one a
 * character offset, and an anchor's offset picks the first word at or past it.
 * Matching on the anchor's own text would fail on the common case where the
 * same word appears twice in a sentence.
 */

const ANCHOR_PATTERN = /\*\*([^*]+)\*\*/g;

export interface WordBoundary {
  offsetSeconds: number;
  durationSeconds: number;
  text: string;
}

export interface SpeechAnchor {
  text: string;
  /** Where this anchor begins in the spoken string. */
  charIndex: number;
}

export interface ItemTiming {
  index: number;
  startSeconds: number;
  durationSeconds: number;
}

export interface ClipTimingResult {
  items: ItemTiming[];
  /** False when the split was derived rather than measured from anchors. */
  measured: boolean;
  warnings: string[];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * Split the authored speech into what the voice reads and where the anchors
 * land in it. Whitespace is collapsed exactly as the TTS request does, so
 * offsets here describe the same string the provider receives.
 */
export function stripAnchors(speech: string): { plain: string; anchors: SpeechAnchor[] } {
  const raw = String(speech ?? '');
  const marks: Array<{ text: string; rawIndex: number }> = [];
  let unmarked = '';
  let cursor = 0;

  for (const match of raw.matchAll(ANCHOR_PATTERN)) {
    const start = match.index ?? 0;
    unmarked += raw.slice(cursor, start);
    marks.push({ text: match[1], rawIndex: unmarked.length });
    unmarked += match[1];
    cursor = start + match[0].length;
  }
  unmarked += raw.slice(cursor);

  // Collapse whitespace while keeping a map from unmarked index to spoken index.
  const map = new Array<number>(unmarked.length + 1);
  let plain = '';
  let pendingSpace = false;
  for (let index = 0; index < unmarked.length; index += 1) {
    const character = unmarked[index];
    if (/\s/.test(character)) {
      map[index] = plain.length;
      pendingSpace = plain.length > 0;
      continue;
    }
    if (pendingSpace) {
      plain += ' ';
      pendingSpace = false;
    }
    map[index] = plain.length;
    plain += character;
  }
  map[unmarked.length] = plain.length;

  return {
    plain,
    anchors: marks.map((mark) => ({
      text: mark.text.trim(),
      charIndex: map[mark.rawIndex] ?? plain.length,
    })),
  };
}

/**
 * Character offset of every word boundary inside the spoken string. The cursor
 * only moves forward, so a repeated word resolves to the occurrence the voice
 * was actually on.
 */
export function boundaryOffsets(plain: string, boundaries: WordBoundary[]): number[] {
  const lower = plain.toLowerCase();
  const offsets: number[] = [];
  let cursor = 0;

  for (const boundary of boundaries) {
    const word = String(boundary?.text ?? '');
    if (!word) {
      offsets.push(cursor);
      continue;
    }
    let index = plain.indexOf(word, cursor);
    if (index === -1) index = lower.indexOf(word.toLowerCase(), cursor);
    if (index === -1) {
      // Punctuation and normalization differences: hold position rather than
      // rewinding, so later boundaries keep their order.
      offsets.push(cursor);
      continue;
    }
    offsets.push(index);
    cursor = index + word.length;
  }
  return offsets;
}

function edgesToTimings(edges: number[], itemCount: number, audioSeconds: number): ItemTiming[] {
  return Array.from({ length: itemCount }, (_, index) => {
    const start = round(Math.max(0, edges[index]));
    const end = round(Math.max(start, index === itemCount - 1 ? audioSeconds : edges[index + 1]));
    return {
      index,
      startSeconds: start,
      // Derive durations from the rounded edges instead of rounding each raw
      // duration independently. Otherwise a 10-shot clip can lose a few
      // milliseconds per shot and finish before the MP3 does.
      durationSeconds: round(end - start),
    };
  });
}

function evenSplit(itemCount: number, audioSeconds: number): ItemTiming[] {
  const edges = Array.from({ length: itemCount + 1 }, (_, index) => (
    (audioSeconds * index) / itemCount
  ));
  return edgesToTimings(edges, itemCount, audioSeconds);
}

function toTimings(switches: number[], itemCount: number, audioSeconds: number): ItemTiming[] {
  return edgesToTimings([0, ...switches, audioSeconds], itemCount, audioSeconds);
}

export interface ResolveClipTimingOptions {
  speech: string;
  itemCount: number;
  boundaries: WordBoundary[];
  audioSeconds: number;
  minItemSeconds?: number;
  label?: string;
}

/**
 * Where each item of one clip starts and how long it holds, measured against
 * the narration that was actually synthesized.
 */
export function resolveClipTiming(options: ResolveClipTimingOptions): ClipTimingResult {
  const itemCount = Math.max(1, Math.floor(options.itemCount) || 1);
  const audioSeconds = Math.max(0, Number(options.audioSeconds) || 0);
  const minItemSeconds = Math.max(0.05, options.minItemSeconds ?? 0.35);
  const label = options.label || 'Clip';
  const warnings: string[] = [];

  if (itemCount === 1) {
    return {
      items: [{ index: 0, startSeconds: 0, durationSeconds: round(audioSeconds) }],
      measured: true,
      warnings,
    };
  }

  // Too short to give every item its floor; an even split is the only honest split.
  if (audioSeconds < minItemSeconds * itemCount) {
    return { items: evenSplit(itemCount, audioSeconds), measured: false, warnings };
  }

  const { plain, anchors } = stripAnchors(options.speech);
  const expected = itemCount - 1;
  if (anchors.length !== expected) {
    warnings.push(
      `${label} has ${itemCount} items but ${anchors.length} anchor(s) instead of ${expected}; `
      + 'shot timing was split evenly across the narration.',
    );
    return { items: evenSplit(itemCount, audioSeconds), measured: false, warnings };
  }

  const offsets = boundaryOffsets(plain, options.boundaries || []);
  const measured = offsets.length > 0;
  const switches = measured
    ? anchors.map((anchor) => {
      const position = offsets.findIndex((offset) => offset >= anchor.charIndex);
      if (position === -1) return audioSeconds;
      return Math.max(0, Number(options.boundaries[position]?.offsetSeconds) || 0);
    })
    : anchors.map((anchor) => (
      audioSeconds * Math.max(0, Math.min(1, anchor.charIndex / Math.max(1, plain.length)))
    ));

  // Keep the sequence strictly increasing, then make sure the tail still fits.
  for (let index = 0; index < switches.length; index += 1) {
    const floor = (index === 0 ? 0 : switches[index - 1]) + minItemSeconds;
    switches[index] = Math.max(switches[index], floor);
  }
  for (let index = switches.length - 1; index >= 0; index -= 1) {
    const ceiling = (index === switches.length - 1 ? audioSeconds : switches[index + 1]) - minItemSeconds;
    switches[index] = Math.min(switches[index], ceiling);
  }
  if (switches.some((value, index) => value < (index === 0 ? 0 : switches[index - 1]))) {
    warnings.push(`${label} anchors sit too close together to hold ${itemCount} shots; split evenly instead.`);
    return { items: evenSplit(itemCount, audioSeconds), measured: false, warnings };
  }

  return { items: toTimings(switches, itemCount, audioSeconds), measured, warnings };
}
