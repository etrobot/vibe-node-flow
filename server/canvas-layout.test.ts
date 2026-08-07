import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUniqueLaneLabels,
  effectiveLaneLabel,
  findLaneLabelConflict,
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
