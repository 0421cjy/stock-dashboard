import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, nextThemePref, normalizeThemePref } from '../public/theme.js';

test('resolveTheme: 라이트·다크를 고르면 그대로, 자동이면 윈도우 설정을 따른다', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('resolveTheme: 저장값이 없거나 이상하면 자동으로 본다', () => {
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme('garbage', false), 'light');
});

test('nextThemePref: 자동 → 라이트 → 다크 → 자동 순서', () => {
  assert.equal(nextThemePref('system'), 'light');
  assert.equal(nextThemePref('light'), 'dark');
  assert.equal(nextThemePref('dark'), 'system');
  assert.equal(nextThemePref('garbage'), 'light', '이상한 값은 자동으로 보고 다음(라이트)으로');
});

test('normalizeThemePref: 알 수 있는 값만 남긴다', () => {
  assert.equal(normalizeThemePref('dark'), 'dark');
  assert.equal(normalizeThemePref(undefined), 'system');
});
