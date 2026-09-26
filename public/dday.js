// 디데이 계산. 실적은 미국 동부 날짜, 직접 입력 일정은 한국 날짜 기준.

const NY = 'America/New_York';
const SEOUL = 'Asia/Seoul';
const HOUR_LABEL = { bmo: '장전', amc: '장후', dmh: '장중' };

export function dateInZone(date, timeZone) {
  // en-CA 형식은 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  const ms = Date.parse(`${toStr}T00:00:00Z`) - Date.parse(`${fromStr}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function monthDay(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

// 장전 발표(미국 오전) = 한국 그날 밤, 장후 발표(미국 오후) = 한국 다음 날 아침
export function koreaTimeHint(dateStr, hour) {
  if (hour === 'bmo') return `한국시간 ${monthDay(dateStr)} 밤`;
  if (hour === 'amc') return `한국시간 ${monthDay(addDays(dateStr, 1))} 아침`;
  return null;
}

function ddayLabel(days) {
  return days === 0 ? 'D-DAY' : `D-${days}`;
}

export function buildDdayList({ earnings = [], events = [], now = new Date(), horizonDays = 90 }) {
  const nyToday = dateInZone(now, NY);
  const seoulToday = dateInZone(now, SEOUL);
  const inRange = (days) => days >= 0 && days <= horizonDays;
  const items = [];

  for (const e of earnings) {
    const days = daysBetween(nyToday, e.date);
    if (!inRange(days)) continue;
    items.push({
      kind: 'earnings',
      id: `earn_${e.symbol}_${e.date}`,
      symbol: e.symbol,
      title: `${e.symbol} 실적`,
      date: e.date,
      days,
      label: ddayLabel(days),
      session: HOUR_LABEL[e.hour] ?? null,
      epsEstimate: e.epsEstimate ?? null,
      koreaHint: koreaTimeHint(e.date, e.hour),
    });
  }

  for (const ev of events) {
    const days = daysBetween(seoulToday, ev.date);
    if (!inRange(days)) continue;
    items.push({
      kind: 'event',
      id: ev.id,
      title: ev.title,
      date: ev.date,
      days,
      label: ddayLabel(days),
      note: ev.note ?? '',
    });
  }

  return items.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));
}
