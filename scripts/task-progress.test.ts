import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordProgress } from '../src/lib/task-progress';
import { parseNotes, buildTaskBrief, type BriefTaskRef } from '../src/lib/task-brief';
import { buildChatTurnMessage, typedTextOf } from '../src/lib/task-chat';

const nov13 = new Date(2026, 10, 13, 11, 35);
const nov15 = new Date(2026, 10, 15, 9, 0);

test('the first thing recorded starts the Progress section and leaves the notes above it alone', () => {
  const notes = recordProgress('Dispute the Boom charge.\n\n- **Unit:** 0901 - B2', { did: 'Sent the dispute to socam290@peakmade.com', next: 'Read the replies', waitingOn: 'SoCam and Boom, since Nov 13' }, nov13);
  assert.equal(notes, [
    'Dispute the Boom charge.', '', '- **Unit:** 0901 - B2', '',
    '## Progress', '- **Next:** Read the replies', '- **Waiting on:** SoCam and Boom, since Nov 13', '- Nov 13: Sent the dispute to socam290@peakmade.com',
  ].join('\n'));
  assert.equal(recordProgress(undefined, { did: 'Called' }, nov13), '## Progress\n- Nov 13: Called');
});

test('later entries add to the log; Next and Waiting on are the latest said, kept when omitted and cleared by ""', () => {
  const first = recordProgress('Intro.', { did: 'Sent it', next: 'Read the replies', waitingOn: 'SoCam' }, nov13);
  const second = recordProgress(first, { did: 'SoCam credited $18', waitingOn: '' }, nov15);
  assert.equal(second, 'Intro.\n\n## Progress\n- **Next:** Read the replies\n- Nov 13: Sent it\n- Nov 15: SoCam credited $18');
  const third = recordProgress(second, { did: 'Boom confirmed', next: 'Check the December ledger' }, nov15);
  assert.match(third, /- \*\*Next:\*\* Check the December ledger\n- Nov 13: Sent it\n- Nov 15: SoCam credited \$18\n- Nov 15: Boom confirmed$/);
});

test('sections after Progress stay after it, and an entry is one line', () => {
  const notes = recordProgress('## Progress\n- Nov 1: Began\n\n## Links\n- [Portal](https://example.com)', { did: 'Two\nlines' }, nov13);
  assert.equal(notes, '## Progress\n- Nov 1: Began\n- Nov 13: Two lines\n\n## Links\n- [Portal](https://example.com)');
});

test('notes past their limit lose the oldest log lines first', () => {
  let notes = 'Intro.';
  for (let i = 0; i < 60; i += 1) notes = recordProgress(notes, { did: `${i} ${'x'.repeat(590)}`, next: 'Keep going' }, nov13);
  assert.ok(notes.length <= 20000);
  assert.ok(notes.startsWith('Intro.\n\n## Progress\n- **Next:** Keep going\n'));
  assert.ok(!notes.includes('- Nov 13: 0 x'));
  assert.ok(notes.includes('- Nov 13: 59 x'));
});

test('the brief shows Progress as a section of its own', () => {
  const parsed = parseNotes(recordProgress('Intro.', { did: 'Sent it', next: 'Read the replies', waitingOn: 'SoCam, since Nov 13' }, nov13));
  assert.equal(parsed.intro, 'Intro.');
  assert.deepEqual(parsed.sections.map((s) => [s.title, s.markdown]), [['Progress', '- **Next:** Read the replies\n- **Waiting on:** SoCam, since Nov 13\n- Nov 13: Sent it']]);
});

test('a chat is told to record what it does for the task, and not to promise to watch', () => {
  const refs: BriefTaskRef[] = [{ task: { id: 'boom', text: 'Dispute Boom charges', notesMarkdown: '' }, listType: 'have-to-do' }];
  const brief = buildTaskBrief({ taskId: 'boom', tasks: refs, completed: [], journal: [], now: nov13 });
  const first = buildChatTurnMessage({ brief, text: 'Send both emails', first: true });
  assert.match(first, /api\/tasks\/progress/);
  assert.match(first, /"taskId":"boom"/);
  assert.match(first, /never say you will watch/);
  assert.equal(typedTextOf(first), 'Send both emails');
  assert.doesNotMatch(buildChatTurnMessage({ brief: null, text: 'Hi', first: true }), /api\/tasks\/progress/);
});
