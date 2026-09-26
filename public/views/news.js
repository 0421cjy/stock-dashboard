import { h } from './dom.js';
import { relativeTime, isHttpUrl } from '../format.js';

export function renderNews(listEl, selectEl, items, { filter, symbols, failed }) {
  syncFilter(selectEl, symbols, filter);
  const shown = filter ? items.filter((n) => n.symbol === filter) : items;
  const rows = shown.map((n) => {
    const li = h('li');
    li.append(h('div', 'news-meta', `${n.symbol} · ${n.source || '출처 미상'} · ${relativeTime(n.datetime)}`));
    if (isHttpUrl(n.url)) {
      const a = h('a', null, n.headline);
      a.href = n.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(a);
    } else {
      li.append(h('div', null, n.headline));
    }
    return li;
  });
  if (!rows.length) rows.push(h('li', 'empty', symbols.length ? '최근 7일 뉴스가 없습니다.' : '종목을 추가하면 뉴스가 보입니다.'));
  if (failed?.length) rows.push(h('li', 'empty', `뉴스를 가져오지 못한 종목: ${failed.join(', ')}`));
  listEl.replaceChildren(...rows);
}

function syncFilter(selectEl, symbols, filter) {
  const wanted = ['', ...symbols].join(',');
  if (selectEl.dataset.options !== wanted) {
    selectEl.replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: '전체' }),
      ...symbols.map((s) => Object.assign(document.createElement('option'), { value: s, textContent: s })),
    );
    selectEl.dataset.options = wanted;
  }
  selectEl.value = symbols.includes(filter) ? filter : '';
}
