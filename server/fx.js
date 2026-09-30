import { AppError } from './errors.js';
import { createCache } from './cache.js';

const FX_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW';
const FX_TTL = 21_600_000;
const FX_TIMEOUT_MS = 5_000;

export function createFxClient({ fetch = globalThis.fetch, now = Date.now, cache = createCache({ now }) } = {}) {
  return {
    usdKrw() {
      return cache.get('usdkrw', FX_TTL, async () => {
        let res;
        try {
          res = await fetch(FX_URL, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
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
