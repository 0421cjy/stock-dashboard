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
