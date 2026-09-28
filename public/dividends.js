// 배당금 계산. DOM·네트워크에 의존하지 않는 순수 함수.
//
// dividends: Map처럼 쓰는 객체 { SYMBOL: { annualDps, growth5y } } (서버 /api/dividends)
// 1주당 연 배당(dps)은 직접 입력(manualDps)이 있으면 그것을, 없으면 자동 값을 쓴다.
// source: 'auto' | 'manual' | 'none'(배당 없음, dps 0) | 'missing'(자동 데이터 없고 입력도 없음)

function sourceOf(h, auto) {
  if (h.manualDps != null) return { dps: h.manualDps, source: h.manualDps > 0 ? 'manual' : 'none' };
  const dps = auto?.annualDps;
  if (dps == null) return { dps: null, source: 'missing' };
  return { dps, source: dps > 0 ? 'auto' : 'none' };
}

export function computeDividends(holdings, dividends = {}, quotes = {}) {
  const all = holdings.map((h) => {
    const auto = dividends[h.symbol];
    const { dps, source } = sourceOf(h, auto);
    const price = quotes[h.symbol]?.price;
    return {
      symbol: h.symbol,
      shares: h.shares,
      dps,
      source,
      annual: dps == null ? null : h.shares * dps,
      yield: dps != null && price > 0 ? dps / price : null,
      yieldOnCost: dps != null ? dps / h.avgCost : null,
      growth5y: auto?.growth5y ?? null,
    };
  });

  const paying = all.filter((r) => r.source === 'auto' || r.source === 'manual').sort((a, b) => b.annual - a.annual);
  const missing = all.filter((r) => r.source === 'missing');
  const annual = paying.reduce((s, r) => s + r.annual, 0);

  // 배당률의 분모는 전체 포트폴리오(배당 없는 종목 포함)
  const marketValue = holdings.reduce((s, h) => s + (quotes[h.symbol]?.price > 0 ? h.shares * quotes[h.symbol].price : 0), 0);
  const cost = holdings.reduce((s, h) => s + h.shares * h.avgCost, 0);

  return {
    rows: [...paying, ...missing],
    noneSymbols: all.filter((r) => r.source === 'none').map((r) => r.symbol),
    missingCount: missing.length,
    totals: {
      annual,
      monthly: annual / 12,
      yield: marketValue > 0 ? annual / marketValue : null,
      yieldOnCost: cost > 0 ? annual / cost : null,
    },
  };
}
