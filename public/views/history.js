import { h } from './dom.js';
import { formatUsd, formatKrw, formatPct, usdClass, signClass } from '../format.js';
import { periodChange, splitEstimated, axisLabel, tooltipTitle, RANGE_LABEL } from '../history.js';

const MINUS = '−';
const SESSION_MS = 6.5 * 3_600_000; // 정규장 09:30~16:00

// 원화 금액(부호 포함). formatKrw는 부호를 붙이지 않으므로 여기서 붙인다.
function signedKrw(n) {
  const won = Math.round(n);
  if (won === 0) return '₩0';
  return `${won < 0 ? MINUS : '+'}${formatKrw(Math.abs(won))}`;
}

function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { up: v('--up'), down: v('--down'), flat: v('--ink-2'), muted: v('--subtle'), text: v('--muted'), grid: v('--chart-grid') };
}

// 선 아래를 위에서 아래로 옅어지게 칠한다
function fillGradient(chart, color) {
  const { ctx, chartArea } = chart;
  if (!chartArea) return 'transparent';
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, withAlpha(color, 0.22));
  g.addColorStop(1, withAlpha(color, 0));
  return g;
}

// '#c8404c' → 'rgba(200, 64, 76, a)'. 다른 형식이면 그대로(투명도 없이) 쓰지 않고 투명 처리한다.
function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function createHistoryChart(canvas) {
  const Chart = window.Chart;
  if (!Chart) return { update() {} };
  let view = { points: [], range: '1m', key: 'value' };
  let colors = themeColors();
  const money = (n) => (view.key === 'krw' ? formatKrw(n) : formatUsd(n));

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        // 기록 구간(실제 보유 수량)
        { data: [], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15, fill: 'origin', spanGaps: false },
        // 추정 구간(지금 보유 수량으로 계산): 점선·흐린 색
        { data: [], borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 3, tension: 0.15, fill: false, spanGaps: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.raw != null && !(item.datasetIndex === 1 && item.chart.data.datasets[0].data[item.dataIndex] != null),
          callbacks: {
            title: (items) => tooltipTitle(view.points[items[0].dataIndex], view.range),
            label: (item) => {
              const p = view.points[item.dataIndex];
              const other = view.key === 'krw' ? formatUsd(p.value) : (p.krw ? formatKrw(p.krw) : '');
              return `${money(item.raw)}${other ? ` (${other})` : ''}${p.estimated ? ' · 추정' : ''}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: () => colors.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 },
          grid: { display: false },
        },
        y: {
          position: 'right',
          ticks: { color: () => colors.text, maxTicksLimit: 5, callback: (v) => compactMoney(v, view.key) },
          grid: { color: () => colors.grid },
        },
      },
    },
  });

  return {
    // points: 그릴 점, key: 'value' | 'krw', change: 기간 등락(선 색을 정한다)
    update({ points, range, key, change }) {
      colors = themeColors();
      view = { points, range, key };
      const { estimated, recorded } = splitEstimated(points, key);
      const color = !change ? colors.flat : change.change > 0 ? colors.up : change.change < 0 ? colors.down : colors.flat;
      const [rec, est] = chart.data.datasets;
      const x = chart.options.scales.x;
      if (range === '1d' && points.length) {
        // 1일은 실제 시각 축으로, 정규장 전체(6시간 30분)를 잡아 두고 선이 채워지게 한다
        const open = points[0].t;
        x.type = 'linear';
        x.min = open;
        x.max = Math.max(open + SESSION_MS, points.at(-1).t);
        x.ticks.callback = (v) => axisLabel(v, range);
        // 눈금: 개장, 1시간 30분 간격, 마감(한국 시간 22:30·00:00·01:30·03:00·05:00, 서머타임 해제 시 한 시간 늦게)
        x.afterBuildTicks = (scale) => {
          scale.ticks = [0, 1.5, 3, 4.5, 6.5].map((hrs) => ({ value: open + hrs * 3_600_000 }));
        };
        chart.data.labels = [];
        rec.data = points.map((p, i) => ({ x: p.t, y: recorded[i] }));
        est.data = points.map((p, i) => ({ x: p.t, y: estimated[i] }));
      } else {
        x.type = 'category';
        delete x.min;
        delete x.max;
        delete x.ticks.callback;
        delete x.afterBuildTicks;
        chart.data.labels = points.map((p) => axisLabel(p.t, range));
        rec.data = recorded;
        est.data = estimated;
      }
      rec.borderColor = color;
      rec.backgroundColor = (ctx) => fillGradient(ctx.chart, color);
      est.borderColor = colors.muted;
      chart.update();
    },
  };
}

// 축 눈금은 짧게: $68.6K, ₩9,220만
function compactMoney(v, key) {
  if (key === 'krw') {
    if (Math.abs(v) >= 1e8) return `₩${(v / 1e8).toFixed(2)}억`;
    return `₩${Math.round(v / 1e4).toLocaleString('en-US')}만`;
  }
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

// 그래프 위 요약: 지금 금액(선택한 통화로 크게, 다른 통화는 작게)과 기간 등락
export function renderHistorySummary(el, { points, base, range, key, loading, error }) {
  if (loading && !points.length) {
    el.replaceChildren(h('div', 'history-empty', '불러오는 중…'));
    return;
  }
  if (!points.length) {
    el.replaceChildren(h('div', 'history-empty', error ?? '표시할 데이터가 없습니다.'));
    return;
  }
  const usd = periodChange(points, base, 'value');
  const krw = periodChange(points, base, 'krw');
  const main = key === 'krw' ? krw : usd;
  const fmt = key === 'krw' ? formatKrw : formatUsd;
  const fmtSigned = key === 'krw' ? signedKrw : (n) => formatUsd(n, { sign: true });
  const otherText = key === 'krw' ? (usd ? formatUsd(usd.last) : '') : (krw ? `≈ ${formatKrw(krw.last)}` : '');

  const value = h('div', 'history-value', main ? fmt(main.last) : '—');
  if (otherText) value.append(h('span', 'history-other', otherText));

  const children = [value];
  if (main) {
    // 색은 화면에 보이는 금액을 따른다(₩0, $0.00이면 칠하지 않음)
    const cls = key === 'krw' ? (Math.round(main.change) === 0 ? 'flat' : signClass(main.change)) : usdClass(main.change);
    const line = h('div', `history-change ${cls}`, `${fmtSigned(main.change)} (${formatPct(main.ratio, { sign: true })})`);
    line.append(h('span', 'history-period', range === '1d' ? '전일 종가 대비' : `${RANGE_LABEL[range]} 전 대비`));
    children.push(line);
  }
  el.replaceChildren(...children);
}
