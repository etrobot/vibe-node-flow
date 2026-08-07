// Shared column-grid geometry for the FlowCanvas and the server execution
// engine. Both sides must agree on these numbers so that a node's visual
// column (its x coordinate) maps 1:1 to its execution column.

/** Left padding before the first column (px). */
export const LEFT_MARGIN = 60;
/** Top padding before the first row (px). */
export const TOP_MARGIN = 48;
/** Rendered width of a single node card (px). */
export const NODE_WIDTH = 165;
/** Rendered height of a single node card icon/interactive block (px). */
export const NODE_HEIGHT = 80;
/** Horizontal gap between two adjacent columns (px). */
export const COL_GAP = 80;
/** Full stride of one column = node width + gap (px). */
export const COL_SPACING = NODE_WIDTH + COL_GAP; // 260
/** Vertical snapping grid for the y coordinate (px). */
export const GRID_Y_SIZE = 20;

/** Minimum number of column guides to always render on the canvas. */
export const MIN_COLUMNS = 4;

/**
 * Vertical clearance reserved above TOP_MARGIN for the lane header label and
 * its double-click hit box. Nodes are allowed to drag up into this band, but
 * not above its top edge.
 */
export const LANE_HEADER_HEIGHT = 48;

/**
 * Compute the exact x coordinate of the vertical divider line after column `colIndex`.
 * Dividers sit in the middle of the gap between adjacent column lanes.
 */
export function columnDividerX(colIndex: number): number {
  return columnX(colIndex) + NODE_WIDTH + COL_GAP / 2;
}

/**
 * The left boundary of column lane 0 (px).
 */
export const LEFT_BOUNDARY = LEFT_MARGIN - COL_GAP / 2;

/**
 * Compute the column index a node at the given x belongs to. Rounds to the
 * nearest column and clamps to >= 0 so nodes dragged off the left edge still
 * land on column 0.
 */
export function columnIndexOf(x: number): number {
  return Math.max(0, Math.round((x - LEFT_MARGIN) / COL_SPACING));
}

/** The exact x coordinate where the left edge of a column begins. */
export function columnX(colIndex: number): number {
  return LEFT_MARGIN + colIndex * COL_SPACING;
}

/** Snap a raw y coordinate onto the vertical grid. */
export function snapY(y: number): number {
  return Math.max(TOP_MARGIN - LANE_HEADER_HEIGHT, Math.round(y / GRID_Y_SIZE) * GRID_Y_SIZE);
}

/** Resolve the display label for a canvas column, including the default fallback. */
export function effectiveLaneLabel(laneLabels: string[] | undefined, colIndex: number): string {
  return laneLabels?.[colIndex]?.trim() || `Lane ${colIndex + 1}`;
}

/**
 * Return the column index of another lane that already uses the same label
 * (case-insensitive). Returns null when the name is available.
 */
export function findLaneLabelConflict(
  laneLabels: string[] | undefined,
  colIndex: number,
  nextLabel: string,
  columnCount: number,
): number | null {
  const nextKey = nextLabel.trim().toLocaleLowerCase();
  if (!nextKey) return null;
  for (let i = 0; i < columnCount; i++) {
    if (i === colIndex) continue;
    if (effectiveLaneLabel(laneLabels, i).toLocaleLowerCase() === nextKey) return i;
  }
  return null;
}

/** Reject duplicate lane labels before persisting a workflow layout. */
export function assertUniqueLaneLabels(laneLabels: string[] | undefined): void {
  const labels = laneLabels ?? [];
  const seen = new Map<string, number>();
  for (let i = 0; i < labels.length; i++) {
    const label = effectiveLaneLabel(labels, i);
    const key = label.toLocaleLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new Error(
        `Lane labels must be unique: "${label}" is used by column ${previous + 1} and column ${i + 1}.`,
      );
    }
    seen.set(key, i);
  }
}
