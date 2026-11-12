import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { JobApplicationRecord, JobEmployerUpdate, JobListing } from '../src/lib/types';

const root = mkdtempSync(path.join(tmpdir(), 'interviews-'));
process.env.JOB_APPLICATION_JOBS_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

const update = (id: string, receivedAt: string, extra: Partial<JobEmployerUpdate>): JobEmployerUpdate =>
  ({ id, source: 'email', receivedAt, appliedAt: receivedAt, stage: null, ...extra }) as JobEmployerUpdate;
const listing = { id: 'rr', company: 'Roadrunner', positionTitle: 'Forward Deployed Engineer (New Grad)', location: 'San Francisco, CA', salary: 'not listed', link: 'https://jobs.ashbyhq.com/Roadrunner/x', savedAt: '2026-10-11T17:00:00Z' } as JobListing;
// Roadrunner's real sequence: receipt, invite to book a phone screen, the booking, an Ashby reminder.
const updates = [
  update('u0', '2026-10-15T00:26:08Z', { stage: 'received', from: 'Roadrunner Hiring Team <no-reply@ashbyhq.com>' }),
  update('u1', '2026-10-18T18:49:45-04:00', { stage: 'interview', interviewRound: 'Recruiter Phone Screen', from: 'Michelle Galan <michelle@roadrunner.ai>' }),
  update('u2', '2026-10-19T23:00:33Z', { stage: 'interview', interviewRound: 'Intro Chat (Recruiter)', from: 'Michelle Galan <michelle@roadrunner.ai>' }),
  update('u3', '2026-10-21T13:05:41-04:00', { stage: 'interview', interviewRound: 'Intro Chat (Recruiter)', from: 'Roadrunner Hiring Team <no-reply@ashbyhq.com>' }),
];
const app = { listingId: 'rr', submittedAt: '2026-10-15T00:26:11Z', employerStage: 'interview', employerUpdates: updates } as JobApplicationRecord;

test('one booking thread becomes one round, named by the latest email, with the person who wrote', async () => {
  const { deriveRounds, senderPerson } = await import('../src/lib/interviews/view.ts');
  const rounds = deriveRounds(updates, []);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].id, 'int-u1');
  assert.equal(rounds[0].name, 'Intro Chat (Recruiter)');
  assert.equal(rounds[0].kind, 'screen');
  assert.deepEqual(rounds[0].people, ['Michelle Galan']);
  assert.equal(rounds[0].state, 'unscheduled');
  assert.equal(senderPerson('Roadrunner Hiring Team <no-reply@ashbyhq.com>'), undefined);
  // A recorded time closes the round; an invite after that time starts the next one.
  const ms = { id: 'm1', kind: 'interview-scheduled' as const, occurredAt: '2026-10-22T13:00:00-04:00', createdAt: '2026-10-20T12:00:00Z', source: 'manual' as const, note: '' };
  const next = update('u4', '2026-10-27T10:00:00-04:00', { stage: 'interview', interviewRound: 'Technical Interview', from: 'Michelle Galan <michelle@roadrunner.ai>' });
  const two = deriveRounds([...updates, next], [ms]);
  assert.deepEqual(two.map((r) => [r.id, r.at, r.kind]), [['int-u1', '2026-10-22T13:00:00-04:00', 'screen'], ['int-u4', undefined, 'tech']]);
});

test('a finished call with no notes asks to be written up, and stops asking once notes exist', async () => {
  const { buildCasebook } = await import('../src/lib/interviews/view.ts');
  const { EMPTY_INDEX } = await import('../src/lib/interviews/store.ts');
  const index = structuredClone(EMPTY_INDEX);
  index.domains.roadrunner = 'roadrunner.ai';
  index.processes.push({ id: '2026-27/roadrunner-fde', season: '2026-27', listingId: 'rr', company: 'Roadrunner', role: 'FDE', people: [{ name: 'Michelle Galan', role: 'Recruiter' }], rounds: [{ id: 'int-u1', name: 'Intro chat', at: '2026-10-22T13:00:00-04:00', duration: '15 min' }], notes: [], createdAt: '', updatedAt: '' });
  const now = Date.parse('2026-10-22T14:05:00-04:00');
  const view = buildCasebook({ index, listings: [listing], applications: { rr: app }, milestones: {}, now });
  const p = view.processes[0];
  assert.equal(p.key, '2026-27/roadrunner-fde');
  assert.equal(p.domain, 'roadrunner.ai');
  assert.equal(p.rounds[0].name, 'Intro chat');
  assert.equal(p.rounds[0].state, 'capture');
  assert.equal(p.people.length, 1, 'stored and emailed Michelle Galan merge');
  assert.equal(p.outcome.label, 'Interviewing');
  assert.equal(view.seasons[0].id, '2026-27');
  index.processes[0].notes.push({ id: 'n1', title: 'Intro chat notes', kind: 'notes', round: 'int-u1', date: '', author: 'you', file: 'intro-chat-notes.md', bytes: 10 });
  assert.equal(buildCasebook({ index, listings: [listing], applications: { rr: app }, milestones: {}, now }).processes[0].rounds[0].state, 'done');
  assert.equal(buildCasebook({ index, listings: [listing], applications: { rr: app }, milestones: {}, now: Date.parse('2026-10-21T09:00:00-04:00') }).processes[0].rounds[0].state, 'upcoming');
});

test('recruiting seasons start May 1 in New York time', async () => {
  const { seasonFor } = await import('../src/lib/interviews/store.ts');
  assert.equal(seasonFor('2025-10-27'), '2025-26');
  assert.equal(seasonFor('2026-04-30T23:00:00-04:00'), '2025-26');
  assert.equal(seasonFor('2026-05-01T00:30:00-04:00'), '2026-27');
  assert.equal(seasonFor('2026-10-15T00:26:11Z'), '2026-27');
});

test('transcript timestamps become a who-spoke-when summary', async () => {
  const { talkSummary } = await import('../src/lib/interviews/talk.ts');
  const md = ['- **[100] Gaurush:** Tell me about yourself.', '- **[110] Adamya:** Sure, I have been building agents for a while now and', '- **[150] Gaurush:** Explain K-means.', '- **[160] Adamya:** Pick k centroids, assign, update, repeat.', '- **[200] Gaurush:** Thanks.'].join('\n');
  const t = talkSummary(md, 'Adamya')!;
  assert.equal(t.turns, 5);
  assert.deepEqual(t.segs[0], [0, 10, 'them']);
  assert.deepEqual(t.segs[1], [10, 40, 'you']);
  assert.equal(t.youShare, 77);
  assert.equal(talkSummary('no timestamps here', 'Adamya'), undefined);
});

test('saving a note for a Jobs posting creates its process, and edits keep the same file', async () => {
  const { mutateInterviews, readInterviews, readNoteBody } = await import('../src/lib/interviews/store.ts');
  const { saveNote, setDomain } = await import('../src/lib/interviews/actions.ts');
  const source = { listings: [listing], applications: { rr: app } };
  const note = await mutateInterviews((index) => saveNote(index, { key: 'listing:rr', title: 'Intro chat notes', round: 'int-u1', body: '## Band\n$150K' }, source));
  const stored = readInterviews().processes[0];
  assert.equal(stored.id, '2026-27/roadrunner-forward-deployed-engineer-new-grad');
  assert.equal(stored.listingId, 'rr');
  await mutateInterviews((index) => saveNote(index, { key: 'listing:rr', noteId: note.id, body: '## Band\n$155K' }, source));
  const again = readInterviews().processes[0];
  assert.equal(again.notes.length, 1);
  assert.equal(readNoteBody(again, again.notes[0]), '## Band\n$155K');
  assert.ok(fs.existsSync(path.join(root, 'interviews', '2026-27', 'roadrunner-forward-deployed-engineer-new-grad', 'intro-chat-notes.md')));
  await assert.rejects(mutateInterviews((index) => saveNote(index, { key: 'listing:nope', body: 'x' }, source)), /not found/);
  await mutateInterviews((index) => setDomain(index, "Moody's", 'https://www.moodys.com/careers'));
  assert.equal(readInterviews().domains["moody's"], 'moodys.com');
  await assert.rejects(mutateInterviews((index) => setDomain(index, 'X', 'not a domain')), /Not a domain/);
});

test('logos: icon links are ranked biggest first and image types are sniffed', async () => {
  const { iconLinks, sniff } = await import('../src/lib/interviews/logos.ts');
  const html = '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="/icon.svg" type="image/svg+xml">';
  assert.deepEqual(iconLinks(html, 'https://roadrunner.ai/'), ['https://roadrunner.ai/apple.png', 'https://roadrunner.ai/icon.svg', 'https://roadrunner.ai/favicon.ico']);
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(128, 16); png.writeUInt32BE(128, 20);
  assert.deepEqual(sniff(png), { ext: 'png', size: 128 });
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.ext, 'svg');
  assert.equal(sniff(Buffer.from('<html>not an image</html>')), undefined);
});
