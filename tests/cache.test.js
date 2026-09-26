import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../server/cache.js';
import { AppError } from '../server/errors.js';

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('TTL 안에서는 loader를 다시 부르지 않는다', async () => {
  const now = clock();
  const cache = createCache({ now });
  let calls = 0;
  const loader = async () => ++calls;
  assert.equal((await cache.get('k', 1000, loader)).value, 1);
  now.advance(999);
  assert.equal((await cache.get('k', 1000, loader)).value, 1);
  now.advance(2);
  const r = await cache.get('k', 1000, loader);
  assert.equal(r.value, 2);
  assert.equal(r.stale, false);
});

test('동시 요청은 loader를 한 번만 부른다', async () => {
  const cache = createCache({ now: clock() });
  let calls = 0;
  const loader = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return 'v'; };
  const [a, b] = await Promise.all([cache.get('k', 1000, loader), cache.get('k', 1000, loader)]);
  assert.equal(calls, 1);
  assert.equal(a.value, 'v');
  assert.equal(b.value, 'v');
});

test('실패하면 이전 값을 stale로 돌려준다', async () => {
  const now = clock();
  const cache = createCache({ now });
  await cache.get('k', 1000, async () => 'old');
  now.advance(5000);
  const err = new AppError('UPSTREAM', '연결 실패', 502);
  const r = await cache.get('k', 1000, async () => { throw err; });
  assert.equal(r.value, 'old');
  assert.equal(r.stale, true);
  assert.equal(r.error, err);
});

test('이전 값이 없으면 오류를 그대로 던진다', async () => {
  const cache = createCache({ now: clock() });
  await assert.rejects(
    cache.get('k', 1000, async () => { throw new AppError('UPSTREAM', 'x', 502); }),
    { code: 'UPSTREAM' },
  );
});

test('NOT_FOUND는 이전 값이 있어도 던진다', async () => {
  const now = clock();
  const cache = createCache({ now });
  await cache.get('k', 1000, async () => 'old');
  now.advance(5000);
  await assert.rejects(
    cache.get('k', 1000, async () => { throw new AppError('NOT_FOUND', '없음', 404); }),
    { code: 'NOT_FOUND' },
  );
});
