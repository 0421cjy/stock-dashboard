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
    // 기간별 가격 막대(정규장) { previousClose, bars: [{ t(ms), date(뉴욕), close }] }
    history(symbol, range) {
      const r = HISTORY_RANGES[range];
      if (!r) return Promise.reject(new AppError('VALIDATION', '지원하지 않는 기간입니다.', 400));
      return cache.get(`hist:${range}:${symbol}`, r.ttl, async () => parseHistory(await chart(symbol, `range=${r.range}&interval=${r.interval}`)));
    },
  };
}

// 그래프 기간 → Yahoo 조회 범위·간격과 캐시 시간
export const HISTORY_RANGES = {
  '1d': { range: '1d', interval: '5m', ttl: 60_000 },
  '1w': { range: '5d', interval: '30m', ttl: 300_000 },
  '1m': { range: '1mo', interval: '1d', ttl: 1_800_000 },
  '3m': { range: '3mo', interval: '1d', ttl: 1_800_000 },
  '1y': { range: '1y', interval: '1d', ttl: 1_800_000 },
};

const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

// Yahoo 차트 응답 → { previousClose, bars } (가격이 비어 있는 막대는 뺀다)
export function parseHistory(data) {
  const r = data?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const bars = [];
  ts.forEach((t, i) => {
    if (closes[i] > 0) bars.push({ t: t * 1000, date: nyDate.format(new Date(t * 1000)), close: closes[i] });
  });
  const pc = r?.meta?.chartPreviousClose;
  return { previousClose: pc > 0 ? pc : null, bars };
}

// Yahoo 차트 응답 → 정규장 마지막 체결 { p, t(ms) } 또는 null
export function parseRegular(data) {
  const meta = data?.chart?.result?.[0]?.meta;
  const p = meta?.regularMarketPrice;
  const t = meta?.regularMarketTime;
  return p > 0 && Number.isFinite(t) ? { p, t: t * 1000 } : null;
}
