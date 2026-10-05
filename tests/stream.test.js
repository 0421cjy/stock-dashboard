import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTradeStream } from '../server/stream.js';

// 가짜 WebSocket: 만든 순서대로 sockets에 쌓인다
function fakeWs() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    message(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    drop() { this.onclose?.(); }
  }
  return { FakeSocket, sockets };
}

function manualTimers() {
  const pending = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; pending.push(t); return t; },
    clearTimer: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); },
    pending,
    runNext() { pending.shift().fn(); },
  };
}

test('구독하면 연결하고, 열리면 종목을 구독한다. 키는 주소에만 넣는다', () => {
  const { FakeSocket, sockets } = fakeWs();
  const stream = createTradeStream({ apiKey: 'k1', WebSocketImpl: FakeSocket });
  stream.subscribe(['AAPL', 'MSFT'], () => {});
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'wss://ws.finnhub.io?token=k1');
  sockets[0].open();
  assert.deepEqual(sockets[0].sent, [{ type: 'subscribe', symbol: 'AAPL' }, { type: 'subscribe', symbol: 'MSFT' }]);
});

test('체결을 받으면 최신 값만 남기고 리스너에 알린다', () => {
  const { FakeSocket, sockets } = fakeWs();
  const stream = createTradeStream({ apiKey: 'k', WebSocketImpl: FakeSocket });
  const got = [];
  stream.subscribe(['AAPL'], (s, tr) => got.push([s, tr.p]));
  sockets[0].open();
  sockets[0].message({ type: 'trade', data: [{ s: 'AAPL', p: 10, t: 2 }, { s: 'AAPL', p: 9, t: 1 }, { s: 'ZZZ', p: 1, t: 3 }] });
  sockets[0].message({ type: 'ping' });
  assert.deepEqual(got, [['AAPL', 10]]);
  assert.deepEqual(stream.snapshot(['AAPL', 'MSFT']), { AAPL: { p: 10, t: 2 } });
});

test('여러 화면이 같은 종목을 보면 마지막 화면이 떠날 때만 구독을 푼다', () => {
  const { FakeSocket, sockets } = fakeWs();
  const stream = createTradeStream({ apiKey: 'k', WebSocketImpl: FakeSocket });
  const offA = stream.subscribe(['AAPL'], () => {});
  sockets[0].open();
  const offB = stream.subscribe(['AAPL', 'NVDA'], () => {});
  assert.deepEqual(sockets[0].sent.map((m) => m.symbol), ['AAPL', 'NVDA']);
  offB();
  assert.deepEqual(sockets[0].sent.at(-1), { type: 'unsubscribe', symbol: 'NVDA' });
  assert.equal(sockets[0].closed, false);
  offA();
  assert.deepEqual(sockets[0].sent.at(-1), { type: 'unsubscribe', symbol: 'AAPL' });
  assert.equal(sockets[0].closed, true, '아무도 안 보면 연결을 닫는다');
});

test('끊기면 1초, 2초… 간격으로 다시 연결하고 다시 구독한다', () => {
  const { FakeSocket, sockets } = fakeWs();
  const timers = manualTimers();
  const stream = createTradeStream({ apiKey: 'k', WebSocketImpl: FakeSocket, ...timers });
  stream.subscribe(['AAPL'], () => {});
  sockets[0].drop();
  assert.equal(timers.pending[0].ms, 1000);
  timers.runNext();
  sockets[1].drop();
  assert.equal(timers.pending[0].ms, 2000);
  timers.runNext();
  sockets[2].open();
  assert.deepEqual(sockets[2].sent, [{ type: 'subscribe', symbol: 'AAPL' }]);
});

test('키가 없으면 연결하지 않는다', () => {
  const { FakeSocket, sockets } = fakeWs();
  const stream = createTradeStream({ apiKey: '', WebSocketImpl: FakeSocket });
  stream.subscribe(['AAPL'], () => {});
  assert.equal(sockets.length, 0);
});
