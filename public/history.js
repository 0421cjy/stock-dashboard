// 총 평가금액 추이 그래프용 계산. DOM·네트워크에 의존하지 않는 순수 함수.

export const RANGES = ['1d', '1w', '1m', '3m', '1y'];
export const RANGE_LABEL = { '1d': '1일', '1w': '1주', '1m': '1개월', '3m': '3개월', '1y': '1년' };

// 1일 그래프 끝에 지금 평가금액을 붙인다(장중 실시간). 마지막 점보다 늦을 때만.
export function withLivePoint(points, live) {
  if (!live || !(live.value > 0) || !points.length || live.t <= points.at(-1).t) return points;
  return [...points, { ...live, date: points.at(-1).date, estimated: false }];
}

// 일별·주별 그래프의 마지막 점이 지금 진행 중인 날(주)이면 지금 평가금액으로 바꾼다(서버 값은 최대 30분 전).
// since: 이 날짜 이후에 시작한 막대만 '진행 중'으로 본다(일봉은 오늘, 주봉은 6일 전부터).
export function withLiveToday(points, live, since) {
  if (!live || !(live.value > 0) || !points.length || points.at(-1).date < since) return points;
  return [...points.slice(0, -1), { ...points.at(-1), value: live.value, krw: live.krw ?? points.at(-1).krw }];
}

// 기간 등락: 1일은 전일 종가 기준(base), 나머지는 기간 첫 점 기준. key: 'value'(달러) | 'krw'(원화)
export function periodChange(points, base, key) {
  if (!points.length) return null;
  const last = points.at(-1)[key];
  const from = base?.[key] ?? points[0][key];
  if (!(last > 0) || !(from > 0)) return null;
  return { last, change: last - from, ratio: last / from - 1 };
}

// 추정 구간과 기록 구간을 두 줄로 나눈다(같은 길이, 빈 칸은 null). 두 줄이 이어지도록 경계 점은 양쪽에 넣는다.
export function splitEstimated(points, key) {
  const estimated = points.map((p) => (p.estimated ? p[key] : null));
  const recorded = points.map((p) => (p.estimated ? null : p[key]));
  const first = points.findIndex((p) => !p.estimated);
  if (first > 0) estimated[first] = points[first][key];
  return { estimated, recorded, hasEstimated: first !== 0 && points.some((p) => p.estimated) };
}

const pad = (n) => String(n).padStart(2, '0');

// x축 글자(한국 시간): 1일은 시:분, 1주는 월/일 시:분, 그 밖은 월/일(1년은 연.월)
export function axisLabel(t, range) {
  const d = new Date(t);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (range === '1d') return hm;
  if (range === '1w') return `${md} ${hm}`;
  if (range === '1y') return `${String(d.getFullYear()).slice(2)}.${pad(d.getMonth() + 1)}`;
  return md;
}

// 일별 점은 뉴욕 날짜가 그날이므로 툴팁에는 날짜만, 1일·1주는 한국 시간까지
export function tooltipTitle(point, range) {
  if (range === '1d' || range === '1w') {
    const d = new Date(point.t);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} (한국 시간)`;
  }
  return `${point.date} 종가`;
}
