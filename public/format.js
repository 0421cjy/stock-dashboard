// 화면 표시용 형식 함수. 모두 순수 함수.

const MINUS = '−';
const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatUsd(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.005) return usdFmt.format(0);
  const body = usdFmt.format(Math.abs(n));
  if (n < 0) return MINUS + body;
  return sign ? `+${body}` : body;
}

export function formatPct(ratio, { sign = false } = {}) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  if (Math.abs(pct) < 0.05) return '0.0%';
  const body = `${Math.abs(pct).toFixed(1)}%`;
  if (pct < 0) return MINUS + body;
  return sign ? `+${body}` : body;
}

export function formatKrw(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₩${Math.round(n).toLocaleString('en-US')}`;
}

export function formatShares(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

// 로컬 시각을 HH:MM:SS로. 브라우저 언어 설정에 따라 "7시 39분"처럼 바뀌지 않게 직접 만든다.
export function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// 한국식 색: 상승 up(빨강), 하락 down(파랑)
export function signClass(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function relativeTime(ms, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
