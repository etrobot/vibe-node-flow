import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUniqueLaneLabels,
  COL_SPACING,
  columnDividerX,
  effectiveLaneLabel,
  findLaneLabelConflict,
  GRID_SIZE,
  LEFT_BOUNDARY,
} from '../lib/canvas-layout.ts';

test('effectiveLaneLabel falls back to the default Lane N label', () => {
  assert.equal(effectiveLaneLabel(['Research'], 0), 'Research');
  assert.equal(effectiveLaneLabel(['Research'], 1), 'Lane 2');
});

test('findLaneLabelConflict detects duplicate lane names case-insensitively', () => {
  assert.equal(
    findLaneLabelConflict(['Research', 'Generation'], 1, 'research', 2),
    0,
  );
  assert.equal(findLaneLabelConflict(['Research', 'Generation'], 1, 'Output', 2), null);
});

test('assertUniqueLaneLabels rejects duplicate labels on save', () => {
  assert.throws(
    () => assertUniqueLaneLabels(['Research', 'research']),
    /Lane labels must be unique/,
  );
});

test('visual grid size divides lane spacing so every divider lands on a column of dots', () => {
  assert.equal(COL_SPACING % GRID_SIZE, 0, `COL_SPACING=${COL_SPACING} must be a multiple of GRID_SIZE=${GRID_SIZE}`);
  assert.equal(columnDividerX(0) - LEFT_BOUNDARY, COL_SPACING);
  for (let i = 0; i < 8; i++) {
    const dividerX = i === 0 ? LEFT_BOUNDARY : columnDividerX(i - 1);
    assert.equal(
      (dividerX - LEFT_BOUNDARY) % GRID_SIZE,
      0,
      `lane line at x=${dividerX} is not on the ${GRID_SIZE}px dot grid (origin ${LEFT_BOUNDARY})`,
    );
  }
});
