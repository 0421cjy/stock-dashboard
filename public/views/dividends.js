import { h } from './dom.js';
import { formatUsd, formatPct, formatKrwFromUsd } from '../format.js';
import { icon } from '../icons.js';

// 배당금 카드: 요약(연·월 배당금, 배당률) + 종목별 표 + 배당 없는 종목 한 줄.
export function renderDividends({ summaryEl, bodyEl, footEl }, result, { fxRate, hasHoldings, onEdit }) {
  const { rows, noneSymbols, missingCount, totals } = result;

  summaryEl.replaceChildren(
    stat('연간 예상 배당금', formatUsd(totals.annual), formatKrwFromUsd(totals.annual, fxRate)),
    stat('월평균', formatUsd(totals.monthly), formatKrwFromUsd(totals.monthly, fxRate)),
    stat('포트폴리오 배당률', formatPct(totals.yield, { digits: 2 }), '평가금액 대비'),
    stat('매입가 대비 배당률', formatPct(totals.yieldOnCost, { digits: 2 }), '매입금액 대비'),
  );

  bodyEl.replaceChildren(...rows.map((r) => (r.source === 'missing' ? missingRow(r, onEdit) : payingRow(r, fxRate, onEdit))));

  const notes = [];
  if (!hasHoldings) notes.push('종목을 추가하면 예상 배당금이 보입니다.');
  if (noneSymbols.length) notes.push(`배당 없음: ${noneSymbols.join(', ')}`);
  if (missingCount) notes.push(`자동 데이터가 없는 ${missingCount}개 종목은 직접 입력해야 합계에 들어갑니다.`);
  footEl.hidden = !notes.length;
  footEl.textContent = notes.join(' · ');
}

function stat(label, value, sub) {
  const box = h('div', 'div-stat');
  box.append(h('div', 'div-stat-label', label), h('div', 'div-stat-value', value), h('div', 'div-stat-sub', sub));
  return box;
}

function payingRow(r, fxRate, onEdit) {
  const tr = h('tr');
  const dps = h('td', 'num', formatUsd(r.dps));
  if (r.source === 'manual') dps.prepend(h('span', 'src-tag', '직접'), ' ');
  const annual = h('td', 'num');
  annual.append(h('div', null, formatUsd(r.annual)), h('div', 'krw', formatKrwFromUsd(r.annual, fxRate)));
  tr.append(
    h('td', 'sym', r.symbol),
    dps,
    annual,
    h('td', 'num', formatPct(r.yield, { digits: 2 })),
    h('td', 'num', formatPct(r.yieldOnCost, { digits: 2 })),
    h('td', 'num', r.growth5y == null ? '—' : formatPct(r.growth5y / 100, { sign: true })),
    editCell(r, onEdit, `${r.symbol} 배당 직접 입력`),
  );
  tr.cells[0].classList.add('strong');
  return tr;
}

function missingRow(r, onEdit) {
  const tr = h('tr', 'is-missing');
  const td = h('td', 'missing-note');
  td.colSpan = 5;
  td.textContent = '자동 배당 데이터 없음 (ETF 등)';
  const action = h('td');
  const btn = h('button', 'dps-input-btn', '직접 입력');
  btn.type = 'button';
  btn.addEventListener('click', () => onEdit(r));
  action.append(btn);
  tr.append(h('td', 'sym strong', r.symbol), td, action);
  return tr;
}

function editCell(r, onEdit, label) {
  const td = h('td');
  const box = h('div', 'row-actions');
  const btn = h('button');
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon('pencil', 15));
  btn.addEventListener('click', () => onEdit(r));
  box.append(btn);
  td.append(box);
  return td;
}
