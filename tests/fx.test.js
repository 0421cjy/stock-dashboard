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
