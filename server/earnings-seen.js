import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 같은 분기 실적 발표가 날짜만 바뀌어 두 번 오는 경우(Finnhub가 옛 날짜를 지우지 않음)를 하나로 합친다.
// 날짜마다 처음 본 시각을 data/earnings-seen.json에 기록해 두고, 같은 종목·분기에서는 가장 나중에 처음 본
// 날짜(= 바뀐 새 일정)만 남긴다. 처음 본 시각이 같으면 Finnhub가 먼저 준 항목을 남긴다.
const KEEP_DAYS = 30; // 발표일이 이만큼 지난 기록은 지운다

const keyOf = (item) => `${item.symbol}:${item.date}`;

export function createEarningsSeen({ filePath, now = Date.now }) {
  let seen = {}; // { 'SYMBOL:YYYY-MM-DD': 처음 본 시각(ms) }
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object') seen = data;
  } catch {
    // 파일이 없거나 깨졌으면 빈 기록으로 시작한다
  }

  let writing = Promise.resolve();
  function save() {
    const text = `${JSON.stringify(seen, null, 2)}\n`;
    writing = writing.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, filePath);
    }).catch(() => {});
    return writing;
  }

  function prune() {
    const cutoff = new Date(now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const key of Object.keys(seen)) if (key.slice(key.indexOf(':') + 1) < cutoff) delete seen[key];
  }

  return {
    isEmpty: () => Object.keys(seen).length === 0,

    // 예전 기록(캐시 파일 등)에서 날짜별로 처음 본 시각을 채운다. 이미 있는 값보다 이를 때만 바꾼다.
    seed(entries) {
      for (const { symbol, date, at } of entries) {
        const key = `${symbol}:${date}`;
        if (!(seen[key] <= at)) seen[key] = at;
      }
      prune();
      return save();
    },

    // 받은 일정의 처음 본 시각을 기록하고, 같은 종목·분기에서 하나만 남긴 목록을 돌려준다(순서는 유지).
    pick(items) {
      let changed = false;
      for (const item of items) {
        const key = keyOf(item);
        if (seen[key] == null) {
          seen[key] = now();
          changed = true;
        }
      }
      if (changed) {
        prune();
        save();
      }
      const best = new Map(); // 'SYMBOL:YEAR:Q' → 남길 항목
      items.forEach((item) => {
        if (item.year == null || item.quarter == null) return; // 분기를 모르면 합치지 않는다
        const group = `${item.symbol}:${item.year}:${item.quarter}`;
        const cur = best.get(group);
        if (!cur || seen[keyOf(item)] > seen[keyOf(cur)]) best.set(group, item);
      });
      return items.filter((item) => item.year == null || item.quarter == null || best.get(`${item.symbol}:${item.year}:${item.quarter}`) === item);
    },

    flush: () => writing,
  };
}

// cache.json의 실적 기록 → 날짜별 처음 본 시각. 키는 'earnings:SYMBOL:조회시작일', 값은 { value: [...], storedAt }.
export function seenFromCache(cacheData) {
  const out = [];
  for (const [key, entry] of Object.entries(cacheData ?? {})) {
    if (!key.startsWith('earnings:') || !Array.isArray(entry?.value) || typeof entry.storedAt !== 'number') continue;
    for (const item of entry.value) if (item?.symbol && item?.date) out.push({ symbol: item.symbol, date: item.date, at: entry.storedAt });
  }
  return out;
}
