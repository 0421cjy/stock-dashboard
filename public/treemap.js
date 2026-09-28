// 비중 히트맵의 배치(squarified treemap)와 색. DOM에 의존하지 않는 순수 함수.

// items: [{id, value}] → [{id, x, y, w, h}]. 칸 넓이는 value에 비례하고,
// 칸 모양이 되도록 정사각형에 가깝게 줄을 나눈다(Bruls 외, "Squarified Treemaps").
export function squarify(items, width, height) {
  const valid = items.filter((i) => Number.isFinite(i.value) && i.value > 0);
  const total = valid.reduce((s, i) => s + i.value, 0);
  if (!valid.length || !(width > 0) || !(height > 0)) return [];

  const scale = (width * height) / total;
  const nodes = valid
    .map((i) => ({ id: i.id, area: i.value * scale }))
    .sort((a, b) => b.area - a.area);

  const out = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  // 줄 안에서 가장 길쭉한 칸의 가로세로비. 작을수록 정사각형에 가깝다.
  function worst(row, side) {
    const s = row.reduce((acc, n) => acc + n.area, 0);
    const max = Math.max(...row.map((n) => n.area));
    const min = Math.min(...row.map((n) => n.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  }

  function place(row) {
    const s = row.reduce((acc, n) => acc + n.area, 0);
    if (w >= h) {
      // 남은 영역이 가로로 길면 왼쪽에 세로 줄을 놓는다
      const colW = s / h;
      let cy = y;
      for (const n of row) {
        const nh = n.area / colW;
        out.push({ id: n.id, x, y: cy, w: colW, h: nh });
        cy += nh;
      }
      x += colW;
      w -= colW;
    } else {
      // 세로로 길면 위쪽에 가로 줄을 놓는다
      const rowH = s / w;
      let cx = x;
      for (const n of row) {
        const nw = n.area / rowH;
        out.push({ id: n.id, x: cx, y, w: nw, h: rowH });
        cx += nw;
      }
      y += rowH;
      h -= rowH;
    }
  }

  let row = [];
  for (let i = 0; i < nodes.length;) {
    const side = Math.min(w, h);
    const candidate = [...row, nodes[i]];
    if (!row.length || worst(candidate, side) <= worst(row, side)) {
      row = candidate;
      i += 1;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

// 차분한 평면 단색 팔레트(채도를 낮추고 약간 어둡게 해서 흰 글자가 잘 읽히게).
// 순서: 청록·스틸 블루·머스터드·더스티 코랄·세이지 그린·라벤더 그레이·테라코타·로즈·딥 틸·슬레이트 블루
const PALETTE = [
  '#4FA3B3', '#4A7BA7', '#C99A3E', '#CC7A70', '#5FA37D',
  '#8574B8', '#C98A52', '#B96A8A', '#4E9A95', '#5A67A8',
];

// 종목별 배경색 → Map(symbol → hex). 티커 알파벳 순으로 팔레트를 차례로 배정해서
// 새로고침·비중 순위가 바뀌어도 같은 종목은 같은 색(종목 추가·삭제 때만 다시 배정).
export function flatColors(symbols) {
  const unique = [...new Set(symbols)].sort();
  return new Map(unique.map((s, i) => [s, PALETTE[i % PALETTE.length]]));
}

// 칸 글자 배치: 아주 작은 칸 = 글자 없음, 작은 칸 = 티커, 큰 칸 = 티커 + 비중.
// 글자는 칸이 클수록 커지고(티커 최대 36px, 비중 13~24px), 긴 티커는 칸 폭을 넘지 않게 줄인다.
const CHAR_WIDTH = 0.8; // 굵은 대문자 한 글자의 최대 폭(글자 크기 대비, 브라우저에서 잰 값: QQQ 0.796)
const PADDING_X = 28; // .heat-tile 좌우 padding 12px × 2 + 흰 테두리 2px × 2
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function tileLabel(rect, symbol) {
  if (rect.w < 28 || rect.h < 18) return { showSymbol: false, showWeight: false };
  const short = Math.min(rect.w, rect.h);
  const fitWidth = (rect.w - PADDING_X) / (CHAR_WIDTH * String(symbol).length);
  // 내림: 반올림으로 커지면 칸 폭을 넘을 수 있다
  const symbolPx = Math.floor(clamp(Math.min(short / 3, fitWidth), 12, 36));
  if (rect.w < 56 || rect.h < 48) return { showSymbol: true, showWeight: false, symbolPx };
  return { showSymbol: true, showWeight: true, symbolPx, weightPx: Math.round(clamp(short / 6, 13, 24)) };
}

// 티커와 비중이 둘 다 온전히 나오는가: 비중 줄이 보이고, 티커가 최소 글자 크기(12px)로도 칸 폭에 들어가야 한다.
const MIN_SYMBOL_PX = 12;
export function labelFits(rect, symbol) {
  const fitWidth = (rect.w - PADDING_X) / (CHAR_WIDTH * String(symbol).length);
  return tileLabel(rect, symbol).showWeight && fitWidth >= MIN_SYMBOL_PX;
}

// 글자가 온전히 나오지 못하는 종목을 작은 것부터 하나씩 Others로 옮기며 다시 배치한다.
// 작은 종목이 빠지면 남은 칸이 커져 글자가 다시 들어갈 수 있으므로 한 번에 다 옮기지 않는다.
// → { rects: squarify 결과(Others는 id가 OTHERS_ID), others: 묶인 [{id, value}] }
export const OTHERS_ID = '__others__';

export function groupOthers(items, width, height) {
  const kept = items.filter((i) => Number.isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const others = [];
  for (;;) {
    const othersValue = others.reduce((s, o) => s + o.value, 0);
    const layout = others.length ? [...kept, { id: OTHERS_ID, value: othersValue }] : kept;
    const rects = squarify(layout, width, height);
    const allFit = rects.every((r) => r.id === OTHERS_ID || labelFits(r, r.id));
    if (allFit || !kept.length) return { rects, others };
    others.push(kept.pop()); // 남은 것 중 가장 작은 종목
  }
}
