import express from 'express';
import { AppError } from './errors.js';
import { normalizeSymbol, validateHoldingFields } from './store.js';
import { computeMarketStatus } from './market.js';
import { dateInZone, addDays } from '../public/dday.js';
import { HISTORY_RANGES } from './extended.js';
import { holdingsResolver, buildSeries, fxResolver, lateListed } from './history.js';

const NY = 'America/New_York';
const MAX_SYMBOLS = 30;
const EARNINGS_DAYS = 90;
const NEWS_DAYS = 7;
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

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

export function createApp({ store, finnhub, fx, extended = null, stream = null, history = null, streamFlushMs = 1_000, now = () => new Date(), publicDir, vendorDir, fontDir }) {
  const app = express();

  // 오늘(뉴욕 날짜)의 보유 종목을 자산 추이 기록에 남긴다
  async function recordHoldings() {
    if (!history) return;
    const { holdings } = await store.read();
    await history.record(dateInZone(now(), NY), holdings);
  }

  // DNS rebinding 방어: 다른 도메인 이름으로 들어온 요청(악성 사이트가 자기 도메인을
  // 127.0.0.1로 돌려놓은 경우)은 보유 내역에 닿기 전에 막는다.
  app.use((req, res, next) => {
    const hostname = String(req.headers.host ?? '').replace(/:\d+$/, '');
    if (ALLOWED_HOSTS.has(hostname)) return next();
    res.status(403).json({ error: { code: 'FORBIDDEN_HOST', message: '이 주소로는 대시보드에 접근할 수 없습니다. http://127.0.0.1 로 열어주세요.' } });
  });

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
      // 회사 정보가 없으면(ETF 등) 시세가 있는지로 실제 티커인지 확인한다.
      if (!name) await finnhub.quote(symbol);
    } catch (err) {
      if (err.code === 'NOT_FOUND') throw new AppError('NOT_FOUND', '찾을 수 없는 티커입니다.', 400);
      // 키가 틀렸으면 저장하지 않고 알린다. 그래야 사용자가 키부터 고친다.
      if (err.code === 'INVALID_KEY') throw err;
      // 키 없음·한도 초과·연결 실패로 확인할 수 없으면 이름 없이 저장한다.
    }
    const holding = await store.addHolding({ ...body, symbol });
    await recordHoldings();
    res.status(201).json({ ...holding, name });
  });

  app.put('/api/holdings/:symbol', async (req, res) => {
    const holding = await store.updateHolding(req.params.symbol, req.body ?? {});
    await recordHoldings();
    res.json(holding);
  });

  // ETF 등 자동 배당 데이터가 없는 종목의 1주당 연 배당 직접 입력. null이면 지운다.
  app.put('/api/holdings/:symbol/dividend', async (req, res) => {
    res.json(await store.setManualDps(req.params.symbol, req.body?.manualDps));
  });

  app.delete('/api/holdings/:symbol', async (req, res) => {
    await store.removeHolding(req.params.symbol);
    await recordHoldings();
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

  app.get('/api/dividends', async (req, res) => {
    const result = await collect(parseSymbols(req.query.symbols), async (s) => ({ value: [(await finnhub.dividendMetrics(s)).value] }));
    res.json(result);
  });

  app.get('/api/fx', async (req, res) => {
    const r = await fx.usdKrw();
    res.json({ rate: r.value.rate, date: r.value.date, stale: r.stale });
  });

  async function marketStatus() {
    let holidays = [];
    try {
      holidays = (await finnhub.holidays()).value;
    } catch {
      // 휴장일 정보가 없으면 시간표만으로 판정
    }
    return computeMarketStatus(now(), holidays);
  }

  app.get('/api/market-status', async (req, res) => {
    res.json(await marketStatus());
  });

  // 프리마켓·애프터마켓 가격. 그 시간대가 아니면 묻지 않고 빈 결과를 준다.
  // { SYMBOL: { session, price, change, changeRatio, time } } — 시간외 거래가 없거나 못 가져온 종목은 빠진다.
  app.get('/api/extended', async (req, res) => {
    const { session } = await marketStatus();
    if (!extended || (session !== 'pre' && session !== 'post')) return res.json({});
    const symbols = parseSymbols(req.query.symbols);
    const entries = await Promise.all(symbols.map(async (s) => {
      try {
        const v = (await extended.price(s)).value;
        return v && v.session === session ? [s, v] : null;
      } catch {
        return null;
      }
    }));
    res.json(Object.fromEntries(entries.filter(Boolean)));
  });

  // 총 평가금액 추이. range: 1d(5분) | 1w(30분) | 1m·3m·1y(일별 종가)
  // { range, points: [{ t, date, value, krw, estimated }], base: { value, krw } | null, recordedSince, listedLate: [{ symbol, since }] }
  // base는 1d에서 전일 종가 기준 평가금액(오늘 등락의 기준). 원화는 그날의 기준환율(오늘은 지금 환율)로 바꾼다.
  app.get('/api/history', async (req, res) => {
    const range = String(req.query.range ?? '1m');
    if (!extended?.history || !HISTORY_RANGES[range]) throw new AppError('VALIDATION', '지원하지 않는 기간입니다.', 400);

    const { holdings } = await store.read();
    const snapshots = history?.snapshots() ?? [];
    // 기간 안에 갖고 있었던 종목까지 함께 받는다(지금은 판 종목 포함)
    const symbols = [...new Set([...holdings, ...snapshots.flatMap((s) => s.holdings)].map((h) => h.symbol))].slice(0, MAX_SYMBOLS);
    const bars = {};
    const previousClose = {};
    await Promise.all(symbols.map(async (s) => {
      try {
        const v = (await extended.history(s, range)).value;
        bars[s] = v.bars;
        previousClose[s] = v.previousClose;
      } catch {
        // 못 받은 종목은 빼고 그린다
      }
    }));

    const resolve = holdingsResolver(snapshots, holdings);
    const points = buildSeries(bars, resolve);
    // 기간 중 상장해 그 전에는 0으로 계산한 종목(지금 보유 중인 것만 알린다)
    const late = lateListed(bars);
    const listedLate = holdings.filter((h) => late[h.symbol]).map((h) => ({ symbol: h.symbol, since: late[h.symbol] }));

    let current = null;
    try { current = (await fx.usdKrw()).value.rate; } catch { /* 원화 없이 */ }
    let rates = {};
    if (points.length) {
      try { rates = (await fx.usdKrwSince(addDays(points[0].date, -7))).value; } catch { /* 지금 환율로 */ }
    }
    const fxAt = fxResolver(rates, current);
    const krw = (value, date) => {
      const rate = fxAt(date);
      return rate > 0 ? value * rate : null;
    };

    let base = null;
    if (range === '1d' && points.length) {
      const { holdings: held } = resolve(points[0].date);
      const value = held.reduce((sum, h) => sum + h.shares * (previousClose[h.symbol] ?? NaN), 0);
      if (Number.isFinite(value)) base = { value, krw: krw(value, addDays(points[0].date, -1)) };
    }

    res.json({
      range,
      points: points.map((p) => ({ t: p.t, date: p.date, value: p.value, krw: krw(p.value, p.date), estimated: p.estimated })),
      base,
      recordedSince: snapshots[0]?.date ?? null,
      listedLate,
    });
  });

  // 실시간 체결을 화면으로 흘려보낸다(Server-Sent Events). 1초에 한 번, 그사이 바뀐 종목의 마지막 체결만 보낸다.
  // data: { SYMBOL: { p: 가격, t: 체결 시각(ms) } }
  app.get('/api/stream', (req, res) => {
    const symbols = parseSymbols(req.query.symbols);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    if (!stream || !symbols.length) return; // 연결은 열어두되 보낼 것이 없다

    let pending = stream.snapshot(symbols);
    const flush = () => {
      if (!Object.keys(pending).length) return;
      res.write(`data: ${JSON.stringify(pending)}\n\n`);
      pending = {};
    };
    flush();
    const unsubscribe = stream.subscribe(symbols, (symbol, trade) => { pending[symbol] = trade; });
    const timer = setInterval(flush, streamFlushMs);
    // 프록시·브라우저가 조용한 연결을 끊지 않도록 가끔 주석을 보낸다
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(timer);
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 API 경로입니다.' } });
  });

  app.use('/vendor/chart.js', express.static(vendorDir));
  if (fontDir) app.use('/vendor/pretendard', express.static(fontDir));
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
