# 개인 주식 대시보드 v1 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 PC에서만 여는 미국 주식 대시보드를 만든다. Finnhub 실시간 시세로 보유 종목의 평가손익과 비중을 보여주고, 실적발표일·직접 입력 일정 디데이와 종목 뉴스를 함께 보여준다.

**Architecture:** Node.js 24 + Express 서버가 `127.0.0.1`에서만 떠서 Finnhub·Frankfurter 호출(키 보관, TTL 캐시, 429 백오프)과 `data/portfolio.json` 저장을 맡는다. 화면은 프레임워크 없는 ES 모듈로 만든다. 손익·디데이 계산은 DOM에 의존하지 않는 순수 함수(`public/calc.js`, `public/dday.js`, `public/format.js`)로 분리해 Node 테스트 러너로 검증한다.

**Tech Stack:** Node.js 24 (내장 `fetch`, `node:test`), Express 5.1.0, Chart.js 4.4.7(로컬 제공), HTML/CSS/ES 모듈.

**Spec:** `docs/superpowers/specs/2026-09-27-stock-dashboard-design.md`

## Global Constraints

- 서버 바인딩 주소는 코드에 `127.0.0.1`로 고정한다. 설정으로 바꿀 수 없게 한다.
- Finnhub API 키는 `.env`의 `FINNHUB_API_KEY`에서만 읽는다. 프론트엔드 코드와 API 응답에 키를 절대 넣지 않는다.
- `.env`와 `data/`는 git에 올리지 않는다(`.gitignore`는 이미 있음).
- 외부 의존성은 `express`와 `chart.js` 두 개뿐이다. 버전은 `--save-exact`로 고정한다.
- Chart.js는 CDN이 아니라 `node_modules`에서 `/vendor/chart.js/`로 제공한다.
- 색상은 한국식이다. 상승·이익 = 빨강 `#d6293a`, 하락·손해 = 파랑 `#1f5fd1`.
- 사용자에게 보이는 모든 문구와 오류 `message`는 한국어로 쓴다.
- 오류 응답 형식은 `{ "error": { "code": "...", "message": "..." } }`이다.
- 갱신 주기: 시세는 장중 30초(장외 자동 중지), 장 상태 60초, 뉴스·실적·환율 30분.
- 서버 캐시 TTL: 시세 15초, 회사명 24시간, 뉴스 30분, 실적 6시간, 환율 6시간, 휴장일 24시간.
- 실적 일정 범위는 앞으로 90일, 뉴스는 최근 7일이며 종목당 최신 5개다.
- 기본 포트는 5173이다(`.env`의 `PORT`로 변경 가능).
- 외부 데이터에서 온 문자열(뉴스 제목 등)은 `textContent`로만 넣는다. `innerHTML`에 넣지 않는다.
- 테스트에서 실제 Finnhub·Frankfurter를 호출하지 않는다.

## Review Focus

1. **공백·소문자 티커:** `" sofi "`를 입력해도 `SOFI`로 저장돼야 하고 중복 검사도 정규화 후에 해야 한다. → Task 4 테스트
2. **빠른 연속 저장:** 종목 두 개를 거의 동시에 추가해도 둘 다 파일에 남아야 한다(쓰기 직렬화). → Task 4 테스트
3. **한국 아침 시간의 디데이:** 한국 9/28 08:00(미국 9/27 저녁)에는 미국 9/28 실적이 `D-1`, 한국 9/28 직접 일정이 `D-DAY`여야 한다. → Task 2 테스트
4. **쉼표·달러 기호 입력:** `"1,000"`, `"$14.20"`은 숫자로 받아야 하고, `"-5"`, `"abc"`, 빈칸은 거부해야 한다. → Task 1 테스트
5. **점이 들어간 티커(BRK.B):** 검증을 통과하고 Finnhub 요청의 `symbol` 값이 `BRK.B` 그대로여야 한다. → Task 4, Task 6 테스트

---

## 파일 구조

```
Stock/
├─ package.json          # type: module, scripts: start / test
├─ .env.example          # FINNHUB_API_KEY=, PORT=5173
├─ README.md             # 설치·실행 방법
├─ server/
│  ├─ errors.js          # AppError(code, message, status)
│  ├─ cache.js           # TTL 캐시 + 동시 요청 병합 + 실패 시 마지막 값(stale)
│  ├─ store.js           # portfolio.json 검증·원자적 쓰기·쓰기 직렬화
│  ├─ market.js          # 뉴욕 시간 기준 장 상태 판정(순수 함수)
│  ├─ finnhub.js         # Finnhub 클라이언트(키, 캐시, 429 백오프)
│  ├─ fx.js              # Frankfurter USD→KRW
│  ├─ app.js             # createApp(): 라우트·정적 파일·오류 처리
│  └─ index.js           # 진입점: .env 읽기, 127.0.0.1 바인딩, 포트 충돌 안내
├─ public/
│  ├─ index.html, styles.css
│  ├─ calc.js            # computePortfolio, parseAmount, mergeQuotes, sortRows (순수)
│  ├─ format.js          # 금액·퍼센트·시간 표시, signClass, isHttpUrl (순수)
│  ├─ dday.js            # 날짜 계산, 디데이 목록, 한국시간 안내 (순수)
│  ├─ api.js             # /api 호출 래퍼
│  ├─ forms.js           # 종목·일정 입력 대화상자, 삭제 확인
│  ├─ app.js             # 상태, 새로고침 스케줄러, 렌더링 조립
│  └─ views/             # dom.js, summary.js, holdings.js, charts.js, events.js, news.js
└─ tests/                # *.test.js (node --test)
```

스펙에서 조정한 점(Task 12에서 스펙 문서에도 반영):
- `createApp`은 `server/app.js`에, 기동 코드는 `server/index.js`에 둔다.
- `/api/news`와 `/api/earnings`는 `{ items, failed }` 형태로 돌려준다(일부 종목 실패를 화면에 알리기 위해).
- `/api/market-status`는 `{ isOpen, session }`만 돌려준다(`nextChange`는 화면에서 쓰지 않으므로 생략).

---

### Task 1: 프로젝트 뼈대 + 손익 계산(`calc.js`)

**Files:**
- Create: `package.json`, `.env.example`, `public/calc.js`
- Test: `tests/calc.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `computePortfolio(holdings: {symbol, shares, avgCost}[], quotes: Record<symbol, {price?, prevClose?, stale?, error?}>) → { rows: Row[], totals: {marketValue, cost, pnl, pnlPct|null, dayChange, dayChangePct|null}, excludedCount }`
    - `Row = {symbol, shares, avgCost, cost, hasPrice, stale, error, price|null, prevClose|null, marketValue|null, pnl|null, pnlPct|null, dayChange|null, dayChangePct|null, weight|null}`
  - `parseAmount(text: string|number) → number` (잘못된 입력이면 `NaN`)
  - `mergeQuotes(prev, incoming) → Record<symbol, quote>`: 새 값이 실패하면 이전 가격을 `stale: true`로 유지한다.
  - `sortRows(rows, key, dir: 'asc'|'desc') → Row[]`: 새 배열을 돌려주며 `null`은 항상 맨 뒤에 둔다.

- [ ] **Step 1: 프로젝트 파일과 의존성 준비**

`package.json`:

```json
{
  "name": "stock-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "내 PC 전용 미국 주식 포트폴리오 대시보드",
  "scripts": {
    "start": "node --env-file-if-exists=.env server/index.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=24"
  }
}
```

`.env.example`:

```
# finnhub.io에서 무료 가입 후 받은 API 키
FINNHUB_API_KEY=
# 대시보드 포트 (이미 사용 중이면 다른 번호로)
PORT=5173
```

Run:

```bash
npm install --save-exact express@5.1.0 chart.js@4.4.7
```

Run: `ls node_modules/chart.js/dist/chart.umd.js`
Expected: 파일 경로가 출력된다. 파일이 없고 `chart.umd.min.js`만 있다면, Task 8의 `index.html`에서 스크립트 경로를 그 이름으로 바꾼다.

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/calc.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePortfolio, parseAmount, mergeQuotes, sortRows } from '../public/calc.js';

const holdings = [
  { symbol: 'AAA', shares: 10, avgCost: 100 },
  { symbol: 'BBB', shares: 2.5, avgCost: 40 },
];
const quotes = {
  AAA: { price: 120, prevClose: 110 },
  BBB: { price: 30, prevClose: 32 },
};

test('종목별 평가금액·손익·손익률·오늘 등락을 계산한다', () => {
  const { rows } = computePortfolio(holdings, quotes);
  const [a, b] = rows;
  assert.equal(a.marketValue, 1200);
  assert.equal(a.cost, 1000);
  assert.equal(a.pnl, 200);
  assert.equal(a.pnlPct, 0.2);
  assert.equal(a.dayChange, 100);
  assert.equal(b.marketValue, 75);
  assert.equal(b.pnl, -25);
  assert.equal(b.pnlPct, -0.25);
  assert.equal(b.dayChange, -5);
});

test('합계와 비중을 계산하고 비중 합은 100%다', () => {
  const { rows, totals, excludedCount } = computePortfolio(holdings, quotes);
  assert.equal(totals.marketValue, 1275);
  assert.equal(totals.cost, 1100);
  assert.equal(totals.pnl, 175);
  assert.equal(totals.pnlPct, 175 / 1100);
  assert.equal(totals.dayChange, 95);
  assert.equal(totals.dayChangePct, 95 / 1180);
  assert.equal(excludedCount, 0);
  const weightSum = rows.reduce((s, r) => s + r.weight, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-12);
});

test('가격이 없는 종목은 합계에서 빼고 excludedCount로 센다', () => {
  const { rows, totals, excludedCount } = computePortfolio(
    [...holdings, { symbol: 'CCC', shares: 1, avgCost: 50 }],
    quotes,
  );
  const c = rows[2];
  assert.equal(c.hasPrice, false);
  assert.equal(c.marketValue, null);
  assert.equal(c.weight, null);
  assert.equal(totals.marketValue, 1275);
  assert.equal(totals.cost, 1100);
  assert.equal(excludedCount, 1);
});

test('보유 종목이 없으면 합계는 0이고 비율은 null이다', () => {
  const { rows, totals, excludedCount } = computePortfolio([], {});
  assert.deepEqual(rows, []);
  assert.equal(totals.marketValue, 0);
  assert.equal(totals.pnlPct, null);
  assert.equal(totals.dayChangePct, null);
  assert.equal(excludedCount, 0);
});

test('전일 종가가 없으면 오늘 등락은 0, 등락률은 null이다', () => {
  const { rows } = computePortfolio([{ symbol: 'AAA', shares: 1, avgCost: 1 }], { AAA: { price: 2 } });
  assert.equal(rows[0].dayChange, 0);
  assert.equal(rows[0].dayChangePct, null);
});

test('parseAmount는 쉼표·달러 기호·공백을 허용하고 잘못된 값은 NaN이다', () => {
  assert.equal(parseAmount('1,000'), 1000);
  assert.equal(parseAmount(' $14.20 '), 14.2);
  assert.equal(parseAmount('0.5'), 0.5);
  assert.equal(parseAmount(7), 7);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('abc')));
  assert.ok(Number.isNaN(parseAmount('-5')));
  assert.ok(Number.isNaN(parseAmount('1.2.3')));
});

test('mergeQuotes는 실패한 종목의 이전 가격을 stale로 유지한다', () => {
  const prev = { AAA: { price: 120, prevClose: 110, stale: false } };
  const err = { code: 'UPSTREAM', message: '연결 실패' };
  const merged = mergeQuotes(prev, {
    AAA: { error: err },
    BBB: { price: 30, prevClose: 32, stale: false },
    CCC: { error: err },
  });
  assert.deepEqual(merged.AAA, { price: 120, prevClose: 110, stale: true, error: err });
  assert.deepEqual(merged.BBB, { price: 30, prevClose: 32, stale: false });
  assert.deepEqual(merged.CCC, { error: err });
});

test('mergeQuotes는 더 이상 없는 종목을 버린다', () => {
  const merged = mergeQuotes({ OLD: { price: 1 } }, { NEW: { price: 2 } });
  assert.deepEqual(Object.keys(merged), ['NEW']);
});

test('sortRows는 null을 방향과 상관없이 맨 뒤에 둔다', () => {
  const rows = [
    { symbol: 'B', pnl: 10 },
    { symbol: 'A', pnl: null },
    { symbol: 'C', pnl: -5 },
  ];
  assert.deepEqual(sortRows(rows, 'pnl', 'desc').map((r) => r.symbol), ['B', 'C', 'A']);
  assert.deepEqual(sortRows(rows, 'pnl', 'asc').map((r) => r.symbol), ['C', 'B', 'A']);
  assert.deepEqual(sortRows(rows, 'symbol', 'asc').map((r) => r.symbol), ['A', 'B', 'C']);
  assert.deepEqual(rows.map((r) => r.symbol), ['B', 'A', 'C'], '원본 배열은 바꾸지 않는다');
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `node --test tests/calc.test.js`
Expected: FAIL. `Cannot find module '.../public/calc.js'` 오류가 난다.

- [ ] **Step 4: 구현**

`public/calc.js`:

```js
// 손익·비중 계산. DOM·네트워크에 의존하지 않는 순수 함수만 둔다.

export function computePortfolio(holdings, quotes = {}) {
  const rows = holdings.map((h) => toRow(h, quotes[h.symbol]));
  const priced = rows.filter((r) => r.hasPrice);

  const marketValue = sum(priced, 'marketValue');
  const cost = sum(priced, 'cost');
  const pnl = marketValue - cost;
  const dayChange = sum(priced, 'dayChange');
  const prevValue = marketValue - dayChange;

  for (const r of priced) r.weight = marketValue > 0 ? r.marketValue / marketValue : 0;

  return {
    rows,
    totals: {
      marketValue,
      cost,
      pnl,
      pnlPct: cost > 0 ? pnl / cost : null,
      dayChange,
      dayChangePct: prevValue > 0 ? dayChange / prevValue : null,
    },
    excludedCount: rows.length - priced.length,
  };
}

function toRow(h, q) {
  const cost = h.shares * h.avgCost;
  const base = {
    symbol: h.symbol,
    shares: h.shares,
    avgCost: h.avgCost,
    cost,
    stale: Boolean(q?.stale),
    error: q?.error ?? null,
  };
  if (!(q && Number.isFinite(q.price) && q.price > 0)) {
    return {
      ...base,
      hasPrice: false,
      price: null,
      prevClose: null,
      marketValue: null,
      pnl: null,
      pnlPct: null,
      dayChange: null,
      dayChangePct: null,
      weight: null,
    };
  }
  const marketValue = h.shares * q.price;
  const pnl = marketValue - cost;
  const hasPrev = Number.isFinite(q.prevClose) && q.prevClose > 0;
  return {
    ...base,
    hasPrice: true,
    price: q.price,
    prevClose: hasPrev ? q.prevClose : null,
    marketValue,
    pnl,
    pnlPct: pnl / cost,
    dayChange: hasPrev ? h.shares * (q.price - q.prevClose) : 0,
    dayChangePct: hasPrev ? (q.price - q.prevClose) / q.prevClose : null,
    weight: 0,
  };
}

function sum(rows, key) {
  return rows.reduce((acc, r) => acc + r[key], 0);
}

// 사용자가 입력한 금액·수량 문자열을 숫자로 바꾼다. 음수·빈칸·형식 오류는 NaN.
export function parseAmount(text) {
  if (typeof text === 'number') return text;
  const cleaned = String(text ?? '').trim().replace(/,/g, '').replace(/^\$/, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

// 새로 받은 시세를 합친다. 실패한 종목은 이전 가격을 stale로 유지한다.
export function mergeQuotes(prev = {}, incoming = {}) {
  const out = {};
  for (const [symbol, q] of Object.entries(incoming)) {
    if (q && Number.isFinite(q.price) && q.price > 0) {
      out[symbol] = q;
    } else if (prev[symbol]?.price > 0) {
      out[symbol] = { ...prev[symbol], stale: true, error: q?.error ?? null };
    } else {
      out[symbol] = { error: q?.error ?? { code: 'UNKNOWN', message: '시세를 가져오지 못했습니다.' } };
    }
  }
  return out;
}

// 표 정렬. null은 방향과 상관없이 맨 뒤.
export function sortRows(rows, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string') return sign * x.localeCompare(y);
    return sign * (x - y);
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/calc.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json .env.example public/calc.js tests/calc.test.js
git commit -m "feat: add project scaffold and portfolio calculations"
```

---

### Task 2: 표시 형식(`format.js`)과 디데이(`dday.js`)

**Files:**
- Create: `public/format.js`, `public/dday.js`
- Test: `tests/format.test.js`, `tests/dday.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `format.js`: `formatUsd(n, {sign}) → string`, `formatPct(ratio, {sign}) → string`, `formatKrw(n) → string`, `formatShares(n) → string`, `formatClock(date) → 'HH:MM:SS'`, `signClass(n) → 'up'|'down'|'flat'`, `relativeTime(ms, now) → string`, `isHttpUrl(s) → boolean`
  - `dday.js`:
    - `dateInZone(date: Date, timeZone: string) → 'YYYY-MM-DD'`
    - `addDays(dateStr, n) → 'YYYY-MM-DD'`
    - `daysBetween(fromStr, toStr) → integer`
    - `koreaTimeHint(dateStr, hour) → string|null`
    - `buildDdayList({earnings, events, now, horizonDays=90}) → Item[]`
      - `Item = {kind: 'earnings'|'event', id, title, date, days, label, symbol?, session?, epsEstimate?, koreaHint?, note?}`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/format.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUsd, formatPct, formatKrw, formatShares, signClass, relativeTime, isHttpUrl,
} from '../public/format.js';

test('formatUsd는 두 자리 소수와 부호를 붙인다', () => {
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(-25), '−$25.00');
  assert.equal(formatUsd(175, { sign: true }), '+$175.00');
  assert.equal(formatUsd(-0.001, { sign: true }), '$0.00');
  assert.equal(formatUsd(null), '—');
});

test('formatPct는 비율을 소수 첫째 자리 퍼센트로 바꾼다', () => {
  assert.equal(formatPct(0.132, { sign: true }), '+13.2%');
  assert.equal(formatPct(-0.008), '−0.8%');
  assert.equal(formatPct(0.0004, { sign: true }), '0.0%');
  assert.equal(formatPct(null), '—');
});

test('formatKrw와 formatShares', () => {
  assert.equal(formatKrw(72_100_000.4), '₩72,100,000');
  assert.equal(formatShares(2.5), '2.5');
  assert.equal(formatShares(1000), '1,000');
});

test('signClass는 한국식 색 클래스를 고른다', () => {
  assert.equal(signClass(3), 'up');
  assert.equal(signClass(-3), 'down');
  assert.equal(signClass(0), 'flat');
  assert.equal(signClass(null), 'flat');
});

test('relativeTime', () => {
  const now = 10 * 86_400_000;
  assert.equal(relativeTime(now - 30_000, now), '방금 전');
  assert.equal(relativeTime(now - 5 * 60_000, now), '5분 전');
  assert.equal(relativeTime(now - 2 * 3_600_000, now), '2시간 전');
  assert.equal(relativeTime(now - 3 * 86_400_000, now), '3일 전');
});

test('isHttpUrl은 http/https만 허용한다', () => {
  assert.equal(isHttpUrl('https://example.com/a'), true);
  assert.equal(isHttpUrl('javascript:alert(1)'), false);
  assert.equal(isHttpUrl('not a url'), false);
});
```

`tests/dday.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateInZone, addDays, daysBetween, koreaTimeHint, buildDdayList,
} from '../public/dday.js';

test('dateInZone은 시간대별 날짜를 돌려준다', () => {
  const d = new Date('2026-09-27T23:00:00Z');
  assert.equal(dateInZone(d, 'Asia/Seoul'), '2026-09-28');
  assert.equal(dateInZone(d, 'America/New_York'), '2026-09-27');
});

test('addDays와 daysBetween은 월·연 경계를 넘는다', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-09-28', 90), '2026-12-27');
  assert.equal(daysBetween('2026-09-27', '2026-12-26'), 90);
  assert.equal(daysBetween('2026-09-28', '2026-09-27'), -1);
});

test('koreaTimeHint: 장전은 같은 날 밤, 장후는 다음 날 아침', () => {
  assert.equal(koreaTimeHint('2026-10-30', 'bmo'), '한국시간 10/30 밤');
  assert.equal(koreaTimeHint('2026-10-31', 'amc'), '한국시간 11/1 아침');
  assert.equal(koreaTimeHint('2026-10-30', 'dmh'), null);
  assert.equal(koreaTimeHint('2026-10-30', ''), null);
});

test('한국 아침에는 실적은 미국 날짜, 직접 일정은 한국 날짜로 센다', () => {
  // 한국 9/28 08:00 = 미국 동부 9/27 19:00
  const now = new Date('2026-09-27T23:00:00Z');
  const items = buildDdayList({
    now,
    earnings: [
      { symbol: 'SOFI', date: '2026-09-28', hour: 'amc', epsEstimate: 0.12 },
      { symbol: 'OLD', date: '2026-09-26', hour: 'bmo', epsEstimate: null },
      { symbol: 'FAR', date: '2026-12-27', hour: 'bmo', epsEstimate: null },
    ],
    events: [
      { id: 'e1', title: 'FOMC', date: '2026-09-28', note: '' },
      { id: 'e0', title: '지난 일정', date: '2026-09-27', note: '' },
    ],
  });
  assert.deepEqual(items.map((i) => [i.title, i.label]), [
    ['FOMC', 'D-DAY'],
    ['SOFI 실적', 'D-1'],
  ]);
  const sofi = items[1];
  assert.equal(sofi.kind, 'earnings');
  assert.equal(sofi.session, '장후');
  assert.equal(sofi.epsEstimate, 0.12);
  assert.equal(sofi.koreaHint, '한국시간 9/29 아침');
});

test('90일째 일정은 보이고 91일째는 숨긴다', () => {
  const now = new Date('2026-09-27T16:00:00Z'); // 미국·한국 모두 9/27~28 사이
  const items = buildDdayList({
    now,
    earnings: [],
    events: [
      { id: 'a', title: '90일', date: addDays(dateInZone(now, 'Asia/Seoul'), 90), note: '' },
      { id: 'b', title: '91일', date: addDays(dateInZone(now, 'Asia/Seoul'), 91), note: '' },
    ],
  });
  assert.deepEqual(items.map((i) => i.title), ['90일']);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/format.test.js tests/dday.test.js`
Expected: FAIL. `Cannot find module` 오류가 난다.

- [ ] **Step 3: 구현**

`public/format.js`:

```js
// 화면 표시용 형식 함수. 모두 순수 함수.

const MINUS = '−';
const usdFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatUsd(n, { sign = false } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.005) return usdFmt.format(0);
  const body = usdFmt.format(Math.abs(n));
  if (n < 0) return MINUS + body;
  return sign ? `+${body}` : body;
}

export function formatPct(ratio, { sign = false } = {}) {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  if (Math.abs(pct) < 0.05) return '0.0%';
  const body = `${Math.abs(pct).toFixed(1)}%`;
  if (pct < 0) return MINUS + body;
  return sign ? `+${body}` : body;
}

export function formatKrw(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₩${Math.round(n).toLocaleString('en-US')}`;
}

export function formatShares(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function formatClock(date) {
  return date.toLocaleTimeString('ko-KR', { hour12: false });
}

// 한국식 색: 상승 up(빨강), 하락 down(파랑)
export function signClass(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function relativeTime(ms, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
```

`public/dday.js`:

```js
// 디데이 계산. 실적은 미국 동부 날짜, 직접 입력 일정은 한국 날짜 기준.

const NY = 'America/New_York';
const SEOUL = 'Asia/Seoul';
const HOUR_LABEL = { bmo: '장전', amc: '장후', dmh: '장중' };

export function dateInZone(date, timeZone) {
  // en-CA 형식은 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  const ms = Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function monthDay(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

// 장전 발표(미국 오전) = 한국 그날 밤, 장후 발표(미국 오후) = 한국 다음 날 아침
export function koreaTimeHint(dateStr, hour) {
  if (hour === 'bmo') return `한국시간 ${monthDay(dateStr)} 밤`;
  if (hour === 'amc') return `한국시간 ${monthDay(addDays(dateStr, 1))} 아침`;
  return null;
}

function ddayLabel(days) {
  return days === 0 ? 'D-DAY' : `D-${days}`;
}

export function buildDdayList({ earnings = [], events = [], now = new Date(), horizonDays = 90 }) {
  const nyToday = dateInZone(now, NY);
  const seoulToday = dateInZone(now, SEOUL);
  const inRange = (days) => days >= 0 && days <= horizonDays;
  const items = [];

  for (const e of earnings) {
    const days = daysBetween(nyToday, e.date);
    if (!inRange(days)) continue;
    items.push({
      kind: 'earnings',
      id: `earn_${e.symbol}_${e.date}`,
      symbol: e.symbol,
      title: `${e.symbol} 실적`,
      date: e.date,
      days,
      label: ddayLabel(days),
      session: HOUR_LABEL[e.hour] ?? null,
      epsEstimate: e.epsEstimate ?? null,
      koreaHint: koreaTimeHint(e.date, e.hour),
    });
  }

  for (const ev of events) {
    const days = daysBetween(seoulToday, ev.date);
    if (!inRange(days)) continue;
    items.push({
      kind: 'event',
      id: ev.id,
      title: ev.title,
      date: ev.date,
      days,
      label: ddayLabel(days),
      note: ev.note ?? '',
    });
  }

  return items.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/format.test.js tests/dday.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add public/format.js public/dday.js tests/format.test.js tests/dday.test.js
git commit -m "feat: add display formatting and D-day calculations"
```

---

### Task 3: 오류 타입과 TTL 캐시

**Files:**
- Create: `server/errors.js`, `server/cache.js`
- Test: `tests/cache.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `class AppError extends Error { code: string; status: number }`, 생성자는 `new AppError(code, message, status = 500)`
    - 사용하는 code: `VALIDATION`, `NOT_FOUND`, `DUPLICATE`, `STORE_CORRUPT`, `MISSING_KEY`, `INVALID_KEY`, `RATE_LIMITED`, `UPSTREAM`
  - `createCache({now}) → { get(key, ttlMs, loader) → Promise<{value, stale, storedAt, error?}> }`
    - TTL 안이면 저장된 값을 돌려준다.
    - 같은 키의 동시 요청은 loader를 한 번만 부른다.
    - loader가 실패하면: 이전 값이 있고 오류가 `NOT_FOUND`가 아니면 `{stale: true, error}`로 이전 값을 돌려주고, 그 외에는 오류를 그대로 던진다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/cache.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../server/cache.js';
import { AppError } from '../server/errors.js';

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('TTL 안에서는 loader를 다시 부르지 않는다', async () => {
  const now = clock();
  const cache = createCache({ now });
  let calls = 0;
  const loader = async () => ++calls;
  assert.equal((await cache.get('k', 1000, loader)).value, 1);
  now.advance(999);
  assert.equal((await cache.get('k', 1000, loader)).value, 1);
  now.advance(2);
  const r = await cache.get('k', 1000, loader);
  assert.equal(r.value, 2);
  assert.equal(r.stale, false);
});

test('동시 요청은 loader를 한 번만 부른다', async () => {
  const cache = createCache({ now: clock() });
  let calls = 0;
  const loader = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 'v'; };
  const [a, b] = await Promise.all([cache.get('k', 1000, loader), cache.get('k', 1000, loader)]);
  assert.equal(calls, 1);
  assert.equal(a.value, 'v');
  assert.equal(b.value, 'v');
});

test('실패하면 이전 값을 stale로 돌려준다', async () => {
  const now = clock();
  const cache = createCache({ now });
  await cache.get('k', 1000, async () => 'old');
  now.advance(5000);
  const err = new AppError('UPSTREAM', '연결 실패', 502);
  const r = await cache.get('k', 1000, async () => { throw err; });
  assert.equal(r.value, 'old');
  assert.equal(r.stale, true);
  assert.equal(r.error, err);
});

test('이전 값이 없으면 오류를 그대로 던진다', async () => {
  const cache = createCache({ now: clock() });
  await assert.rejects(
    cache.get('k', 1000, async () => { throw new AppError('UPSTREAM', 'x', 502); }),
    { code: 'UPSTREAM' },
  );
});

test('NOT_FOUND는 이전 값이 있어도 던진다', async () => {
  const now = clock();
  const cache = createCache({ now });
  await cache.get('k', 1000, async () => 'old');
  now.advance(5000);
  await assert.rejects(
    cache.get('k', 1000, async () => { throw new AppError('NOT_FOUND', '없음', 404); }),
    { code: 'NOT_FOUND' },
  );
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/cache.test.js`
Expected: FAIL. `Cannot find module` 오류가 난다.

- [ ] **Step 3: 구현**

`server/errors.js`:

```js
// 서버 전체에서 쓰는 오류. message는 화면에 그대로 보여줄 한국어 문장이다.
export class AppError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
```

`server/cache.js`:

```js
// TTL 캐시. 동시 요청을 합치고, 실패하면 마지막 성공 값을 stale로 돌려준다.
export function createCache({ now = Date.now } = {}) {
  const entries = new Map();
  const inflight = new Map();

  async function load(key, loader) {
    const previous = entries.get(key);
    try {
      const value = await loader();
      const storedAt = now();
      entries.set(key, { value, storedAt });
      return { value, stale: false, storedAt };
    } catch (error) {
      if (previous && error?.code !== 'NOT_FOUND') {
        return { value: previous.value, stale: true, storedAt: previous.storedAt, error };
      }
      throw error;
    }
  }

  function get(key, ttlMs, loader) {
    const entry = entries.get(key);
    if (entry && now() - entry.storedAt < ttlMs) {
      return Promise.resolve({ value: entry.value, stale: false, storedAt: entry.storedAt });
    }
    if (inflight.has(key)) return inflight.get(key);
    const promise = load(key, loader).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  return { get };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/cache.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/errors.js server/cache.js tests/cache.test.js
git commit -m "feat: add AppError and TTL cache with stale fallback"
```

---

### Task 4: 보유 종목·일정 저장소(`store.js`)

**Files:**
- Create: `server/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: `AppError` (Task 3)
- Produces:
  - `normalizeSymbol(raw) → string`: 앞뒤 공백을 지우고 대문자로 바꾼다. `^[A-Z0-9.\-]{1,10}$`에 맞지 않으면 `VALIDATION`을 던진다.
  - `validateHoldingFields({shares, avgCost}) → {shares, avgCost}`
  - `validateEvent({title, date, note}) → {title, date, note}`
  - `createStore({filePath, idGen?})` → 아래 메서드를 가진 객체. 모든 메서드는 Promise를 돌려준다.
    - `read() → {version, holdings, events}`
    - `addHolding({symbol, shares, avgCost}) → holding`
    - `updateHolding(symbol, {shares, avgCost}) → holding`
    - `removeHolding(symbol) → void`
    - `addEvent({title, date, note}) → event`
    - `updateEvent(id, {title, date, note}) → event`
    - `removeEvent(id) → void`
  - 오류 코드:
    - `VALIDATION` 400
    - `DUPLICATE` 409
    - `NOT_FOUND` 404: 메시지는 종목이면 `보유 목록에 없는 종목입니다.`, 일정이면 `일정을 찾을 수 없습니다.`
    - `STORE_CORRUPT` 500

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/store.test.js`:

```js
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore, normalizeSymbol, validateEvent } from '../server/store.js';

let filePath;
let store;

beforeEach(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'stock-store-'));
  filePath = path.join(dir, 'data', 'portfolio.json');
  let n = 0;
  store = createStore({ filePath, idGen: () => `e_${++n}` });
});

test('파일이 없으면 빈 포트폴리오를 돌려준다', async () => {
  assert.deepEqual(await store.read(), { version: 1, holdings: [], events: [] });
});

test('종목을 저장하고 다시 읽으면 같다', async () => {
  await store.addHolding({ symbol: 'SOFI', shares: 500, avgCost: 14.2 });
  const again = createStore({ filePath });
  assert.deepEqual((await again.read()).holdings, [{ symbol: 'SOFI', shares: 500, avgCost: 14.2 }]);
});

test('티커는 공백을 지우고 대문자로 저장하며, 정규화 후 중복을 막는다', async () => {
  const h = await store.addHolding({ symbol: ' sofi ', shares: 1, avgCost: 1 });
  assert.equal(h.symbol, 'SOFI');
  await assert.rejects(store.addHolding({ symbol: 'Sofi', shares: 2, avgCost: 2 }), { code: 'DUPLICATE', status: 409 });
});

test('점이 들어간 티커(BRK.B)를 허용한다', () => {
  assert.equal(normalizeSymbol('brk.b'), 'BRK.B');
  assert.throws(() => normalizeSymbol('AB CD'), { code: 'VALIDATION' });
  assert.throws(() => normalizeSymbol(''), { code: 'VALIDATION' });
  assert.throws(() => normalizeSymbol('ABCDEFGHIJK'), { code: 'VALIDATION' });
});

test('수량·평단가는 0보다 큰 숫자여야 한다(소수 허용)', async () => {
  await store.addHolding({ symbol: 'A', shares: 0.25, avgCost: 10 });
  for (const bad of [0, -1, NaN, Infinity, '10', null]) {
    await assert.rejects(store.addHolding({ symbol: 'B', shares: bad, avgCost: 10 }), { code: 'VALIDATION' });
    await assert.rejects(store.addHolding({ symbol: 'B', shares: 1, avgCost: bad }), { code: 'VALIDATION' });
  }
});

test('종목 수정과 삭제, 없는 종목은 NOT_FOUND', async () => {
  await store.addHolding({ symbol: 'AAPL', shares: 1, avgCost: 100 });
  const h = await store.updateHolding('aapl', { shares: 3, avgCost: 150 });
  assert.deepEqual(h, { symbol: 'AAPL', shares: 3, avgCost: 150 });
  await store.removeHolding('AAPL');
  assert.deepEqual((await store.read()).holdings, []);
  await assert.rejects(store.removeHolding('AAPL'), { code: 'NOT_FOUND', status: 404 });
  await assert.rejects(store.updateHolding('MSFT', { shares: 1, avgCost: 1 }), { code: 'NOT_FOUND' });
});

test('빠르게 연속으로 추가해도 모두 저장된다', async () => {
  await Promise.all([
    store.addHolding({ symbol: 'A', shares: 1, avgCost: 1 }),
    store.addHolding({ symbol: 'B', shares: 1, avgCost: 1 }),
    store.addHolding({ symbol: 'C', shares: 1, avgCost: 1 }),
  ]);
  const saved = JSON.parse(await readFile(filePath, 'utf8'));
  assert.deepEqual(saved.holdings.map((h) => h.symbol).sort(), ['A', 'B', 'C']);
});

test('일정 추가·수정·삭제', async () => {
  const ev = await store.addEvent({ title: ' FOMC ', date: '2026-10-28' });
  assert.deepEqual(ev, { id: 'e_1', title: 'FOMC', date: '2026-10-28', note: '' });
  const up = await store.updateEvent('e_1', { title: 'FOMC 금리 결정', date: '2026-10-29', note: '밤 3시' });
  assert.equal(up.note, '밤 3시');
  await store.removeEvent('e_1');
  assert.deepEqual((await store.read()).events, []);
  await assert.rejects(store.removeEvent('e_1'), { code: 'NOT_FOUND' });
});

test('일정 검증: 제목 1~60자, 실제 존재하는 날짜, 메모 200자 이하', () => {
  assert.throws(() => validateEvent({ title: '', date: '2026-10-28' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'x'.repeat(61), date: '2026-10-28' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '2026-02-30' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '10/28/2026' }), { code: 'VALIDATION' });
  assert.throws(() => validateEvent({ title: 'a', date: '2026-10-28', note: 'x'.repeat(201) }), { code: 'VALIDATION' });
});

test('깨진 파일은 덮어쓰지 않고 모든 요청을 거부한다', async () => {
  await store.addHolding({ symbol: 'A', shares: 1, avgCost: 1 });
  await writeFile(filePath, '{ not json', 'utf8');
  await assert.rejects(store.read(), { code: 'STORE_CORRUPT' });
  await assert.rejects(store.addHolding({ symbol: 'B', shares: 1, avgCost: 1 }), { code: 'STORE_CORRUPT' });
  assert.equal(await readFile(filePath, 'utf8'), '{ not json');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/store.test.js`
Expected: FAIL. `Cannot find module` 오류가 난다.

- [ ] **Step 3: 구현**

`server/store.js`:

```js
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (message) => new AppError('VALIDATION', message, 400);

export function normalizeSymbol(raw) {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw invalid('티커는 영문·숫자·점(.)·하이픈(-)으로 된 1~10자여야 합니다.');
  }
  return symbol;
}

function positiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${label}은(는) 0보다 큰 숫자여야 합니다.`);
  }
  return value;
}

export function validateHoldingFields({ shares, avgCost } = {}) {
  return { shares: positiveNumber(shares, '수량'), avgCost: positiveNumber(avgCost, '평단가') };
}

export function validateEvent({ title, date, note = '' } = {}) {
  const t = String(title ?? '').trim();
  if (t.length < 1 || t.length > 60) throw invalid('일정 제목은 1~60자여야 합니다.');
  const d = String(date ?? '');
  const parsed = new Date(`${d}T00:00:00Z`);
  if (!DATE_RE.test(d) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
    throw invalid('날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  }
  const n = String(note ?? '').trim();
  if (n.length > 200) throw invalid('메모는 200자 이하여야 합니다.');
  return { title: t, date: d, note: n };
}

const emptyPortfolio = () => ({ version: 1, holdings: [], events: [] });
const defaultId = () => `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function createStore({ filePath, idGen = defaultId }) {
  // 모든 읽기·쓰기를 한 줄로 세워, 연속 저장이 서로를 덮어쓰지 않게 한다.
  let queue = Promise.resolve();
  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function load() {
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return emptyPortfolio();
      throw err;
    }
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.holdings) || !Array.isArray(data.events)) throw new Error('shape');
      return data;
    } catch {
      throw new AppError(
        'STORE_CORRUPT',
        `${path.basename(filePath)} 파일을 읽을 수 없습니다. 파일을 고치거나 백업으로 바꾼 뒤 서버를 다시 켜주세요. (원본은 그대로 두었습니다)`,
        500,
      );
    }
  }

  async function save(data) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmp, filePath);
  }

  function mutate(fn) {
    return serialize(async () => {
      const data = await load();
      const result = fn(data);
      await save(data);
      return result;
    });
  }

  const holdingNotFound = () => new AppError('NOT_FOUND', '보유 목록에 없는 종목입니다.', 404);
  const eventNotFound = () => new AppError('NOT_FOUND', '일정을 찾을 수 없습니다.', 404);

  return {
    read: () => serialize(load),

    async addHolding(input = {}) {
      const symbol = normalizeSymbol(input.symbol);
      const fields = validateHoldingFields(input);
      return mutate((data) => {
        if (data.holdings.some((h) => h.symbol === symbol)) {
          throw new AppError('DUPLICATE', `${symbol}은(는) 이미 있습니다. 표에서 [수정]을 눌러 바꿔주세요.`, 409);
        }
        const holding = { symbol, ...fields };
        data.holdings.push(holding);
        return holding;
      });
    },

    async updateHolding(rawSymbol, input = {}) {
      const symbol = normalizeSymbol(rawSymbol);
      const fields = validateHoldingFields(input);
      return mutate((data) => {
        const holding = data.holdings.find((h) => h.symbol === symbol);
        if (!holding) throw holdingNotFound();
        Object.assign(holding, fields);
        return holding;
      });
    },

    async removeHolding(rawSymbol) {
      const symbol = normalizeSymbol(rawSymbol);
      return mutate((data) => {
        const i = data.holdings.findIndex((h) => h.symbol === symbol);
        if (i < 0) throw holdingNotFound();
        data.holdings.splice(i, 1);
      });
    },

    async addEvent(input = {}) {
      const fields = validateEvent(input);
      return mutate((data) => {
        const event = { id: idGen(), ...fields };
        data.events.push(event);
        return event;
      });
    },

    async updateEvent(id, input = {}) {
      const fields = validateEvent(input);
      return mutate((data) => {
        const event = data.events.find((e) => e.id === id);
        if (!event) throw eventNotFound();
        Object.assign(event, fields);
        return event;
      });
    },

    async removeEvent(id) {
      return mutate((data) => {
        const i = data.events.findIndex((e) => e.id === id);
        if (i < 0) throw eventNotFound();
        data.events.splice(i, 1);
      });
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/store.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/store.js tests/store.test.js
git commit -m "feat: add portfolio store with validation and atomic writes"
```

---

### Task 5: 미국 장 상태 판정(`market.js`)

**Files:**
- Create: `server/market.js`
- Test: `tests/market.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `computeMarketStatus(date: Date, holidays: {date: 'YYYY-MM-DD', tradingHour: string}[] = []) → {isOpen: boolean, session: 'pre'|'regular'|'post'|'closed'}`
  - `tradingHour`가 `''`이면 종일 휴장, `'09:30-13:00'`이면 조기 폐장이다.
  - 세션 구간(뉴욕 시간):
    - `pre`: 04:00~개장
    - `regular`: 개장~폐장
    - `post`: 폐장~20:00
    - `closed`: 그 외 시간, 주말, 종일 휴장일

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/market.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMarketStatus } from '../server/market.js';

const at = (iso, holidays) => computeMarketStatus(new Date(iso), holidays);

test('평일 장중·장전·장후·야간 (서머타임 기간, 뉴욕 = UTC-4)', () => {
  assert.deepEqual(at('2026-09-28T14:00:00Z'), { isOpen: true, session: 'regular' }); // 10:00
  assert.deepEqual(at('2026-09-28T13:00:00Z'), { isOpen: false, session: 'pre' });    // 09:00
  assert.deepEqual(at('2026-09-28T20:30:00Z'), { isOpen: false, session: 'post' });   // 16:30
  assert.deepEqual(at('2026-09-29T01:00:00Z'), { isOpen: false, session: 'closed' }); // 21:00
});

test('주말은 닫혀 있다', () => {
  assert.deepEqual(at('2026-09-26T15:00:00Z'), { isOpen: false, session: 'closed' }); // 토요일
});

test('서머타임 종료 후(뉴욕 = UTC-5)', () => {
  assert.deepEqual(at('2026-11-02T14:45:00Z'), { isOpen: true, session: 'regular' }); // 09:45 EST
  assert.deepEqual(at('2026-11-02T14:15:00Z'), { isOpen: false, session: 'pre' });    // 09:15 EST
});

test('서머타임 시작 직후', () => {
  assert.deepEqual(at('2026-03-09T13:45:00Z'), { isOpen: true, session: 'regular' }); // 09:45 EDT
});

test('종일 휴장일과 조기 폐장일', () => {
  const holidays = [
    { date: '2026-11-26', tradingHour: '' },
    { date: '2026-11-27', tradingHour: '09:30-13:00' },
  ];
  assert.deepEqual(at('2026-11-26T15:00:00Z', holidays), { isOpen: false, session: 'closed' });
  assert.deepEqual(at('2026-11-27T17:30:00Z', holidays), { isOpen: true, session: 'regular' }); // 12:30 EST
  assert.deepEqual(at('2026-11-27T18:30:00Z', holidays), { isOpen: false, session: 'post' });   // 13:30 EST
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/market.test.js`
Expected: FAIL. `Cannot find module` 오류가 난다.

- [ ] **Step 3: 구현**

`server/market.js`:

```js
// 미국 장 상태 판정. 서머타임은 Intl의 America/New_York 시간대가 처리한다.

const NY = 'America/New_York';
const PRE_START = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const POST_END = 20 * 60;

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

function nyClock(date) {
  const p = Object.fromEntries(clockFormat.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function computeMarketStatus(date, holidays = []) {
  const closed = { isOpen: false, session: 'closed' };
  const { day, weekday, minutes } = nyClock(date);
  if (weekday === 'Sat' || weekday === 'Sun') return closed;

  let open = REGULAR_OPEN;
  let close = REGULAR_CLOSE;
  const holiday = holidays.find((h) => h.date === day);
  if (holiday) {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(holiday.tradingHour ?? '');
    if (!m) return closed;
    open = toMinutes(m[1]);
    close = toMinutes(m[2]);
  }

  if (minutes >= open && minutes < close) return { isOpen: true, session: 'regular' };
  if (minutes >= PRE_START && minutes < open) return { isOpen: false, session: 'pre' };
  if (minutes >= close && minutes < POST_END) return { isOpen: false, session: 'post' };
  return closed;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/market.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/market.js tests/market.test.js
git commit -m "feat: add US market session detection"
```

---

### Task 6: 외부 데이터 클라이언트(`finnhub.js`, `fx.js`)

**Files:**
- Create: `server/finnhub.js`, `server/fx.js`
- Test: `tests/finnhub.test.js`, `tests/fx.test.js`

**Interfaces:**
- Consumes: `AppError` (Task 3), `createCache` (Task 3)
- Produces:
  - `createFinnhubClient({apiKey, fetch?, now?, cache?})` → 아래 메서드를 가진 객체. 메서드는 모두 `Promise<{value, stale}>`를 돌려준다.
    - `quote(symbol)` → `value = {price, change, changePct, prevClose, time}`. 가격이 0 이하면 `NOT_FOUND`.
    - `profile(symbol)` → `value = {symbol, name}`. 빈 응답이면 `NOT_FOUND`(`찾을 수 없는 티커입니다.`).
    - `news(symbol, {from, to})` → `value = [{symbol, headline, source, url, datetime(ms)}]`. 최신순 5개.
    - `earnings(symbol, {from, to})` → `value = [{symbol, date, hour, epsEstimate}]`
    - `holidays()` → `value = [{date, tradingHour}]`
    - `keyStatus()` → `'ok'|'missing'|'invalid'` (동기 함수)
  - `createFxClient({fetch?, now?, cache?})` → `{ usdKrw() → Promise<{value: {rate, date}, stale}> }`
- 오류 코드:
  - 키 없음 → `MISSING_KEY` 503
  - 401 → `INVALID_KEY` 503
  - 403 → `UPSTREAM` 502 (무료 플랜 미제공)
  - 429 → `RATE_LIMITED` 503. 백오프는 5초부터 두 배씩, 최대 60초.
  - 연결 실패·그 밖의 HTTP 오류 → `UPSTREAM` 502

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/finnhub.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFinnhubClient } from '../server/finnhub.js';

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// handler(url: URL) → { status?, body } 또는 throw(연결 실패 흉내)
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    const { status = 200, body = {} } = await handler(u);
    return new Response(JSON.stringify(body), { status });
  };
  fn.calls = calls;
  return fn;
}

const QUOTE = { c: 16.67, d: -0.22, dp: -1.3, pc: 16.89, t: 1790000000 };

test('quote: 필드를 바꿔 담고 키는 헤더로만 보낸다', async () => {
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'secret', fetch, now: clock() });
  const r = await fh.quote('SOFI');
  assert.deepEqual(r.value, { price: 16.67, change: -0.22, changePct: -1.3, prevClose: 16.89, time: 1790000000 });
  const { url, init } = fetch.calls[0];
  assert.equal(url.pathname, '/api/v1/quote');
  assert.equal(url.searchParams.get('symbol'), 'SOFI');
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(init.headers['X-Finnhub-Token'], 'secret');
});

test('quote: 점이 들어간 티커를 그대로 보낸다', async () => {
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  await fh.quote('BRK.B');
  assert.equal(fetch.calls[0].url.searchParams.get('symbol'), 'BRK.B');
});

test('quote: 15초 동안 캐시한다', async () => {
  const now = clock();
  const fetch = fakeFetch(() => ({ body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now });
  await fh.quote('SOFI');
  now.advance(14_000);
  await fh.quote('SOFI');
  assert.equal(fetch.calls.length, 1);
  now.advance(2_000);
  await fh.quote('SOFI');
  assert.equal(fetch.calls.length, 2);
});

test('quote: 가격 0은 없는 종목으로 본다', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ body: { c: 0, d: null, dp: null, pc: 0, t: 0 } })), now: clock() });
  await assert.rejects(fh.quote('NOPE'), { code: 'NOT_FOUND' });
});

test('429: 이전 값은 stale로 주고, 백오프 동안은 호출하지 않는다', async () => {
  const now = clock();
  let limited = false;
  const fetch = fakeFetch(() => (limited ? { status: 429, body: {} } : { body: QUOTE }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now });
  await fh.quote('SOFI');
  limited = true;
  now.advance(16_000);
  const r1 = await fh.quote('SOFI');
  assert.equal(r1.stale, true);
  assert.equal(r1.value.price, 16.67);
  assert.equal(fetch.calls.length, 2);
  now.advance(1_000);
  const r2 = await fh.quote('SOFI');
  assert.equal(r2.stale, true);
  assert.equal(fetch.calls.length, 2, '백오프 중에는 Finnhub를 부르지 않는다');
});

test('429: 이전 값이 없으면 RATE_LIMITED', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => ({ status: 429 })), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'RATE_LIMITED' });
});

test('키 상태: 없음·잘못됨·정상', async () => {
  const missing = createFinnhubClient({ apiKey: '', fetch: fakeFetch(() => ({ body: QUOTE })), now: clock() });
  assert.equal(missing.keyStatus(), 'missing');
  await assert.rejects(missing.quote('SOFI'), { code: 'MISSING_KEY' });

  let ok = false;
  const fh = createFinnhubClient({ apiKey: 'bad', fetch: fakeFetch(() => (ok ? { body: QUOTE } : { status: 401 })), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'INVALID_KEY' });
  assert.equal(fh.keyStatus(), 'invalid');
  ok = true;
  await fh.quote('AAPL');
  assert.equal(fh.keyStatus(), 'ok');
});

test('연결 실패는 UPSTREAM', async () => {
  const fh = createFinnhubClient({ apiKey: 'k', fetch: fakeFetch(() => { throw new TypeError('fetch failed'); }), now: clock() });
  await assert.rejects(fh.quote('SOFI'), { code: 'UPSTREAM' });
});

test('profile: 회사명, 빈 응답은 NOT_FOUND', async () => {
  const fh = createFinnhubClient({
    apiKey: 'k',
    now: clock(),
    fetch: fakeFetch((u) => ({ body: u.searchParams.get('symbol') === 'SOFI' ? { name: 'SoFi Technologies Inc', ticker: 'SOFI' } : {} })),
  });
  assert.deepEqual((await fh.profile('SOFI')).value, { symbol: 'SOFI', name: 'SoFi Technologies Inc' });
  await assert.rejects(fh.profile('NOPE'), { code: 'NOT_FOUND', message: '찾을 수 없는 티커입니다.' });
});

test('news: 최신순 5개, 링크 없는 기사 제외, 시간은 ms', async () => {
  const items = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
    datetime: 1_790_000_000 + i, headline: `h${i}`, source: 'S', url: i === 7 ? '' : `https://x/${i}`,
  }));
  const fetch = fakeFetch(() => ({ body: items }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  const r = await fh.news('SOFI', { from: '2026-09-21', to: '2026-09-28' });
  assert.deepEqual(r.value.map((n) => n.headline), ['h6', 'h5', 'h4', 'h3', 'h2']);
  assert.deepEqual(r.value[0], { symbol: 'SOFI', headline: 'h6', source: 'S', url: 'https://x/6', datetime: 1_790_000_006_000 });
  const { url } = fetch.calls[0];
  assert.equal(url.pathname, '/api/v1/company-news');
  assert.equal(url.searchParams.get('from'), '2026-09-21');
  assert.equal(url.searchParams.get('to'), '2026-09-28');
});

test('earnings: 일정을 바꿔 담고, 비어 있으면 빈 배열', async () => {
  let body = { earningsCalendar: [{ date: '2026-10-27', epsEstimate: 0.12, hour: 'bmo', symbol: 'SOFI', year: 2026, quarter: 3 }] };
  const fetch = fakeFetch(() => ({ body }));
  const fh = createFinnhubClient({ apiKey: 'k', fetch, now: clock() });
  const r = await fh.earnings('SOFI', { from: '2026-09-28', to: '2026-12-27' });
  assert.deepEqual(r.value, [{ symbol: 'SOFI', date: '2026-10-27', hour: 'bmo', epsEstimate: 0.12 }]);
  assert.equal(fetch.calls[0].url.pathname, '/api/v1/calendar/earnings');
  body = { earningsCalendar: null };
  assert.deepEqual((await fh.earnings('AAPL', { from: '2026-09-28', to: '2026-12-27' })).value, []);
});

test('holidays: 날짜와 거래 시간', async () => {
  const fh = createFinnhubClient({
    apiKey: 'k',
    now: clock(),
    fetch: fakeFetch(() => ({ body: { data: [{ eventName: 'Thanksgiving', atDate: '2026-11-26', tradingHour: '' }] } })),
  });
  assert.deepEqual((await fh.holidays()).value, [{ date: '2026-11-26', tradingHour: '' }]);
});
```

`tests/fx.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFxClient } from '../server/fx.js';

const respond = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('USD→KRW 환율과 기준일', async () => {
  const fx = createFxClient({ fetch: respond(200, { amount: 1, base: 'USD', date: '2026-09-25', rates: { KRW: 1391.2 } }) });
  assert.deepEqual((await fx.usdKrw()).value, { rate: 1391.2, date: '2026-09-25' });
});

test('서버 오류와 잘못된 응답은 UPSTREAM', async () => {
  await assert.rejects(createFxClient({ fetch: respond(500, {}) }).usdKrw(), { code: 'UPSTREAM' });
  await assert.rejects(createFxClient({ fetch: respond(200, { rates: {} }) }).usdKrw(), { code: 'UPSTREAM' });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/finnhub.test.js tests/fx.test.js`
Expected: FAIL. `Cannot find module` 오류가 난다.

- [ ] **Step 3: 구현**

`server/finnhub.js`:

```js
import { AppError } from './errors.js';
import { createCache } from './cache.js';

const BASE = 'https://finnhub.io/api/v1';
const TTL = {
  quote: 15_000,
  profile: 86_400_000,
  news: 1_800_000,
  earnings: 21_600_000,
  holidays: 86_400_000,
};
const FIRST_BACKOFF = 5_000;
const MAX_BACKOFF = 60_000;
const NEWS_PER_SYMBOL = 5;

export function createFinnhubClient({ apiKey, fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }) }) {
  let authFailed = false;
  let backoffMs = 0;
  let blockedUntil = 0;

  async function request(pathname, params) {
    if (!apiKey) {
      throw new AppError('MISSING_KEY', 'Finnhub API 키가 없습니다. .env 파일에 FINNHUB_API_KEY를 넣고 서버를 다시 켜주세요.', 503);
    }
    if (now() < blockedUntil) {
      throw new AppError('RATE_LIMITED', 'Finnhub 호출 한도를 넘어 잠시 쉬는 중입니다.', 503);
    }
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res;
    try {
      res = await fetch(url, { headers: { 'X-Finnhub-Token': apiKey } });
    } catch {
      throw new AppError('UPSTREAM', 'Finnhub에 연결할 수 없습니다. 인터넷 연결을 확인해주세요.', 502);
    }

    if (res.status === 401) {
      authFailed = true;
      throw new AppError('INVALID_KEY', 'Finnhub API 키가 올바르지 않습니다. .env 파일의 FINNHUB_API_KEY를 확인해주세요.', 503);
    }
    if (res.status === 403) {
      throw new AppError('UPSTREAM', '이 데이터는 Finnhub 무료 플랜에서 제공되지 않습니다.', 502);
    }
    if (res.status === 429) {
      backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF) : FIRST_BACKOFF;
      blockedUntil = now() + backoffMs;
      throw new AppError('RATE_LIMITED', 'Finnhub 호출 한도를 넘어 잠시 쉬는 중입니다.', 503);
    }
    if (!res.ok) {
      throw new AppError('UPSTREAM', `Finnhub 오류가 발생했습니다. (${res.status})`, 502);
    }

    authFailed = false;
    backoffMs = 0;
    return res.json();
  }

  return {
    keyStatus() {
      if (!apiKey) return 'missing';
      return authFailed ? 'invalid' : 'ok';
    },

    quote(symbol) {
      return cache.get(`quote:${symbol}`, TTL.quote, async () => {
        const q = await request('/quote', { symbol });
        if (!(q?.c > 0)) throw new AppError('NOT_FOUND', `${symbol} 시세를 찾을 수 없습니다.`, 404);
        return { price: q.c, change: q.d, changePct: q.dp, prevClose: q.pc, time: q.t };
      });
    },

    profile(symbol) {
      return cache.get(`profile:${symbol}`, TTL.profile, async () => {
        const p = await request('/stock/profile2', { symbol });
        if (!p?.name) throw new AppError('NOT_FOUND', '찾을 수 없는 티커입니다.', 404);
        return { symbol, name: p.name };
      });
    },

    news(symbol, { from, to }) {
      return cache.get(`news:${symbol}:${from}`, TTL.news, async () => {
        const list = await request('/company-news', { symbol, from, to });
        return (Array.isArray(list) ? list : [])
          .filter((n) => n.headline && n.url)
          .sort((a, b) => b.datetime - a.datetime)
          .slice(0, NEWS_PER_SYMBOL)
          .map((n) => ({ symbol, headline: n.headline, source: n.source ?? '', url: n.url, datetime: n.datetime * 1000 }));
      });
    },

    earnings(symbol, { from, to }) {
      return cache.get(`earnings:${symbol}:${from}`, TTL.earnings, async () => {
        const data = await request('/calendar/earnings', { symbol, from, to });
        return (data?.earningsCalendar ?? [])
          .filter((e) => e.symbol === symbol && e.date)
          .map((e) => ({ symbol, date: e.date, hour: e.hour ?? '', epsEstimate: e.epsEstimate ?? null }));
      });
    },

    holidays() {
      return cache.get('holidays', TTL.holidays, async () => {
        const data = await request('/stock/market-holiday', { exchange: 'US' });
        return (data?.data ?? []).map((h) => ({ date: h.atDate, tradingHour: h.tradingHour ?? '' }));
      });
    },
  };
}
```

`server/fx.js`:

```js
import { AppError } from './errors.js';
import { createCache } from './cache.js';

const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW';
const FX_TTL = 21_600_000;

export function createFxClient({ fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }) } = {}) {
  return {
    usdKrw() {
      return cache.get('usdkrw', FX_TTL, async () => {
        let res;
        try {
          res = await fetch(FX_URL);
        } catch {
          throw new AppError('UPSTREAM', '환율 서버에 연결할 수 없습니다.', 502);
        }
        if (!res.ok) throw new AppError('UPSTREAM', `환율 서버 오류가 발생했습니다. (${res.status})`, 502);
        const data = await res.json();
        const rate = data?.rates?.KRW;
        if (!(rate > 0)) throw new AppError('UPSTREAM', '환율 응답 형식이 올바르지 않습니다.', 502);
        return { rate, date: data.date };
      });
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/finnhub.test.js tests/fx.test.js`
Expected: PASS (14 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/finnhub.js server/fx.js tests/finnhub.test.js tests/fx.test.js
git commit -m "feat: add Finnhub and FX clients with caching and backoff"
```

---

### Task 7: API 서버(`app.js`)와 진입점(`index.js`)

**Files:**
- Create: `server/app.js`, `server/index.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes:
  - `createStore`, `normalizeSymbol`, `validateHoldingFields` (Task 4)
  - `computeMarketStatus` (Task 5)
  - Finnhub·환율 클라이언트 인터페이스 (Task 6)
  - `dateInZone`, `addDays` (Task 2)
  - `AppError` (Task 3)
- Produces:
  - `createApp({store, finnhub, fx, now?: () => Date, publicDir, vendorDir}) → express.Application`
  - HTTP API(프론트엔드가 사용):
    - `GET /api/health` → `{finnhubKey}`
    - `GET /api/portfolio` → `{holdings, events}`
    - `POST /api/holdings` `{symbol, shares, avgCost}` → 201 `{symbol, shares, avgCost, name|null}`
    - `PUT /api/holdings/:symbol` `{shares, avgCost}` → 200 holding
    - `DELETE /api/holdings/:symbol` → 204
    - `POST /api/events` `{title, date, note}` → 201 event
    - `PUT /api/events/:id` → 200 event
    - `DELETE /api/events/:id` → 204
    - `GET /api/quotes?symbols=A,B` → `{A: {price, change, changePct, prevClose, time, name, stale}, B: {error: {code, message}}}`
    - `GET /api/news?symbols=` → `{items: [{symbol, headline, source, url, datetime}], failed: [symbol]}`
    - `GET /api/earnings?symbols=` → `{items: [{symbol, date, hour, epsEstimate}], failed: [symbol]}`
    - `GET /api/fx` → `{rate, date, stale}`
    - `GET /api/market-status` → `{isOpen, session}`
  - 정적 파일: `/` → `public/`, `/vendor/chart.js/` → `node_modules/chart.js/dist/`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/app.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createStore } from '../server/store.js';
import { AppError } from '../server/errors.js';

function fakeFinnhub(overrides = {}) {
  const calls = { profile: 0, news: [], earnings: [] };
  return {
    calls,
    keyStatus: () => 'ok',
    async quote(s) {
      if (s === 'NOPE') throw new AppError('NOT_FOUND', `${s} 시세를 찾을 수 없습니다.`, 404);
      return { value: { price: 10, change: 1, changePct: 11.1, prevClose: 9, time: 1 }, stale: false };
    },
    async profile(s) {
      calls.profile += 1;
      if (s === 'NOPE') throw new AppError('NOT_FOUND', '찾을 수 없는 티커입니다.', 404);
      return { value: { symbol: s, name: `${s} Inc` }, stale: false };
    },
    async news(s, range) {
      calls.news.push([s, range]);
      if (s === 'BAD') throw new AppError('UPSTREAM', 'x', 502);
      return { value: [{ symbol: s, headline: `${s} news`, source: 'T', url: `https://example.com/${s}`, datetime: s === 'AAA' ? 2000 : 1000 }], stale: false };
    },
    async earnings(s, range) {
      calls.earnings.push([s, range]);
      return { value: [{ symbol: s, date: s === 'AAA' ? '2026-11-05' : '2026-10-27', hour: 'bmo', epsEstimate: 0.1 }], stale: false };
    },
    async holidays() { return { value: [], stale: false }; },
    ...overrides,
  };
}

let ctx;

async function start({ finnhub = fakeFinnhub(), fx } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'stock-app-'));
  const filePath = path.join(dir, 'portfolio.json');
  let n = 0;
  const store = createStore({ filePath, idGen: () => `e_${++n}` });
  const app = createApp({
    store,
    finnhub,
    fx: fx ?? { usdKrw: async () => ({ value: { rate: 1400, date: '2026-09-25' }, stale: false }) },
    now: () => new Date('2026-09-28T14:00:00Z'), // 월요일 뉴욕 10:00
    publicDir: dir,
    vendorDir: dir,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined || raw ? { 'Content-Type': 'application/json' } : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { call, finnhub, filePath, close: () => new Promise((r) => server.close(r)) };
}

beforeEach(async () => { ctx = await start(); });
afterEach(async () => { await ctx.close(); });

test('종목 추가: 정규화하고 회사명을 붙여 201', async () => {
  const r = await ctx.call('POST', '/api/holdings', { symbol: ' sofi ', shares: 500, avgCost: 14.2 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body, { symbol: 'SOFI', shares: 500, avgCost: 14.2, name: 'SOFI Inc' });
  const p = await ctx.call('GET', '/api/portfolio');
  assert.deepEqual(p.body, { holdings: [{ symbol: 'SOFI', shares: 500, avgCost: 14.2 }], events: [] });
});

test('없는 티커는 400, 수량 오류는 티커 확인 전에 400', async () => {
  const r = await ctx.call('POST', '/api/holdings', { symbol: 'NOPE', shares: 1, avgCost: 1 });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: { code: 'NOT_FOUND', message: '찾을 수 없는 티커입니다.' } });
  const before = ctx.finnhub.calls.profile;
  const bad = await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 0, avgCost: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION');
  assert.equal(ctx.finnhub.calls.profile, before);
});

test('티커를 확인할 수 없으면(키 없음 등) 이름 없이 저장한다', async () => {
  await ctx.close();
  ctx = await start({ finnhub: fakeFinnhub({ profile: async () => { throw new AppError('MISSING_KEY', '키 없음', 503); } }) });
  const r = await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 1, avgCost: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.name, null);
});

test('중복 409, 수정 200, 삭제 204, 없는 종목 삭제 404', async () => {
  await ctx.call('POST', '/api/holdings', { symbol: 'AAA', shares: 1, avgCost: 1 });
  assert.equal((await ctx.call('POST', '/api/holdings', { symbol: 'aaa', shares: 1, avgCost: 1 })).status, 409);
  const up = await ctx.call('PUT', '/api/holdings/aaa', { shares: 2, avgCost: 3 });
  assert.deepEqual(up.body, { symbol: 'AAA', shares: 2, avgCost: 3 });
  assert.equal((await ctx.call('DELETE', '/api/holdings/AAA')).status, 204);
  assert.equal((await ctx.call('DELETE', '/api/holdings/AAA')).status, 404);
});

test('일정 추가·수정·삭제', async () => {
  const r = await ctx.call('POST', '/api/events', { title: 'FOMC', date: '2026-10-28' });
  assert.equal(r.status, 201);
  assert.equal(r.body.id, 'e_1');
  const up = await ctx.call('PUT', '/api/events/e_1', { title: 'FOMC', date: '2026-10-29', note: '새벽' });
  assert.equal(up.body.date, '2026-10-29');
  assert.equal((await ctx.call('DELETE', '/api/events/e_1')).status, 204);
  assert.equal((await ctx.call('POST', '/api/events', { title: '', date: '2026-10-28' })).status, 400);
});

test('시세: 성공 종목과 실패 종목을 함께 돌려준다', async () => {
  const r = await ctx.call('GET', '/api/quotes?symbols=aaa,NOPE,,bad symbol');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.AAA, { price: 10, change: 1, changePct: 11.1, prevClose: 9, time: 1, name: 'AAA Inc', stale: false });
  assert.equal(r.body.NOPE.error.code, 'NOT_FOUND');
  assert.deepEqual(Object.keys(r.body).sort(), ['AAA', 'NOPE']);
});

test('뉴스: 최신순으로 합치고 실패 종목을 알려준다', async () => {
  const r = await ctx.call('GET', '/api/news?symbols=BBB,AAA,BAD');
  assert.deepEqual(r.body.items.map((n) => n.symbol), ['AAA', 'BBB']);
  assert.deepEqual(r.body.failed, ['BAD']);
  assert.deepEqual(ctx.finnhub.calls.news[0][1], { from: '2026-09-21', to: '2026-09-28' });
});

test('실적: 오늘(뉴욕)부터 90일, 날짜순', async () => {
  const r = await ctx.call('GET', '/api/earnings?symbols=AAA,BBB');
  assert.deepEqual(r.body.items.map((e) => e.symbol), ['BBB', 'AAA']);
  assert.deepEqual(ctx.finnhub.calls.earnings[0][1], { from: '2026-09-28', to: '2026-12-27' });
});

test('장 상태: 휴장일 조회가 실패해도 시간표로 판정한다', async () => {
  await ctx.close();
  ctx = await start({ finnhub: fakeFinnhub({ holidays: async () => { throw new AppError('UPSTREAM', 'x', 502); } }) });
  const r = await ctx.call('GET', '/api/market-status');
  assert.deepEqual(r.body, { isOpen: true, session: 'regular' });
});

test('환율과 키 상태', async () => {
  assert.deepEqual((await ctx.call('GET', '/api/fx')).body, { rate: 1400, date: '2026-09-25', stale: false });
  assert.deepEqual((await ctx.call('GET', '/api/health')).body, { finnhubKey: 'ok' });
});

test('잘못된 JSON은 400, 없는 API 경로는 404', async () => {
  const bad = await ctx.call('POST', '/api/holdings', undefined, '{oops');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
  assert.equal((await ctx.call('GET', '/api/nothing')).status, 404);
});

test('깨진 저장 파일은 500 STORE_CORRUPT', async () => {
  await mkdir(path.dirname(ctx.filePath), { recursive: true });
  await writeFile(ctx.filePath, 'not json', 'utf8');
  const r = await ctx.call('GET', '/api/portfolio');
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'STORE_CORRUPT');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test tests/app.test.js`
Expected: FAIL. `Cannot find module '.../server/app.js'` 오류가 난다.

- [ ] **Step 3: `server/app.js` 구현**

```js
import express from 'express';
import { AppError } from './errors.js';
import { normalizeSymbol, validateHoldingFields } from './store.js';
import { computeMarketStatus } from './market.js';
import { dateInZone, addDays } from '../public/dday.js';

const NY = 'America/New_York';
const MAX_SYMBOLS = 30;
const EARNINGS_DAYS = 90;
const NEWS_DAYS = 7;

// "aaa,,bad symbol,AAA" → ["AAA"]. 형식이 틀린 티커는 조용히 건너뛴다.
function parseSymbols(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(',')) {
    try {
      const s = normalizeSymbol(part);
      if (!out.includes(s)) out.push(s);
    } catch {
      // 잘못된 티커는 무시
    }
  }
  return out.slice(0, MAX_SYMBOLS);
}

async function collect(symbols, fn) {
  const results = await Promise.allSettled(symbols.map(fn));
  const items = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value.value);
    else failed.push(symbols[i]);
  });
  return { items, failed };
}

export function createApp({ store, finnhub, fx, now = () => new Date(), publicDir, vendorDir }) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ finnhubKey: finnhub.keyStatus() });
  });

  app.get('/api/portfolio', async (req, res) => {
    const { holdings, events } = await store.read();
    res.json({ holdings, events });
  });

  app.post('/api/holdings', async (req, res) => {
    const body = req.body ?? {};
    const symbol = normalizeSymbol(body.symbol);
    validateHoldingFields(body); // 티커 확인(API 호출) 전에 입력부터 검사
    let name = null;
    try {
      name = (await finnhub.profile(symbol)).value.name;
    } catch (err) {
      if (err.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', '찾을 수 없는 티커입니다.', 400);
      // 키 없음·한도 초과·연결 실패로 확인할 수 없으면 이름 없이 저장한다.
    }
    const holding = await store.addHolding({ ...body, symbol });
    res.status(201).json({ ...holding, name });
  });

  app.put('/api/holdings/:symbol', async (req, res) => {
    res.json(await store.updateHolding(req.params.symbol, req.body ?? {}));
  });

  app.delete('/api/holdings/:symbol', async (req, res) => {
    await store.removeHolding(req.params.symbol);
    res.status(204).end();
  });

  app.post('/api/events', async (req, res) => {
    res.status(201).json(await store.addEvent(req.body ?? {}));
  });

  app.put('/api/events/:id', async (req, res) => {
    res.json(await store.updateEvent(req.params.id, req.body ?? {}));
  });

  app.delete('/api/events/:id', async (req, res) => {
    await store.removeEvent(req.params.id);
    res.status(204).end();
  });

  app.get('/api/quotes', async (req, res) => {
    const symbols = parseSymbols(req.query.symbols);
    const entries = await Promise.all(symbols.map(async (s) => {
      try {
        const q = await finnhub.quote(s);
        let name = null;
        try {
          name = (await finnhub.profile(s)).value.name;
        } catch {
          // 회사명은 없어도 된다
        }
        return [s, { ...q.value, name, stale: q.stale }];
      } catch (err) {
        return [s, { error: { code: err.code ?? 'UPSTREAM', message: err.message } }];
      }
    }));
    res.json(Object.fromEntries(entries));
  });

  app.get('/api/news', async (req, res) => {
    const to = dateInZone(now(), NY);
    const from = addDays(to, -NEWS_DAYS);
    const result = await collect(parseSymbols(req.query.symbols), (s) => finnhub.news(s, { from, to }));
    result.items.sort((a, b) => b.datetime - a.datetime);
    res.json(result);
  });

  app.get('/api/earnings', async (req, res) => {
    const from = dateInZone(now(), NY);
    const to = addDays(from, EARNINGS_DAYS);
    const result = await collect(parseSymbols(req.query.symbols), (s) => finnhub.earnings(s, { from, to }));
    result.items.sort((a, b) => a.date.localeCompare(b.date));
    res.json(result);
  });

  app.get('/api/fx', async (req, res) => {
    const r = await fx.usdKrw();
    res.json({ rate: r.value.rate, date: r.value.date, stale: r.stale });
  });

  app.get('/api/market-status', async (req, res) => {
    let holidays = [];
    try {
      holidays = (await finnhub.holidays()).value;
    } catch {
      // 휴장일 정보가 없으면 시간표만으로 판정
    }
    res.json(computeMarketStatus(now(), holidays));
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 API 경로입니다.' } });
  });

  app.use('/vendor/chart.js', express.static(vendorDir));
  app.use(express.static(publicDir));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: '요청 형식(JSON)이 올바르지 않습니다.' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: '서버 내부 오류가 발생했습니다.' } });
  });

  return app;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/app.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: `server/index.js` 진입점 작성**

```js
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createFinnhubClient } from './finnhub.js';
import { createFxClient } from './fx.js';

// 내 PC에서만 접속하도록 고정한다. 바꾸지 말 것.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiKey = (process.env.FINNHUB_API_KEY ?? '').trim();

const app = createApp({
  store: createStore({ filePath: path.join(root, 'data', 'portfolio.json') }),
  finnhub: createFinnhubClient({ apiKey }),
  fx: createFxClient(),
  publicDir: path.join(root, 'public'),
  vendorDir: path.join(root, 'node_modules', 'chart.js', 'dist'),
});

const server = http.createServer(app);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`포트 ${PORT}이(가) 이미 사용 중입니다. .env 파일의 PORT 값을 다른 번호(예: ${PORT + 1})로 바꾼 뒤 다시 실행해주세요.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`주식 대시보드: http://${HOST}:${PORT}`);
  if (!apiKey) {
    console.warn('Finnhub API 키가 없습니다. .env.example을 .env로 복사하고 FINNHUB_API_KEY를 넣어주세요.');
  }
});
```

- [ ] **Step 6: 기동과 포트 충돌 확인**

Run: `npm start` (백그라운드로 실행)
Expected: `주식 대시보드: http://127.0.0.1:5173`가 출력되고, 키가 없으면 경고 한 줄이 함께 나온다.

Run: `curl -s http://127.0.0.1:5173/api/health`
Expected: `{"finnhubKey":"missing"}` (`.env`가 없을 때)

같은 포트로 두 번째 `npm start`를 실행한다.
Expected: `포트 5173이(가) 이미 사용 중입니다...` 안내가 나오고 종료 코드 1로 끝난다.

두 서버를 모두 끈다.

- [ ] **Step 7: 전체 테스트 후 커밋**

Run: `npm test`
Expected: 모든 테스트 PASS

```bash
git add server/app.js server/index.js tests/app.test.js
git commit -m "feat: add API routes and localhost-only entry point"
```

---

### Task 8: 화면 뼈대, 요약 카드, 보유 종목 표, 새로고침

**Files:**
- Create: `public/index.html`, `public/styles.css`, `public/api.js`, `public/app.js`, `public/views/dom.js`, `public/views/summary.js`, `public/views/holdings.js`

**Interfaces:**
- Consumes:
  - `computePortfolio`, `mergeQuotes`, `sortRows` (Task 1)
  - format 함수들 (Task 2)
  - HTTP API (Task 7)
- Produces:
  - `api` 객체 — 메서드: `health`, `portfolio`, `addHolding`, `updateHolding`, `removeHolding`, `addEvent`, `updateEvent`, `removeEvent`, `quotes`, `news`, `earnings`, `fx`, `marketStatus`. 실패하면 `Error{code, message}`를 던진다.
  - `h(tag, className?, text?) → HTMLElement`
  - `renderSummary(el, {totals, excludedCount, fx, stale})`
  - `renderHoldings(tbody, rows, {names, onEdit, onDelete})`
  - `app.js`의 훅 함수: `state`, `render()`, `refreshAll()`, `afterHoldingChange()`, `afterEventChange()`, `notify(message)`. Task 9~11은 `app.js`에서 이 함수들을 이어서 쓴다.

이 과제는 DOM 코드라 자동 테스트가 없다. Step 5의 수동 확인이 테스트 단계를 대신한다.

- [ ] **Step 1: `public/index.html`**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>내 포트폴리오</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/vendor/chart.js/chart.umd.js"></script>
  <script type="module" src="/app.js"></script>
</head>
<body>
  <div id="banner" class="banner" role="alert" hidden></div>
  <div id="toast" class="toast" role="status" hidden></div>

  <header class="topbar">
    <h1>내 포트폴리오</h1>
    <div class="topbar-right">
      <span id="status" class="status">불러오는 중…</span>
      <button id="refresh-btn" type="button" class="icon" title="지금 새로고침" aria-label="지금 새로고침">⟳</button>
      <button id="add-holding-btn" type="button" class="primary">+ 종목 추가</button>
    </div>
  </header>

  <main class="layout">
    <div class="col-main">
      <section id="summary" class="summary" aria-label="요약"></section>

      <section class="card">
        <div class="table-wrap">
          <table class="holdings">
            <thead>
              <tr>
                <th data-sort="symbol" class="left">종목</th>
                <th data-sort="shares">수량</th>
                <th data-sort="avgCost">평단가</th>
                <th data-sort="price">현재가</th>
                <th data-sort="dayChangePct">오늘</th>
                <th data-sort="marketValue">평가금액</th>
                <th data-sort="pnl">평가손익</th>
                <th data-sort="weight">비중</th>
                <th aria-label="관리"></th>
              </tr>
            </thead>
            <tbody id="holdings-body"></tbody>
          </table>
        </div>
        <p id="holdings-empty" class="empty" hidden>아직 종목이 없습니다. 오른쪽 위 [+ 종목 추가]로 첫 종목을 넣어보세요.</p>
      </section>

      <section class="card charts">
        <div>
          <h2>평가금액 비중</h2>
          <div class="chart-box"><canvas id="weight-chart" aria-label="종목별 평가금액 비중"></canvas></div>
        </div>
        <div>
          <h2>종목별 평가손익</h2>
          <div class="chart-box"><canvas id="pnl-chart" aria-label="종목별 평가손익"></canvas></div>
        </div>
      </section>
    </div>

    <aside class="col-side">
      <section class="card">
        <div class="card-head">
          <h2>디데이</h2>
          <button id="add-event-btn" type="button">+ 일정 추가</button>
        </div>
        <ol id="dday-list" class="dday"></ol>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>뉴스</h2>
          <select id="news-filter" aria-label="뉴스 종목 필터"><option value="">전체</option></select>
        </div>
        <ul id="news-list" class="news"></ul>
      </section>
    </aside>
  </main>

  <dialog id="holding-dialog">
    <form id="holding-form" method="dialog">
      <h2 id="holding-title">종목 추가</h2>
      <label>티커 <input id="h-symbol" autocomplete="off" placeholder="예: AAPL" required></label>
      <label>수량 <input id="h-shares" inputmode="decimal" placeholder="예: 10" required></label>
      <label>평단가 (USD) <input id="h-avgcost" inputmode="decimal" placeholder="예: 180.50" required></label>
      <p id="holding-error" class="form-error" hidden></p>
      <div class="actions">
        <button type="submit" value="cancel" formnovalidate>취소</button>
        <button id="holding-save" type="submit" value="save" class="primary">저장</button>
      </div>
    </form>
  </dialog>

  <dialog id="event-dialog">
    <form id="event-form" method="dialog">
      <h2 id="event-title">일정 추가</h2>
      <label>제목 <input id="ev-title" maxlength="60" placeholder="예: FOMC 금리 발표" required></label>
      <label>날짜 <input id="ev-date" type="date" required></label>
      <label>메모 <input id="ev-note" maxlength="200" placeholder="선택"></label>
      <p id="event-error" class="form-error" hidden></p>
      <div class="actions">
        <button id="event-delete" type="button" class="danger-text" hidden>삭제</button>
        <span class="spacer"></span>
        <button type="submit" value="cancel" formnovalidate>취소</button>
        <button id="event-save" type="submit" value="save" class="primary">저장</button>
      </div>
    </form>
  </dialog>

  <dialog id="confirm-dialog">
    <form method="dialog">
      <p id="confirm-message"></p>
      <div class="actions">
        <button type="submit" value="cancel">취소</button>
        <button type="submit" value="ok" class="danger">삭제</button>
      </div>
    </form>
  </dialog>
</body>
</html>
```

- [ ] **Step 2: `public/styles.css`**

```css
:root {
  --bg: #f4f6f9;
  --card: #ffffff;
  --ink: #16191f;
  --muted: #667085;
  --line: #e4e7ec;
  --accent: #1f3a8a;
  --up: #d6293a;
  --down: #1f5fd1;
  --warn: #b45309;
  --warn-bg: #fff7ed;
  --radius: 10px;
  font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  font-size: 15px;
  color: var(--ink);
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 10px; }
button {
  font: inherit; border: 1px solid var(--line); background: var(--card); color: var(--ink);
  border-radius: 8px; padding: 6px 12px; cursor: pointer;
}
button:hover { border-color: var(--accent); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.danger { background: var(--up); border-color: var(--up); color: #fff; }
button.danger-text { color: var(--up); }
button.icon { padding: 6px 10px; }
button:disabled { opacity: 0.5; cursor: wait; }

.num, .holdings th { font-variant-numeric: tabular-nums; }
.up { color: var(--up); }
.down { color: var(--down); }
.flat { color: var(--ink); }

.banner { background: var(--warn-bg); color: var(--warn); border-bottom: 1px solid #fed7aa; padding: 10px 24px; }
.toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 8px; z-index: 10;
}

.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding: 16px 24px; background: var(--card); border-bottom: 1px solid var(--line);
}
.topbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.status { color: var(--muted); font-size: 13px; }
.status.warn { color: var(--warn); font-weight: 600; }

.layout {
  display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px;
  padding: 16px 24px 40px; max-width: 1400px; margin: 0 auto;
}
.col-main, .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
@media (max-width: 1000px) { .layout { grid-template-columns: minmax(0, 1fr); } }

.card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.card-head h2 { margin: 0; }
.empty { color: var(--muted); margin: 8px 0 0; }

.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.summary.is-stale .tile-value { opacity: 0.55; }
.tile { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; }
.tile-label { color: var(--muted); font-size: 13px; }
.tile-value { font-size: 22px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
.tile-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }

.table-wrap { overflow-x: auto; }
.holdings { width: 100%; border-collapse: collapse; }
.holdings th, .holdings td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.holdings th.left, .holdings td.sym { text-align: left; }
.holdings th[data-sort] { cursor: pointer; color: var(--muted); font-weight: 600; font-size: 13px; user-select: none; }
.holdings th[aria-sort="ascending"]::after { content: " ▲"; }
.holdings th[aria-sort="descending"]::after { content: " ▼"; }
.holdings tr.is-stale td.num { opacity: 0.55; }
.holdings .name { display: block; color: var(--muted); font-size: 12px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.holdings .warn-mark { color: var(--warn); margin-left: 6px; cursor: help; }
.holdings .sub { font-size: 12px; }
.row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.row-actions button { padding: 3px 8px; font-size: 13px; }

.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.chart-box { position: relative; height: 260px; }
.chart-empty { color: var(--muted); }

.dday, .news { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.dday li { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: start; }
.dday-badge {
  font-weight: 700; font-variant-numeric: tabular-nums; text-align: center;
  border: 1px solid var(--line); border-radius: 6px; padding: 4px 0; font-size: 13px;
}
.dday-badge.soon { background: var(--up); border-color: var(--up); color: #fff; }
.dday-title { font-weight: 600; }
.dday-detail { color: var(--muted); font-size: 13px; }
.dday-edit { border: none; padding: 0; background: none; color: var(--accent); font-size: 13px; }

.news li { border-bottom: 1px solid var(--line); padding-bottom: 10px; }
.news li:last-child { border-bottom: none; }
.news-meta { color: var(--muted); font-size: 12px; }
.news a { color: var(--ink); text-decoration: none; line-height: 1.4; }
.news a:hover { text-decoration: underline; }

dialog { border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; width: min(380px, 92vw); }
dialog::backdrop { background: rgb(15 23 42 / 0.35); }
dialog form { display: flex; flex-direction: column; gap: 12px; }
dialog label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
dialog input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); }
.actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }
.spacer { flex: 1; }
.form-error { color: var(--up); margin: 0; font-size: 13px; }
```

- [ ] **Step 3: `public/api.js`, `public/views/dom.js`, `public/views/summary.js`, `public/views/holdings.js`**

`public/api.js`:

```js
// 서버 /api 호출. 실패하면 서버가 준 한국어 메시지로 Error를 던진다.

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('대시보드 서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해주세요.'), { code: 'OFFLINE' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message ?? `요청이 실패했습니다. (${res.status})`), {
      code: data?.error?.code ?? `HTTP_${res.status}`,
    });
  }
  return data;
}

const list = (symbols) => encodeURIComponent(symbols.join(','));
const seg = (s) => encodeURIComponent(s);

export const api = {
  health: () => call('GET', '/api/health'),
  portfolio: () => call('GET', '/api/portfolio'),
  addHolding: (h) => call('POST', '/api/holdings', h),
  updateHolding: (symbol, h) => call('PUT', `/api/holdings/${seg(symbol)}`, h),
  removeHolding: (symbol) => call('DELETE', `/api/holdings/${seg(symbol)}`),
  addEvent: (e) => call('POST', '/api/events', e),
  updateEvent: (id, e) => call('PUT', `/api/events/${seg(id)}`, e),
  removeEvent: (id) => call('DELETE', `/api/events/${seg(id)}`),
  quotes: (symbols) => call('GET', `/api/quotes?symbols=${list(symbols)}`),
  news: (symbols) => call('GET', `/api/news?symbols=${list(symbols)}`),
  earnings: (symbols) => call('GET', `/api/earnings?symbols=${list(symbols)}`),
  fx: () => call('GET', '/api/fx'),
  marketStatus: () => call('GET', '/api/market-status'),
};
```

`public/views/dom.js`:

```js
// 요소 생성 도우미. 외부 데이터는 항상 textContent로 넣는다.
export function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}
```

`public/views/summary.js`:

```js
import { h } from './dom.js';
import { formatUsd, formatPct, formatKrw, signClass } from '../format.js';

export function renderSummary(el, { totals, excludedCount, fx, stale }) {
  const krw = fx
    ? `≈ ${formatKrw(totals.marketValue * fx.rate)} (기준환율 ${fx.date}${fx.stale ? ' · 지연' : ''})`
    : '원화 환산: 환율 확인 중';
  el.replaceChildren(
    tile('총 평가금액', formatUsd(totals.marketValue), krw, 'flat'),
    tile(
      '총 평가손익',
      `${formatUsd(totals.pnl, { sign: true })} (${formatPct(totals.pnlPct, { sign: true })})`,
      `매입금액 ${formatUsd(totals.cost)}`,
      signClass(totals.pnl),
    ),
    tile(
      '오늘 등락',
      `${formatUsd(totals.dayChange, { sign: true })} (${formatPct(totals.dayChangePct, { sign: true })})`,
      excludedCount ? `${excludedCount}개 종목 제외 (시세 없음)` : '',
      signClass(totals.dayChange),
    ),
  );
  el.classList.toggle('is-stale', stale);
}

function tile(label, value, sub, cls) {
  const box = h('div', 'tile');
  box.append(h('div', 'tile-label', label), h('div', `tile-value ${cls}`, value));
  if (sub) box.append(h('div', 'tile-sub', sub));
  return box;
}
```

`public/views/holdings.js`:

```js
import { h } from './dom.js';
import { formatUsd, formatPct, formatShares, signClass } from '../format.js';

export function renderHoldings(tbody, rows, { names, onEdit, onDelete }) {
  tbody.replaceChildren(...rows.map((r) => {
    const tr = h('tr', r.stale ? 'is-stale' : '');
    tr.append(
      symbolCell(r, names[r.symbol]),
      h('td', 'num', formatShares(r.shares)),
      h('td', 'num', formatUsd(r.avgCost)),
      h('td', 'num', formatUsd(r.price)),
      h('td', `num ${signClass(r.dayChangePct)}`, formatPct(r.dayChangePct, { sign: true })),
      h('td', 'num', formatUsd(r.marketValue)),
      pnlCell(r),
      h('td', 'num', formatPct(r.weight)),
      actionsCell(r, onEdit, onDelete),
    );
    return tr;
  }));
}

function symbolCell(r, name) {
  const td = h('td', 'sym');
  td.append(h('strong', null, r.symbol));
  if (r.error || r.stale) {
    const mark = h('span', 'warn-mark', '⚠');
    mark.title = r.stale ? '최신 시세를 받지 못해 마지막 값을 보여줍니다.' : r.error.message;
    td.append(mark);
  }
  td.append(h('span', 'name', name ?? ''));
  return td;
}

function pnlCell(r) {
  const td = h('td', `num ${signClass(r.pnl)}`);
  td.append(h('div', null, formatUsd(r.pnl, { sign: true })), h('div', 'sub', formatPct(r.pnlPct, { sign: true })));
  return td;
}

function actionsCell(r, onEdit, onDelete) {
  const td = h('td');
  const box = h('div', 'row-actions');
  const edit = h('button', null, '수정');
  edit.type = 'button';
  edit.addEventListener('click', () => onEdit(r));
  const del = h('button', null, '삭제');
  del.type = 'button';
  del.addEventListener('click', () => onDelete(r));
  box.append(edit, del);
  td.append(box);
  return td;
}
```

- [ ] **Step 4: `public/app.js` (상태·새로고침·렌더링)**

```js
import { api } from './api.js';
import { computePortfolio, mergeQuotes, sortRows } from './calc.js';
import { formatClock } from './format.js';
import { renderSummary } from './views/summary.js';
import { renderHoldings } from './views/holdings.js';

const QUOTE_MS = 30_000;
const MARKET_MS = 60_000;
const SLOW_MS = 30 * 60_000;
const TOAST_MS = 5_000;

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
    state.quoteProblem = values.some((q) => q.error || q.stale) ? '일부 시세가 지연되고 있습니다.' : null;
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
  const [news, earnings, fx] = await Promise.allSettled([
    list.length ? api.news(list) : Promise.resolve({ items: [], failed: [] }),
    list.length ? api.earnings(list) : Promise.resolve({ items: [], failed: [] }),
    api.fx(),
  ]);
  if (news.status === 'fulfilled') {
    state.news = news.value.items;
    state.newsFailed = news.value.failed;
  }
  if (earnings.status === 'fulfilled') state.earnings = earnings.value.items;
  if (fx.status === 'fulfilled') state.fx = fx.value;
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
  await Promise.all([refreshHealth(), refreshMarket(), refreshQuotes(), refreshSlow()]);
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

function renderStatus() {
  const el = $('status');
  const clock = state.lastQuoteAt ? formatClock(state.lastQuoteAt) : null;
  el.classList.remove('warn');
  if (state.quoteProblem && clock) {
    el.textContent = `지연 · 마지막 갱신 ${clock}`;
    el.classList.add('warn');
  } else if (!state.market) {
    el.textContent = '장 상태 확인 중';
  } else if (state.market.isOpen) {
    el.textContent = clock ? `장중 · ${clock} 갱신 (30초마다)` : '장중';
  } else {
    el.textContent = clock ? `장 마감 · 종가 기준 (${clock} 확인)` : '장 마감 · 종가 기준';
  }
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

function wireControls() {
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
  setInterval(async () => { await refreshMarket(); render(); }, MARKET_MS);
  setInterval(async () => { await refreshSlow(); render(); }, SLOW_MS);
}

async function main() {
  wireControls();
  await import('./setup.js');
  await refreshAll();
  startSchedulers();
}

main();
```

`public/setup.js` (Task 9~11에서 채울 연결 파일. 지금은 비워 둔다):

```js
// 화면 영역(대화상자·차트·디데이·뉴스)을 app.js에 연결한다. Task 9~11에서 채운다.
```

- [ ] **Step 5: 수동 확인**

Run: `npm start`, 브라우저에서 `http://127.0.0.1:5173` 열기

확인할 것 (키 없는 상태):
- 위쪽에 키 안내 배너가 보인다.
- 요약 카드 3개에 `$0.00`이 보인다.
- 표 아래에 "아직 종목이 없습니다" 문구가 보인다.
- 오른쪽 위 상태 표시가 "장중" 또는 "장 마감 · 종가 기준"이다.
- 브라우저 개발자 도구 콘솔에 오류가 없다.

그다음 서버를 끄고 `data/portfolio.json`을 아래 내용으로 직접 만든다.

```json
{ "version": 1, "holdings": [{ "symbol": "AAPL", "shares": 10, "avgCost": 180 }], "events": [] }
```

`.env`에 실제 Finnhub 키를 넣고 다시 `npm start` 한다.
- 표에 AAPL 줄이 생기고 현재가, 평가금액, 손익이 채워진다.
- 이익은 빨강, 손해는 파랑으로 보인다.
- 열 제목을 누르면 정렬되고 ▲/▼ 표시가 바뀐다.
- [⟳]를 누르면 상태 표시의 시각이 바뀐다.

- [ ] **Step 6: 커밋**

```bash
git add public/index.html public/styles.css public/api.js public/app.js public/setup.js public/views/dom.js public/views/summary.js public/views/holdings.js
git commit -m "feat: add dashboard shell with summary, holdings table and refresh"
```

---

### Task 9: 종목 추가·수정·삭제 대화상자

**Files:**
- Create: `public/forms.js`
- Modify: `public/setup.js`

**Interfaces:**
- Consumes:
  - `api` (Task 8)
  - `app.js`의 `handlers`, `afterHoldingChange`, `afterEventChange`, `notify` (Task 8)
  - `parseAmount` (Task 1)
- Produces:
  - `openHoldingDialog({mode: 'add'|'edit', holding?, onSubmit(values) → Promise})`
  - `openEventDialog({event?, onSubmit(values) → Promise, onDelete?() → Promise})` (Task 10에서 사용)
  - `confirmDialog(message) → Promise<boolean>`

- [ ] **Step 1: `public/forms.js`**

```js
import { parseAmount } from './calc.js';

const $ = (id) => document.getElementById(id);

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

// 저장 버튼이면 onSubmit을 기다리고, 실패하면 대화상자 안에 오류를 보여준다.
function bindSubmit(form, dialog, saveBtn, errorEl, collect) {
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== 'save') return; // 취소는 기본 동작(닫기)
    e.preventDefault();
    const result = collect();
    if (result.error) {
      showError(errorEl, result.error);
      return;
    }
    saveBtn.disabled = true;
    try {
      await result.submit();
      dialog.close();
    } catch (err) {
      showError(errorEl, err.message);
    } finally {
      saveBtn.disabled = false;
    }
  };
}

export function openHoldingDialog({ mode, holding = null, onSubmit }) {
  const dialog = $('holding-dialog');
  const symbol = $('h-symbol');
  const shares = $('h-shares');
  const avgCost = $('h-avgcost');
  const errorEl = $('holding-error');

  $('holding-title').textContent = mode === 'edit' ? `${holding.symbol} 수정` : '종목 추가';
  symbol.value = holding?.symbol ?? '';
  symbol.disabled = mode === 'edit';
  shares.value = holding?.shares ?? '';
  avgCost.value = holding?.avgCost ?? '';
  errorEl.hidden = true;

  bindSubmit($('holding-form'), dialog, $('holding-save'), errorEl, () => {
    const values = {
      symbol: symbol.value.trim(),
      shares: parseAmount(shares.value),
      avgCost: parseAmount(avgCost.value),
    };
    if (!values.symbol) return { error: '티커를 입력해주세요.' };
    if (!(values.shares > 0) || !(values.avgCost > 0)) {
      return { error: '수량과 평단가는 0보다 큰 숫자로 입력해주세요. (예: 1,000 또는 14.20)' };
    }
    return { submit: () => onSubmit(values) };
  });

  dialog.showModal();
  (mode === 'edit' ? shares : symbol).focus();
}

export function openEventDialog({ event = null, onSubmit, onDelete }) {
  const dialog = $('event-dialog');
  const title = $('ev-title');
  const date = $('ev-date');
  const note = $('ev-note');
  const errorEl = $('event-error');
  const del = $('event-delete');

  $('event-title').textContent = event ? '일정 수정' : '일정 추가';
  title.value = event?.title ?? '';
  date.value = event?.date ?? '';
  note.value = event?.note ?? '';
  errorEl.hidden = true;
  del.hidden = !event;
  del.onclick = async () => {
    dialog.close();
    await onDelete?.();
  };

  bindSubmit($('event-form'), dialog, $('event-save'), errorEl, () => {
    const values = { title: title.value.trim(), date: date.value, note: note.value.trim() };
    if (!values.title) return { error: '제목을 입력해주세요.' };
    if (!values.date) return { error: '날짜를 골라주세요.' };
    return { submit: () => onSubmit(values) };
  });

  dialog.showModal();
  title.focus();
}

export function confirmDialog(message) {
  const dialog = $('confirm-dialog');
  $('confirm-message').textContent = message;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}
```

- [ ] **Step 2: `public/setup.js`에 종목 대화상자 연결**

```js
// 화면 영역(대화상자·차트·디데이·뉴스)을 app.js에 연결한다.
import { api } from './api.js';
import { state, handlers, afterHoldingChange, notify } from './app.js';
import { openHoldingDialog, confirmDialog } from './forms.js';

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
```

`app.js`와 `setup.js`는 서로를 import한다. `setup.js`는 `main()` 안에서 동적 `import()`로 불러오므로, `app.js`가 모두 평가된 뒤에 실행된다. 그래서 순환 참조 문제가 없다.

- [ ] **Step 3: 수동 확인**

Run: `npm start`, 브라우저 새로고침

확인할 것:
- [+ 종목 추가] → `  msft `, `1,000`, `$400.5` 입력 → 저장하면 표에 `MSFT` 1,000주 $400.50이 생기고 아래에 알림이 뜬다.
- 같은 티커 `msft`를 다시 추가하면 대화상자 안에 "MSFT은(는) 이미 있습니다..."가 보이고 대화상자가 닫히지 않는다.
- `ZZZZZZ` 추가 → "찾을 수 없는 티커입니다."가 보인다.
- 수량에 `-5` 입력 → "수량과 평단가는 0보다 큰 숫자로..."가 보인다.
- [수정]을 누르면 티커 칸은 잠겨 있고, 수량을 바꿔 저장하면 표가 바뀐다.
- [삭제] → 확인 대화상자에서 [취소]를 누르면 그대로이고, [삭제]를 누르면 사라진다.
- `data/portfolio.json`을 열어 변경 내용이 반영됐는지 본다.

- [ ] **Step 4: 커밋**

```bash
git add public/forms.js public/setup.js
git commit -m "feat: add holding add/edit/delete dialogs"
```

---

### Task 10: 비중·손익 차트

**Files:**
- Create: `public/views/charts.js`
- Modify: `public/setup.js` (끝에 추가)

**Interfaces:**
- Consumes:
  - `addRenderer` (Task 8). 콜백은 `computePortfolio` 결과를 받는다.
  - `formatUsd`, `formatPct` (Task 2)
  - 전역 `window.Chart` (Chart.js UMD)
- Produces: `createCharts(weightCanvas, pnlCanvas) → { update(rows) }`

- [ ] **Step 1: `public/views/charts.js`**

```js
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
```

- [ ] **Step 2: `public/setup.js` 끝에 추가**

```js
import { addRenderer } from './app.js';
import { createCharts } from './views/charts.js';

const charts = createCharts(document.getElementById('weight-chart'), document.getElementById('pnl-chart'));
addRenderer((portfolio) => charts.update(portfolio.rows));
```

(`import` 문은 파일 맨 위의 기존 import 블록으로 옮긴다. `addRenderer`는 기존 `./app.js` import 줄에 합친다.)

- [ ] **Step 3: 수동 확인**

- 종목이 2개 이상 있을 때 도넛 차트의 조각 비율이 표의 "비중" 열과 같다.
- 막대 차트에서 이익 종목은 빨강, 손해 종목은 파랑이다.
- 막대에 마우스를 올리면 `+$1,234.00` 형식으로 보인다.
- 창 폭을 1000px 아래로 줄이면 오른쪽 패널이 아래로 내려가고 차트 크기가 맞춰진다.

- [ ] **Step 4: 커밋**

```bash
git add public/views/charts.js public/setup.js
git commit -m "feat: add allocation and P&L charts"
```

---

### Task 11: 디데이 패널과 뉴스 패널

**Files:**
- Create: `public/views/events.js`, `public/views/news.js`
- Modify: `public/setup.js` (끝에 추가)

**Interfaces:**
- Consumes:
  - `buildDdayList` (Task 2)
  - `formatUsd`, `relativeTime`, `isHttpUrl` (Task 2)
  - `openEventDialog`, `confirmDialog` (Task 9)
  - `state`, `addRenderer`, `afterEventChange`, `notify`, `render` (Task 8)
- Produces:
  - `renderDday(listEl, items, {onEdit})`
  - `renderNews(listEl, selectEl, items, {filter, symbols, failed})`

- [ ] **Step 1: `public/views/events.js`**

```js
import { h } from './dom.js';

export function renderDday(listEl, items, { onEdit }) {
  if (!items.length) {
    listEl.replaceChildren(h('li', 'empty', '앞으로 90일 안에 일정이 없습니다.'));
    return;
  }
  listEl.replaceChildren(...items.map((item) => {
    const li = h('li');
    const badge = h('div', `dday-badge${item.days <= 3 ? ' soon' : ''}`, item.label);
    const body = h('div');
    body.append(h('div', 'dday-title', item.title));
    for (const line of detailLines(item)) body.append(h('div', 'dday-detail', line));
    if (item.kind === 'event') {
      const edit = h('button', 'dday-edit', '수정');
      edit.type = 'button';
      edit.addEventListener('click', () => onEdit(item));
      body.append(edit);
    }
    li.append(badge, body);
    return li;
  }));
}

function detailLines(item) {
  if (item.kind === 'earnings') {
    const eps = item.epsEstimate != null ? `예상 EPS $${item.epsEstimate.toFixed(2)}` : '예상 EPS 미정';
    return [
      `${item.date} (미국) · ${item.session ?? '시간 미정'} · ${eps}`,
      ...(item.koreaHint ? [item.koreaHint] : []),
    ];
  }
  return [item.date, ...(item.note ? [item.note] : [])];
}
```

- [ ] **Step 2: `public/views/news.js`**

```js
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
```

- [ ] **Step 3: `public/setup.js` 끝에 추가**

```js
import { buildDdayList } from './dday.js';
import { renderDday } from './views/events.js';
import { renderNews } from './views/news.js';
import { openEventDialog } from './forms.js';
// 기존 import 줄에 합칠 것: afterEventChange, render (./app.js)

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
```

이 과제가 끝나면 `setup.js`의 import 블록은 아래와 같아야 한다.

```js
import { api } from './api.js';
import { state, handlers, addRenderer, afterHoldingChange, afterEventChange, render, notify } from './app.js';
import { openHoldingDialog, openEventDialog, confirmDialog } from './forms.js';
import { createCharts } from './views/charts.js';
import { buildDdayList } from './dday.js';
import { renderDday } from './views/events.js';
import { renderNews } from './views/news.js';
```

- [ ] **Step 4: 수동 확인**

- 실적이 90일 안에 잡힌 종목(예: 대형 기술주)을 넣으면 디데이 목록에 `D-n TICKER 실적`, `미국 날짜 · 장전/장후 · 예상 EPS`, `한국시간 …` 줄이 보인다.
- [+ 일정 추가] → 제목 `FOMC`, 날짜는 3일 뒤 → 저장하면 목록에 날짜순으로 끼어들고 빨간 배지(`D-3`)가 보인다.
- 일정의 [수정] → 메모를 넣고 저장하면 반영된다. 다시 [수정] → [삭제] → 확인하면 사라진다.
- 날짜를 비우고 저장 → "날짜를 골라주세요."
- 뉴스 목록에 `티커 · 출처 · n시간 전`과 제목이 보이고, 누르면 새 탭에서 원문이 열린다.
- 종목 필터로 한 종목만 고르면 그 종목 뉴스만 보인다.
- 필터로 고른 종목을 삭제하면 필터가 "전체"로 돌아간다.

- [ ] **Step 5: 커밋**

```bash
git add public/views/events.js public/views/news.js public/setup.js
git commit -m "feat: add D-day and news panels"
```

---

### Task 12: README, 스펙 정리, 최종 점검

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-27-stock-dashboard-design.md` (섹션 5 폴더 구조, 섹션 7 API 표)

**Interfaces:**
- Consumes: 전체
- Produces: 실행 문서

- [ ] **Step 1: `README.md`**

````markdown
# 내 주식 대시보드

내 PC에서만 여는 미국 주식 포트폴리오 대시보드입니다. 실시간 시세로 평가손익과 비중을 보여주고, 실적발표일·직접 넣은 일정을 디데이로, 보유 종목 뉴스를 목록으로 보여줍니다.

## 준비

1. Node.js 24 이상
2. [finnhub.io](https://finnhub.io)에서 무료 가입 후 API 키 발급

## 설치와 실행

```bash
npm install
cp .env.example .env   # .env를 열어 FINNHUB_API_KEY에 키를 넣는다
npm start
```

브라우저에서 콘솔에 나온 주소(기본 `http://127.0.0.1:5173`)를 엽니다.

## 데이터와 보안

- 보유 종목과 일정은 `data/portfolio.json`에 저장됩니다. 이 파일을 복사해 두면 백업이 됩니다.
- 서버는 `127.0.0.1`에서만 열려서 같은 네트워크의 다른 기기에서는 접속할 수 없습니다.
- 외부(Finnhub)로 나가는 정보는 조회하는 티커뿐입니다. 수량·평단가는 PC 밖으로 나가지 않습니다.
- `.env`와 `data/`는 git에 올라가지 않습니다.

## 갱신 주기

- 시세: 미국 장중 30초마다 (장외에는 자동 갱신 멈춤, [⟳]로 수동 갱신)
- 뉴스·실적 일정·환율: 30분마다
- 원화 환산은 하루 1번 고시되는 기준환율(Frankfurter)을 씁니다.

## 테스트

```bash
npm test
```
````

- [ ] **Step 2: 스펙 문서를 구현에 맞게 고치기**

`docs/superpowers/specs/2026-09-27-stock-dashboard-design.md` 섹션 5 폴더 구조에서 서버 파일 목록을 아래로 바꾼다.

```
│  ├─ app.js        # createApp(): 라우트·정적 파일·오류 처리
│  ├─ index.js      # 진입점: 127.0.0.1 바인딩, 포트 충돌 안내
│  ├─ errors.js     # AppError
│  ├─ cache.js      # 범용 TTL 캐시(마지막 성공 값 보관)
```

섹션 7 API 표에서 세 줄을 아래처럼 고친다.

```
| `GET /api/news?symbols=A,B` | 최근 7일 뉴스 | `{items: [{symbol, headline, source, url, datetime}], failed: [symbol]}` |
| `GET /api/earnings?symbols=A,B` | 앞으로 90일 실적 일정 | `{items: [{symbol, date, hour, epsEstimate}], failed: [symbol]}` |
| `GET /api/market-status` | 장 상태 | `{isOpen, session}` |
```

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: 모든 테스트 PASS, 실패 0

- [ ] **Step 4: 최종 수동 점검 (실제 키)**

- 다른 기기(휴대폰 등)에서 `http://<PC의 IP>:5173` 접속이 **안 되는지** 확인한다.
- `data/portfolio.json`에 일부러 `{`만 남기고 서버를 켠다. 화면 배너에 "portfolio.json 파일을 읽을 수 없습니다..."가 보이고, 파일 내용이 그대로인지 확인한 뒤 원래대로 돌려놓는다.
- 인터넷을 끊고 [⟳]를 누른다. 숫자가 흐려지고 상태 표시가 "지연 · 마지막 갱신 …"으로 바뀌며, 값은 0으로 바뀌지 않는다.
- `git status`에 `.env`와 `data/`가 보이지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/superpowers/specs/2026-09-27-stock-dashboard-design.md
git commit -m "docs: add README and align spec with implementation"
```
