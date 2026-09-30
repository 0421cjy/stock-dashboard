import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

// TTL 캐시. 동시 요청을 합치고, 실패하면 마지막 성공 값을 stale로 돌려준다.
// filePath와 persist(key → boolean)를 주면 그 키들은 파일에도 저장해, 서버를 다시 켜도 TTL 안이면 그대로 쓴다.
export function createCache({ now = Date.now, filePath = null, persist = () => false } = {}) {
  const entries = new Map();
  const inflight = new Map();

  if (filePath) {
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      for (const [key, e] of Object.entries(saved)) {
        if (persist(key) && typeof e?.storedAt === 'number') entries.set(key, { value: e.value, storedAt: e.storedAt });
      }
    } catch {
      // 파일이 없거나 깨졌으면 빈 상태로 시작한다(다시 받으면 된다)
    }
  }

  // 한꺼번에 여러 키가 바뀌어도 파일은 한 번만 쓴다
  let saveQueued = false;
  let writing = Promise.resolve();
  function scheduleSave() {
    if (!filePath || saveQueued) return;
    saveQueued = true;
    writing = writing.then(() => new Promise((r) => setTimeout(r, 200))).then(async () => {
      saveQueued = false;
      const data = Object.fromEntries([...entries].filter(([key]) => persist(key)));
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(data), 'utf8');
      await rename(tmp, filePath);
    }).catch(() => {
      saveQueued = false; // 저장 실패는 다음에 다시 받으면 될 뿐이다
    });
  }

  async function load(key, loader) {
    const previous = entries.get(key);
    try {
      const value = await loader();
      const storedAt = now();
      entries.set(key, { value, storedAt });
      if (persist(key)) scheduleSave();
      return { value, stale: false, storedAt };
    } catch (error) {
      if (previous && error?.code !== 'NOT_FOUND') {
        return { value: previous.value, stale: true, storedAt: previous.storedAt, error };
      }
      throw error;
    }
  }

  function get(key, ttlMs, loader) {
    const entry = entries.get(key);
    if (entry && now() - entry.storedAt < ttlMs) {
      return Promise.resolve({ value: entry.value, stale: false, storedAt: entry.storedAt });
    }
    if (inflight.has(key)) return inflight.get(key);
    const promise = load(key, loader).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  // 테스트용: 예약된 파일 저장이 끝날 때까지 기다린다
  function flush() {
    return writing;
  }

  return { get, flush };
}
