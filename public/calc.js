// 손익·비중 계산. DOM·네트워크에 의존하지 않는 순수 함수만 둔다.

export function computePortfolio(holdings, quotes = {}) {
  const rows = holdings.map((h) => toRow(h, quotes[h.symbol]));
  const priced = rows.filter((r) => r.hasPrice);

  const marketValue = sum(priced, 'marketValue');
  const cost = sum(priced, 'cost');
  const pnl = marketValue - cost;
  const dayChange = sum(priced, 'dayChange');
  const prevValue = marketValue - dayChange;

  for (const r of priced) r.weight = marketValue > 0 ? r.marketValue / marketValue : 0;

  return {
    rows,
    totals: {
      marketValue,
      cost,
      pnl,
      pnlPct: cost > 0 ? pnl / cost : null,
      dayChange,
      dayChangePct: prevValue > 0 ? dayChange / prevValue : null,
    },
    excludedCount: rows.length - priced.length,
  };
}

function toRow(h, q) {
  const cost = h.shares * h.avgCost;
  const base = {
    symbol: h.symbol,
    shares: h.shares,
    avgCost: h.avgCost,
    cost,
    stale: Boolean(q?.stale),
    error: q?.error ?? null,
  };
  if (!(q && Number.isFinite(q.price) && q.price > 0)) {
    return {
      ...base,
      hasPrice: false,
      price: null,
      prevClose: null,
      marketValue: null,
      pnl: null,
      pnlPct: null,
      dayChange: null,
      dayChangePct: null,
      weight: null,
    };
  }
  const marketValue = h.shares * q.price;
  const pnl = marketValue - cost;
  const hasPrev = Number.isFinite(q.prevClose) && q.prevClose > 0;
  return {
    ...base,
    hasPrice: true,
    price: q.price,
    prevClose: hasPrev ? q.prevClose : null,
    marketValue,
    pnl,
    pnlPct: pnl / cost,
    dayChange: hasPrev ? h.shares * (q.price - q.prevClose) : 0,
    dayChangePct: hasPrev ? (q.price - q.prevClose) / q.prevClose : null,
    weight: 0,
  };
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + r[key], 0);
}

// 사용자가 입력한 금액·수량 문자열을 숫자로 바꾼다. 음수·빈칸·형식 오류는 NaN.
export function parseAmount(text) {
  if (typeof text === 'number') return text;
  const cleaned = String(text ?? '').trim().replace(/,/g, '').replace(/^\$/, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

// 새로 받은 시세를 합친다. 실패한 종목은 이전 가격을 stale로 유지한다.
export function mergeQuotes(prev = {}, incoming = {}) {
  const out = {};
  for (const [symbol, q] of Object.entries(incoming)) {
    if (q && Number.isFinite(q.price) && q.price > 0) {
      out[symbol] = q;
    } else if (prev[symbol]?.price > 0) {
      out[symbol] = { ...prev[symbol], stale: true, error: q?.error ?? null };
    } else {
      out[symbol] = { error: q?.error ?? { code: 'UNKNOWN', message: '시세를 가져오지 못했습니다.' } };
    }
  }
  return out;
}

// 표 정렬. null은 방향과 상관없이 맨 뒤.
export function sortRows(rows, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string') return sign * x.localeCompare(y);
    return sign * (x - y);
  });
}
