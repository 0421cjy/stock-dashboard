// 환율 초깃값과 표시 문구. 모두 순수 함수.

// 서버 응답 전에 쓰는 임시 환율. 원화 금액을 '₩ —'로 비워두지 않으려는 용도라 대략적인 값이면 된다.
export const DEFAULT_USD_KRW = 1350;

// 첫 화면에 쓸 환율: 지난번에 받은 값이 있으면 그것을, 없으면 기본값을 쓴다.
// 어느 쪽이든 서버에서 확인하기 전까지는 pending으로 표시한다.
export function initialFx(saved) {
  if (saved?.rate > 0) return { rate: saved.rate, date: saved.date ?? null, stale: false, pending: true };
  return { rate: DEFAULT_USD_KRW, date: null, stale: false, pending: true };
}

// 저장해둔 문자열을 읽는다. 형식이 틀리면 null.
export function parseSavedFx(text) {
  try {
    const v = JSON.parse(text);
    return v?.rate > 0 ? { rate: v.rate, date: typeof v.date === 'string' ? v.date : null } : null;
  } catch {
    return null;
  }
}

export function fxNote(fx) {
  if (!(fx?.rate > 0)) return '환율 확인 중';
  const rate = `₩${fx.rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (fx.pending) return `기준환율 ${rate} (${fx.date ? `${fx.date} · ` : '임시값 · '}확인 중)`;
  return `기준환율 ${rate} (${fx.date}${fx.stale ? ' · 지연' : ''})`;
}
