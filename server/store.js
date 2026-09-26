import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';

const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (message) => new AppError('VALIDATION', message, 400);

export function normalizeSymbol(raw) {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw invalid('티커는 영문·숫자·점(.)·하이픈(-)으로 된 1~10자여야 합니다.');
  }
  return symbol;
}

function positiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${label}은(는) 0보다 큰 숫자여야 합니다.`);
  }
  return value;
}

export function validateHoldingFields({ shares, avgCost } = {}) {
  return { shares: positiveNumber(shares, '수량'), avgCost: positiveNumber(avgCost, '평단가') };
}

export function validateEvent({ title, date, note = '' } = {}) {
  const t = String(title ?? '').trim();
  if (t.length < 1 || t.length > 60) throw invalid('일정 제목은 1~60자여야 합니다.');
  const d = String(date ?? '');
  const parsed = new Date(`${d}T00:00:00Z`);
  if (!DATE_RE.test(d) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
    throw invalid('날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  }
  const n = String(note ?? '').trim();
  if (n.length > 200) throw invalid('메모는 200자 이하여야 합니다.');
  return { title: t, date: d, note: n };
}

const emptyPortfolio = () => ({ version: 1, holdings: [], events: [] });
const defaultId = () => `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function createStore({ filePath, idGen = defaultId }) {
  // 모든 읽기·쓰기를 한 줄로 세워, 연속 저장이 서로를 덮어쓰지 않게 한다.
  let queue = Promise.resolve();
  function serialize(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function load() {
    let text;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return emptyPortfolio();
      throw err;
    }
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.holdings) || !Array.isArray(data.events)) throw new Error('shape');
      return data;
    } catch {
      throw new AppError(
        'STORE_CORRUPT',
        `${path.basename(filePath)} 파일을 읽을 수 없습니다. 파일을 고치거나 백업으로 바꾼 뒤 서버를 다시 켜주세요. (원본은 그대로 두었습니다)`,
        500,
      );
    }
  }

  async function save(data) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(tmp, filePath);
  }

  function mutate(fn) {
    return serialize(async () => {
      const data = await load();
      const result = fn(data);
      await save(data);
      return result;
    });
  }

  const holdingNotFound = () => new AppError('NOT_FOUND', '보유 목록에 없는 종목입니다.', 404);
  const eventNotFound = () => new AppError('NOT_FOUND', '일정을 찾을 수 없습니다.', 404);

  return {
    read: () => serialize(load),

    async addHolding(input = {}) {
      const symbol = normalizeSymbol(input.symbol);
      const fields = validateHoldingFields(input);
      return mutate((data) => {
        if (data.holdings.some((h) => h.symbol === symbol)) {
          throw new AppError('DUPLICATE', `${symbol}은(는) 이미 있습니다. 표에서 [수정]을 눌러 바꿔주세요.`, 409);
        }
        const holding = { symbol, ...fields };
        data.holdings.push(holding);
        return holding;
      });
    },

    async updateHolding(rawSymbol, input = {}) {
      const symbol = normalizeSymbol(rawSymbol);
      const fields = validateHoldingFields(input);
      return mutate((data) => {
        const holding = data.holdings.find((h) => h.symbol === symbol);
        if (!holding) throw holdingNotFound();
        Object.assign(holding, fields);
        return holding;
      });
    },

    async removeHolding(rawSymbol) {
      const symbol = normalizeSymbol(rawSymbol);
      return mutate((data) => {
        const i = data.holdings.findIndex((h) => h.symbol === symbol);
        if (i < 0) throw holdingNotFound();
        data.holdings.splice(i, 1);
      });
    },

    async addEvent(input = {}) {
      const fields = validateEvent(input);
      return mutate((data) => {
        const event = { id: idGen(), ...fields };
        data.events.push(event);
        return event;
      });
    },

    async updateEvent(id, input = {}) {
      const fields = validateEvent(input);
      return mutate((data) => {
        const event = data.events.find((e) => e.id === id);
        if (!event) throw eventNotFound();
        Object.assign(event, fields);
        return event;
      });
    },

    async removeEvent(id) {
      return mutate((data) => {
        const i = data.events.findIndex((e) => e.id === id);
        if (i < 0) throw eventNotFound();
        data.events.splice(i, 1);
      });
    },
  };
}
