// 화면 영역(대화상자·차트·디데이·뉴스)을 app.js에 연결한다.
import { api } from './api.js';
import { state, handlers, addRenderer, afterHoldingChange, afterEventChange, render, notify } from './app.js';
import { openHoldingDialog, openEventDialog, openDpsDialog, confirmDialog } from './forms.js';
import { createCharts } from './views/charts.js';
import { createHeatmap } from './views/heatmap.js';
import { flatColors } from './treemap.js';
import { buildDdayList, dateInZone, addDays } from './dday.js';
import { renderDday } from './views/events.js';
import { renderNews } from './views/news.js';
import { computeDividends } from './dividends.js';
import { renderDividends } from './views/dividends.js';
import { createHistoryChart, renderHistorySummary } from './views/history.js';
import { RANGES, withLivePoint, withLiveToday, periodChange } from './history.js';

// 종목별 색: 전체 보유 종목 기준으로 한 번 정해 트리맵과 뉴스 태그가 같은 색을 쓴다.
const holdingColors = () => flatColors(state.holdings.map((h) => h.symbol));

const heatmap = createHeatmap(document.getElementById('weight-heatmap'));
const charts = createCharts(document.getElementById('pnl-chart'));
addRenderer((portfolio) => {
  heatmap.update(portfolio.rows, holdingColors());
  charts.update(portfolio.rows);
});

handlers.addHolding = () => openHoldingDialog({
  mode: 'add',
  onSubmit: async (values) => {
    const added = await api.addHolding(values);
    if (added.name) state.names[added.symbol] = added.name;
    await afterHoldingChange();
    notify(`${added.symbol}을(를) 추가했습니다.`);
  },
});

handlers.editHolding = (row) => {
  const holding = state.holdings.find((h) => h.symbol === row.symbol);
  if (!holding) return;
  openHoldingDialog({
    mode: 'edit',
    holding,
    onSubmit: async ({ shares, avgCost }) => {
      await api.updateHolding(holding.symbol, { shares, avgCost });
      await afterHoldingChange();
      notify(`${holding.symbol}을(를) 수정했습니다.`);
    },
  });
};

handlers.deleteHolding = async (row) => {
  if (!(await confirmDialog(`${row.symbol}을(를) 보유 목록에서 삭제할까요?`))) return;
  try {
    await api.removeHolding(row.symbol);
    await afterHoldingChange();
    notify(`${row.symbol}을(를) 삭제했습니다.`);
  } catch (err) {
    notify(err.message);
  }
};

function editEvent(item) {
  const event = state.events.find((e) => e.id === item.id);
  if (!event) return;
  openEventDialog({
    event,
    onSubmit: async (values) => {
      await api.updateEvent(event.id, values);
      await afterEventChange();
      notify('일정을 수정했습니다.');
    },
    onDelete: async () => {
      if (!(await confirmDialog(`'${event.title}' 일정을 삭제할까요?`))) return;
      try {
        await api.removeEvent(event.id);
        await afterEventChange();
        notify('일정을 삭제했습니다.');
      } catch (err) {
        notify(err.message);
      }
    },
  });
}

document.getElementById('add-event-btn').addEventListener('click', () => openEventDialog({
  onSubmit: async (values) => {
    await api.addEvent(values);
    await afterEventChange();
    notify('일정을 추가했습니다.');
  },
}));

const newsFilter = document.getElementById('news-filter');
newsFilter.addEventListener('change', () => {
  state.newsFilter = newsFilter.value;
  render();
});

addRenderer(() => {
  const items = buildDdayList({ earnings: state.earnings, events: state.events, now: new Date() });
  const has = state.holdings.length > 0;
  renderDday(document.getElementById('dday-list'), items, { onEdit: editEvent, loading: has && !state.loaded.earnings });
  renderNews(document.getElementById('news-list'), newsFilter, state.news, {
    filter: state.newsFilter,
    symbols: state.holdings.map((h) => h.symbol),
    failed: state.newsFailed,
    colors: holdingColors(),
    loading: has && !state.loaded.news,
  });
});

// 배당금 카드. 직접 입력은 저장 후 보유 종목만 다시 읽으면 된다(배당 지표는 그대로).
function editDps(row) {
  const holding = state.holdings.find((h) => h.symbol === row.symbol);
  if (!holding) return;
  openDpsDialog({
    symbol: holding.symbol,
    current: holding.manualDps ?? null,
    onSubmit: async (value) => {
      await api.setManualDps(holding.symbol, value);
      await afterEventChange(); // 보유 종목 다시 읽고 다시 그리기
      notify(value == null ? `${holding.symbol} 직접 입력을 지웠습니다.` : `${holding.symbol} 배당을 저장했습니다.`);
    },
  });
}

addRenderer(() => {
  const result = computeDividends(state.holdings, state.dividends, state.quotes);
  renderDividends(
    {
      summaryEl: document.getElementById('dividend-summary'),
      bodyEl: document.getElementById('dividend-body'),
      footEl: document.getElementById('dividend-foot'),
    },
    result,
    { fxRate: state.fx?.rate, hasHoldings: state.holdings.length > 0, onEdit: editDps, loading: !state.loaded.dividends && state.holdings.length > 0 },
  );
});

// 총 평가금액 추이. 기간·통화 선택은 이 브라우저에 저장한다.
const HISTORY_REFRESH_MS = 5 * 60_000;
const CURRENCIES = ['usd', 'krw'];
function readPref(name, allowed, fallback) {
  try {
    const v = localStorage.getItem(name);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(name, value) {
  try { localStorage.setItem(name, value); } catch { /* 이번 화면에만 적용 */ }
}

const historyChart = createHistoryChart(document.getElementById('history-chart'));
const hist = {
  range: readPref('historyRange', RANGES, '1m'),
  currency: readPref('historyCurrency', CURRENCIES, 'usd'),
  data: null,
  loading: false,
  error: null,
  holdingsKey: '',
};

async function loadHistory() {
  const range = hist.range;
  hist.loading = true;
  render();
  try {
    const data = await api.history(range);
    if (range !== hist.range) return; // 그사이 기간을 바꿨으면 버린다
    hist.data = data;
    hist.error = null;
  } catch (err) {
    if (range !== hist.range) return;
    hist.error = err.message;
  } finally {
    if (range === hist.range) {
      hist.loading = false;
      render();
    }
  }
}

for (const btn of document.querySelectorAll('#history-range button')) {
  btn.addEventListener('click', () => {
    if (hist.range === btn.dataset.range) return;
    hist.range = btn.dataset.range;
    hist.data = null;
    savePref('historyRange', hist.range);
    loadHistory();
  });
}
for (const btn of document.querySelectorAll('#history-currency button')) {
  btn.addEventListener('click', () => {
    hist.currency = btn.dataset.currency;
    savePref('historyCurrency', hist.currency);
    render();
  });
}
// 1일·1주 그래프는 장중에 5분마다 새로 받는다
setInterval(() => {
  if ((hist.range === '1d' || hist.range === '1w') && state.market?.isOpen && !document.hidden) loadHistory();
}, HISTORY_REFRESH_MS);

addRenderer((portfolio) => {
  const card = document.getElementById('history-card');
  card.hidden = state.holdings.length === 0;
  // 보유 종목(수량)이 바뀌면 다시 받는다. 첫 렌더에서도 여기서 받기 시작한다.
  const key = state.holdings.map((h) => `${h.symbol}:${h.shares}`).join(',');
  if (key !== hist.holdingsKey) {
    hist.holdingsKey = key;
    if (state.holdings.length) loadHistory();
  }
  for (const b of document.querySelectorAll('#history-range button')) b.setAttribute('aria-pressed', String(b.dataset.range === hist.range));
  for (const b of document.querySelectorAll('#history-currency button')) b.setAttribute('aria-pressed', String(b.dataset.currency === hist.currency));

  const data = hist.data?.range === hist.range ? hist.data : null;
  let points = data?.points ?? [];
  // 장중에는 지금(실시간) 평가금액을 반영한다: 1일·1주는 끝에 이어 붙이고, 일별 그래프는 오늘 점을 바꾼다
  const live = portfolio.totals.marketValue;
  if (state.market?.isOpen && state.quotesLoaded && live > 0) {
    const now = { t: Date.now(), value: live, krw: state.fx?.rate > 0 ? live * state.fx.rate : null };
    points = hist.range === '1d' || hist.range === '1w'
      ? withLivePoint(points, now)
      : withLiveToday(points, now, addDays(dateInZone(new Date(), 'America/New_York'), hist.range === '1y' ? -6 : 0));
  }
  const valueKey = hist.currency === 'krw' ? 'krw' : 'value';
  const base = data?.base ?? null;
  renderHistorySummary(document.getElementById('history-summary'), {
    points, base, range: hist.range, key: valueKey, loading: hist.loading, error: hist.error,
  });
  historyChart.update({ points, range: hist.range, key: valueKey, change: periodChange(points, base, valueKey) });
});
