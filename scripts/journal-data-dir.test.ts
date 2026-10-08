import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Set before the routes are imported so nothing can capture the real data dir.
const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-journal-dir-'));
process.env.BACKEND_DATA_DIR = testRoot;

const journalDir = path.join(testRoot, 'journal');
const productionJournalDir = path.join(process.cwd(), 'src/backend/data/journal');
const DATE = '2099-01-01';
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

let createRoute: typeof import('../src/app/api/journal/create/route');
let appendRoute: typeof import('../src/app/api/journal/append/route');

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  mkdirSync(journalDir, { recursive: true });
  const template = Object.fromEntries(HOURS.map((hour) => [hour, '']));
  writeFileSync(path.join(journalDir, 'format.json'), JSON.stringify(template, null, 2), 'utf-8');
  createRoute = await import('../src/app/api/journal/create/route');
  appendRoute = await import('../src/app/api/journal/append/route');
});

after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('journal routes honour BACKEND_DATA_DIR', () => {
  test('create uses format.json from the redirected journal dir', async () => {
    const response = await createRoute.POST(post('http://localhost/api/journal/create', { date: DATE }));
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.alreadyExists, false);

    const filePath = path.join(journalDir, `${DATE}.json`);
    assert.ok(existsSync(filePath));
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(filePath, 'utf-8'))), HOURS);
    assert.equal(existsSync(path.join(productionJournalDir, `${DATE}.json`)), false);
  });

  test('append writes to the redirected journal dir', async () => {
    const response = await appendRoute.POST(
      post('http://localhost/api/journal/append', {
        date: DATE,
        hour: '9am',
        text: 'redirected entry',
        entryMode: 'logged',
      })
    );
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));

    const raw = readFileSync(path.join(journalDir, `${DATE}.json`), 'utf-8');
    assert.ok(raw.endsWith('\n'), 'written via writeJsonFileAtomic');
    assert.match(JSON.stringify(JSON.parse(raw)['9am']), /redirected entry/);
    assert.equal(existsSync(path.join(productionJournalDir, `${DATE}.json`)), false);
  });
});
