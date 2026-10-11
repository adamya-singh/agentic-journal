import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskBrief, type BriefTaskRef } from '../src/lib/task-brief';
import { buildChatTurnMessage, chatSessionKey, settleStalePending, CHAT_TURN_TIMEOUT_MS, type TaskChatThread } from '../src/lib/task-chat';

const now = new Date(2026, 9, 8, 12, 0);

test('the first turn carries the brief, later turns go as typed', () => {
  const refs: BriefTaskRef[] = [{ task: { id: 'ff', text: '[Data Context] Fair Face', dueDate: '2026-10-09', notesMarkdown: 'Read the two articles.' }, listType: 'have-to-do' }];
  const brief = buildTaskBrief({ taskId: 'ff', tasks: refs, completed: [], journal: [], now });
  assert.ok(brief);
  const first = buildChatTurnMessage({ brief, text: 'What does the rubric want?', first: true });
  assert.match(first, /Task: \[Data Context\] Fair Face/);
  assert.match(first, /Read the two articles\./);
  assert.match(first, /Journal task id: ff \(have-to-do\)/);
  assert.ok(first.trimEnd().endsWith('What does the rubric want?'));
  assert.equal(buildChatTurnMessage({ brief, text: 'Thanks', first: false }), 'Thanks');
});

test('session keys are per thread and safe', () => {
  const key = chatSessionKey('Task ID/42', now);
  assert.equal(key, `agent:main:journal-chat-task-id-42-${now.getTime()}`);
});

test('a turn lost to a restart settles as failed', () => {
  const thread: TaskChatThread = { taskId: 'ff', sessionKey: 'k', messages: [], pendingSince: now.toISOString(), error: null };
  assert.equal(settleStalePending(thread, new Date(now.getTime() + 60_000)), false);
  assert.ok(thread.pendingSince);
  assert.equal(settleStalePending(thread, new Date(now.getTime() + CHAT_TURN_TIMEOUT_MS + 120_000)), true);
  assert.equal(thread.pendingSince, null);
  assert.ok(thread.error);
});
