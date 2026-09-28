// 테마 선택(자동/라이트/다크)과 실제 적용 테마를 정하는 순수 함수.
export const THEME_PREFS = ['system', 'light', 'dark'];

export const THEME_LABEL = {
  system: '테마: 자동(윈도우 설정)',
  light: '테마: 라이트',
  dark: '테마: 다크',
};

export function normalizeThemePref(pref) {
  return THEME_PREFS.includes(pref) ? pref : 'system';
}

// 실제로 적용할 테마: 라이트·다크를 골랐으면 그대로, 자동이면 윈도우 설정을 따른다.
export function resolveTheme(pref, systemDark) {
  const p = normalizeThemePref(pref);
  if (p === 'system') return systemDark ? 'dark' : 'light';
  return p;
}

// 버튼을 누를 때마다 자동 → 라이트 → 다크 → 자동
export function nextThemePref(pref) {
  const i = THEME_PREFS.indexOf(normalizeThemePref(pref));
  return THEME_PREFS[(i + 1) % THEME_PREFS.length];
}
