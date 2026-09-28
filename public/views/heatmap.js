import { h } from './dom.js';
import { groupOthers, tileLabel, OTHERS_ID } from '../treemap.js';
import { formatPct } from '../format.js';

const OTHERS_COLOR = '#8a93a3'; // 종목 팔레트와 겹치지 않는 차분한 회색

// 평가금액 비중 트리맵. 칸 넓이 = 비중, 배경 = 종목별 단색(뉴스 태그와 같은 색), 글자 = 티커와 비중(%).
// 티커와 비중이 온전히 들어가지 않는 작은 종목들은 Others 한 칸으로 묶는다.
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
    const { rects, others } = groupOthers(priced.map((r) => ({ id: r.symbol, value: r.marketValue })), width, height);
    container.replaceChildren(...rects.map((rect) => (rect.id === OTHERS_ID
      ? othersTile(rect, others.map((o) => bySymbol.get(o.id)))
      : tile(rect, bySymbol.get(rect.id).symbol, bySymbol.get(rect.id).weight, colors.get(rect.id)))));
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

function othersTile(rect, members) {
  const weight = members.reduce((s, r) => s + r.weight, 0);
  const el = tile(rect, 'Others', weight, OTHERS_COLOR);
  el.classList.add('heat-others');
  const byWeight = [...members].sort((a, b) => b.weight - a.weight);
  el.title = `Others ${formatPct(weight)} · ${byWeight.map((r) => `${r.symbol} ${formatPct(r.weight)}`).join(', ')}`;
  return el;
}

function tile(rect, name, weight, background) {
  const el = h('div', 'heat-tile');
  Object.assign(el.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.w}px`,
    height: `${rect.h}px`,
    background,
  });
  el.title = `${name} · ${formatPct(weight)}`;

  const label = tileLabel(rect, name);
  if (label.showSymbol) {
    const sym = h('strong', 'heat-sym', name);
    sym.style.fontSize = `${label.symbolPx}px`;
    el.append(sym);
  }
  if (label.showWeight) {
    const w = h('span', 'heat-weight', formatPct(weight));
    w.style.fontSize = `${label.weightPx}px`;
    el.append(w);
  }
  return el;
}
