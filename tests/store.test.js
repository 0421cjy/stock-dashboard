import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, normalizeSymbol, validateEvent } from '../server/store.js';

let filePath;
let store;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'stock-store-'));
  filePath = path.join(dir, 'data', 'portfolio.json');
  let n = 0;
  store = createStore({ filePath, idGen: () => `e_${++n}` });
});

test('파일이 없으면 빈 포트폴리오를 돌려준다', async () => {
  assert.deepEqual(await store.read(), { version: 1, holdings: [], events: [] });
});

test('종목을 저장하고 다시 읽으면 같다', async () => {
  await store.addHolding({ symbol: 'SOFI', shares: 500, avgCost: 14.2 });
  const again = createStore({ filePath });
  assert.deepEqual((await again.read()).holdings, [{ symbol: 'SOFI', shares: 500, avgCost: 14.2 }]);
});

test('티커는 공백을 지우고 대문자로 저장하며, 정규화 후 중복을 막는다', async () => {
  const h = await store.addHolding({ symbol: ' sofi ', shares: 1, avgCost: 1 });
  assert.equal(h.symbol, 'SOFI');
  await assert.rejects(store.addHolding({ symbol: 'Sofi', shares: 2, avgCost: 2 }), { code: 'DUPLICATE', status: 409 });
});

test('점이 들어간 티커(BRK.B)를 허용한다', () => {
  assert.equal(normalizeSymbol('brk.b'), 'BRK.B');
  assert.throws(() => normalizeSymbol('AB CD'), { code: 'VALIDATION' });
  assert.throws(() => normalizeSymbol(''), { code: 'VALIDATION' });
  assert.throws(() => normalizeSymbol('ABCDEFGHIJK'), { code: 'VALIDATION' });
});

test('수량·평단가는 0보다 큰 숫자여야 한다(소수 허용)', async () => {
  await store.addHolding({ symbol: 'A', shares: 0.25, avgCost: 10 });
  for (const bad of [0, -1, NaN, Infinity, '10', null]) {
    await assert.rejects(store.addHolding({ symbol: 'B', shares: bad, avgCost: 10 }), { code: 'VALIDATION' });
    await assert.rejects(store.addHolding({ symbol: 'B', shares: 1, avgCost: bad }), { code: 'VALIDATION' });
  }
});

test('종목 수정과 삭제, 없는 종목은 NOT_FOUND', async () => {
  await store.addHolding({ symbol: 'AAPL', shares: 1, avgCost: 100 });
  const h = await store.updateHolding('aapl', { shares: 3, avgCost: 150 });
  assert.deepEqual(h, { symbol: 'AAPL', shares: 3, avgCost: 150 });
  await store.removeHolding('AAPL');
  assert.deepEqual((await store.read()).holdings, []);
  await assert.rejects(store.removeHolding('AAPL'), { code: 'NOT_FOUND', status: 404 });
  await assert.rejects(store.updateHolding('MSFT', { shares: 1, avgCost: 1 }), { code: 'NOT_FOUND' });
});

test('빠르게 연속으로 추가해도 모두 저장된다', async () => {
  await Promise.all([
    store.addHolding({ symbol: 'A', shares: 1, avgCost: 1 }),
    store.addHolding({ symbol: 'B', shares: 1, avgCost: 1 }),
    store.addHolding({ symbol: 'C', shares: 1, avgCost: 1 }),
  ]);
  const saved = JSON.parse(await readFile(filePath, 'utf8'));
  assert.deepEqual(saved.holdings.map((h) => h.symbol).sort(), ['A', 'B', 'C']);
});

test('일정 추가·수정·삭제', async () => {
  const ev = await store.addEvent({ title: ' FOMC ', date: '2026-10-28' });
  assert.deepEqual(ev, { id: 'e_1', title: 'FOMC', date: '2026-10-28', note: '' });
  const up = await store.updateEvent('e_1', { title: 'FOMC 금리 결정', date: '2026-10-29', note: '밤 3시' });
  assert.equal(up.note, '밤 3시');
  await store.removeEvent('e_1');
  assert.deepEqual((await store.read()).events, []);
  await assert.rejects(store.removeEvent('e_1'), { code: 'NOT_FOUND' });
});

test('일정 검증: 제목 1~60자, 실제 존재하는 날짜, 메모 200자 이하', () => {
  assert.throws(() => validateEvent({ title: '', date: '2026-10-28' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'x'.repeat(61), date: '2026-10-28' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '2026-02-30' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '10/28/2026' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '2026-10-28', note: 'x'.repeat(201) }), { code: 'VALIDATION' });
});

test('깨진 파일은 덮어쓰지 않고 모든 요청을 거부한다', async () => {
  await store.addHolding({ symbol: 'A', shares: 1, avgCost: 1 });
  await writeFile(filePath, '{ not json', 'utf8');
  await assert.rejects(store.read(), { code: 'STORE_CORRUPT' });
  await assert.rejects(store.addHolding({ symbol: 'B', shares: 1, avgCost: 1 }), { code: 'STORE_CORRUPT' });
  assert.equal(await readFile(filePath, 'utf8'), '{ not json');
});

test('setManualDps: 1주당 연 배당을 직접 저장하고, null이면 지운다', async () => {
  await store.addHolding({ symbol: 'VOO', shares: 6, avgCost: 500 });
  assert.deepEqual(await store.setManualDps('voo', 6.8), { symbol: 'VOO', shares: 6, avgCost: 500, manualDps: 6.8 });
  assert.deepEqual(await store.setManualDps('VOO', 0), { symbol: 'VOO', shares: 6, avgCost: 500, manualDps: 0 });
  assert.deepEqual(await store.setManualDps('VOO', null), { symbol: 'VOO', shares: 6, avgCost: 500 });
  assert.deepEqual((await store.read()).holdings, [{ symbol: 'VOO', shares: 6, avgCost: 500 }]);
});

test('setManualDps: 음수·숫자 아님은 거부, 없는 종목은 NOT_FOUND', async () => {
  await store.addHolding({ symbol: 'VOO', shares: 6, avgCost: 500 });
  for (const bad of [-1, NaN, Infinity, '6.8']) {
    await assert.rejects(store.setManualDps('VOO', bad), { code: 'VALIDATION' });
  }
  await assert.rejects(store.setManualDps('QQQ', 1), { code: 'NOT_FOUND' });
});

test('수량·평단가를 수정해도 직접 넣은 배당은 남는다', async () => {
  await store.addHolding({ symbol: 'VOO', shares: 6, avgCost: 500 });
  await store.setManualDps('VOO', 6.8);
  assert.equal((await store.updateHolding('VOO', { shares: 7, avgCost: 510 })).manualDps, 6.8);
});
