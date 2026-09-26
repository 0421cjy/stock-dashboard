import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, pastelColors, changeTextColor } from '../public/treemap.js';

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

const hueOf = (color) => Number(/^hsl\((\d{1,3}), 50%, 88%\)$/.exec(color)?.[1]);
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('pastelColors: 순서·비중과 상관없이 같은 종목 구성이면 같은 색', () => {
  const a = pastelColors(['NVDA', 'AAPL', 'MSFT']);
  const b = pastelColors(['MSFT', 'NVDA', 'AAPL']);
  for (const s of ['AAPL', 'MSFT', 'NVDA']) assert.equal(a.get(s), b.get(s));
});

test('pastelColors: 모두 파스텔 형식이고, 색상이 한쪽으로 몰리지 않는다', () => {
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'VOO', 'SOFI', 'BRK.B', 'QQQ', 'TSLA'];
  const colors = pastelColors(symbols);
  const hues = symbols.map((s) => hueOf(colors.get(s)));
  for (const [i, h] of hues.entries()) assert.ok(h >= 0 && h < 360, `${symbols[i]}: ${colors.get(symbols[i])}`);
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      assert.ok(hueGap(hues[i], hues[j]) >= 44, `${symbols[i]}와 ${symbols[j]}의 색상이 너무 가깝다`);
    }
  }
  assert.equal(pastelColors(['ONLY']).size, 1);
  assert.equal(pastelColors([]).size, 0);
});

test('changeTextColor: 한국식 글자색, ±3% 이상이 가장 진하고 0·시세 없음은 회색', () => {
  assert.equal(changeTextColor(0), 'rgb(108, 117, 125)');
  assert.equal(changeTextColor(null), 'rgb(108, 117, 125)');
  assert.equal(changeTextColor(0.05), 'rgb(176, 18, 32)');
  assert.equal(changeTextColor(-0.03), 'rgb(21, 72, 170)');
  assert.equal(changeTextColor(0.015), 'rgb(142, 68, 79)');
});
