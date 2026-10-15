import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createEarningsSeen, seenFromCache } from '../server/earnings-seen.js';

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'seen-'));
  return { filePath: path.join(dir, 'earnings-seen.json'), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const tsla = (date) => ({ symbol: 'TSLA', date, hour: 'amc', epsEstimate: 0.4, year: 2026, quarter: 3 });

test('같은 종목·분기에 날짜가 둘이면 나중에 처음 본(바뀐) 날짜만 남기고, 다시 켜도 기억한다', async () => {
  const { filePath, cleanup } = await tempFile();
  try {
    let t = T0;
    const a = createEarningsSeen({ filePath, now: () => t });
    assert.deepEqual(a.pick([tsla('2026-10-20')]).map((e) => e.date), ['2026-10-20']);
    t += 14 * DAY; // 2주 뒤 Finnhub가 새 날짜를 옛 날짜 뒤에 붙여 보낸다
    assert.deepEqual(a.pick([tsla('2026-10-20'), tsla('2026-10-21')]).map((e) => e.date), ['2026-10-21']);
    await a.flush();
    const b = createEarningsSeen({ filePath, now: () => t });
    assert.deepEqual(b.pick([tsla('2026-10-21'), tsla('2026-10-20')]).map((e) => e.date), ['2026-10-21']);
  } finally {
    await cleanup();
  }
});

test('처음 본 시각이 같으면 먼저 온 항목을, 분기를 모르거나 다른 종목·분기는 그대로 둔다', async () => {
  const { filePath, cleanup } = await tempFile();
  try {
    const s = createEarningsSeen({ filePath, now: () => T0 });
    const items = [
      tsla('2026-10-21'),
      tsla('2026-10-20'),
      { ...tsla('2027-01-27'), quarter: 4 },
      { symbol: 'AAPL', date: '2026-10-29', year: null, quarter: null },
      { symbol: 'AAPL', date: '2026-10-30', year: null, quarter: null },
    ];
    assert.deepEqual(s.pick(items).map((e) => `${e.symbol} ${e.date}`), ['TSLA 2026-10-21', 'TSLA 2027-01-27', 'AAPL 2026-10-29', 'AAPL 2026-10-30']);
  } finally {
    await cleanup();
  }
});

test('캐시 파일의 예전 실적 기록으로 처음 본 시각을 채운다(가장 이른 시각)', async () => {
  const { filePath, cleanup } = await tempFile();
  try {
    const cache = {
      'earnings:TSLA:2026-09-30': { storedAt: T0, value: [{ symbol: 'TSLA', date: '2026-10-20' }] },
      'earnings:TSLA:2026-10-15': { storedAt: T0 + 14 * DAY, value: [{ symbol: 'TSLA', date: '2026-10-21' }, { symbol: 'TSLA', date: '2026-10-20' }] },
      'news:TSLA:2026-10-08': { storedAt: T0, value: [] },
    };
    assert.deepEqual(seenFromCache(cache).length, 3);
    const s = createEarningsSeen({ filePath, now: () => T0 + 15 * DAY });
    assert.equal(s.isEmpty(), true);
    await s.seed(seenFromCache(cache));
    assert.equal(s.isEmpty(), false);
    assert.deepEqual(s.pick([tsla('2026-10-20'), tsla('2026-10-21')]).map((e) => e.date), ['2026-10-21']);
  } finally {
    await cleanup();
  }
});
