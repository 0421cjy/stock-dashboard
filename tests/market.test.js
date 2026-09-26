import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketStatus } from '../server/market.js';

const at = (iso, holidays) => computeMarketStatus(new Date(iso), holidays);

test('평일 장중·장전·장후·야간 (서머타임 기간, 뉴욕 = UTC-4)', () => {
  assert.deepEqual(at('2026-09-28T14:00:00Z'), { isOpen: true, session: 'regular' }); // 10:00
  assert.deepEqual(at('2026-09-28T13:00:00Z'), { isOpen: false, session: 'pre' });    // 09:00
  assert.deepEqual(at('2026-09-28T20:30:00Z'), { isOpen: false, session: 'post' });   // 16:30
  assert.deepEqual(at('2026-09-29T01:00:00Z'), { isOpen: false, session: 'closed' }); // 21:00
});

test('주말은 닫혀 있다', () => {
  assert.deepEqual(at('2026-09-26T15:00:00Z'), { isOpen: false, session: 'closed' }); // 토요일
});

test('서머타임 종료 후(뉴욕 = UTC-5)', () => {
  assert.deepEqual(at('2026-11-02T14:45:00Z'), { isOpen: true, session: 'regular' }); // 09:45 EST
  assert.deepEqual(at('2026-11-02T14:15:00Z'), { isOpen: false, session: 'pre' });    // 09:15 EST
});

test('서머타임 시작 직후', () => {
  assert.deepEqual(at('2026-03-09T13:45:00Z'), { isOpen: true, session: 'regular' }); // 09:45 EDT
});

test('종일 휴장일과 조기 폐장일', () => {
  const holidays = [
    { date: '2026-11-26', tradingHour: '' },
    { date: '2026-11-27', tradingHour: '09:30-13:00' },
  ];
  assert.deepEqual(at('2026-11-26T15:00:00Z', holidays), { isOpen: false, session: 'closed' });
  assert.deepEqual(at('2026-11-27T17:30:00Z', holidays), { isOpen: true, session: 'regular' }); // 12:30 EST
  assert.deepEqual(at('2026-11-27T18:30:00Z', holidays), { isOpen: false, session: 'post' });   // 13:30 EST
});
