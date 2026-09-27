import { formatUsd } from '../format.js';

const UP = '#c8404c'; // styles.css --up
const DOWN = '#3a6bc4'; // styles.css --down
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

  // 차트 글자도 페이지 글꼴(Pretendard)과 보조 글자색을 따른다
  Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6b7280';

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
