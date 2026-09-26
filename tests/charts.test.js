import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLine } from '../public/views/charts.js';

test('gridLine: 0 기준선만 진한 2px, 나머지 격자선은 옅은 1px', () => {
  assert.deepEqual(gridLine(0), { color: '#16191f', width: 2 });
  assert.deepEqual(gridLine(500), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
  assert.deepEqual(gridLine(-250), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
  assert.deepEqual(gridLine(undefined), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
});
