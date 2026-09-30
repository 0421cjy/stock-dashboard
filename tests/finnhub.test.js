import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFinnhubClient } from '../server/finnhub.js';

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// handler(url: URL) → { status?, body } 또는 throw(연결 실패 흉내)
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const { status = 200, body = {} } = await handler(u);
    return new Response(JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

const QUOTE = { c: 16.67, d: -0.22, dp: -1.3, pc: 16.89, t: 1790000000 };

test('quote: 필드를 바꿔 담고 키는 헤더로만 보낸다', async () => {
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'secret', fetch, now: clock() });
  const r = await fh.quote('SOFI');
  assert.deepEqual(r.value, { price: 16.67, change: -0.22, changePct: -1.3, prevClose: 16.89, time: 1790000000 });
  const { url, init } = fetch.calls[0];
  assert.equal(url.pathname, '/api/v1/quote');
  assert.equal(url.searchParams.get('symbol'), 'SOFI');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(init.headers['X-Finnhub-Token'], 'secret');
});

test('quote: 점이 들어간 티커를 그대로 보낸다', async () => {
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  await fh.quote('BRK.B');
  assert.equal(fetch.calls[0].url.searchParams.get('symbol'), 'BRK.B');
});

test('quote: 15초 동안 캐시한다', async () => {
  const now = clock();
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now });
  await fh.quote('SOFI');
  now.advance(14_000);
  await fh.quote('SOFI');
  assert.equal(fetch.calls.length, 1);
  now.advance(2_000);
  await fh.quote('SOFI');
  assert.equal(fetch.calls.length, 2);
});

test('quote: 가격 0은 없는 종목으로 본다', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { c: 0, d: null, dp: null, pc: 0, t: 0 } })), now: clock() });
  await assert.rejects(fh.quote('NOPE'), { code: 'NOT_FOUND' });
});

test('429: 이전 값은 stale로 주고, 백오프 동안은 호출하지 않는다', async () => {
  const now = clock();
  let limited = false;
  const fetch = fakeFetch(() => (limited ? { status: 429, body: {} } : { body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now });
  await fh.quote('SOFI');
  limited = true;
  now.advance(16_000);
  const r1 = await fh.quote('SOFI');
  assert.equal(r1.stale, true);
  assert.equal(r1.value.price, 16.67);
  assert.equal(fetch.calls.length, 2);
  now.advance(1_000);
  const r2 = await fh.quote('SOFI');
  assert.equal(r2.stale, true);
  assert.equal(fetch.calls.length, 2, '백오프 중에는 Finnhub를 부르지 않는다');
});

test('429: 동시에 받은 429는 대기 시간을 한 번만 늘린다', async () => {
  const now = clock();
  let limited = true;
  const fetch = fakeFetch(() => (limited ? { status: 429 } : { body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now });
  await Promise.allSettled(['A', 'B', 'C', 'D'].map((s) => fh.quote(s)));
  limited = false;
  now.advance(5_001);
  const r = await fh.quote('E');
  assert.equal(r.value.price, 16.67, '첫 백오프(5초)가 지나면 다시 호출한다');
});

test('동시에 Finnhub로 나가는 요청은 8개로 제한한다', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return new Response(JSON.stringify(QUOTE), { status: 200 });
  };
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  await Promise.all(Array.from({ length: 12 }, (_, i) => fh.quote(`S${i}`)));
  assert.equal(maxInFlight, 8);
});

test('429: 이전 값이 없으면 RATE_LIMITED', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ status: 429 })), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'RATE_LIMITED' });
});

test('키 상태: 없음·잘못됨·정상', async () => {
  const missing = createFinnhubClient({ apiKey: '', fetch: fakeFetch(() => ({ body: QUOTE })), now: clock() });
  assert.equal(missing.keyStatus(), 'missing');
  await assert.rejects(missing.quote('SOFI'), { code: 'MISSING_KEY' });

  let ok = false;
  const fh = createFinnhubClient({ apiKey: 'bad', fetch: fakeFetch(() => (ok ? { body: QUOTE } : { status: 401 })), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'INVALID_KEY' });
  assert.equal(fh.keyStatus(), 'invalid');
  ok = true;
  await fh.quote('AAPL');
  assert.equal(fh.keyStatus(), 'ok');
});

test('연결 실패는 UPSTREAM', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'UPSTREAM' });
});

test('profile: 회사명을 돌려주고, 빈 응답(ETF 등)은 이름 없이 24시간 캐시한다', async () => {
  const fetch = fakeFetch((u) => ({ body: u.searchParams.get('symbol') === 'SOFI' ? { name: 'SoFi Technologies Inc', ticker: 'SOFI' } : {} }));
  const fh = createFinnhubClient({ apiKey: 'k', now: clock(), fetch });
  assert.deepEqual((await fh.profile('SOFI')).value, { symbol: 'SOFI', name: 'SoFi Technologies Inc' });
  assert.deepEqual((await fh.profile('VOO')).value, { symbol: 'VOO', name: null });
  await fh.profile('VOO');
  assert.equal(fetch.calls.length, 2, '이름 없는 결과도 캐시해 매번 다시 부르지 않는다');
});

test('profile: 저장된 이름이 있으면 묻지 않고, 새로 받은 이름은 저장한다', async () => {
  const saved = { AAPL: { name: 'Apple Inc' }, VOO: { name: null } };
  const written = [];
  const names = { get: (s) => saved[s], set: (s, n) => { written.push([s, n]); } };
  const fetch = fakeFetch(() => ({ body: { name: 'SoFi Technologies Inc' } }));
  const fh = createFinnhubClient({ apiKey: 'k', now: clock(), fetch, names });
  assert.deepEqual((await fh.profile('AAPL')).value, { symbol: 'AAPL', name: 'Apple Inc' });
  assert.deepEqual((await fh.profile('VOO')).value, { symbol: 'VOO', name: null });
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual((await fh.profile('SOFI')).value, { symbol: 'SOFI', name: 'SoFi Technologies Inc' });
  assert.deepEqual(written, [['SOFI', 'SoFi Technologies Inc']]);
});

test('news: 최신순 5개, 링크 없는 기사 제외, 시간은 ms', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    datetime: 1_790_000_000 + i, headline: `h${i}`, source: 'S', url: i === 7 ? '' : `https://x/${i}`,
  }));
  const fetch = fakeFetch(() => ({ body: items }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  const r = await fh.news('SOFI', { from: '2026-09-21', to: '2026-09-28' });
  assert.deepEqual(r.value.map((n) => n.headline), ['h6', 'h5', 'h4', 'h3', 'h2']);
  assert.deepEqual(r.value[0], { symbol: 'SOFI', headline: 'h6', source: 'S', url: 'https://x/6', datetime: 1_790_000_006_000 });
  const { url } = fetch.calls[0];
  assert.equal(url.pathname, '/api/v1/company-news');
  assert.equal(url.searchParams.get('from'), '2026-09-21');
  assert.equal(url.searchParams.get('to'), '2026-09-28');
});

test('earnings: 일정을 바꿔 담고, 비어 있으면 빈 배열', async () => {
  let body = { earningsCalendar: [{ date: '2026-10-27', epsEstimate: 0.12, hour: 'bmo', symbol: 'SOFI', year: 2026, quarter: 3 }] };
  const fetch = fakeFetch(() => ({ body }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  const r = await fh.earnings('SOFI', { from: '2026-09-28', to: '2026-12-27' });
  assert.deepEqual(r.value, [{ symbol: 'SOFI', date: '2026-10-27', hour: 'bmo', epsEstimate: 0.12 }]);
  assert.equal(fetch.calls[0].url.pathname, '/api/v1/calendar/earnings');
  body = { earningsCalendar: null };
  assert.deepEqual((await fh.earnings('AAPL', { from: '2026-09-28', to: '2026-12-27' })).value, []);
});

test('holidays: 날짜와 거래 시간', async () => {
  const fh = createFinnhubClient({
    apiKey: 'k',
    now: clock(),
    fetch: fakeFetch(() => ({ body: { data: [{ eventName: 'Thanksgiving', atDate: '2026-11-26', tradingHour: '' }] } })),
  });
  assert.deepEqual((await fh.holidays()).value, [{ date: '2026-11-26', tradingHour: '' }]);
});

test('dividendMetrics: 1주당 연 배당과 5년 성장률을 바꿔 담는다(배당률은 화면에서 현재가로 계산)', async () => {
  const body = { metric: { dividendIndicatedAnnual: 3.92, dividendPerShareTTM: 3.559, dividendYieldIndicatedAnnual: 0.79485, dividendGrowthRate5Y: 10.2, beta: 0.9 } };
  const fetch = fakeFetch(() => ({ body }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  assert.deepEqual((await fh.dividendMetrics('MSFT')).value, { symbol: 'MSFT', annualDps: 3.92, growth5y: 10.2 });
  const { url } = fetch.calls[0];
  assert.equal(url.pathname, '/api/v1/stock/metric');
  assert.equal(url.searchParams.get('metric'), 'all');
});

test('dividendMetrics: 예정 배당이 없으면 최근 12개월 배당, 둘 다 없으면(ETF) null', async () => {
  let body = { metric: { dividendPerShareTTM: 1.06 } };
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body })), now: clock() });
  assert.equal((await fh.dividendMetrics('AAPL')).value.annualDps, 1.06);
  body = { metric: {} };
  assert.deepEqual((await fh.dividendMetrics('VOO')).value, { symbol: 'VOO', annualDps: null, growth5y: null });
});

test('dividendMetrics: 배당을 안 주는 종목은 0', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { metric: { dividendIndicatedAnnual: 0, dividendPerShareTTM: 0 } } })), now: clock() });
  assert.equal((await fh.dividendMetrics('SOFI')).value.annualDps, 0);
});

test('dividendMetrics: 예정 배당이 지난 회계연도 배당과 3배 넘게 다르면 오류로 보고 회계연도 값을 쓴다', async () => {
  // 실제 Finnhub NVDA 응답(2026-09-29): 예정 1.00, 회계연도 0.0399, 12개월 0.2795 — 실제 배당은 연 약 0.04
  let body = { metric: { dividendIndicatedAnnual: 1, dividendPerShareAnnual: 0.0399, dividendPerShareTTM: 0.2795 } };
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body })), now: clock() });
  assert.equal((await fh.dividendMetrics('NVDA')).value.annualDps, 0.0399);
  body = { metric: { dividendIndicatedAnnual: 1.08, dividendPerShareAnnual: 1.0318 } };
  assert.equal((await fh.dividendMetrics('AAPL')).value.annualDps, 1.08, '차이가 작으면 예정 배당을 쓴다');
  body = { metric: { dividendIndicatedAnnual: 0, dividendPerShareAnnual: 0.5 } };
  assert.equal((await fh.dividendMetrics('CUT')).value.annualDps, 0, '배당을 없앤 경우(예정 0)는 0');
});
