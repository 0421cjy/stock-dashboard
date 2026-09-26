import { h } from './dom.js';
import { formatUsd, formatPct, formatKrw, signClass } from '../format.js';

export function renderSummary(el, { totals, excludedCount, fx, stale }) {
  const krw = fx
    ? `≈ ${formatKrw(totals.marketValue * fx.rate)} (기준환율 ${fx.date}${fx.stale ? ' · 지연' : ''})`
    : '원화 환산: 환율 확인 중';
  el.replaceChildren(
    tile('총 평가금액', formatUsd(totals.marketValue), krw, 'flat'),
    tile(
      '총 평가손익',
      `${formatUsd(totals.pnl, { sign: true })} (${formatPct(totals.pnlPct, { sign: true })})`,
      `매입금액 ${formatUsd(totals.cost)}`,
      signClass(totals.pnl),
    ),
    tile(
      '오늘 등락',
      `${formatUsd(totals.dayChange, { sign: true })} (${formatPct(totals.dayChangePct, { sign: true })})`,
      excludedCount ? `${excludedCount}개 종목 제외 (시세 없음)` : '',
      signClass(totals.dayChange),
    ),
  );
  el.classList.toggle('is-stale', stale);
}

function tile(label, value, sub, cls) {
  const box = h('div', 'tile');
  box.append(h('div', 'tile-label', label), h('div', `tile-value ${cls}`, value));
  if (sub) box.append(h('div', 'tile-sub', sub));
  return box;
}
