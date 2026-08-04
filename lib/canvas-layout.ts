// Shared column-grid geometry for the FlowCanvas and the server execution
// engine. Both sides must agree on these numbers so that a node's visual
// column (its x coordinate) maps 1:1 to its execution column.

/** Left padding before the first column (px). */
export const LEFT_MARGIN = 60;
/** Top padding before the first row (px). */
export const TOP_MARGIN = 48;
/** Rendered width of a single node card (px). */
export const NODE_WIDTH = 153;
/** Rendered height of a single node card (px). */
export const NODE_HEIGHT = 50;
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
