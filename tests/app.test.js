import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { AppError } from '../server/errors.js';

function fakeFinnhub(overrides = {}) {
  const calls = { profile: 0, news: [], earnings: [] };
  return {
    calls,
    keyStatus: () => 'ok',
    async quote(s) {
      if (s === 'NOPE') throw new AppError('NOT_FOUND', `${s} 시세를 찾을 수 없습니다.`, 404);
      return { value: { price: 10, change: 1, changePct: 11.1, prevClose: 9, time: 1 }, stale: false };
    },
    async profile(s) {
      calls.profile += 1;
      if (s === 'NOPE') throw new AppError('NOT_FOUND', '찾을 수 없는 티커입니다.', 404);
      return { value: { symbol: s, name: `${s} Inc` }, stale: false };
    },
    async news(s, range) {
      calls.news.push([s, range]);
      if (s === 'BAD') throw new AppError('UPSTREAM', 'x', 502);
      return { value: [{ symbol: s, headline: `${s} news`, source: 'T', url: `https://example.com/${s}`, datetime: s === 'AAA' ? 2000 : 1000 }], stale: false };
    },
    async earnings(s, range) {
      calls.earnings.push([s, range]);
      return { value: [{ symbol: s, date: s === 'AAA' ? '2026-11-05' : '2026-10-27', hour: 'bmo', epsEstimate: 0.1 }], stale: false };
    },
    async holidays() { return { value: [], stale: false }; },
    ...overrides,
  };
}

let ctx;

async function start({ finnhub = fakeFinnhub(), fx } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'stock-app-'));
  const filePath = path.join(dir, 'portfolio.json');
  let n = 0;
  const store = createStore({ filePath, idGen: () => `e_${++n}` });
  const app = createApp({
    store,
    finnhub,
    fx: fx ?? { usdKrw: async () => ({ value: { rate: 1400, date: '2026-09-25' }, stale: false }) },
    now: () => new Date('2026-09-28T14:00:00Z'), // 월요일 뉴욕 10:00
    publicDir: dir,
    vendorDir: dir,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined || raw ? { 'Content-Type': 'application/json' } : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, finnhub, filePath, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

beforeEach(async () => { ctx = await start(); });
afterEach(async () => { await ctx.close(); });

test('종목 추가: 정규화하고 회사명을 붙여 201', async () => {
  const r = await ctx.call('POST', '/api/holdings', { symbol: ' sofi ', shares: 500, avgCost: 14.2 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { symbol: 'SOFI', shares: 500, avgCost: 14.2, name: 'SOFI Inc' });
  const p = await ctx.call('GET', '/api/portfolio');
  assert.deepEqual(p.body, { holdings: [{ symbol: 'SOFI', shares: 500, avgCost: 14.2 }], events: [] });
});

test('없는 티커는 400, 수량 오류는 티커 확인 전에 400', async () => {
  const r = await ctx.call('POST', '/api/holdings', { symbol: 'NOPE', shares: 1, avgCost: 1 });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: { code: 'NOT_FOUND', message: '찾을 수 없는 티커입니다.' } });
  const before = ctx.finnhub.calls.profile;
  const bad = await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 0, avgCost: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  assert.equal(ctx.finnhub.calls.profile, before);
});

test('회사 정보가 없는 티커(ETF)는 시세로 확인해 이름 없이 저장한다', async () => {
  await ctx.close();
  ctx = await start({
    finnhub: fakeFinnhub({
      async profile(s) { return { value: { symbol: s, name: null }, stale: false }; },
    }),
  });
  const etf = await ctx.call('POST', '/api/holdings', { symbol: 'VOO', shares: 1, avgCost: 500 });
  assert.equal(etf.status, 201);
  assert.equal(etf.body.name, null);
  const missing = await ctx.call('POST', '/api/holdings', { symbol: 'NOPE', shares: 1, avgCost: 1 });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.message, '찾을 수 없는 티커입니다.');
});

test('티커를 확인할 수 없으면(키 없음 등) 이름 없이 저장한다', async () => {
  await ctx.close();
  ctx = await start({ finnhub: fakeFinnhub({ profile: async () => { throw new AppError('MISSING_KEY', '키 없음', 503); } }) });
  const r = await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 1, avgCost: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, null);
});

test('API 키가 잘못됐으면 종목 추가가 키 오류를 알린다', async () => {
  await ctx.close();
  ctx = await start({ finnhub: fakeFinnhub({ profile: async () => { throw new AppError('INVALID_KEY', 'Finnhub API 키가 올바르지 않습니다.', 503); } }) });
  const r = await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 1, avgCost: 1 });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'INVALID_KEY');
  assert.deepEqual((await ctx.call('GET', '/api/portfolio')).body.holdings, []);
});

test('중복 409, 수정 200, 삭제 204, 없는 종목 삭제 404', async () => {
  await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 1, avgCost: 1 });
  assert.equal((await ctx.call('POST', '/api/holdings', { symbol: 'aaa', shares: 1, avgCost: 1 })).status, 409);
  const up = await ctx.call('PUT', '/api/holdings/aaa', { shares: 2, avgCost: 3 });
  assert.deepEqual(up.body, { symbol: 'AAA', shares: 2, avgCost: 3 });
  assert.equal((await ctx.call('DELETE', '/api/holdings/AAA')).status, 204);
  assert.equal((await ctx.call('DELETE', '/api/holdings/AAA')).status, 404);
});

test('일정 추가·수정·삭제', async () => {
  const r = await ctx.call('POST', '/api/events', { title: 'FOMC', date: '2026-10-28' });
  assert.equal(r.status, 201);
  assert.equal(r.body.id, 'e_1');
  const up = await ctx.call('PUT', '/api/events/e_1', { title: 'FOMC', date: '2026-10-29', note: '새벽' });
  assert.equal(up.body.date, '2026-10-29');
  assert.equal((await ctx.call('DELETE', '/api/events/e_1')).status, 204);
  assert.equal((await ctx.call('POST', '/api/events', { title: '', date: '2026-10-28' })).status, 400);
});

test('시세: 성공 종목과 실패 종목을 함께 돌려준다', async () => {
  const r = await ctx.call('GET', '/api/quotes?symbols=aaa,NOPE,,bad symbol');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.AAA, { price: 10, change: 1, changePct: 11.1, prevClose: 9, time: 1, name: 'AAA Inc', stale: false });
  assert.equal(r.body.NOPE.error.code, 'NOT_FOUND');
  assert.deepEqual(Object.keys(r.body).sort(), ['AAA', 'NOPE']);
});

test('뉴스: 최신순으로 합치고 실패 종목을 알려준다', async () => {
  const r = await ctx.call('GET', '/api/news?symbols=BBB,AAA,BAD');
  assert.deepEqual(r.body.items.map((n) => n.symbol), ['AAA', 'BBB']);
  assert.deepEqual(r.body.failed, ['BAD']);
  assert.deepEqual(ctx.finnhub.calls.news[0][1], { from: '2026-09-21', to: '2026-09-28' });
});

test('실적: 오늘(뉴욕)부터 90일, 날짜순', async () => {
  const r = await ctx.call('GET', '/api/earnings?symbols=AAA,BBB');
  assert.deepEqual(r.body.items.map((e) => e.symbol), ['BBB', 'AAA']);
  assert.deepEqual(ctx.finnhub.calls.earnings[0][1], { from: '2026-09-28', to: '2026-12-27' });
});

test('장 상태: 휴장일 조회가 실패해도 시간표로 판정한다', async () => {
  await ctx.close();
  ctx = await start({ finnhub: fakeFinnhub({ holidays: async () => { throw new AppError('UPSTREAM', 'x', 502); } }) });
  const r = await ctx.call('GET', '/api/market-status');
  assert.deepEqual(r.body, { isOpen: true, session: 'regular' });
});

test('환율과 키 상태', async () => {
  assert.deepEqual((await ctx.call('GET', '/api/fx')).body, { rate: 1400, date: '2026-09-25', stale: false });
  assert.deepEqual((await ctx.call('GET', '/api/health')).body, { finnhubKey: 'ok' });
});

test('잘못된 JSON은 400, 없는 API 경로는 404', async () => {
  const bad = await ctx.call('POST', '/api/holdings', undefined, '{oops');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
  assert.equal((await ctx.call('GET', '/api/nothing')).status, 404);
});

test('다른 도메인 이름(Host)으로 들어온 요청은 403 (DNS rebinding 방어)', async () => {
  const get = (host) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: ctx.port, path: '/api/portfolio', headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }));
    });
    req.on('error', reject);
    req.end();
  });
  const evil = await get(`evil.example:${ctx.port}`);
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.code, 'FORBIDDEN_HOST');
  assert.equal((await get(`localhost:${ctx.port}`)).status, 200);
  assert.equal((await get(`127.0.0.1:${ctx.port}`)).status, 200);
});

test('깨진 저장 파일은 500 STORE_CORRUPT', async () => {
  await mkdir(path.dirname(ctx.filePath), { recursive: true });
  await writeFile(ctx.filePath, 'not json', 'utf8');
  const r = await ctx.call('GET', '/api/portfolio');
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'STORE_CORRUPT');
});
