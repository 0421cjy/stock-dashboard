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

// 프리마켓·애프터마켓 가격이 있으면 '오늘' 등락률을 그 가격으로 바꾸고 session을 붙인다.
// 프리마켓은 마지막 정규장 종가 대비, 애프터마켓은 전일 종가 대비(오늘 정규장 + 시간외).
// 시간외 가격이 없는 종목은 정규장 등락률 그대로. 평가금액·손익은 정규장 가격 기준으로 둔다.
export function applyExtended(rows, extended = {}) {
  return rows.map((r) => {
    const ext = extended[r.symbol];
    if (!r.hasPrice || !(ext?.price > 0)) return r;
    const base = ext.session === 'post' && r.prevClose > 0 ? r.prevClose : r.price;
    return {
      ...r,
      dayChange: r.shares * (ext.price - base),
      dayChangePct: ext.price / base - 1,
      dayBaseValue: r.shares * base,
      session: ext.session,
    };
  });
}

// 요약 카드의 '오늘 등락'. applyExtended를 거친 행으로 계산해 표와 같은 기준을 쓴다.
// session: 시간외 가격을 쓴 종목이 있으면 그 시간대, extCount: 그런 종목 수
export function dayTotals(rows) {
  const priced = rows.filter((r) => r.hasPrice);
  const dayChange = sum(priced, 'dayChange');
  const baseValue = priced.reduce((acc, r) => acc + (r.dayBaseValue ?? r.marketValue - r.dayChange), 0);
  const ext = priced.filter((r) => r.session);
  return {
    dayChange,
    dayChangePct: baseValue > 0 ? dayChange / baseValue : null,
    session: ext[0]?.session ?? null,
    extCount: ext.length,
    pricedCount: priced.length,
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

// 실시간 체결가를 시세에 반영한다. 시세(30초 조회)보다 새로운 체결만 쓰고, 등락은 전일 종가로 다시 계산한다.
// trades: { SYMBOL: { p, t(ms) } }. 시세가 없는 종목(전일 종가를 모름)은 건드리지 않는다.
export function applyTrades(quotes = {}, trades = {}) {
  const out = { ...quotes };
  for (const [symbol, tr] of Object.entries(trades)) {
    const q = quotes[symbol];
    if (!(q?.price > 0) || !(tr?.p > 0)) continue;
    if (tr.t <= (q.time ?? 0) * 1000) continue;
    const change = q.prevClose > 0 ? tr.p - q.prevClose : q.change;
    const changePct = q.prevClose > 0 ? (change / q.prevClose) * 100 : q.changePct;
    out[symbol] = { ...q, price: tr.p, change, changePct, time: tr.t / 1000, stale: false };
  }
  return out;
}

// 화면 전체를 "지연"으로 표시할지 정한다. 캐시 값을 썼거나 일시적 오류(한도·연결)가 있을 때만
// 지연이고, 없는 티커(NOT_FOUND)는 그 줄의 ⚠로만 알린다.
export function quoteDelay(incoming = {}) {
  const delayed = Object.values(incoming).some((q) => q?.stale || (q?.error && q.error.code !== 'NOT_FOUND'));
  return delayed ? '일부 시세가 지연되고 있습니다.' : null;
}

// 종목별 목록(뉴스·실적)을 새로 받을 때, 가져오지 못한 종목은 이전 항목을 유지한다.
export function keepFailed(prevItems = [], { items = [], failed = [] } = {}) {
  return [...items, ...prevItems.filter((p) => failed.includes(p.symbol))];
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
