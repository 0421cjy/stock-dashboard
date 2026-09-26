import { formatUsd, formatPct } from '../format.js';

const UP = '#d6293a';
const DOWN = '#1f5fd1';
const PALETTE = ['#1f3a8a', '#2f6fdb', '#5b8def', '#8fb0f5', '#0f766e', '#14b8a6', '#7c3aed', '#a78bfa', '#b45309', '#f59e0b'];

export function createCharts(weightCanvas, pnlCanvas) {
  const Chart = window.Chart;
  if (!Chart) {
    for (const c of [weightCanvas, pnlCanvas]) {
      c.replaceWith(Object.assign(document.createElement('p'), {
        className: 'chart-empty',
        textContent: '차트 라이브러리를 불러오지 못했습니다. npm install을 실행했는지 확인해주세요.',
      }));
    }
    return { update() {} };
  }

  const common = { responsive: true, maintainAspectRatio: false, animation: false };

  const weight = new Chart(weightCanvas, {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 1 }] },
    options: {
      ...common,
      plugins: {
        legend: { position: 'right' },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatPct(c.raw)}` } },
      },
    },
  });

  const pnl = new Chart(pnlCanvas, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
    options: {
      ...common,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => formatUsd(c.raw, { sign: true }) } },
      },
      scales: { y: { ticks: { callback: (v) => formatUsd(v) } } },
    },
  });

  return {
    update(rows) {
      const priced = rows.filter((r) => r.hasPrice).sort((a, b) => b.marketValue - a.marketValue);
      const labels = priced.map((r) => r.symbol);

      weight.data.labels = labels;
      weight.data.datasets[0].data = priced.map((r) => r.weight);
      weight.data.datasets[0].backgroundColor = priced.map((_, i) => PALETTE[i % PALETTE.length]);
      weight.update();

      pnl.data.labels = labels;
      pnl.data.datasets[0].data = priced.map((r) => r.pnl);
      pnl.data.datasets[0].backgroundColor = priced.map((r) => (r.pnl >= 0 ? UP : DOWN));
      pnl.update();
    },
  };
}
