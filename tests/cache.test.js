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

test('파일 저장: persist 키만 저장하고, 다시 만들면 TTL 안의 값은 loader 없이 쓴다', async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'cache-'));
  const filePath = path.join(dir, 'cache.json');
  try {
    const now = clock();
    const persist = (key) => key.startsWith('news:');
    const a = createCache({ now, filePath, persist });
    await a.get('news:A', 1000, async () => ['n1']);
    await a.get('quote:A', 1000, async () => 1);
    await a.flush();
    assert.deepEqual(Object.keys(JSON.parse(await readFile(filePath, 'utf8'))), ['news:A']);

    now.advance(500);
    const b = createCache({ now, filePath, persist });
    let calls = 0;
    assert.deepEqual((await b.get('news:A', 1000, async () => { calls++; return ['n2']; })).value, ['n1']);
    assert.equal(calls, 0);
    now.advance(600);
    assert.deepEqual((await b.get('news:A', 1000, async () => ['n2'])).value, ['n2'], 'TTL이 지나면 다시 받는다');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('파일 저장: maxAgeMs보다 오래된 저장 키는 읽지 않고, 저장할 때 지운다', async () => {
  const { mkdtemp, rm, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'cache-'));
  const filePath = path.join(dir, 'cache.json');
  try {
    const now = clock(10_000_000);
    await writeFile(filePath, JSON.stringify({
      'news:A:old': { value: ['old'], storedAt: 1_000 },
      'news:A:new': { value: ['new'], storedAt: 9_999_000 },
    }));
    const c = createCache({ now, filePath, persist: (k) => k.startsWith('news:'), maxAgeMs: 5_000 });
    let calls = 0;
    assert.deepEqual((await c.get('news:A:old', Infinity, async () => { calls++; return ['fresh']; })).value, ['fresh'], '오래된 기록은 읽지 않는다');
    assert.equal(calls, 1);
    await c.flush();
    assert.deepEqual(Object.keys(JSON.parse(await readFile(filePath, 'utf8'))).sort(), ['news:A:new', 'news:A:old']);
    now.advance(4_500); // 이제 news:A:new(5.5초 전)는 오래됨, news:A:old(4.5초 전에 새로 받음)는 남는다
    await c.get('news:B:x', 1000, async () => ['b']);
    await c.flush();
    assert.deepEqual(Object.keys(JSON.parse(await readFile(filePath, 'utf8'))).sort(), ['news:A:old', 'news:B:x']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
