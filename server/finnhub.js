import { AppError } from './errors.js';
import { createCache } from './cache.js';

const BASE = 'https://finnhub.io/api/v1';
const TTL = {
  quote: 15_000,
  profile: 86_400_000,
  news: 1_800_000,
  earnings: 21_600_000,
  holidays: 86_400_000,
  dividends: 86_400_000,
};
const FIRST_BACKOFF = 5_000;
const MAX_BACKOFF = 60_000;
const NEWS_PER_SYMBOL = 5;
// 무료 플랜 초당 한도(30회)를 넘지 않도록 동시에 나가는 요청 수를 제한한다.
// 요청 하나가 0.4~0.7초 걸리므로 8개씩이면 초당 20회 안팎이다.
const MAX_CONCURRENT = 8;

export function createFinnhubClient({ apiKey, fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }), names = null }) {
  let authFailed = false;
  let backoffMs = 0;
  let blockedUntil = 0;
  let active = 0;
  const waiting = [];

  async function withSlot(fn) {
    if (active < MAX_CONCURRENT) active += 1;
    else await new Promise((resolve) => waiting.push(resolve)); // 끝난 요청의 자리를 그대로 넘겨받는다
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  }

  function request(pathname, params) {
    if (!apiKey) {
      return Promise.reject(new AppError('MISSING_KEY', 'Finnhub API 키가 없습니다. .env 파일에 FINNHUB_API_KEY를 넣고 서버를 다시 켜주세요.', 503));
    }
    return withSlot(() => send(pathname, params));
  }

  async function send(pathname, params) {
    if (now() < blockedUntil) {
      throw new AppError('RATE_LIMITED', 'Finnhub 호출 한도를 넘어 잠시 쉬는 중입니다.', 503);
    }
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res;
    try {
      res = await fetch(url, { headers: { 'X-Finnhub-Token': apiKey } });
    } catch {
      throw new AppError('UPSTREAM', 'Finnhub에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.', 502);
    }

    if (res.status === 401) {
      authFailed = true;
      throw new AppError('INVALID_KEY', 'Finnhub API 키가 올바르지 않습니다. .env 파일의 FINNHUB_API_KEY를 확인해주세요.', 503);
    }
    if (res.status === 403) {
      throw new AppError('UPSTREAM', '이 데이터는 Finnhub 무료 플랜에서 제공되지 않습니다.', 502);
    }
    if (res.status === 429) {
      // 이미 막혀 있는 동안 도착한 429(동시에 보낸 요청들)는 대기 시간을 다시 늘리지 않는다.
      if (now() >= blockedUntil) {
        backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF) : FIRST_BACKOFF;
        blockedUntil = now() + backoffMs;
      }
      throw new AppError('RATE_LIMITED', 'Finnhub 호출 한도를 넘어 잠시 쉬는 중입니다.', 503);
    }
    if (!res.ok) {
      throw new AppError('UPSTREAM', `Finnhub 오류가 발생했습니다. (${res.status})`, 502);
    }

    authFailed = false;
    backoffMs = 0;
    return res.json();
  }

  return {
    keyStatus() {
      if (!apiKey) return 'missing';
      return authFailed ? 'invalid' : 'ok';
    },

    quote(symbol) {
      return cache.get(`quote:${symbol}`, TTL.quote, async () => {
        const q = await request('/quote', { symbol });
        if (!(q?.c > 0)) throw new AppError('NOT_FOUND', `${symbol} 시세를 찾을 수 없습니다.`, 404);
        return { price: q.c, change: q.d, changePct: q.dp, prevClose: q.pc, time: q.t };
      });
    },

    profile(symbol) {
      // 파일에 저장해둔 이름이 있으면 Finnhub에 묻지 않는다(서버를 다시 켠 직후 시세 응답이 빨라진다)
      const saved = names?.get(symbol);
      if (saved) return Promise.resolve({ value: { symbol, name: saved.name }, stale: false });
      return cache.get(`profile:${symbol}`, TTL.profile, async () => {
        // ETF 등은 회사 정보가 비어 있다. 없는 티커 여부는 호출하는 쪽이 시세로 판단한다.
        const p = await request('/stock/profile2', { symbol });
        const name = p?.name || null;
        names?.set(symbol, name);
        return { symbol, name };
      });
    },

    news(symbol, { from, to }) {
      return cache.get(`news:${symbol}:${from}`, TTL.news, async () => {
        const list = await request('/company-news', { symbol, from, to });
        return (Array.isArray(list) ? list : [])
          .filter((n) => n.headline && n.url)
          .sort((a, b) => b.datetime - a.datetime)
          .slice(0, NEWS_PER_SYMBOL)
          .map((n) => ({ symbol, headline: n.headline, source: n.source ?? '', url: n.url, datetime: n.datetime * 1000 }));
      });
    },

    earnings(symbol, { from, to }) {
      return cache.get(`earnings:${symbol}:${from}`, TTL.earnings, async () => {
        const data = await request('/calendar/earnings', { symbol, from, to });
        return (data?.earningsCalendar ?? [])
          .filter((e) => e.symbol === symbol && e.date)
          .map((e) => ({ symbol, date: e.date, hour: e.hour ?? '', epsEstimate: e.epsEstimate ?? null }));
      });
    },

    // 배당 지표(무료): 1주당 연 배당(예정 배당 → 없으면 최근 12개월)과 5년 배당 성장률.
    // ETF는 지표가 비어 있어 annualDps가 null이다. 배당을 안 주는 종목은 0.
    dividendMetrics(symbol) {
      return cache.get(`dividend:${symbol}`, TTL.dividends, async () => {
        const m = (await request('/stock/metric', { symbol, metric: 'all' }))?.metric ?? {};
        const num = (v) => (Number.isFinite(v) ? v : null);
        const indicated = num(m.dividendIndicatedAnnual);
        const fiscal = num(m.dividendPerShareAnnual);
        let annualDps = indicated ?? fiscal ?? num(m.dividendPerShareTTM);
        // 예정 배당이 지난 회계연도 배당과 3배 넘게 다르면 데이터 오류로 보고 회계연도 값을 쓴다
        // (예: NVDA 예정 1.00 vs 회계연도 0.0399). 예정 0(배당 중단)은 그대로 둔다.
        if (indicated > 0 && fiscal > 0 && Math.max(indicated / fiscal, fiscal / indicated) > 3) annualDps = fiscal;
        return { symbol, annualDps, growth5y: num(m.dividendGrowthRate5Y) };
      });
    },

    holidays() {
      return cache.get('holidays', TTL.holidays, async () => {
        const data = await request('/stock/market-holiday', { exchange: 'US' });
        return (data?.data ?? []).map((h) => ({ date: h.atDate, tradingHour: h.tradingHour ?? '' }));
      });
    },
  };
}
