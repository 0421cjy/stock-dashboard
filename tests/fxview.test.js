import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_USD_KRW, initialFx, parseSavedFx, fxNote } from '../public/fx.js';

test('initialFx: 저장된 값이 있으면 그것을, 없으면 기본값을 확인 중 상태로', () => {
  assert.deepEqual(initialFx(null), { rate: DEFAULT_USD_KRW, date: null, stale: false, pending: true });
  assert.deepEqual(initialFx({ rate: 1391.2, date: '2026-09-25' }), { rate: 1391.2, date: '2026-09-25', stale: false, pending: true });
  assert.equal(initialFx({ rate: 0 }).rate, DEFAULT_USD_KRW);
});

test('parseSavedFx: 형식이 틀리면 null', () => {
  assert.deepEqual(parseSavedFx('{"rate":1391.2,"date":"2026-09-25"}'), { rate: 1391.2, date: '2026-09-25' });
  assert.equal(parseSavedFx(null), null);
  assert.equal(parseSavedFx('garbage'), null);
  assert.equal(parseSavedFx('{"rate":-1}'), null);
});

test('fxNote: 임시값·지난 값·확인된 값·지연', () => {
  assert.equal(fxNote({ rate: 1350, date: null, pending: true }), '기준환율 ₩1,350 (임시값 · 확인 중)');
  assert.equal(fxNote({ rate: 1391.2, date: '2026-09-25', pending: true }), '기준환율 ₩1,391.2 (2026-09-25 · 확인 중)');
  assert.equal(fxNote({ rate: 1391.2, date: '2026-09-25', stale: false }), '기준환율 ₩1,391.2 (2026-09-25)');
  assert.equal(fxNote({ rate: 1391.2, date: '2026-09-25', stale: true }), '기준환율 ₩1,391.2 (2026-09-25 · 지연)');
  assert.equal(fxNote(null), '환율 확인 중');
});
