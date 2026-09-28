import { test } from 'node:test';
import assert from 'node:assert/strict';
import { squarify, flatColors, tileLabel, groupOthers, labelFits, OTHERS_ID } from '../public/treemap.js';

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

test('flatColors: 알파벳 순으로 차분한 청록·파랑·머스터드·코랄부터 배정하고, 순서와 상관없이 같다', () => {
  const colors = flatColors(['D', 'C', 'B', 'A']);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((s) => colors.get(s)), ['#4FA3B3', '#4A7BA7', '#C99A3E', '#CC7A70']);
  assert.equal(flatColors(['A', 'B', 'C', 'D']).get('C'), colors.get('C'));
});

test('flatColors: 10종목까지는 색이 겹치지 않고, 11번째부터 반복한다', () => {
  const symbols = Array.from({ length: 11 }, (_, i) => `S${String(i).padStart(2, '0')}`);
  const colors = flatColors(symbols);
  assert.equal(new Set(symbols.slice(0, 10).map((s) => colors.get(s))).size, 10);
  assert.equal(colors.get('S10'), colors.get('S00'));
  assert.equal(flatColors([]).size, 0);
});

test('tileLabel: 아주 작은 칸은 글자 없음, 작은 칸은 티커만, 큰 칸은 티커와 비중', () => {
  assert.deepEqual(tileLabel({ w: 20, h: 100 }, 'AAPL'), { showSymbol: false, showWeight: false });
  assert.deepEqual(tileLabel({ w: 80, h: 23 }, 'TSLA'), { showSymbol: true, showWeight: false, symbolPx: 12 });
  assert.deepEqual(tileLabel({ w: 300, h: 260 }, 'SOFI'), { showSymbol: true, showWeight: true, symbolPx: 36, weightPx: 24 });
});

test('tileLabel: 글자 크기는 칸에 맞춰 커지고, 긴 티커는 칸 폭에 맞춰 줄인다', () => {
  assert.deepEqual(tileLabel({ w: 95, h: 176 }, 'AAPL'), { showSymbol: true, showWeight: true, symbolPx: 20, weightPx: 16 });
  assert.equal(tileLabel({ w: 80, h: 62 }, 'BRK.B').symbolPx, 13);
});

test('tileLabel: 넓은 글자(M·W·Q)가 많은 티커도 칸 폭(좌우 여백 24px + 흰 테두리 4px 제외)을 넘지 않는다', () => {
  // 굵은 대문자 한 글자는 글자 크기의 최대 약 0.8배 폭(브라우저에서 잰 값: QQQ 0.796, NVDA 0.745)
  for (const [w, h, symbol] of [[115, 176, 'MSFT'], [95, 176, 'AAPL'], [129, 84, 'QQQ'], [90, 200, 'NVDA']]) {
    const { symbolPx } = tileLabel({ w, h }, symbol);
    assert.ok(symbolPx * 0.8 * symbol.length <= w - 28, `${symbol} ${symbolPx}px가 ${w}px 칸을 넘친다`);
  }
});

const byValueDesc = (items) => [...items].sort((a, b) => b.value - a.value);

test('groupOthers: 모든 칸에 티커와 비중이 다 들어가면 Others를 만들지 않는다', () => {
  const items = [{ id: 'AAA', value: 50 }, { id: 'BBB', value: 30 }, { id: 'CCC', value: 20 }];
  const { rects, others } = groupOthers(items, 600, 260);
  assert.deepEqual(others, []);
  assert.deepEqual(rects.map((r) => r.id).sort(), ['AAA', 'BBB', 'CCC']);
});

test('groupOthers: 글자가 다 안 들어가는 칸은 가장 작은 종목부터 Others로 묶는다', () => {
  const items = [500, 300, 120, 20, 10, 5].map((value, i) => ({ id: `S${i}`, value }));
  const W = 500;
  const H = 260;
  const { rects, others } = groupOthers(items, W, H);
  assert.ok(others.length > 0, '작은 종목이 묶여야 한다');
  // 묶인 것은 값이 가장 작은 종목들(정렬했을 때 끝부분)이다
  const smallest = byValueDesc(items).slice(-others.length).map((i) => i.id).sort();
  assert.deepEqual(others.map((o) => o.id).sort(), smallest);
  // Others를 뺀 나머지 칸은 모두 티커와 비중이 온전히 나온다
  for (const r of rects.filter((x) => x.id !== OTHERS_ID)) assert.ok(labelFits(r, r.id), `${r.id} 칸에 글자가 다 안 들어간다`);
  // Others 칸 넓이 = 묶인 종목 값의 합에 비례, 전체 넓이는 그대로
  const total = items.reduce((s, i) => s + i.value, 0);
  const othersRect = rects.find((r) => r.id === OTHERS_ID);
  const othersValue = others.reduce((s, o) => s + o.value, 0);
  assert.ok(Math.abs(othersRect.w * othersRect.h - (othersValue / total) * W * H) < 1e-6);
  assert.ok(Math.abs(rects.reduce((s, r) => s + r.w * r.h, 0) - W * H) < 1e-6);
});

test('groupOthers: 영역이 너무 작으면 전부 Others 한 칸이 된다', () => {
  const { rects, others } = groupOthers([{ id: 'AAA', value: 2 }, { id: 'BBB', value: 1 }], 40, 40);
  assert.deepEqual(rects.map((r) => r.id), [OTHERS_ID]);
  assert.equal(others.length, 2);
});

test('labelFits: 티커와 비중이 둘 다 나오고, 티커가 최소 글자 크기로 칸 폭에 들어가야 한다', () => {
  assert.equal(labelFits({ w: 120, h: 80 }, 'AAPL'), true);
  assert.equal(labelFits({ w: 80, h: 23 }, 'TSLA'), false); // 티커만 보이는 칸
  assert.equal(labelFits({ w: 60, h: 60 }, 'GOOGL'), false); // 비중은 보여도 티커가 칸을 넘친다
});

const atBottomRight = (r, W, H) => Math.abs(r.x + r.w - W) < 1e-6 && Math.abs(r.y + r.h - H) < 1e-6;

test('squarify: last로 지정한 칸은 크기와 상관없이 오른쪽 아래 모서리에 놓인다', () => {
  const rects = squarify([{ id: 'A', value: 10 }, { id: 'B', value: 1 }, { id: 'P', value: 5, last: true }], 300, 200);
  const p = rects.find((r) => r.id === 'P');
  assert.ok(atBottomRight(p, 300, 200), `P: x=${p.x} y=${p.y} w=${p.w} h=${p.h}`);
  assert.equal(rects[rects.length - 1].id, 'P');
});

test('groupOthers: Others가 남은 종목보다 커도 오른쪽 아래 모서리에 놓인다', () => {
  const W = 500;
  const H = 260;
  const tiny = Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, value: 8 }));
  const items = [{ id: 'A', value: 500 }, { id: 'B', value: 300 }, { id: 'C', value: 150 }, { id: 'D', value: 60 }, ...tiny];
  const { rects, others } = groupOthers(items, W, H);
  const othersValue = others.reduce((s, o) => s + o.value, 0);
  const kept = items.filter((i) => !others.some((o) => o.id === i.id));
  assert.ok(kept.some((i) => i.value < othersValue), '이 경우 Others가 남은 종목 중 일부보다 커야 의미 있는 검사다');
  const o = rects.find((r) => r.id === OTHERS_ID);
  assert.ok(atBottomRight(o, W, H), `Others: x=${o.x} y=${o.y} w=${o.w} h=${o.h}`);
});
