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

test('profile: 회사명, 빈 응답은 NOT_FOUND', async () => {
  const fh = createFinnhubClient({
    apiKey: 'k',
    now: clock(),
    fetch: fakeFetch((u) => ({ body: u.searchParams.get('symbol') === 'SOFI' ? { name: 'SoFi Technologies Inc', ticker: 'SOFI' } : {} })),
  });
  assert.deepEqual((await fh.profile('SOFI')).value, { symbol: 'SOFI', name: 'SoFi Technologies Inc' });
  await assert.rejects(fh.profile('NOPE'), { code: 'NOT_FOUND', message: '찾을 수 없는 티커입니다.' });
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
