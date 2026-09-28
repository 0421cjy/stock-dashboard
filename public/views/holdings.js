import { h } from './dom.js';
import { formatUsd, formatPct, formatKrwFromUsd, formatShares, pctClass, usdClass } from '../format.js';
import { icon } from '../icons.js';

function iconButton(name, label, className) {
  const btn = h('button', className);
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(name, 15));
  return btn;
}

export function renderHoldings(tbody, rows, { names, fxRate, onEdit, onDelete }) {
  tbody.replaceChildren(...rows.map((r) => {
    const tr = h('tr', r.stale ? 'is-stale' : '');
    tr.append(
      symbolCell(r, names[r.symbol]),
      h('td', 'num', formatShares(r.shares)),
      h('td', 'num', formatUsd(r.avgCost)),
      h('td', 'num', formatUsd(r.price)),
      h('td', `num ${pctClass(r.dayChangePct)}`, formatPct(r.dayChangePct, { sign: true })),
      valueCell(r, fxRate),
      pnlCell(r, fxRate),
      h('td', 'num', formatPct(r.weight)),
      actionsCell(r, onEdit, onDelete),
    );
    return tr;
  }));
}

function symbolCell(r, name) {
  const td = h('td', 'sym');
  td.append(h('strong', null, r.symbol));
  if (r.error || r.stale) {
    const mark = h('span', 'warn-mark');
    mark.append(icon('alert', 14));
    mark.title = r.stale ? '최신 시세를 받지 못해 마지막 값을 보여줍니다.' : r.error.message;
    mark.setAttribute('aria-label', mark.title);
    td.append(mark);
  }
  td.append(h('span', 'name', name ?? ''));
  return td;
}

// 평가금액: 달러 아래 원화
function valueCell(r, fxRate) {
  const td = h('td', 'num');
  td.append(h('div', null, formatUsd(r.marketValue)));
  if (r.hasPrice) td.append(h('div', 'krw', formatKrwFromUsd(r.marketValue, fxRate)));
  return td;
}

// 평가손익: 달러, 원화, 수익률 순서
function pnlCell(r, fxRate) {
  const td = h('td', `num ${usdClass(r.pnl)}`);
  td.append(h('div', null, formatUsd(r.pnl, { sign: true })));
  if (r.hasPrice) td.append(h('div', 'krw', formatKrwFromUsd(r.pnl, fxRate, { sign: true })));
  td.append(h('div', 'sub', formatPct(r.pnlPct, { sign: true })));
  return td;
}

function actionsCell(r, onEdit, onDelete) {
  const td = h('td');
  const box = h('div', 'row-actions');
  const edit = iconButton('pencil', `${r.symbol} 수정`, 'row-edit');
  edit.addEventListener('click', () => onEdit(r));
  const del = iconButton('trash', `${r.symbol} 삭제`, 'row-delete');
  del.addEventListener('click', () => onDelete(r));
  box.append(edit, del);
  td.append(box);
  return td;
}
