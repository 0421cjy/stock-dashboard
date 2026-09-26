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

// 평면 단색 팔레트. 앞의 넷은 참고 이미지의 청록·파랑·노랑·코랄, 나머지는 같은 톤으로 맞춘 색.
const PALETTE = [
  '#14C1D6', '#0A77C2', '#FFC220', '#F76C62', '#2BB673',
  '#7B5CD6', '#F7931E', '#E8508B', '#0E9F9A', '#3F51B5',
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
const PADDING_X = 24; // .heat-tile 좌우 padding 12px × 2
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
