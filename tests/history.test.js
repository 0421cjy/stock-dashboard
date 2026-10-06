import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHistoryStore, holdingsResolver, buildSeries, fxResolver, lateListed } from '../server/history.js';
import { parseHistory } from '../server/extended.js';

test('기록: 날짜별 보유 종목을 저장하고 다시 켜도 읽는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hist-'));
  const filePath = path.join(dir, 'history.json');
  try {
    const a = createHistoryStore({ filePath });
    await a.record('2026-10-05', [{ symbol: 'MSFT', shares: 2, avgCost: 1 }, { symbol: 'AAPL', shares: 1, avgCost: 1 }]);
    await a.record('2026-10-06', [{ symbol: 'AAPL', shares: 3, avgCost: 1 }]);
    const b = createHistoryStore({ filePath });
    assert.deepEqual(b.snapshots(), [
      { date: '2026-10-05', holdings: [{ symbol: 'AAPL', shares: 1 }, { symbol: 'MSFT', shares: 2 }] },
      { date: '2026-10-06', holdings: [{ symbol: 'AAPL', shares: 3 }] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('holdingsResolver: 그날 또는 직전 기록일 보유, 첫 기록 이전은 지금 보유로 추정', () => {
  const resolve = holdingsResolver(
    [{ date: '2026-10-05', holdings: [{ symbol: 'A', shares: 1 }] }, { date: '2026-10-08', holdings: [{ symbol: 'A', shares: 5 }] }],
    [{ symbol: 'A', shares: 9 }],
  );
  assert.deepEqual(resolve('2026-10-01'), { holdings: [{ symbol: 'A', shares: 9 }], estimated: true });
  assert.deepEqual(resolve('2026-10-05'), { holdings: [{ symbol: 'A', shares: 1 }], estimated: false });
  assert.deepEqual(resolve('2026-10-07'), { holdings: [{ symbol: 'A', shares: 1 }], estimated: false });
  assert.deepEqual(resolve('2026-10-09'), { holdings: [{ symbol: 'A', shares: 5 }], estimated: false });
});

test('buildSeries: 시점별 수량 × 가격, 빠진 가격은 직전 값으로, 첫 가격 전 시점은 건너뛴다', () => {
  const bars = {
    A: [{ t: 1, date: 'd1', close: 10 }, { t: 2, date: 'd1', close: 11 }, { t: 3, date: 'd2', close: 12 }],
    B: [{ t: 2, date: 'd1', close: 100 }],
  };
  const resolve = (date) => ({ holdings: [{ symbol: 'A', shares: date === 'd2' ? 2 : 1 }, { symbol: 'B', shares: 1 }], estimated: date === 'd1' });
  assert.deepEqual(buildSeries(bars, resolve), [
    { t: 2, date: 'd1', value: 111, estimated: true },
    { t: 3, date: 'd2', value: 124, estimated: false },
  ]);
});

test('fxResolver: 그날 또는 직전 고시 환율, 마지막 고시일 뒤는 지금 환율', () => {
  const fx = fxResolver({ '2026-10-02': 1350, '2026-10-05': 1360 }, 1370);
  assert.equal(fx('2026-10-01'), 1350);
  assert.equal(fx('2026-10-03'), 1350);
  assert.equal(fx('2026-10-05'), 1360);
  assert.equal(fx('2026-10-06'), 1370);
  assert.equal(fxResolver({}, 1370)('2026-10-06'), 1370);
});

test('parseHistory: 빈 가격은 빼고 뉴욕 날짜를 붙인다', () => {
  const data = { chart: { result: [{
    meta: { chartPreviousClose: 99 },
    timestamp: [1_790_947_800, 1_790_948_100],
    indicators: { quote: [{ close: [100, null] }] },
  }] } };
  assert.deepEqual(parseHistory(data), { previousClose: 99, bars: [{ t: 1_790_947_800_000, date: '2026-10-02', close: 100 }] });
});

test('buildSeries: 기간 중 상장한 종목은 상장 전을 0으로 계산해 기간 전체를 그린다', () => {
  const bars = {
    A: [1, 2, 3, 4].map((t) => ({ t, date: `d${t}`, close: 10 })),
    NEW: [{ t: 4, date: 'd4', close: 100 }],
  };
  const resolve = () => ({ holdings: [{ symbol: 'A', shares: 1 }, { symbol: 'NEW', shares: 1 }], estimated: true });
  assert.deepEqual(buildSeries(bars, resolve).map((p) => p.value), [10, 10, 10, 110]);
  assert.deepEqual(lateListed(bars), { NEW: 'd4' });
});
