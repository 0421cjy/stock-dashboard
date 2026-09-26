import { h } from './dom.js';
import { squarify, heatColor } from '../treemap.js';
import { formatPct } from '../format.js';

// 평가금액 비중 히트맵. 칸 넓이 = 비중, 색 = 오늘 등락률.
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
    const rects = squarify(priced.map((r) => ({ id: r.symbol, value: r.marketValue })), width, height);
    container.replaceChildren(...rects.map((rect) => tile(bySymbol.get(rect.id), rect)));
  }

  new ResizeObserver(() => draw()).observe(container);

  return {
    update(next) {
      rows = next;
      draw();
    },
  };
}

function tile(r, rect) {
  const el = h('div', 'heat-tile');
  Object.assign(el.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    background: heatColor(r.dayChangePct),
  });
  el.title = `${r.symbol} · 비중 ${formatPct(r.weight)} · 오늘 ${formatPct(r.dayChangePct, { sign: true })}`;

  const short = Math.min(rect.w, rect.h);
  if (rect.w < 28 || rect.h < 18) return el; // 너무 작은 칸은 색만, 정보는 마우스를 올리면 보인다
  const sym = h('strong', 'heat-sym', r.symbol);
  sym.style.fontSize = `${Math.max(11, Math.min(24, short / 3.5))}px`;
  el.append(sym);
  if (rect.w >= 70 && rect.h >= 44) {
    el.append(h('span', 'heat-sub', `${formatPct(r.weight)} · ${formatPct(r.dayChangePct, { sign: true })}`));
  }
  return el;
}
