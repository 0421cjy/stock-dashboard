import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBadge } from '../public/status.js';

const at = new Date(2026, 8, 28, 14, 32, 5); // 로컬 14:32:05

test('statusBadge: 장중이면 LIVE와 마지막 갱신 시각', () => {
  assert.deepEqual(statusBadge({ market: { isOpen: true }, lastQuoteAt: at, quoteProblem: null }), { tone: 'live', label: 'LIVE · 14:32:05' });
  assert.deepEqual(statusBadge({ market: { isOpen: true }, lastQuoteAt: null, quoteProblem: null }), { tone: 'live', label: 'LIVE' });
});

test('statusBadge: 장 마감이면 회색 단계', () => {
  assert.deepEqual(statusBadge({ market: { isOpen: false }, lastQuoteAt: at, quoteProblem: null }), { tone: 'closed', label: '장 마감 · 14:32:05' });
  assert.deepEqual(statusBadge({ market: { isOpen: false }, lastQuoteAt: null, quoteProblem: null }), { tone: 'closed', label: '장 마감' });
});

test('statusBadge: 프리마켓·애프터마켓이면 그 이름으로(회색 단계)', () => {
  assert.deepEqual(statusBadge({ market: { isOpen: false, session: 'pre' }, lastQuoteAt: at, quoteProblem: null }), { tone: 'closed', label: '프리마켓 · 14:32:05' });
  assert.deepEqual(statusBadge({ market: { isOpen: false, session: 'post' }, lastQuoteAt: null, quoteProblem: null }), { tone: 'closed', label: '애프터마켓' });
});

test('statusBadge: 시세가 지연되면 장 상태보다 먼저 지연을 알린다', () => {
  assert.deepEqual(statusBadge({ market: { isOpen: true }, lastQuoteAt: at, quoteProblem: '지연' }), { tone: 'delayed', label: '지연 · 14:32:05' });
});

test('statusBadge: 장 상태를 아직 모르면 확인 중', () => {
  assert.deepEqual(statusBadge({ market: null, lastQuoteAt: null, quoteProblem: null }), { tone: 'loading', label: '장 상태 확인 중' });
});
