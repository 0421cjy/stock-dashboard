// Finnhub 무료 실시간 체결은 일부 종목(SOFI, SPYM 등)에는 거의 오지 않는다.
// 정규장 동안, 최근 quietMs 동안 체결이 오지 않은 종목만 Yahoo 정규장 가격으로 intervalMs마다 채운다.
const MAX_SYMBOLS = 20;

export function startLiveFill({ stream, yahoo, isRegular, intervalMs = 5_000, quietMs = 10_000, every = setInterval, cancel = clearInterval }) {
  let running = false;

  async function tick() {
    if (running) return; // 앞 차례가 아직 끝나지 않았으면 건너뛴다
    running = true;
    try {
      const symbols = stream.quietSymbols(quietMs).slice(0, MAX_SYMBOLS);
      if (!symbols.length || !(await isRegular())) return;
      await Promise.all(symbols.map(async (s) => {
        try {
          const trade = (await yahoo.regular(s)).value;
          if (trade) stream.inject(s, trade);
        } catch {
          // Yahoo가 막히면 30초 시세 조회로 버틴다
        }
      }));
    } finally {
      running = false;
    }
  }

  const timer = every(tick, intervalMs);
  return { tick, stop: () => cancel(timer) };
}
