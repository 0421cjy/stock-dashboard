// Finnhub 실시간 체결(WebSocket). 연결은 하나만 열고, 화면들이 보고 있는 종목을 합쳐서 구독한다.
// 무료 플랜: 미국 주식 체결, 50종목까지. 분당 호출 한도와는 별개다.
const WS_URL = 'wss://ws.finnhub.io';
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

export function createTradeStream({ apiKey, WebSocketImpl = globalThis.WebSocket, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const counts = new Map(); // 종목 → 구독 중인 화면 수
  const latest = new Map(); // 종목 → { p, t } 마지막 체결
  const listeners = new Set();
  let ws = null;
  let open = false;
  let retryMs = 0;
  let retryTimer = null;

  const send = (type, symbol) => {
    if (open) ws.send(JSON.stringify({ type, symbol }));
  };

  function connect() {
    if (ws || retryTimer || !apiKey || !WebSocketImpl || counts.size === 0) return;
    // Finnhub WebSocket은 키를 주소로만 받는다(서버 안에서만 쓰고 화면으로는 보내지 않는다)
    ws = new WebSocketImpl(`${WS_URL}?token=${encodeURIComponent(apiKey)}`);
    ws.onopen = () => {
      open = true;
      retryMs = 0;
      for (const s of counts.keys()) send('subscribe', s);
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg?.type !== 'trade' || !Array.isArray(msg.data)) return;
      const changed = new Set();
      for (const d of msg.data) {
        if (!counts.has(d?.s) || !(d.p > 0) || !Number.isFinite(d.t)) continue;
        const prev = latest.get(d.s);
        if (prev && prev.t > d.t) continue;
        latest.set(d.s, { p: d.p, t: d.t });
        changed.add(d.s);
      }
      for (const s of changed) for (const fn of listeners) fn(s, latest.get(s));
    };
    ws.onerror = () => {}; // 이어서 onclose가 온다
    ws.onclose = () => {
      ws = null;
      open = false;
      if (counts.size === 0) return;
      // 끊기면 1초, 2초, 4초… 최대 1분 간격으로 다시 연결한다
      retryMs = retryMs ? Math.min(retryMs * 2, MAX_RETRY_MS) : FIRST_RETRY_MS;
      retryTimer = setTimer(() => {
        retryTimer = null;
        connect();
      }, retryMs);
    };
  }

  function close() {
    if (retryTimer) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    if (ws) {
      const w = ws;
      ws = null;
      open = false;
      w.onclose = null;
      w.close();
    }
  }

  return {
    // symbols를 구독하고 체결이 오면 listener(symbol, { p, t })를 부른다. 돌려준 함수로 해제한다.
    subscribe(symbols, listener) {
      for (const s of symbols) {
        const n = counts.get(s) ?? 0;
        counts.set(s, n + 1);
        if (n === 0) send('subscribe', s);
      }
      listeners.add(listener);
      connect();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        listeners.delete(listener);
        for (const s of symbols) {
          const n = counts.get(s) - 1;
          if (n > 0) {
            counts.set(s, n);
          } else {
            counts.delete(s);
            latest.delete(s);
            send('unsubscribe', s);
          }
        }
        if (counts.size === 0) close();
      };
    },

    // 지금까지 받은 마지막 체결 { SYMBOL: { p, t } }
    snapshot(symbols) {
      return Object.fromEntries(symbols.filter((s) => latest.has(s)).map((s) => [s, latest.get(s)]));
    },
  };
}
