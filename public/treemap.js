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

// 종목별 파스텔 배경 → Map(symbol → 'hsl(h, 50%, 88%)').
// 티커 알파벳 순으로 색상환을 균등하게 나눠 준다. 그래서 새로고침·비중 순위가 바뀌어도
// 같은 종목은 같은 색이고(종목 추가·삭제 때만 다시 배정), 이웃 색이 한쪽으로 몰리지 않는다.
const HUE_START = 210; // 첫 색은 차분한 파랑 계열

export function pastelColors(symbols) {
  const unique = [...new Set(symbols)].sort();
  const step = 360 / Math.max(unique.length, 1);
  return new Map(unique.map((s, i) => [s, `hsl(${Math.round(HUE_START + i * step) % 360}, 50%, 88%)`]));
}

// 등락률 글자색(한국식): 상승 빨강, 하락 파랑. |등락률| 3% 이상이 가장 진하고 0이나 시세 없음은 회색.
// 파스텔 배경 위에서도 읽히도록 가장 옅은 단계도 충분히 어두운 색을 쓴다.
const NEUTRAL = [108, 117, 125];
const UP = [176, 18, 32];
const DOWN = [21, 72, 170];
const FULL_AT = 0.03;

export function changeTextColor(changePct) {
  if (changePct == null || !Number.isFinite(changePct) || changePct === 0) return rgb(NEUTRAL);
  const t = Math.min(Math.abs(changePct) / FULL_AT, 1);
  const target = changePct > 0 ? UP : DOWN;
  return rgb(NEUTRAL.map((c, i) => Math.round(c + (target[i] - c) * t)));
}

function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}
