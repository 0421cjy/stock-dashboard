import { AppError } from './errors.js';
import { createCache } from './cache.js';

const BASE = 'https://finnhub.io/api/v1';
const TTL = {
  quote: 15_000,
  profile: 86_400_000,
  news: 1_800_000,
  earnings: 21_600_000,
  holidays: 86_400_000,
};
const FIRST_BACKOFF = 5_000;
const MAX_BACKOFF = 60_000;
const NEWS_PER_SYMBOL = 5;

export function createFinnhubClient({ apiKey, fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }) }) {
  let authFailed = false;
  let backoffMs = 0;
  let blockedUntil = 0;

  async function request(pathname, params) {
    if (!apiKey) {
      throw new AppError('MISSING_KEY', 'Finnhub API 키가 없습니다. .env 파일에 FINNHUB_API_KEY를 넣고 서버를 다시 켜주세요.', 503);
    }
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
      backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF) : FIRST_BACKOFF;
      blockedUntil = now() + backoffMs;
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
      return cache.get(`profile:${symbol}`, TTL.profile, async () => {
        // ETF 등은 회사 정보가 비어 있다. 없는 티커 여부는 호출하는 쪽이 시세로 판단한다.
        const p = await request('/stock/profile2', { symbol });
        return { symbol, name: p?.name || null };
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

    holidays() {
      return cache.get('holidays', TTL.holidays, async () => {
        const data = await request('/stock/market-holiday', { exchange: 'US' });
        return (data?.data ?? []).map((h) => ({ date: h.atDate, tradingHour: h.tradingHour ?? '' }));
      });
    },
  };
}
