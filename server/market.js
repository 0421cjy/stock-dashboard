// 미국 장 상태 판정. 서머타임은 Intl의 America/New_York 시간대가 처리한다.

const NY = 'America/New_York';
const PRE_START = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const POST_END = 20 * 60;

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

function nyClock(date) {
  const p = Object.fromEntries(clockFormat.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function computeMarketStatus(date, holidays = []) {
  const closed = { isOpen: false, session: 'closed' };
  const { day, weekday, minutes } = nyClock(date);
  if (weekday === 'Sat' || weekday === 'Sun') return closed;

  let open = REGULAR_OPEN;
  let close = REGULAR_CLOSE;
  const holiday = holidays.find((h) => h.date === day);
  if (holiday) {
    const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(holiday.tradingHour ?? '');
    if (!m) return closed;
    open = toMinutes(m[1]);
    close = toMinutes(m[2]);
  }

  if (minutes >= open && minutes < close) return { isOpen: true, session: 'regular' };
  if (minutes >= PRE_START && minutes < open) return { isOpen: false, session: 'pre' };
  if (minutes >= close && minutes < POST_END) return { isOpen: false, session: 'post' };
  return closed;
}
