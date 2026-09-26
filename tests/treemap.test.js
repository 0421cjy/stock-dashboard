import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, flatColors, changeMark } from '../public/treemap.js';

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

test('flatColors: 알파벳 순으로 이미지의 청록·파랑·노랑·코랄부터 배정하고, 순서와 상관없이 같다', () => {
  const colors = flatColors(['D', 'C', 'B', 'A']);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((s) => colors.get(s)), ['#14C1D6', '#0A77C2', '#FFC220', '#F76C62']);
  assert.equal(flatColors(['A', 'B', 'C', 'D']).get('C'), colors.get('C'));
});

test('flatColors: 10종목까지는 색이 겹치지 않고, 11번째부터 반복한다', () => {
  const symbols = Array.from({ length: 11 }, (_, i) => `S${String(i).padStart(2, '0')}`);
  const colors = flatColors(symbols);
  assert.equal(new Set(symbols.slice(0, 10).map((s) => colors.get(s))).size, 10);
  assert.equal(colors.get('S10'), colors.get('S00'));
  assert.equal(flatColors([]).size, 0);
});

test('changeMark: ▲/▼ 방향과 굵기 단계(1% 미만 400, 1~3% 600, 3% 이상 800)', () => {
  assert.deepEqual(changeMark(0.037), { text: '▲ 3.7%', weight: 800 });
  assert.deepEqual(changeMark(0.03), { text: '▲ 3.0%', weight: 800 });
  assert.deepEqual(changeMark(-0.013), { text: '▼ 1.3%', weight: 600 });
  assert.deepEqual(changeMark(0.01), { text: '▲ 1.0%', weight: 600 });
  assert.deepEqual(changeMark(0.002), { text: '▲ 0.2%', weight: 400 });
  assert.deepEqual(changeMark(0), { text: '— 0.0%', weight: 400 });
  assert.deepEqual(changeMark(null), { text: '—', weight: 400 });
});
