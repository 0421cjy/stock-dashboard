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

// 한국식 색: 상승 빨강, 하락 파랑. |등락률| 3% 이상이 가장 진하고 0이나 시세 없음은 회색.
const NEUTRAL = [108, 117, 125];
const UP = [214, 41, 58];
const DOWN = [31, 95, 209];
const FULL_AT = 0.03;

export function heatColor(changePct) {
  if (changePct == null || !Number.isFinite(changePct) || changePct === 0) return rgb(NEUTRAL);
  const t = Math.min(Math.abs(changePct) / FULL_AT, 1);
  const target = changePct > 0 ? UP : DOWN;
  return rgb(NEUTRAL.map((c, i) => Math.round(c + (target[i] - c) * t)));
}

function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}
