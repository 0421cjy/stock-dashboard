import { h } from './dom.js';
import { squarify, pastelColors, changeTextColor } from '../treemap.js';
import { formatPct } from '../format.js';

// 평가금액 비중 트리맵. 칸 넓이 = 비중, 배경 = 종목별 파스텔, 등락률 = 글자색.
export function createHeatmap(container) {
  let rows = [];

  function draw() {
    const { width, height } = container.getBoundingClientRect();
    const priced = rows.filter((r) => r.hasPrice && r.marketValue > 0);
    if (!priced.length) {
      container.replaceChildren(h('p', 'heat-empty', '시세가 있는 종목이 없습니다.'));
      return;
    }
    const bySymbol = new Map(priced.map((r) => [r.symbol, r]));
    const colors = pastelColors(priced.map((r) => r.symbol));
    const rects = squarify(priced.map((r) => ({ id: r.symbol, value: r.marketValue })), width, height);
    container.replaceChildren(...rects.map((rect) => tile(bySymbol.get(rect.id), rect, colors.get(rect.id))));
  }

  new ResizeObserver(() => draw()).observe(container);

  return {
    update(next) {
      rows = next;
      draw();
    },
  };
}

function tile(r, rect, background) {
  const el = h('div', 'heat-tile');
  Object.assign(el.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    background,
  });
  el.title = `${r.symbol} · 비중 ${formatPct(r.weight)} · 오늘 ${formatPct(r.dayChangePct, { sign: true })}`;

  // 칸 크기에 따라: 아주 작음 = 색만, 작음 = 티커, 중간 = 티커 + 등락률, 큼 = 티커 + 비중 · 등락률
  if (rect.w < 28 || rect.h < 18) return el;
  const sym = h('strong', 'heat-sym', r.symbol);
  sym.style.fontSize = `${Math.max(11, Math.min(24, Math.min(rect.w, rect.h) / 3.5))}px`;
  el.append(sym);
  if (rect.w < 44 || rect.h < 34) return el;

  const change = h('span', 'heat-change', formatPct(r.dayChangePct, { sign: true }));
  change.style.color = changeTextColor(r.dayChangePct);
  const sub = h('span', 'heat-sub');
  if (rect.w >= 70 && rect.h >= 44) sub.append(h('span', 'heat-weight', formatPct(r.weight)), ' · ');
  sub.append(change);
  el.append(sub);
  return el;
}
