import { api } from './api.js';
import { computePortfolio, mergeQuotes, sortRows, keepFailed, quoteDelay } from './calc.js';
import { statusBadge } from './status.js';
import { icon } from './icons.js';
import { normalizeThemePref, nextThemePref, THEME_LABEL, normalizeUpDown, toggleUpDown, UPDOWN_LABEL } from './theme.js';
import { renderSummary } from './views/summary.js';
import { renderHoldings } from './views/holdings.js';

const QUOTE_MS = 30_000;
const MARKET_MS = 60_000;
const SLOW_MS = 30 * 60_000;
const SLOW_RETRY_MS = 60_000;
const TOAST_MS = 5_000;
let slowRetryTimer = null;

const KEY_HELP = {
  missing: 'Finnhub API 키가 없습니다. finnhub.io에서 무료 키를 받아 .env 파일의 FINNHUB_API_KEY에 넣고 서버를 다시 켜주세요. 보유 종목 입력은 지금도 할 수 있습니다.',
  invalid: 'Finnhub API 키가 올바르지 않습니다. .env 파일의 FINNHUB_API_KEY 값을 확인하고 서버를 다시 켜주세요.',
};

export const state = {
  holdings: [],
  events: [],
  names: {},
  quotes: {},
  news: [],
  newsFailed: [],
  earnings: [],
  dividends: {}, // { SYMBOL: { annualDps, growth5y } }
  fx: null,
  market: null,
  keyStatus: 'ok',
  sort: { key: 'marketValue', dir: 'desc' },
  newsFilter: '',
  lastQuoteAt: null,
  quoteProblem: null,
  fatal: null,
};

const $ = (id) => document.getElementById(id);
const symbols = () => state.holdings.map((h) => h.symbol);

// 화면 영역을 늘릴 때(Task 9~11) 여기에 렌더 함수를 등록한다.
const extraRenderers = [];
export function addRenderer(fn) { extraRenderers.push(fn); }

async function loadPortfolio() {
  const data = await api.portfolio();
  state.holdings = data.holdings;
  state.events = data.events;
}

async function refreshQuotes() {
  if (!state.holdings.length) {
    state.quotes = {};
    state.quoteProblem = null;
    return;
  }
  try {
    const incoming = await api.quotes(symbols());
    for (const [s, q] of Object.entries(incoming)) if (q.name) state.names[s] = q.name;
    state.quotes = mergeQuotes(state.quotes, incoming);
    const values = Object.values(incoming);
    if (values.some((q) => q.price > 0 && !q.stale)) state.lastQuoteAt = new Date();
    state.quoteProblem = quoteDelay(incoming);
  } catch (err) {
    const failed = Object.fromEntries(symbols().map((s) => [s, { error: { code: err.code, message: err.message } }]));
    state.quotes = mergeQuotes(state.quotes, failed);
    state.quoteProblem = err.message;
  }
}

async function refreshMarket() {
  try {
    state.market = await api.marketStatus();
  } catch {
    // 이전 상태 유지
  }
}

async function refreshHealth() {
  try {
    state.keyStatus = (await api.health()).finnhubKey;
  } catch {
    // 서버 연결 문제는 다른 요청에서 드러난다
  }
}

async function refreshSlow() {
  const list = symbols();
  const empty = Promise.resolve({ items: [], failed: [] });
  const [news, earnings, fx, dividends] = await Promise.allSettled([
    list.length ? api.news(list) : empty,
    list.length ? api.earnings(list) : empty,
    api.fx(),
    list.length ? api.dividends(list) : empty,
  ]);
  if (news.status === 'fulfilled') {
    state.news = keepFailed(state.news, news.value).sort((a, b) => b.datetime - a.datetime);
    state.newsFailed = news.value.failed;
  }
  if (earnings.status === 'fulfilled') {
    state.earnings = keepFailed(state.earnings, earnings.value).sort((a, b) => a.date.localeCompare(b.date));
  }
  if (fx.status === 'fulfilled') state.fx = fx.value;
  if (dividends.status === 'fulfilled') {
    // 가져오지 못한 종목은 이전 값을 유지한다
    const next = Object.fromEntries(dividends.value.failed.filter((s) => state.dividends[s]).map((s) => [s, state.dividends[s]]));
    for (const d of dividends.value.items) next[d.symbol] = d;
    state.dividends = next;
  }

  // 일부 종목을 못 가져왔으면(대개 호출 한도) 30분을 기다리지 않고 1분 뒤 한 번 더 시도한다.
  const failedSome = [news, earnings, dividends].some((r) => r.status === 'rejected' || r.value.failed.length);
  if (failedSome && !slowRetryTimer) {
    slowRetryTimer = setTimeout(async () => {
      slowRetryTimer = null;
      await refreshSlow();
      render();
    }, SLOW_RETRY_MS);
  }
}

export async function refreshAll() {
  try {
    await loadPortfolio();
    state.fatal = null;
  } catch (err) {
    state.fatal = err.message;
    render();
    return;
  }
  await Promise.all([refreshMarket(), refreshQuotes(), refreshSlow()]);
  // 키가 틀렸는지는 Finnhub 호출이 끝나야 알 수 있으므로 마지막에 확인한다.
  await refreshHealth();
  render();
}

export async function afterHoldingChange() {
  await loadPortfolio();
  await Promise.all([refreshQuotes(), refreshSlow()]);
  render();
}

export async function afterEventChange() {
  await loadPortfolio();
  render();
}

let toastTimer = null;
export function notify(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, TOAST_MS);
}

function renderBanner() {
  const el = $('banner');
  const message = state.fatal ?? KEY_HELP[state.keyStatus] ?? null;
  el.hidden = !message;
  el.textContent = message ?? '';
}

const STATUS_TITLE = {
  live: '장중 · 30초마다 시세를 갱신합니다',
  closed: '장이 닫혀 종가 기준입니다 · 자동 갱신을 멈췄습니다',
  delayed: '최신 시세를 받지 못해 마지막 값을 보여줍니다',
  loading: '장 상태를 확인하고 있습니다',
};

function renderStatus() {
  const el = $('status');
  const { tone, label } = statusBadge(state);
  el.className = `status tone-${tone}`;
  el.textContent = label;
  el.title = STATUS_TITLE[tone];
}

function renderSortHeaders() {
  for (const th of document.querySelectorAll('.holdings th[data-sort]')) {
    if (th.dataset.sort === state.sort.key) {
      th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
    } else {
      th.removeAttribute('aria-sort');
    }
  }
}

export function render() {
  renderBanner();
  renderStatus();
  renderSortHeaders();
  const portfolio = computePortfolio(state.holdings, state.quotes);
  renderSummary($('summary'), {
    totals: portfolio.totals,
    excludedCount: portfolio.excludedCount,
    fx: state.fx,
    stale: Boolean(state.quoteProblem),
  });
  renderHoldings($('holdings-body'), sortRows(portfolio.rows, state.sort.key, state.sort.dir), {
    names: state.names,
    fxRate: state.fx?.rate,
    onEdit: (row) => handlers.editHolding(row),
    onDelete: (row) => handlers.deleteHolding(row),
  });
  $('holdings-empty').hidden = state.holdings.length > 0;
  for (const fn of extraRenderers) fn(portfolio);
}

// Task 9에서 실제 대화상자로 바꾼다.
export const handlers = {
  addHolding: () => notify('종목 추가는 다음 단계에서 연결됩니다.'),
  editHolding: () => {},
  deleteHolding: () => {},
};

// 테마: 자동(윈도우 설정) / 라이트 / 다크. 선택은 이 브라우저에만 저장한다.
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' };
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function readThemePref() {
  try { return normalizeThemePref(localStorage.getItem('theme')); } catch { return 'system'; }
}

function applyThemePref(pref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  const btn = $('theme-btn');
  btn.replaceChildren(icon(THEME_ICON[pref]));
  btn.title = `${THEME_LABEL[pref]} · 누르면 바뀝니다`;
  btn.setAttribute('aria-label', btn.title);
  render(); // 차트는 그릴 때 현재 테마 색을 읽는다
}

// 등락 색: 한국식(kr) / 미국식(us). 색은 CSS 변수(--up, --down)만 바뀌므로 차트만 다시 그리면 된다.
function readUpDown() {
  try { return normalizeUpDown(localStorage.getItem('updown')); } catch { return 'kr'; }
}

function applyUpDown(style) {
  const root = document.documentElement;
  if (style === 'us') root.dataset.updown = 'us';
  else delete root.dataset.updown;
  const btn = $('updown-btn');
  btn.title = `${UPDOWN_LABEL[style]} · 누르면 바뀝니다`;
  btn.setAttribute('aria-label', btn.title);
  render();
}

function wireUpDown() {
  applyUpDown(readUpDown());
  $('updown-btn').addEventListener('click', () => {
    const next = toggleUpDown(readUpDown());
    try { localStorage.setItem('updown', next); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
    applyUpDown(next);
  });
}

function wireTheme() {
  applyThemePref(readThemePref());
  $('theme-btn').addEventListener('click', () => {
    const next = nextThemePref(readThemePref());
    try { localStorage.setItem('theme', next); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
    applyThemePref(next);
  });
  // 자동일 때 윈도우 설정이 바뀌면 CSS는 알아서 바뀌고, 차트만 다시 그린다
  systemDark.addEventListener('change', () => render());
}

function wireControls() {
  $('refresh-btn').replaceChildren(icon('refresh'));
  $('add-holding-btn').prepend(icon('plus'));
  $('add-event-btn').prepend(icon('plus', 14));
  $('refresh-btn').addEventListener('click', () => refreshAll());
  $('add-holding-btn').addEventListener('click', () => handlers.addHolding());
  for (const th of document.querySelectorAll('.holdings th[data-sort]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = state.sort.key === key
        ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'symbol' ? 'asc' : 'desc' };
      render();
    });
  }
}

function startSchedulers() {
  setInterval(async () => {
    if (!state.market?.isOpen || document.hidden) return;
    await refreshQuotes();
    render();
  }, QUOTE_MS);
  setInterval(async () => {
    await refreshMarket();
    await refreshHealth();
    render();
  }, MARKET_MS);
  setInterval(async () => { await refreshSlow(); render(); }, SLOW_MS);
}

async function main() {
  wireControls();
  await import('./setup.js');
  wireTheme();
  wireUpDown();
  await refreshAll();
  startSchedulers();
}

main();
