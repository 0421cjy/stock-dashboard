import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createStore } from './store.js';
import { createFinnhubClient } from './finnhub.js';
import { createFxClient } from './fx.js';
import { createNameStore } from './names.js';
import { createCache } from './cache.js';
import { createExtendedClient } from './extended.js';
import { createTradeStream } from './stream.js';
import { startLiveFill } from './livefill.js';
import { computeMarketStatus } from './market.js';

// 내 PC에서만 접속하도록 고정한다. 바꾸지 말 것.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5173;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiKey = (process.env.FINNHUB_API_KEY ?? '').trim();

const fx = createFxClient();
const store = createStore({ filePath: path.join(root, 'data', 'portfolio.json') });
// 뉴스·실적·배당·휴장일은 파일에도 저장해, 서버를 다시 켜도 유효 시간 안이면 Finnhub에 다시 묻지 않는다.
const finnhub = createFinnhubClient({
  apiKey,
  names: createNameStore({ filePath: path.join(root, 'data', 'names.json') }),
  cache: createCache({
    filePath: path.join(root, 'data', 'cache.json'),
    persist: (key) => key === 'holidays' || /^(news|earnings|dividend):/.test(key),
  }),
});
const yahoo = createExtendedClient();
const stream = createTradeStream({ apiKey });
// Finnhub 실시간 체결이 오지 않는 종목은 정규장 동안 5초마다 Yahoo 가격으로 채운다
startLiveFill({
  stream,
  yahoo,
  isRegular: async () => {
    const holidays = await finnhub.holidays().then((r) => r.value, () => []);
    return computeMarketStatus(new Date(), holidays).session === 'regular';
  },
});
const app = createApp({
  store,
  finnhub,
  fx,
  extended: yahoo,
  stream,
  publicDir: path.join(root, 'public'),
  vendorDir: path.join(root, 'node_modules', 'chart.js', 'dist'),
  fontDir: path.join(root, 'node_modules', 'pretendard', 'dist', 'web', 'variable'),
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
  warmUp();
  if (!apiKey) {
    console.warn('Finnhub API 키가 없습니다. .env.example을 .env로 복사하고 FINNHUB_API_KEY를 넣어주세요.');
  }
});

// 첫 접속 전에 화면이 부르는 API를 서버가 직접 한 번 불러 캐시를 채운다.
// 시세를 먼저, 뉴스·실적·배당을 나중에 보낸다. 실패해도 접속 시 다시 시도하므로 무시한다.
async function warmUp() {
  const base = `http://${HOST}:${PORT}/api`;
  const call = (p) => fetch(base + p).catch(() => {});
  call('/fx');
  if (!apiKey) return;
  let holdings = [];
  try {
    holdings = (await store.read()).holdings;
  } catch {
    return;
  }
  const q = holdings.length ? `?symbols=${encodeURIComponent(holdings.map((h) => h.symbol).join(','))}` : '';
  await Promise.all([call('/market-status'), q && call(`/quotes${q}`)]);
  if (q) await Promise.all(['/news', '/earnings', '/dividends'].map((p) => call(p + q)));
}
