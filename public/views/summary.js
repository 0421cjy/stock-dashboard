import { h } from './dom.js';
import { formatUsd, formatPct, formatKrwFromUsd, usdClass } from '../format.js';

export function renderSummary(el, { totals, excludedCount, fx, stale, loading = false }) {
  // 첫 시세를 받기 전에는 $0.00 대신 '불러오는 중'을 보여준다
  if (loading) {
    el.replaceChildren(
      ...['총 평가금액', '총 평가손익', '오늘 등락'].map((label) => tile({ label, amount: '—', krw: '', sub: '시세 불러오는 중…', cls: 'flat' })),
    );
    el.classList.remove('is-stale');
    return;
  }
  const rate = fx?.rate;
  const fxNote = fx ? `기준환율 ₩${fx.rate.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${fx.date}${fx.stale ? ' · 지연' : ''})` : '환율 확인 중';
  el.replaceChildren(
    tile({
      label: '총 평가금액',
      amount: formatUsd(totals.marketValue),
      krw: `≈ ${formatKrwFromUsd(totals.marketValue, rate)}`,
      sub: fxNote,
      cls: 'flat',
    }),
    tile({
      label: '총 평가손익',
      amount: formatUsd(totals.pnl, { sign: true }),
      pct: formatPct(totals.pnlPct, { sign: true }),
      krw: formatKrwFromUsd(totals.pnl, rate, { sign: true }),
      sub: `매입금액 ${formatUsd(totals.cost)} (${formatKrwFromUsd(totals.cost, rate)})`,
      cls: usdClass(totals.pnl),
    }),
    tile({
      label: '오늘 등락',
      amount: formatUsd(totals.dayChange, { sign: true }),
      pct: formatPct(totals.dayChangePct, { sign: true }),
      krw: formatKrwFromUsd(totals.dayChange, rate, { sign: true }),
      sub: excludedCount ? `${excludedCount}개 종목 제외 (시세 없음)` : '',
      cls: usdClass(totals.dayChange),
    }),
  );
  el.classList.toggle('is-stale', stale);
}

// 금액은 크게 한 줄로(퍼센트는 옆에 작게), 그 아래 원화, 맨 아래 보조 설명.
function tile({ label, amount, pct, krw, sub, cls }) {
  const box = h('div', 'tile');
  const value = h('div', `tile-value ${cls}`, amount);
  if (pct) value.append(h('span', 'tile-pct', pct));
  box.append(h('div', 'tile-label', label), value, h('div', `tile-krw ${cls}`, krw));
  if (sub) box.append(h('div', 'tile-sub', sub));
  return box;
}
