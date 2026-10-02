// 오른쪽 위 상태 배지의 단계(tone)와 문구. DOM에 의존하지 않는 순수 함수.
import { formatClock } from './format.js';

// 정규장 밖 시간대 이름(시간외 가격도 이 이름으로 표시한다)
export const SESSION_LABEL = { pre: '프리마켓', post: '애프터마켓' };

// tone: live(장중·초록) | closed(장 마감·회색) | delayed(지연·주황) | loading(확인 중)
export function statusBadge({ market, lastQuoteAt, quoteProblem }) {
  const clock = lastQuoteAt ? formatClock(lastQuoteAt) : null;
  const withClock = (text) => (clock ? `${text} · ${clock}` : text);
  if (quoteProblem && clock) return { tone: 'delayed', label: withClock('지연') };
  if (!market) return { tone: 'loading', label: '장 상태 확인 중' };
  if (market.isOpen) return { tone: 'live', label: withClock('LIVE') };
  return { tone: 'closed', label: withClock(SESSION_LABEL[market.session] ?? '장 마감') };
}
