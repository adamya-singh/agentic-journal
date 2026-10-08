import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  describeDone,
  extractJsonObject,
  journalSlotFor,
  validateReply,
} from '../src/lib/done-at';
import {
  logTaskDoneInJournal,
  unlogTaskDoneInJournal,
  type DayJournalWithRanges,
} from '../src/app/api/journal/plan-lifecycle-utils';
import {
  expireStale,
  failTurn,
  newProposal,
  receiveReply,
  sendMessage,
} from '../src/app/api/tasks/done-proposals/store';
import { buildCompletionSnapshot } from '../src/app/api/tasks/today/completion-utils';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-done-at-'));
process.env.BACKEND_DATA_DIR = testRoot;
const tasksDir = path.join(testRoot, 'tasks');
const journalDir = path.join(testRoot, 'journal');

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

describe('journal slot', () => {
  test('a finish time maps to its calendar day and clock hour', () => {
    assert.deepEqual(journalSlotFor(new Date(2026, 9, 6, 22, 30)), { kind: 'hour', date: '2026-10-06', hour: '10pm' });
    assert.deepEqual(journalSlotFor(new Date(2026, 9, 7, 1, 10)), { kind: 'hour', date: '2026-10-07', hour: '1am' });
    assert.deepEqual(journalSlotFor(new Date(2026, 9, 7, 0, 0)), { kind: 'hour', date: '2026-10-07', hour: '12am' });
  });

  test('a known start makes a range ending at the finish hour', () => {
    assert.deepEqual(
      journalSlotFor(new Date(2026, 9, 6, 22, 0), new Date(2026, 9, 6, 20, 0)),
      { kind: 'range', date: '2026-10-06', start: '8pm', end: '10pm' }
    );
  });

  test('ranges that would run against the 7am-6am hour order or stay in one hour fall back to an hour', () => {
    // 5am -> 8am crosses the file's 6am/7am seam
    assert.equal(journalSlotFor(new Date(2026, 9, 6, 8, 0), new Date(2026, 9, 6, 5, 0)).kind, 'hour');
    assert.equal(journalSlotFor(new Date(2026, 9, 6, 22, 50), new Date(2026, 9, 6, 22, 5)).kind, 'hour');
    // starting the day before clamps to midnight of the finish day
    assert.deepEqual(
      journalSlotFor(new Date(2026, 9, 7, 2, 0), new Date(2026, 9, 6, 23, 0)),
      { kind: 'range', date: '2026-10-07', start: '12am', end: '2am' }
    );
  });

  test('works across the November DST change', () => {
    assert.deepEqual(journalSlotFor(new Date(2026, 10, 1, 3, 15)), { kind: 'hour', date: '2026-11-01', hour: '3am' });
  });
});

describe('OpenClaw reply validation', () => {
  const now = new Date(2026, 9, 8, 14, 20);

  test('accepts a proposal, normalising times to ISO', () => {
    const result = validateReply(
      extractJsonObject('```json\n{"kind":"proposal","completedAt":"2026-10-06T22:00:00-04:00","rangeStart":null,"timeIsGuess":false,"note":"Tuesday after lab."}\n```'),
      { now }
    );
    assert.ok(result.ok);
    if (!result.ok || result.reply.kind !== 'proposal') return;
    assert.equal(result.reply.proposal.completedAt, new Date('2026-10-06T22:00:00-04:00').toISOString());
    assert.equal(result.reply.proposal.note, 'Tuesday after lab.');
  });

  test('accepts a question', () => {
    const result = validateReply(extractJsonObject('Sure: {"kind":"question","question":"Which day?"}'), { now });
    assert.deepEqual(result, { ok: true, reply: { kind: 'question', question: 'Which day?' } });
  });

  test('rejects future, ancient, malformed and backwards answers', () => {
    const bad = [
      { kind: 'proposal', completedAt: '2026-10-09T10:00:00-04:00' },
      { kind: 'proposal', completedAt: '2026-01-01T10:00:00-05:00' },
      { kind: 'proposal', completedAt: 'last tuesday' },
      { kind: 'proposal', completedAt: '2026-10-06T22:00:00-04:00', rangeStart: '2026-10-06T23:00:00-04:00' },
      { kind: 'nope' },
    ];
    for (const raw of bad) assert.equal(validateReply(raw, { now }).ok, false, JSON.stringify(raw));
    assert.equal(validateReply(extractJsonObject('I could not tell'), { now }).ok, false);
  });

  test('describes lateness and the journal entry', () => {
    const lines = describeDone(new Date(2026, 9, 6, 22, 0), new Date(2026, 9, 6, 20, 0), new Date(2026, 9, 5, 23, 59));
    assert.equal(lines[0], 'Mark it done at Tue Oct 6, 10 PM');
    assert.match(lines[1], /^That’s 22h after it was due/);
    assert.equal(lines[2], 'Log it in your Tue Oct 6 journal from 8pm to 10pm');
  });
});

describe('journal done entries', () => {
  const plannedJournal = (): DayJournalWithRanges => ({
    '9pm': { taskId: 't1', listType: 'have-to-do', entryMode: 'planned', planId: 'p1', planStatus: 'active', planCreatedAt: 'x', planUpdatedAt: 'x' },
    '10pm': 'existing note',
  });

  test('logs at an hour, completes the open plan, and undo reverses both', () => {
    const journal = plannedJournal();
    const slot = { kind: 'hour' as const, date: '2026-10-06', hour: '10pm' };
    const { journalEntryId, created } = logTaskDoneInJournal(journal, slot, 't1', 'have-to-do', 'now');
    assert.equal(created, true);
    assert.deepEqual(journal['10pm'], ['existing note', { taskId: 't1', listType: 'have-to-do', entryMode: 'logged', journalEntryId }]);
    assert.equal((journal['9pm'] as { planStatus: string }).planStatus, 'completed');
    assert.deepEqual((journal['9pm'] as { completedByLogRef: unknown }).completedByLogRef, { date: '2026-10-06', hour: '10pm' });

    assert.equal(logTaskDoneInJournal(journal, slot, 't1', 'have-to-do').created, false, 'no duplicate entry');

    assert.equal(unlogTaskDoneInJournal(journal, slot, 't1', journalEntryId, 'later'), true);
    assert.equal(journal['10pm'], 'existing note');
    assert.equal((journal['9pm'] as { planStatus: string }).planStatus, 'active');
    assert.equal('completedByLogRef' in (journal['9pm'] as object), false);
  });

  test('logs a range entry', () => {
    const journal: DayJournalWithRanges = {};
    const slot = { kind: 'range' as const, date: '2026-10-06', start: '8pm', end: '10pm' };
    const { journalEntryId } = logTaskDoneInJournal(journal, slot, 't1', 'have-to-do');
    assert.deepEqual(journal.ranges, [{ start: '8pm', end: '10pm', taskId: 't1', listType: 'have-to-do', entryMode: 'logged', journalEntryId }]);
    unlogTaskDoneInJournal(journal, slot, 't1', journalEntryId);
    assert.deepEqual(journal.ranges, []);
  });
});

describe('proposal ledger', () => {
  const t0 = new Date('2026-10-08T18:00:00Z');
  const base = () => newProposal({
    id: 'r1', taskId: 't1', listType: 'have-to-do', short: 'HW', title: 'Stats HW', due: null, dueIsImplied: false, text: 'tuesday', now: t0,
  });
  const proposal = { completedAt: '2026-10-07T02:00:00.000Z', rangeStart: null, timeIsGuess: true, note: 'Tuesday night.' };

  test('a reply lands only on the turn it answers', () => {
    const r = base();
    const answered = receiveReply(r, 1, { kind: 'proposal', proposal }, t0);
    assert.equal(answered.status, 'proposed');
    assert.equal(answered.messages.at(-1)?.text, 'Tuesday night.');

    const resent = sendMessage(answered, 'actually 11:30', t0);
    assert.equal(resent.turn, 2);
    assert.equal(receiveReply(resent, 1, { kind: 'question', question: 'stale?' }, t0), resent, 'old turn ignored');
    assert.equal(receiveReply({ ...resent, status: 'declined' }, 2, { kind: 'proposal', proposal }, t0).status, 'declined');
    assert.equal(failTurn(resent, 2, 'boom', t0).status, 'failed');
  });

  test('a turn stuck thinking for over 3 minutes becomes failed', () => {
    const [stuck] = expireStale([base()], new Date(t0.getTime() + 4 * 60_000));
    assert.equal(stuck.status, 'failed');
    const [fresh] = expireStale([base()], new Date(t0.getTime() + 60_000));
    assert.equal(fresh.status, 'thinking');
  });
});

test('a completion snapshot keeps the given finish time', () => {
  const snap = buildCompletionSnapshot({ id: 'a', text: 'A' }, 'have-to-do', '2026-10-06T02:00:00.000Z');
  assert.equal(snap.completedAt, '2026-10-06T02:00:00.000Z');
});

describe('done-at apply and undo (on disk)', () => {
  let apply: typeof import('../src/app/api/tasks/done-at/apply');
  const finished = new Date();
  finished.setDate(finished.getDate() - 2);
  finished.setHours(22, 15, 0, 0);
  const date = iso(finished);

  before(async () => {
    rmSync(testRoot, { recursive: true, force: true });
    writeJson(path.join(tasksDir, 'have-to-do.json'), { _comment: '', tasks: [{ id: 't1', text: 'Stats HW 4', dueDate: date }, { id: 't2', text: 'Other' }] });
    writeJson(path.join(tasksDir, 'want-to-do.json'), { _comment: '', tasks: [] });
    apply = await import('../src/app/api/tasks/done-at/apply');
  });

  test('completes at the finish time, logs the journal, and undo restores it', () => {
    const result = apply.applyDoneAt({ taskId: 't1', listType: 'have-to-do', completedAt: finished });
    assert.equal(result.status, 'done');
    if (result.status !== 'done') return;
    assert.deepEqual(result.receipt.slot, { kind: 'hour', date, hour: '10pm' });

    const general = readJson<{ tasks: { id: string }[] }>(path.join(tasksDir, 'have-to-do.json'));
    assert.deepEqual(general.tasks.map((t) => t.id), ['t2']);
    const index = readJson<{ tasks: Record<string, { completedAt: string; sourceDate: string }> }>(path.join(tasksDir, 'completed-index.json'));
    assert.equal(index.tasks.t1.completedAt, finished.toISOString());
    assert.equal(index.tasks.t1.sourceDate, date);
    const journal = readJson<DayJournalWithRanges>(path.join(journalDir, `${date}.json`));
    const logged = ([] as unknown[]).concat(journal['10pm']);
    assert.ok(logged.some((e) => (e as { taskId?: string; entryMode?: string }).taskId === 't1' && (e as { entryMode?: string }).entryMode === 'logged'));

    assert.equal(apply.applyDoneAt({ taskId: 't1', listType: 'have-to-do', completedAt: finished }).status, 'already-completed');

    assert.deepEqual(apply.undoDoneAt(result.receipt), { status: 'undone' });
    const restored = readJson<{ tasks: { id: string }[] }>(path.join(tasksDir, 'have-to-do.json'));
    assert.ok(restored.tasks.some((t) => t.id === 't1'));
    const after = readJson<DayJournalWithRanges>(path.join(journalDir, `${date}.json`));
    assert.ok(!([] as unknown[]).concat(after['10pm']).some((e) => (e as { taskId?: string }).taskId === 't1'));
  });
});
