import { formatUsd } from '../format.js';

// 라이트 테마 기본값. 실제로는 그릴 때마다 CSS 변수에서 현재 테마 색을 읽는다(themeColors).
const LIGHT_GRID = { zero: '#16191f', grid: 'rgba(0, 0, 0, 0.1)' };

// 평가손익 차트 격자선: 0(이익·손해 경계)만 진한 굵은 선으로 구분한다.
export function gridLine(value, palette = LIGHT_GRID) {
  return value === 0 ? { color: palette.zero, width: 2 } : { color: palette.grid, width: 1 };
}

// styles.css의 테마 변수(--up, --down, --ink, --muted, --chart-grid)를 읽는다.
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { up: v('--up'), down: v('--down'), text: v('--muted'), grid: { zero: v('--ink'), grid: v('--chart-grid') } };
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

  // 차트 글자도 페이지 글꼴(Pretendard)을 따른다
  Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
  Chart.defaults.font.size = 12;

  let colors = themeColors();
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
        x: { ticks: { color: () => colors.text }, grid: { color: () => colors.grid.grid } },
        y: {
          beginAtZero: true, // 모두 이익이거나 모두 손해여도 0 기준선이 보이게
          ticks: { callback: (v) => formatUsd(v), color: () => colors.text },
          grid: {
            color: (ctx) => gridLine(ctx.tick?.value, colors.grid).color,
            lineWidth: (ctx) => gridLine(ctx.tick?.value, colors.grid).width,
          },
        },
      },
    },
  });

  return {
    // 그릴 때마다 현재 테마 색을 다시 읽으므로 테마를 바꾼 뒤 render()만 부르면 된다.
    update(rows) {
      colors = themeColors();
      const priced = rows.filter((r) => r.hasPrice).sort((a, b) => b.marketValue - a.marketValue);
      pnl.data.labels = priced.map((r) => r.symbol);
      pnl.data.datasets[0].data = priced.map((r) => r.pnl);
      pnl.data.datasets[0].backgroundColor = priced.map((r) => (r.pnl >= 0 ? colors.up : colors.down));
      pnl.update();
    },
  };
}
