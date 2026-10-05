import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtended, createExtendedClient } from '../server/extended.js';

const PRE = { start: 1_790_928_000, end: 1_790_947_800 }; // 04:00~09:30 EDT
const POST = { start: 1_790_971_200, end: 1_790_985_600 }; // 16:00~20:00 EDT

function chart({ ts, closes, price = 100 }) {
  return {
    chart: {
      result: [{
        meta: { regularMarketPrice: price, currentTradingPeriod: { pre: PRE, post: POST } },
        timestamp: ts,
        indicators: { quote: [{ close: closes }] },
      }],
    },
  };
}

test('parseExtended: 프리마켓 마지막 체결가와 정규장 종가 대비 등락', () => {
  const r = parseExtended(chart({ ts: [PRE.start + 60, PRE.start + 120, PRE.start + 180], closes: [101, 102, null] }));
  assert.equal(r.session, 'pre');
  assert.equal(r.price, 102);
  assert.equal(r.change, 2);
  assert.equal(r.changeRatio, 0.02);
  assert.equal(r.time, (PRE.start + 120) * 1000);
});

test('parseExtended: 애프터마켓은 post', () => {
  assert.equal(parseExtended(chart({ ts: [POST.start + 60], closes: [99] })).session, 'post');
});

test('parseExtended: 마지막 체결이 정규장이거나 데이터가 없으면 null', () => {
  assert.equal(parseExtended(chart({ ts: [PRE.end + 60], closes: [101] })), null);
  assert.equal(parseExtended(chart({ ts: [], closes: [] })), null);
  assert.equal(parseExtended({}), null);
});

test('price: BRK.B는 BRK-B로 묻고, 60초 캐시한다', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(chart({ ts: [PRE.start + 60], closes: [101] })), { status: 200 });
  };
  const ext = createExtendedClient({ fetch, now: () => 1_000_000 });
  assert.equal((await ext.price('BRK.B')).value.price, 101);
  await ext.price('BRK.B');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/chart\/BRK-B\?/);
});

test('price: 서버 오류는 UPSTREAM', async () => {
  const ext = createExtendedClient({ fetch: async () => new Response('{}', { status: 429 }) });
  await assert.rejects(ext.price('AAPL'), { code: 'UPSTREAM' });
});

test('parseRegular: 정규장 마지막 체결가와 시각(ms)', async () => {
  const { parseRegular } = await import('../server/extended.js');
  assert.deepEqual(parseRegular({ chart: { result: [{ meta: { regularMarketPrice: 16.01, regularMarketTime: 1_790_000_000 } }] } }), { p: 16.01, t: 1_790_000_000_000 });
  assert.equal(parseRegular({}), null);
});
