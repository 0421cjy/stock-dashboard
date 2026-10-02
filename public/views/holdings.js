import { h } from './dom.js';
import { formatUsd, formatPct, formatKrwFromUsd, formatShares, pctClass, usdClass } from '../format.js';
import { icon } from '../icons.js';
import { SESSION_LABEL } from '../status.js';

function iconButton(name, label, className) {
  const btn = h('button', className);
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(name, 15));
  return btn;
}

export function renderHoldings(tbody, rows, { names, fxRate, extended = {}, onEdit, onDelete }) {
  tbody.replaceChildren(...rows.map((r) => {
    const tr = h('tr', r.stale ? 'is-stale' : '');
    tr.append(
      symbolCell(r, names[r.symbol]),
      h('td', 'num', formatShares(r.shares)),
      h('td', 'num', formatUsd(r.avgCost)),
      priceCell(r, extended[r.symbol]),
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

const SHORT_LABEL = { pre: '프리', post: '애프터' };

// 현재가(정규장). 프리마켓·애프터마켓이면 그 가격과 정규장 종가 대비 등락을 아래에 작게.
function priceCell(r, ext) {
  const td = h('td', 'num');
  td.append(h('div', null, formatUsd(r.price)));
  if (ext) {
    const label = SESSION_LABEL[ext.session];
    const line = h('div', 'sub ext', `${SHORT_LABEL[ext.session]} ${formatUsd(ext.price)} `);
    line.append(h('span', pctClass(ext.changeRatio), formatPct(ext.changeRatio, { sign: true })));
    line.title = `${label} 마지막 체결가 · 정규장 종가 대비 (평가금액은 정규장 가격 기준)`;
    td.append(line);
  }
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
