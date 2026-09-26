// TTL 캐시. 동시 요청을 합치고, 실패하면 마지막 성공 값을 stale로 돌려준다.
export function createCache({ now = Date.now } = {}) {
  const entries = new Map();
  const inflight = new Map();

  async function load(key, loader) {
    const previous = entries.get(key);
    try {
      const value = await loader();
      const storedAt = now();
      entries.set(key, { value, storedAt });
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

  return { get };
}
