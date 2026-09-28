import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDividends } from '../public/dividends.js';

const holdings = [
  { symbol: 'AAA', shares: 10, avgCost: 100 },                 // 자동 배당 2
  { symbol: 'BBB', shares: 5, avgCost: 50, manualDps: 1 },     // 자동 데이터 없음, 직접 입력 1
  { symbol: 'CCC', shares: 3, avgCost: 20 },                   // 배당 없음(0)
  { symbol: 'DDD', shares: 4, avgCost: 10 },                   // 자동 데이터 없음, 입력도 없음
  { symbol: 'EEE', shares: 2, avgCost: 30, manualDps: 0.5 },   // 자동 3보다 직접 입력 0.5가 우선
];
const dividends = {
  AAA: { annualDps: 2, growth5y: 7 },
  BBB: { annualDps: null, growth5y: null },
  CCC: { annualDps: 0, growth5y: null },
  DDD: { annualDps: null, growth5y: null },
  EEE: { annualDps: 3, growth5y: 4 },
};
const quotes = { AAA: { price: 120 }, BBB: { price: 40 }, CCC: { price: 25 }, DDD: { price: 12 }, EEE: { price: 35 } };

test('종목별 예상 연 배당금과 배당률(시가·매입가)을 계산한다', () => {
  const { rows } = computeDividends(holdings, dividends, quotes);
  const aaa = rows.find((r) => r.symbol === 'AAA');
  assert.deepEqual(aaa, { symbol: 'AAA', shares: 10, dps: 2, source: 'auto', annual: 20, yield: 2 / 120, yieldOnCost: 0.02, growth5y: 7 });
  const bbb = rows.find((r) => r.symbol === 'BBB');
  assert.equal(bbb.source, 'manual');
  assert.equal(bbb.annual, 5);
  assert.equal(bbb.yield, 0.025);
});

test('직접 입력한 값이 자동 값보다 우선한다', () => {
  const eee = computeDividends(holdings, dividends, quotes).rows.find((r) => r.symbol === 'EEE');
  assert.equal(eee.source, 'manual');
  assert.equal(eee.dps, 0.5);
  assert.equal(eee.annual, 1);
});

test('배당 없는 종목은 따로 모으고, 데이터 없는 종목은 입력을 기다리는 행으로 맨 뒤에 둔다', () => {
  const { rows, noneSymbols, missingCount } = computeDividends(holdings, dividends, quotes);
  assert.deepEqual(noneSymbols, ['CCC']);
  assert.equal(missingCount, 1);
  assert.deepEqual(rows.map((r) => r.symbol), ['AAA', 'BBB', 'EEE', 'DDD'], '예상 배당금 큰 순, 데이터 없는 종목은 끝');
  const ddd = rows.at(-1);
  assert.equal(ddd.source, 'missing');
  assert.equal(ddd.annual, null);
});

test('합계: 연·월 배당금, 포트폴리오 배당률(평가금액 대비), 매입가 대비 배당률', () => {
  const { totals } = computeDividends(holdings, dividends, quotes);
  assert.equal(totals.annual, 26);
  assert.equal(totals.monthly, 26 / 12);
  assert.equal(totals.yield, 26 / 1593);       // 평가금액 1200+200+75+48+70
  assert.equal(totals.yieldOnCost, 26 / 1410); // 매입금액 1000+250+60+40+60
});

test('직접 0을 넣으면 배당 없는 종목으로 본다', () => {
  const { noneSymbols } = computeDividends([{ symbol: 'ZZZ', shares: 1, avgCost: 1, manualDps: 0 }], { ZZZ: { annualDps: null } }, {});
  assert.deepEqual(noneSymbols, ['ZZZ']);
});

test('시세나 배당 데이터가 아직 없으면 배당률은 null, 보유 종목이 없으면 합계 0', () => {
  const { rows } = computeDividends([{ symbol: 'AAA', shares: 1, avgCost: 100 }], { AAA: { annualDps: 2 } }, {});
  assert.equal(rows[0].yield, null);
  assert.equal(rows[0].annual, 2);
  const empty = computeDividends([], {}, {});
  assert.deepEqual(empty.totals, { annual: 0, monthly: 0, yield: null, yieldOnCost: null });
  const loading = computeDividends([{ symbol: 'AAA', shares: 1, avgCost: 100 }], {}, {});
  assert.equal(loading.rows[0].source, 'missing');
});
