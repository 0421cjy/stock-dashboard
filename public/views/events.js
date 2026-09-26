import { h } from './dom.js';
import { ddayTone } from '../dday.js';

export function renderDday(listEl, items, { onEdit }) {
  if (!items.length) {
    listEl.replaceChildren(h('li', 'empty', '앞으로 90일 안에 일정이 없습니다.'));
    return;
  }
  listEl.replaceChildren(...items.map((item) => {
    const li = h('li');
    const badge = h('div', `dday-badge tone-${ddayTone(item.days)}`, item.label);
    const body = h('div');
    body.append(h('div', 'dday-title', item.title));
    for (const line of detailLines(item)) body.append(h('div', 'dday-detail', line));
    if (item.kind === 'event') {
      const edit = h('button', 'dday-edit', '수정');
      edit.type = 'button';
      edit.addEventListener('click', () => onEdit(item));
      body.append(edit);
    }
    li.append(badge, body);
    return li;
  }));
}

function detailLines(item) {
  if (item.kind === 'earnings') {
    const eps = item.epsEstimate != null ? `예상 EPS $${item.epsEstimate.toFixed(2)}` : '예상 EPS 미정';
    return [
      `${item.date} (미국) · ${item.session ?? '시간 미정'} · ${eps}`,
      ...(item.koreaHint ? [item.koreaHint] : []),
    ];
  }
  return [item.date, ...(item.note ? [item.note] : [])];
}
