import { h } from './dom.js';
import { formatUsd, formatPct, formatShares, signClass } from '../format.js';

export function renderHoldings(tbody, rows, { names, onEdit, onDelete }) {
  tbody.replaceChildren(...rows.map((r) => {
    const tr = h('tr', r.stale ? 'is-stale' : '');
    tr.append(
      symbolCell(r, names[r.symbol]),
      h('td', 'num', formatShares(r.shares)),
      h('td', 'num', formatUsd(r.avgCost)),
      h('td', 'num', formatUsd(r.price)),
      h('td', `num ${signClass(r.dayChangePct)}`, formatPct(r.dayChangePct, { sign: true })),
      h('td', 'num', formatUsd(r.marketValue)),
      pnlCell(r),
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
    const mark = h('span', 'warn-mark', '⚠');
    mark.title = r.stale ? '최신 시세를 받지 못해 마지막 값을 보여줍니다.' : r.error.message;
    td.append(mark);
  }
  td.append(h('span', 'name', name ?? ''));
  return td;
}

function pnlCell(r) {
  const td = h('td', `num ${signClass(r.pnl)}`);
  td.append(h('div', null, formatUsd(r.pnl, { sign: true })), h('div', 'sub', formatPct(r.pnlPct, { sign: true })));
  return td;
}

function actionsCell(r, onEdit, onDelete) {
  const td = h('td');
  const box = h('div', 'row-actions');
  const edit = h('button', null, '수정');
  edit.type = 'button';
  edit.addEventListener('click', () => onEdit(r));
  const del = h('button', null, '삭제');
  del.type = 'button';
  del.addEventListener('click', () => onDelete(r));
  box.append(edit, del);
  td.append(box);
  return td;
}
