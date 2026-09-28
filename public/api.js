// 서버 /api 호출. 실패하면 서버가 준 한국어 메시지로 Error를 던진다.

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('대시보드 서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해주세요.'), { code: 'OFFLINE' });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message ?? `요청이 실패했습니다. (${res.status})`), {
      code: data?.error?.code ?? `HTTP_${res.status}`,
    });
  }
  return data;
}

const list = (symbols) => encodeURIComponent(symbols.join(','));
const seg = (s) => encodeURIComponent(s);

export const api = {
  health: () => call('GET', '/api/health'),
  portfolio: () => call('GET', '/api/portfolio'),
  addHolding: (h) => call('POST', '/api/holdings', h),
  updateHolding: (symbol, h) => call('PUT', `/api/holdings/${seg(symbol)}`, h),
  removeHolding: (symbol) => call('DELETE', `/api/holdings/${seg(symbol)}`),
  addEvent: (e) => call('POST', '/api/events', e),
  updateEvent: (id, e) => call('PUT', `/api/events/${seg(id)}`, e),
  removeEvent: (id) => call('DELETE', `/api/events/${seg(id)}`),
  quotes: (symbols) => call('GET', `/api/quotes?symbols=${list(symbols)}`),
  news: (symbols) => call('GET', `/api/news?symbols=${list(symbols)}`),
  earnings: (symbols) => call('GET', `/api/earnings?symbols=${list(symbols)}`),
  dividends: (symbols) => call('GET', `/api/dividends?symbols=${list(symbols)}`),
  setManualDps: (symbol, manualDps) => call('PUT', `/api/holdings/${seg(symbol)}/dividend`, { manualDps }),
  fx: () => call('GET', '/api/fx'),
  marketStatus: () => call('GET', '/api/market-status'),
};
