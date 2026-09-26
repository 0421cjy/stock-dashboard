import { formatUsd } from '../format.js';

const UP = '#d6293a';
const DOWN = '#1f5fd1';
const ZERO_LINE = { color: '#16191f', width: 2 };
const GRID_LINE = { color: 'rgba(0, 0, 0, 0.1)', width: 1 };

// 평가손익 차트 격자선: 0(이익·손해 경계)만 진한 굵은 선으로 구분한다.
export function gridLine(value) {
  return value === 0 ? ZERO_LINE : GRID_LINE;
}

// 종목별 평가손익 막대 차트. (비중은 views/heatmap.js)
export function createCharts(pnlCanvas) {
  const Chart = window.Chart;
  if (!Chart) {
    pnlCanvas.replaceWith(Object.assign(document.createElement('p'), {
      className: 'chart-empty',
      textContent: '차트 라이브러리를 불러오지 못했습니다. npm install을 실행했는지 확인해주세요.',
    }));
    return { update() {} };
  }

  const common = { responsive: true, maintainAspectRatio: false, animation: false };

  const pnl = new Chart(pnlCanvas, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
    options: {
      ...common,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => formatUsd(c.raw, { sign: true }) } },
      },
      scales: {
        y: {
          beginAtZero: true, // 모두 이익이거나 모두 손해여도 0 기준선이 보이게
          ticks: { callback: (v) => formatUsd(v) },
          grid: {
            color: (ctx) => gridLine(ctx.tick?.value).color,
            lineWidth: (ctx) => gridLine(ctx.tick?.value).width,
          },
        },
      },
    },
  });

  return {
    update(rows) {
      const priced = rows.filter((r) => r.hasPrice).sort((a, b) => b.marketValue - a.marketValue);
      pnl.data.labels = priced.map((r) => r.symbol);
      pnl.data.datasets[0].data = priced.map((r) => r.pnl);
      pnl.data.datasets[0].backgroundColor = priced.map((r) => (r.pnl >= 0 ? UP : DOWN));
      pnl.update();
    },
  };
}
