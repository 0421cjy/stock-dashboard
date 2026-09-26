import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, heatColor } from '../public/treemap.js';

const EPS = 1e-9;
const area = (r) => r.w * r.h;

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > EPS && h > EPS ? w * h : 0;
}

// 논문(Bruls 외)의 예시: 6×4 영역에 값 6,6,4,3,2,2,1 → 값이 곧 넓이
const CLASSIC = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ id: `S${i}`, value }));

test('칸 넓이는 값(평가금액)에 비례한다', () => {
  const rects = squarify(CLASSIC, 6, 4);
  assert.equal(rects.length, 7);
  for (const item of CLASSIC) {
    const r = rects.find((x) => x.id === item.id);
    assert.ok(Math.abs(area(r) - item.value) < 1e-6, `${item.id}: ${area(r)} ≠ ${item.value}`);
  }
});

test('칸들이 영역을 빈틈 없이 채우고, 영역 밖으로 나가지 않으며, 서로 겹치지 않는다', () => {
  const W = 640;
  const H = 260;
  const rects = squarify([500, 300, 120, 80, 40, 30, 20, 10].map((value, i) => ({ id: `T${i}`, value })), W, H);
  const total = rects.reduce((s, r) => s + area(r), 0);
  assert.ok(Math.abs(total - W * H) < 1e-6);
  for (const r of rects) {
    assert.ok(r.x >= -EPS && r.y >= -EPS && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6, `${r.id} 영역 밖`);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.equal(overlap(rects[i], rects[j]), 0, `${rects[i].id}와 ${rects[j].id}가 겹친다`);
    }
  }
});

test('종목이 1개면 영역 전체, 0개거나 값이 0 이하면 빼고 계산한다', () => {
  assert.deepEqual(squarify([{ id: 'A', value: 10 }], 300, 200), [{ id: 'A', x: 0, y: 0, w: 300, h: 200 }]);
  assert.deepEqual(squarify([], 300, 200), []);
  assert.deepEqual(squarify([{ id: 'A', value: 1 }], 0, 200), []);
  const rects = squarify([{ id: 'A', value: 3 }, { id: 'Z', value: 0 }, { id: 'N', value: -1 }], 300, 200);
  assert.deepEqual(rects.map((r) => r.id), ['A']);
});

test('heatColor: 한국식 색, ±3% 이상이 가장 진하고 0·시세 없음은 회색', () => {
  assert.equal(heatColor(0), 'rgb(108, 117, 125)');
  assert.equal(heatColor(null), 'rgb(108, 117, 125)');
  assert.equal(heatColor(0.05), 'rgb(214, 41, 58)');
  assert.equal(heatColor(-0.03), 'rgb(31, 95, 209)');
  assert.equal(heatColor(0.015), 'rgb(161, 79, 92)');
});
