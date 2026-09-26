// 화면 영역(대화상자·차트·디데이·뉴스)을 app.js에 연결한다.
import { api } from './api.js';
import { state, handlers, addRenderer, afterHoldingChange, afterEventChange, render, notify } from './app.js';
import { openHoldingDialog, openEventDialog, confirmDialog } from './forms.js';
import { createCharts } from './views/charts.js';
import { createHeatmap } from './views/heatmap.js';
import { buildDdayList } from './dday.js';
import { renderDday } from './views/events.js';
import { renderNews } from './views/news.js';

const heatmap = createHeatmap(document.getElementById('weight-heatmap'));
const charts = createCharts(document.getElementById('pnl-chart'));
addRenderer((portfolio) => {
  heatmap.update(portfolio.rows);
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
  renderDday(document.getElementById('dday-list'), items, { onEdit: editEvent });
  renderNews(document.getElementById('news-list'), newsFilter, state.news, {
    filter: state.newsFilter,
    symbols: state.holdings.map((h) => h.symbol),
    failed: state.newsFailed,
  });
});
