import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLiveFill } from '../server/livefill.js';
import { createTradeStream } from '../server/stream.js';

const noTimer = { every: () => null, cancel: () => {} };

function fakeWs() {
  const sockets = [];
  class FakeSocket {
    constructor() { this.sent = []; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() {}
  }
  return { FakeSocket, sockets };
}

test('정규장에 실시간 체결이 없는 종목만 Yahoo 가격으로 채운다', async () => {
  let t = 100_000;
  const { FakeSocket, sockets } = fakeWs();
  const stream = createTradeStream({ apiKey: 'k', WebSocketImpl: FakeSocket, now: () => t });
  const got = [];
  stream.subscribe(['AAPL', 'SOFI'], (s, tr) => got.push([s, tr.p]));
  sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify({ type: 'trade', data: [{ s: 'AAPL', p: 330, t: 99_000 }] }) });

  const asked = [];
  const yahoo = { regular: async (s) => { asked.push(s); return { value: { p: 16, t: 99_500 } }; } };
  const fill = startLiveFill({ stream, yahoo, isRegular: async () => true, ...noTimer });
  await fill.tick();
  assert.deepEqual(asked, ['SOFI'], 'AAPL은 방금 실시간 체결이 왔으므로 묻지 않는다');
  assert.deepEqual(got, [['AAPL', 330], ['SOFI', 16]]);

  await fill.tick();
  assert.equal(got.length, 2, '같은 체결은 다시 보내지 않는다');

  t += 11_000; // AAPL도 10초 넘게 조용해짐
  asked.length = 0;
  await fill.tick();
  assert.deepEqual(asked.sort(), ['AAPL', 'SOFI']);
});

test('정규장이 아니거나 Yahoo가 실패하면 아무것도 보내지 않는다', async () => {
  const { FakeSocket } = fakeWs();
  const stream = createTradeStream({ apiKey: 'k', WebSocketImpl: FakeSocket });
  const got = [];
  stream.subscribe(['SOFI'], (s) => got.push(s));
  let regular = false;
  const yahoo = { regular: async () => { throw new Error('blocked'); } };
  const fill = startLiveFill({ stream, yahoo, isRegular: async () => regular, ...noTimer });
  await fill.tick();
  regular = true;
  await fill.tick();
  assert.deepEqual(got, []);
});
