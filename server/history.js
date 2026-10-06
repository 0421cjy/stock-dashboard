import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 총 평가금액 추이.
// 거래내역이 없으므로 날짜별(뉴욕 기준) 보유 종목을 data/history.json에 기록해 두고,
// 그래프를 그릴 때 그날의 보유 수량 × 그 시점 가격으로 계산한다.
// - 기록이 있는 날: 그날(없으면 직전 기록일)의 보유 수량 → 실제 자산 흐름
// - 첫 기록 이전: 지금 보유 수량을 그대로 갖고 있었다고 가정한 추정치(estimated)

export function createHistoryStore({ filePath }) {
  let days = {}; // { 'YYYY-MM-DD': [{ symbol, shares }] }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data && typeof data.days === 'object') days = data.days;
  } catch {
    // 파일이 없거나 깨졌으면 빈 기록으로 시작한다
  }

  let writing = Promise.resolve();
  function save() {
    const text = `${JSON.stringify({ version: 1, days }, null, 2)}\n`;
    writing = writing.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, filePath);
    }).catch(() => {});
    return writing;
  }

  return {
    // 그날의 보유 종목을 기록한다(하루에 여러 번 부르면 마지막 상태가 남는다). 바뀐 게 없으면 쓰지 않는다.
    record(date, holdings) {
      const list = holdings.map((h) => ({ symbol: h.symbol, shares: h.shares })).sort((a, b) => a.symbol.localeCompare(b.symbol));
      if (JSON.stringify(days[date]) === JSON.stringify(list)) return writing;
      days[date] = list;
      return save();
    },
    // 날짜순 [{ date, holdings }]
    snapshots() {
      return Object.keys(days).sort().map((date) => ({ date, holdings: days[date] }));
    },
  };
}

// 날짜 → 그날 쓸 보유 종목과 추정 여부.
// snapshots: 날짜순 [{ date, holdings }], current: 지금 보유 종목
export function holdingsResolver(snapshots, current) {
  return (date) => {
    let found = null;
    for (const s of snapshots) {
      if (s.date <= date) found = s;
      else break;
    }
    return found ? { holdings: found.holdings, estimated: false } : { holdings: current, estimated: true };
  };
}

// 기간 중간 이후에야 가격이 시작되는 종목(기간 중 상장) → { SYMBOL: 첫 가격 날짜 }
export function lateListed(bars) {
  const times = [...new Set(Object.values(bars).flatMap((list) => list.map((b) => b.t)))].sort((a, b) => a - b);
  const middle = times[Math.floor(times.length / 2)];
  return Object.fromEntries(Object.entries(bars).filter(([, list]) => list.length && list[0].t > middle).map(([s, list]) => [s, list[0].date]));
}

// 종목별 가격 막대 → 시점별 총 평가금액.
// bars: { SYMBOL: [{ t(ms), date, close }] } (시간순), resolve: holdingsResolver의 결과
// 종목마다 마지막으로 알려진 가격을 이어 쓴다. 보유 종목 중 아직 가격이 없는 시점은 건너뛰되,
// 기간 중 상장한 종목(lateListed)은 상장 전을 0으로 계산해 기간 전체를 그린다.
export function buildSeries(bars, resolve) {
  const late = lateListed(bars);
  const times = [...new Set(Object.values(bars).flatMap((list) => list.map((b) => b.t)))].sort((a, b) => a - b);
  const byTime = Object.fromEntries(Object.entries(bars).map(([s, list]) => [s, new Map(list.map((b) => [b.t, b]))]));
  const last = {};
  const points = [];
  for (const t of times) {
    let date = null;
    for (const [s, map] of Object.entries(byTime)) {
      const b = map.get(t);
      if (b && b.close > 0) {
        last[s] = b.close;
        date = b.date;
      }
    }
    const { holdings, estimated } = resolve(date);
    if (!holdings.length || holdings.some((h) => bars[h.symbol]?.length && !(last[h.symbol] > 0) && !late[h.symbol])) continue;
    const value = holdings.reduce((sum, h) => sum + (last[h.symbol] > 0 ? h.shares * last[h.symbol] : 0), 0);
    points.push({ t, date, value, estimated });
  }
  return points;
}

// 날짜별 환율(영업일만 있음)에서 그 날짜 또는 직전 영업일 환율을 찾는다.
// 마지막 고시일보다 뒤(오늘 등)는 current(지금 환율)를 쓴다. 고시일보다 앞이면 첫 고시 환율.
export function fxResolver(rates, current) {
  const dates = Object.keys(rates).sort();
  return (date) => {
    if (!dates.length || date > dates.at(-1)) return current ?? rates[dates.at(-1)] ?? null;
    let rate = rates[dates[0]];
    for (const d of dates) {
      if (d <= date) rate = rates[d];
      else break;
    }
    return rate;
  };
}
