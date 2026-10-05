import { AppError } from './errors.js';
import { createCache } from './cache.js';

// Yahoo Finance 차트 데이터.
// - 프리마켓·애프터마켓 가격: Finnhub 무료 플랜은 정규장 가격만 준다.
// - 정규장 마지막 체결: Finnhub 무료 실시간 체결이 오지 않는 종목(SOFI 등)을 채운다.
// 공식 API가 아니라 언제든 막힐 수 있어, 실패하면 화면에서 그냥 표시하지 않는다.
const URL_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const TTL = 60_000;
const REGULAR_TTL = 4_000;
const TIMEOUT_MS = 5_000;
const MAX_CONCURRENT = 4;

// Yahoo 차트 응답 → { session: 'pre'|'post', price, change, changeRatio(0.01 = 1%), time } 또는 null(시간외 거래 없음)
export function parseExtended(data) {
  const r = data?.chart?.result?.[0];
  const meta = r?.meta;
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  const base = meta?.regularMarketPrice;
  if (!Array.isArray(ts) || !Array.isArray(closes) || !(base > 0)) return null;

  let i = ts.length - 1;
  while (i >= 0 && !(closes[i] > 0)) i -= 1;
  if (i < 0) return null;
  const t = ts[i];
  const within = (p) => p && t >= p.start && t < p.end;
  const period = meta.currentTradingPeriod;
  const session = within(period?.pre) ? 'pre' : within(period?.post) ? 'post' : null;
  if (!session) return null;

  const price = closes[i];
  const change = price - base;
  return { session, price, change, changeRatio: change / base, time: t * 1000 };
}

export function createExtendedClient({ fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }) } = {}) {
  let active = 0;
  const waiting = [];
  async function withSlot(fn) {
    if (active < MAX_CONCURRENT) active += 1;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  function chart(symbol, query) {
    return withSlot(async () => {
      // Yahoo는 BRK.B를 BRK-B로 쓴다
      const url = `${URL_BASE}${encodeURIComponent(symbol.replace(/\./g, '-'))}?${query}`;
      let res;
      try {
        res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new AppError('UPSTREAM', 'Yahoo 시세 서버에 연결할 수 없습니다.', 502);
      }
      if (!res.ok) throw new AppError('UPSTREAM', `Yahoo 시세 서버 오류가 발생했습니다. (${res.status})`, 502);
      return res.json();
    });
  }

  return {
    // 프리마켓·애프터마켓 마지막 체결
    price(symbol) {
      return cache.get(`ext:${symbol}`, TTL, async () => parseExtended(await chart(symbol, 'interval=1m&range=1d&includePrePost=true')));
    },
    // 정규장 마지막 체결 { p, t(ms) } 또는 null
    regular(symbol) {
      return cache.get(`reg:${symbol}`, REGULAR_TTL, async () => parseRegular(await chart(symbol, 'interval=1d&range=1d')));
    },
  };
}

// Yahoo 차트 응답 → 정규장 마지막 체결 { p, t(ms) } 또는 null
export function parseRegular(data) {
  const meta = data?.chart?.result?.[0]?.meta;
  const p = meta?.regularMarketPrice;
  const t = meta?.regularMarketTime;
  return p > 0 && Number.isFinite(t) ? { p, t: t * 1000 } : null;
}
