import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

// 회사명은 거의 바뀌지 않으므로 파일에 저장해, 서버를 다시 켜도 Finnhub에 다시 묻지 않는다.
// 이름이 없는 종목(ETF 등)은 null로 저장한다. 30일이 지나면 다시 확인한다.
const MAX_AGE_MS = 30 * 86_400_000;

export function createNameStore({ filePath, now = Date.now }) {
  let entries = {};
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (data && typeof data === 'object') entries = data;
  } catch {
    // 파일이 없거나 깨졌으면 빈 상태로 시작한다(다시 받으면 된다)
  }

  let writing = Promise.resolve();
  function save() {
    const text = `${JSON.stringify(entries, null, 2)}\n`;
    writing = writing.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, filePath);
    }).catch(() => {
      // 저장 실패는 다음에 다시 받으면 될 뿐이다
    });
    return writing;
  }

  return {
    // 알면 { name }(name은 null일 수 있음), 모르거나 오래됐으면 undefined
    get(symbol) {
      const e = entries[symbol];
      if (!e || typeof e.savedAt !== 'number' || now() - e.savedAt > MAX_AGE_MS) return undefined;
      return { name: typeof e.name === 'string' ? e.name : null };
    },
    set(symbol, name) {
      entries[symbol] = { name: name ?? null, savedAt: now() };
      return save();
    },
  };
}
