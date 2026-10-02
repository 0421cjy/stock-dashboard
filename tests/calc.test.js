import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortfolio, parseAmount, mergeQuotes, sortRows, keepFailed, quoteDelay, applyExtended } from '../public/calc.js';

const holdings = [
  { symbol: 'AAA', shares: 10, avgCost: 100 },
  { symbol: 'BBB', shares: 2.5, avgCost: 40 },
];
const quotes = {
  AAA: { price: 120, prevClose: 110 },
  BBB: { price: 30, prevClose: 32 },
};

test('종목별 평가금액·손익·손익률·오늘 등락을 계산한다', () => {
  const { rows } = computePortfolio(holdings, quotes);
  const [a, b] = rows;
  assert.equal(a.marketValue, 1200);
  assert.equal(a.cost, 1000);
  assert.equal(a.pnl, 200);
  assert.equal(a.pnlPct, 0.2);
  assert.equal(a.dayChange, 100);
  assert.equal(b.marketValue, 75);
  assert.equal(b.pnl, -25);
  assert.equal(b.pnlPct, -0.25);
  assert.equal(b.dayChange, -5);
});

test('합계와 비중을 계산하고 비중 합은 100%다', () => {
  const { rows, totals, excludedCount } = computePortfolio(holdings, quotes);
  assert.equal(totals.marketValue, 1275);
  assert.equal(totals.cost, 1100);
  assert.equal(totals.pnl, 175);
  assert.equal(totals.pnlPct, 175 / 1100);
  assert.equal(totals.dayChange, 95);
  assert.equal(totals.dayChangePct, 95 / 1180);
  assert.equal(excludedCount, 0);
  const weightSum = rows.reduce((s, r) => s + r.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-12);
});

test('가격이 없는 종목은 합계에서 빼고 excludedCount로 센다', () => {
  const { rows, totals, excludedCount } = computePortfolio(
    [...holdings, { symbol: 'CCC', shares: 1, avgCost: 50 }],
    quotes,
  );
  const c = rows[2];
  assert.equal(c.hasPrice, false);
  assert.equal(c.marketValue, null);
  assert.equal(c.weight, null);
  assert.equal(totals.marketValue, 1275);
  assert.equal(totals.cost, 1100);
  assert.equal(excludedCount, 1);
});

test('보유 종목이 없으면 합계는 0이고 비율은 null이다', () => {
  const { rows, totals, excludedCount } = computePortfolio([], {});
  assert.deepEqual(rows, []);
  assert.equal(totals.marketValue, 0);
  assert.equal(totals.pnlPct, null);
  assert.equal(totals.dayChangePct, null);
  assert.equal(excludedCount, 0);
});

test('전일 종가가 없으면 오늘 등락은 0, 등락률은 null이다', () => {
  const { rows } = computePortfolio([{ symbol: 'AAA', shares: 1, avgCost: 1 }], { AAA: { price: 2 } });
  assert.equal(rows[0].dayChange, 0);
  assert.equal(rows[0].dayChangePct, null);
});

test('parseAmount는 쉼표·달러 기호·공백을 허용하고 잘못된 값은 NaN이다', () => {
  assert.equal(parseAmount('1,000'), 1000);
  assert.equal(parseAmount(' $14.20 '), 14.2);
  assert.equal(parseAmount('0.5'), 0.5);
  assert.equal(parseAmount(7), 7);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('-5')));
  assert.ok(Number.isNaN(parseAmount('1.2.3')));
});

test('mergeQuotes는 실패한 종목의 이전 가격을 stale로 유지한다', () => {
  const prev = { AAA: { price: 120, prevClose: 110, stale: false } };
  const err = { code: 'UPSTREAM', message: '연결 실패' };
  const merged = mergeQuotes(prev, {
    AAA: { error: err },
    BBB: { price: 30, prevClose: 32, stale: false },
    CCC: { error: err },
  });
  assert.deepEqual(merged.AAA, { price: 120, prevClose: 110, stale: true, error: err });
  assert.deepEqual(merged.BBB, { price: 30, prevClose: 32, stale: false });
  assert.deepEqual(merged.CCC, { error: err });
});

test('mergeQuotes는 더 이상 없는 종목을 버린다', () => {
  const merged = mergeQuotes({ OLD: { price: 1 } }, { NEW: { price: 2 } });
  assert.deepEqual(Object.keys(merged), ['NEW']);
});

test('quoteDelay: 없는 티커 하나는 전체 지연으로 보지 않는다', () => {
  const ok = { price: 10, stale: false };
  assert.equal(quoteDelay({ A: ok, B: { error: { code: 'NOT_FOUND', message: 'x' } } }), null);
  assert.equal(quoteDelay({ A: ok, B: { price: 9, stale: true } }), '일부 시세가 지연되고 있습니다.');
  assert.equal(quoteDelay({ A: ok, B: { error: { code: 'RATE_LIMITED', message: 'x' } } }), '일부 시세가 지연되고 있습니다.');
  assert.equal(quoteDelay({ A: ok }), null);
});

test('keepFailed는 실패한 종목의 이전 항목을 유지하고 나머지는 새 값으로 바꾼다', () => {
  const prev = [{ symbol: 'A', v: 'old' }, { symbol: 'B', v: 'old' }, { symbol: 'GONE', v: 'old' }];
  const merged = keepFailed(prev, { items: [{ symbol: 'A', v: 'new' }], failed: ['B'] });
  assert.deepEqual(merged, [{ symbol: 'A', v: 'new' }, { symbol: 'B', v: 'old' }]);
});

test('sortRows는 null을 방향과 상관없이 맨 뒤에 둔다', () => {
  const rows = [
    { symbol: 'B', pnl: 10 },
    { symbol: 'A', pnl: null },
    { symbol: 'C', pnl: -5 },
  ];
  assert.deepEqual(sortRows(rows, 'pnl', 'desc').map((r) => r.symbol), ['B', 'C', 'A']);
  assert.deepEqual(sortRows(rows, 'pnl', 'asc').map((r) => r.symbol), ['C', 'B', 'A']);
  assert.deepEqual(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol), ['A', 'B', 'C']);
  assert.deepEqual(rows.map((r) => r.symbol), ['B', 'A', 'C'], '원본 배열은 바꾸지 않는다');
});

test('applyExtended: 프리는 마지막 종가 대비, 애프터는 전일 종가 대비, 없으면 그대로', () => {
  const rows = [
    { symbol: 'A', hasPrice: true, price: 100, prevClose: 90, dayChangePct: 0.111 },
    { symbol: 'B', hasPrice: true, price: 100, prevClose: 90, dayChangePct: 0.111 },
    { symbol: 'C', hasPrice: true, price: 100, prevClose: 90, dayChangePct: 0.111 },
    { symbol: 'D', hasPrice: false, price: null, prevClose: null, dayChangePct: null },
  ];
  const out = applyExtended(rows, {
    A: { session: 'pre', price: 102 },
    B: { session: 'post', price: 99 },
    D: { session: 'pre', price: 5 },
  });
  assert.equal(out[0].session, 'pre');
  assert.ok(Math.abs(out[0].dayChangePct - 0.02) < 1e-12);
  assert.equal(out[1].session, 'post');
  assert.ok(Math.abs(out[1].dayChangePct - 0.1) < 1e-12);
  assert.equal(out[2], rows[2]);
  assert.equal(out[3], rows[3]);
});
