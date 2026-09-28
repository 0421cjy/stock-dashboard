import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLine } from '../public/views/charts.js';

test('gridLine: 0 기준선만 진한 2px, 나머지 격자선은 옅은 1px', () => {
  assert.deepEqual(gridLine(0), { color: '#16191f', width: 2 });
  assert.deepEqual(gridLine(500), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
  assert.deepEqual(gridLine(-250), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
  assert.deepEqual(gridLine(undefined), { color: 'rgba(0, 0, 0, 0.1)', width: 1 });
});

test('gridLine: 테마 색을 넘기면 그 색으로 그린다(다크 모드)', () => {
  const dark = { zero: '#e6e8ec', grid: 'rgba(255, 255, 255, 0.08)' };
  assert.deepEqual(gridLine(0, dark), { color: '#e6e8ec', width: 2 });
  assert.deepEqual(gridLine(100, dark), { color: 'rgba(255, 255, 255, 0.08)', width: 1 });
});
