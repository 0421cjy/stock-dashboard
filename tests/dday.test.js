import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateInZone, addDays, daysBetween, koreaTimeHint, buildDdayList, ddayTone,
} from '../public/dday.js';

test('dateInZone은 시간대별 날짜를 돌려준다', () => {
  const d = new Date('2026-09-27T23:00:00Z');
  assert.equal(dateInZone(d, 'Asia/Seoul'), '2026-09-28');
  assert.equal(dateInZone(d, 'America/New_York'), '2026-09-27');
});

test('addDays와 daysBetween은 월·연 경계를 넘는다', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-09-28', 90), '2026-12-27');
  assert.equal(daysBetween('2026-09-27', '2026-12-26'), 90);
  assert.equal(daysBetween('2026-09-28', '2026-09-27'), -1);
});

test('koreaTimeHint: 장전은 같은 날 밤, 장후는 다음 날 아침', () => {
  assert.equal(koreaTimeHint('2026-10-30', 'bmo'), '한국시간 10/30 밤');
  assert.equal(koreaTimeHint('2026-10-31', 'amc'), '한국시간 11/1 아침');
  assert.equal(koreaTimeHint('2026-10-30', 'dmh'), null);
  assert.equal(koreaTimeHint('2026-10-30', ''), null);
});

test('한국 아침에는 실적은 미국 날짜, 직접 일정은 한국 날짜로 센다', () => {
  // 한국 9/28 08:00 = 미국 동부 9/27 19:00
  const now = new Date('2026-09-27T23:00:00Z');
  const items = buildDdayList({
    now,
    earnings: [
      { symbol: 'SOFI', date: '2026-09-28', hour: 'amc', epsEstimate: 0.12 },
      { symbol: 'OLD', date: '2026-09-26', hour: 'bmo', epsEstimate: null },
      { symbol: 'FAR', date: '2026-12-27', hour: 'bmo', epsEstimate: null },
    ],
    events: [
      { id: 'e1', title: 'FOMC', date: '2026-09-28', note: '' },
      { id: 'e0', title: '지난 일정', date: '2026-09-27', note: '' },
    ],
  });
  assert.deepEqual(items.map((i) => [i.title, i.label]), [
    ['FOMC', 'D-DAY'],
    ['SOFI 실적', 'D-1'],
  ]);
  const sofi = items[1];
  assert.equal(sofi.kind, 'earnings');
  assert.equal(sofi.session, '장후');
  assert.equal(sofi.epsEstimate, 0.12);
  assert.equal(sofi.koreaHint, '한국시간 9/29 아침');
});

test('90일째 일정은 보이고 91일째는 숨긴다', () => {
  const now = new Date('2026-09-27T16:00:00Z'); // 미국·한국 모두 9/27~28 사이
  const items = buildDdayList({
    now,
    earnings: [],
    events: [
      { id: 'a', title: '90일', date: addDays(dateInZone(now, 'Asia/Seoul'), 90), note: '' },
      { id: 'b', title: '91일', date: addDays(dateInZone(now, 'Asia/Seoul'), 91), note: '' },
    ],
  });
  assert.deepEqual(items.map((i) => i.title), ['90일']);
});

test('ddayTone: 남은 날짜로 배지 색 단계를 정한다', () => {
  const cases = [[0, 'today'], [1, 'soon'], [3, 'soon'], [4, 'week'], [7, 'week'], [8, 'month'], [30, 'month'], [31, 'later'], [90, 'later']];
  for (const [days, tone] of cases) assert.equal(ddayTone(days), tone, `D-${days}`);
});
