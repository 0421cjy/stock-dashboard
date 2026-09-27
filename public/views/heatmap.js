import { h } from './dom.js';
import { squarify, tileLabel } from '../treemap.js';
import { formatPct } from '../format.js';

// 평가금액 비중 트리맵. 칸 넓이 = 비중, 배경 = 종목별 단색(뉴스 태그와 같은 색), 글자 = 티커와 비중(%).
export function createHeatmap(container) {
  let rows = [];
  let colors = new Map();

  function draw() {
    const { width, height } = container.getBoundingClientRect();
    const priced = rows.filter((r) => r.hasPrice && r.marketValue > 0);
    if (!priced.length) {
      container.replaceChildren(h('p', 'heat-empty', '시세가 있는 종목이 없습니다.'));
      return;
    }
    const bySymbol = new Map(priced.map((r) => [r.symbol, r]));
    const rects = squarify(priced.map((r) => ({ id: r.symbol, value: r.marketValue })), width, height);
    container.replaceChildren(...rects.map((rect) => tile(bySymbol.get(rect.id), rect, colors.get(rect.id))));
  }

  new ResizeObserver(() => draw()).observe(container);

  return {
    // colorMap: 전체 보유 종목 기준 Map(symbol → 색). 뉴스 태그와 같은 지도를 쓴다.
    update(next, colorMap) {
      rows = next;
      colors = colorMap;
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
  el.title = `${r.symbol} · ${formatPct(r.weight)}`;

  const label = tileLabel(rect, r.symbol);
  if (label.showSymbol) {
    const sym = h('strong', 'heat-sym', r.symbol);
    sym.style.fontSize = `${label.symbolPx}px`;
    el.append(sym);
  }
  if (label.showWeight) {
    const weight = h('span', 'heat-weight', formatPct(r.weight));
    weight.style.fontSize = `${label.weightPx}px`;
    el.append(weight);
  }
  return el;
}
