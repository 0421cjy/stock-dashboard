import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNameStore } from '../server/names.js';

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'names-'));
  return { file: path.join(dir, 'names.json'), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('이름을 저장하고 다시 켜도 읽는다(ETF처럼 이름 없는 것도)', async () => {
  const { file, cleanup } = await tempFile();
  try {
    const a = createNameStore({ filePath: file });
    assert.equal(a.get('SOFI'), undefined);
    await a.set('SOFI', 'SoFi Technologies Inc');
    await a.set('VOO', null);
    const b = createNameStore({ filePath: file });
    assert.deepEqual(b.get('SOFI'), { name: 'SoFi Technologies Inc' });
    assert.deepEqual(b.get('VOO'), { name: null });
  } finally {
    await cleanup();
  }
});

test('30일이 지나면 모르는 것으로 본다', async () => {
  const { file, cleanup } = await tempFile();
  try {
    let t = 1_000_000;
    const s = createNameStore({ filePath: file, now: () => t });
    await s.set('AAPL', 'Apple Inc');
    t += 31 * 86_400_000;
    assert.equal(s.get('AAPL'), undefined);
  } finally {
    await cleanup();
  }
});

test('깨진 파일은 무시하고 빈 상태로 시작한다', async () => {
  const { file, cleanup } = await tempFile();
  try {
    await writeFile(file, 'not json');
    const s = createNameStore({ filePath: file });
    assert.equal(s.get('AAPL'), undefined);
    await s.set('AAPL', 'Apple Inc');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).AAPL.name, 'Apple Inc');
  } finally {
    await cleanup();
  }
});
