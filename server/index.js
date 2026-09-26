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
