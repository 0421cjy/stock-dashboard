import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUsd, formatPct, formatKrw, formatKrwFromUsd, formatShares, formatClock, signClass, pctClass, usdClass, relativeTime, isHttpUrl,
} from '../public/format.js';

test('formatUsd는 두 자리 소수와 부호를 붙인다', () => {
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(-25), '−$25.00');
  assert.equal(formatUsd(175, { sign: true }), '+$175.00');
  assert.equal(formatUsd(-0.001, { sign: true }), '$0.00');
  assert.equal(formatUsd(null), '—');
});

test('formatPct는 비율을 소수 첫째 자리 퍼센트로 바꾼다', () => {
  assert.equal(formatPct(0.132, { sign: true }), '+13.2%');
  assert.equal(formatPct(-0.008), '−0.8%');
  assert.equal(formatPct(0.0004, { sign: true }), '0.0%');
  assert.equal(formatPct(null), '—');
});

test('formatKrw와 formatShares', () => {
  assert.equal(formatKrw(72_100_000.4), '₩72,100,000');
  assert.equal(formatShares(2.5), '2.5');
  assert.equal(formatShares(1000), '1,000');
});

test('signClass는 한국식 색 클래스를 고른다', () => {
  assert.equal(signClass(3), 'up');
  assert.equal(signClass(-3), 'down');
  assert.equal(signClass(0), 'flat');
  assert.equal(signClass(null), 'flat');
});

test('relativeTime', () => {
  const now = 10 * 86_400_000;
  assert.equal(relativeTime(now - 30_000, now), '방금 전');
  assert.equal(relativeTime(now - 5 * 60_000, now), '5분 전');
  assert.equal(relativeTime(now - 2 * 3_600_000, now), '2시간 전');
  assert.equal(relativeTime(now - 3 * 86_400_000, now), '3일 전');
});

test('formatClock은 로컬 시각을 HH:MM:SS로 보여준다', () => {
  assert.equal(formatClock(new Date(2026, 8, 27, 7, 39, 59)), '07:39:59');
  assert.equal(formatClock(new Date(2026, 8, 27, 14, 5, 0)), '14:05:00');
  assert.equal(formatClock(new Date(2026, 8, 27, 0, 0, 1)), '00:00:01');
});

test('isHttpUrl은 http/https만 허용한다', () => {
  assert.equal(isHttpUrl('https://example.com/a'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('not a url'), false);
});

test('formatKrwFromUsd: 달러 × 환율을 원화로, 부호와 환율 없음 처리', () => {
  assert.equal(formatKrwFromUsd(100, 1400), '₩140,000');
  assert.equal(formatKrwFromUsd(100, 1400, { sign: true }), '+₩140,000');
  assert.equal(formatKrwFromUsd(-25, 1400, { sign: true }), '−₩35,000');
  assert.equal(formatKrwFromUsd(0.0001, 1400, { sign: true }), '₩0');
  assert.equal(formatKrwFromUsd(100, null), '₩ —');
  assert.equal(formatKrwFromUsd(null, 1400), '₩ —');
});

test('formatPct: digits 옵션으로 소수 자릿수를 정한다(배당률처럼 작은 값)', () => {
  assert.equal(formatPct(0.00017, { digits: 2 }), '0.02%');
  assert.equal(formatPct(0.0079485, { digits: 2 }), '0.79%');
  assert.equal(formatPct(0.00004, { digits: 2 }), '0.00%');
  assert.equal(formatPct(0.102, { sign: true, digits: 2 }), '+10.20%');
  assert.equal(formatPct(0.00017), '0.0%', '기본은 그대로 소수 첫째 자리');
});

test('pctClass: 화면에서 0.0%로 보이는 값은 색을 칠하지 않는다', () => {
  assert.equal(pctClass(0.0004), 'flat');   // 0.0%
  assert.equal(pctClass(-0.0004), 'flat');  // 0.0%
  assert.equal(pctClass(0.0006), 'up');     // +0.1%
  assert.equal(pctClass(-0.0006), 'down');  // −0.1%
  assert.equal(pctClass(0.00004, 2), 'flat'); // 소수 둘째 자리 표시에서 0.00%
  assert.equal(pctClass(0.00006, 2), 'up');   // +0.01%
  assert.equal(pctClass(null), 'flat');
});

test('usdClass: 화면에서 $0.00으로 보이는 금액은 색을 칠하지 않는다', () => {
  assert.equal(usdClass(0.004), 'flat');
  assert.equal(usdClass(-0.003), 'flat');
  assert.equal(usdClass(0.006), 'up');
  assert.equal(usdClass(-25), 'down');
  assert.equal(usdClass(null), 'flat');
});
