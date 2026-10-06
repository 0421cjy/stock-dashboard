import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withLivePoint, periodChange, splitEstimated, axisLabel } from '../public/history.js';

const pts = [
  { t: 1, date: 'd1', value: 100, krw: 130_000, estimated: true },
  { t: 2, date: 'd2', value: 110, krw: 145_000, estimated: true },
  { t: 3, date: 'd3', value: 120, krw: 160_000, estimated: false },
  { t: 4, date: 'd4', value: 90, krw: 120_000, estimated: false },
];

test('withLivePoint: 마지막 점보다 늦은 지금 값만 붙인다', () => {
  assert.equal(withLivePoint(pts, { t: 4, value: 1, krw: 1 }), pts);
  assert.equal(withLivePoint(pts, null), pts);
  const out = withLivePoint(pts, { t: 5, value: 95, krw: 126_000 });
  assert.deepEqual(out.at(-1), { t: 5, value: 95, krw: 126_000, date: 'd4', estimated: false });
});

test('periodChange: 기간 첫 점 또는 1일 기준값 대비', () => {
  const v = periodChange(pts, null, 'value');
  assert.equal(v.last, 90);
  assert.equal(v.change, -10);
  assert.ok(Math.abs(v.ratio + 0.1) < 1e-12);
  const c = periodChange(pts, { value: 80, krw: 100_000 }, 'krw');
  assert.equal(c.change, 20_000);
  assert.ok(Math.abs(c.ratio - 0.2) < 1e-12);
  assert.equal(periodChange([], null, 'value'), null);
});

test('splitEstimated: 추정·기록 두 줄로 나누고 경계 점을 이어 붙인다', () => {
  assert.deepEqual(splitEstimated(pts, 'value'), {
    estimated: [100, 110, 120, null],
    recorded: [null, null, 120, 90],
    hasEstimated: true,
  });
  const allRecorded = pts.map((p) => ({ ...p, estimated: false }));
  assert.equal(splitEstimated(allRecorded, 'value').hasEstimated, false);
});

test('axisLabel: 기간별 x축 글자', () => {
  const t = new Date(2026, 9, 6, 9, 5).getTime(); // 로컬 2026-10-06 09:05
  assert.equal(axisLabel(t, '1d'), '09:05');
  assert.equal(axisLabel(t, '1w'), '10/6 09:05');
  assert.equal(axisLabel(t, '1m'), '10/6');
  assert.equal(axisLabel(t, '1y'), '26.10');
});

test('withLiveToday: 마지막 점이 오늘이면 지금 값으로 바꾼다', async () => {
  const { withLiveToday } = await import('../public/history.js');
  const out = withLiveToday(pts, { t: 9, value: 95, krw: 126_000 }, 'd4');
  assert.deepEqual(out.at(-1), { t: 4, date: 'd4', value: 95, krw: 126_000, estimated: false });
  assert.equal(withLiveToday(pts, { value: 95 }, 'd5'), pts);
});
