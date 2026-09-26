// 화면 영역(대화상자·차트·디데이·뉴스)을 app.js에 연결한다.
import { api } from './api.js';
import { state, handlers, addRenderer, afterHoldingChange, notify } from './app.js';
import { openHoldingDialog, confirmDialog } from './forms.js';
import { createCharts } from './views/charts.js';

const charts = createCharts(document.getElementById('weight-chart'), document.getElementById('pnl-chart'));
addRenderer((portfolio) => charts.update(portfolio.rows));

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
