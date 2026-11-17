// The chat pane's pure logic for coding-agent sessions (src/lib/code-sessions-ui.ts): one list of OpenClaw chats and
// coding sessions, a session's glance and place, a turn as blocks, diffs, durations and limits in words, the stream
// applied without touching what is drawn, and the sky's count and bubble naming the agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySessionEvent, chatsState, codeLinkOf, codeRowId, commandOutcome, diffCounts, failureText, formatDuration, isInternalHref, limitResetsAt, limitsLine,
  linkUnread, mergeChatRows, namesLine, parseDiff, placeGroups, placeLine, resumeCommand, sessionGlance, sessionPill, skyChats, skyTalk,
  stepsSummary, storedState, toolInputLine, turnBlocks,
} from '../src/lib/code-sessions-ui';
import { chatsLine } from '../src/components/sunrise/glance';
import type { CodeSessionLink, SessionItem, SessionSummary, SessionTurn } from '../src/lib/code-agents/protocol';
import type { ChatThreadSummary } from '../src/lib/task-chat';

const NOW = Date.parse('2026-11-16T15:00:00.000Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const link = (over: Partial<CodeSessionLink> = {}): CodeSessionLink => ({
  id: 'cs1', agent: 'codex', host: 'laptop', cwd: '/home/openclaw/projects/agentic-journal', sessionId: 'th-1', title: 'Fix the tests',
  picks: { model: null, effort: null, mode: 'auto-edit' }, createdAt: ago(60), touchedAt: ago(30), seenAt: ago(30), lastState: 'idle', lastLine: '', ...over,
});
const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({ ...link(), state: 'idle', unread: false, approvals: 0, ...over });
const thread = (over: Partial<ChatThreadSummary> = {}): ChatThreadSummary => ({
  id: 't1', title: 'What first?', last: 'Start with the reading.', lastRole: 'openclaw', count: 2, state: 'idle', about: null, ask: '', askAbout: null,
  sessionKey: 'agent:main:journal-chat-x-1', createdAt: ago(90), updatedAt: ago(20), ...over,
});

test('OpenClaw chats and coding sessions are one list, the most recent activity first', () => {
  const rows = mergeChatRows(
    [thread({ id: 'old', updatedAt: ago(120) }), thread({ id: 'new', updatedAt: ago(5) })],
    [summary({ id: 'a', touchedAt: ago(50), settledAt: ago(10) }), summary({ id: 'b', touchedAt: ago(200), workingSince: ago(1) })],
  );
  assert.deepEqual(rows.map((r) => r.id), ['code:b', 'new', 'code:a', 'old']);
  assert.equal(rows[0]!.kind, 'code');
  assert.deepEqual([codeRowId('cs9'), codeLinkOf('code:cs9'), codeLinkOf('t1'), codeLinkOf(null), codeLinkOf('code:')], ['code:cs9', 'cs9', null, null, null]);
  assert.deepEqual(mergeChatRows([thread()], []).map((r) => r.kind), ['openclaw']);
});

test('a session at a glance: its pill, its line, its place', () => {
  assert.deepEqual(sessionPill({ state: 'working' }), { word: 'Working', tone: 'working' });
  assert.deepEqual(sessionPill({ state: 'needs-you' }), { word: 'Needs you', tone: 'waiting' });
  assert.deepEqual(sessionPill({ state: 'idle', unread: true }), { word: 'Waiting on you', tone: 'waiting' });
  assert.deepEqual(sessionPill({ state: 'failed' }), { word: 'Failed', tone: 'failed' });
  assert.equal(sessionGlance(summary({ state: 'needs-you', asking: { kind: 'command', title: 'Run npm test' } })), 'Needs you: Run npm test');
  assert.equal(sessionGlance(summary({ state: 'needs-you', asking: { kind: 'file-change', title: '' } })), 'Needs you: approve file changes');
  assert.equal(sessionGlance(summary({ state: 'needs-you' })), 'Needs you: approve a step');
  assert.equal(sessionGlance(summary({ state: 'working', agent: 'claude-code' })), 'Claude Code is working…');
  assert.equal(sessionGlance(summary({ state: 'failed', lastLine: 'Usage limit reached.' })), 'Failed: Usage limit reached.');
  assert.equal(sessionGlance(summary({ lastLine: 'All 3 tests pass.' })), 'Codex: All 3 tests pass.');
  assert.equal(sessionGlance(summary()), 'Nothing said yet.');
  const places = [{ host: 'laptop', cwd: '/w', label: 'OpenClaw workspace', kind: 'workspace' as const, available: true },
    { host: 'mac', cwd: '~/site', label: 'site', kind: 'project' as const, available: false },
    { host: 'laptop', cwd: '/p/journal', label: 'agentic-journal', kind: 'project' as const, available: true }];
  assert.equal(placeLine('laptop', '/w', places), 'laptop · OpenClaw workspace');
  assert.equal(placeLine('laptop', '/x/some-repo/', places), 'laptop · some-repo');
  assert.deepEqual(placeGroups([places[1]!, places[0]!, places[2]!]).map((g) => [g.host, g.available, g.places.length]), [['laptop', true, 2], ['mac', false, 1]]);
  assert.equal(resumeCommand('codex', "/p/it's", 'th-1'), "cd '/p/it'\\''s' && codex resume th-1");
  // Home and folders under it: the tilde stays outside the quotes, so the shell still reads it as home.
  assert.equal(resumeCommand('claude-code', '', 'abc'), 'cd ~ && claude --resume abc');
  assert.equal(resumeCommand('claude-code', null, 'abc'), 'cd ~ && claude --resume abc');
  assert.equal(resumeCommand('codex', '~', 'th-1'), 'cd ~ && codex resume th-1');
  assert.equal(resumeCommand('codex', '~/projects/my site', 'th-1'), "cd ~/'projects/my site' && codex resume th-1");
  // The id is quoted when it is more than a plain word.
  assert.equal(resumeCommand('codex', '/p', '01a1e72f-95ea-7570-81c0-34d94083c4ac'), "cd '/p' && codex resume 01a1e72f-95ea-7570-81c0-34d94083c4ac");
  assert.equal(resumeCommand('codex', '/p', 'x; rm -rf ~'), "cd '/p' && codex resume 'x; rm -rf ~'");
  assert.equal(resumeCommand('claude-code', '/p', "it's"), "cd '/p' && claude --resume 'it'\\''s'");
});

test('links in what an agent wrote: only paths on this site stay in the tab', () => {
  assert.equal(isInternalHref('/sunrise?task=1'), true);
  assert.equal(isInternalHref('/'), true);
  for (const away of ['//evil.com/x', '/\\evil.com', 'https://evil.com', 'http://127.0.0.1:3000/', 'mailto:a@b.c', 'javascript:alert(1)', '', null, undefined]) {
    assert.equal(isInternalHref(away), false, String(away));
  }
});

const cmd = (id: string, over: Partial<Extract<SessionItem, { kind: 'command' }>> = {}): SessionItem => ({ id, kind: 'command', command: 'npm test', cwd: '/r', output: '', exitCode: 0, status: 'done', durationMs: 1200, ...over });

test('a turn as blocks: what he said, steps grouped, the answer last', () => {
  const turn = { items: [
    { id: 'u', kind: 'user', text: 'Fix it' },
    { id: 'r', kind: 'reasoning', text: 'Looking at the failing test' },
    cmd('c1'),
    cmd('c2', { exitCode: 1, status: 'failed' }),
    { id: 'a1', kind: 'agent', text: 'The test races the clock.' },
    { id: 'p', kind: 'plan', text: '', steps: [{ text: 'Read', status: 'done' }] },
    { id: 'f', kind: 'file-change', status: 'done', files: [{ path: 'a.ts', change: 'update', diff: '@@ -1 +1 @@\n-a\n+b' }, { path: 'b.ts', change: 'add', diff: 'x' }] },
    { id: 'n', kind: 'notice', level: 'info', text: 'Compacted' },
    { id: 'w', kind: 'notice', level: 'warning', text: 'Retrying' },
    { id: 'empty', kind: 'agent', text: '' },
    { id: 'a2', kind: 'agent', text: 'Fixed: the clock is frozen now.' },
  ] as SessionItem[] };
  const blocks = turnBlocks(turn);
  assert.deepEqual(blocks.map((b) => b.type), ['user', 'steps', 'agent', 'plan', 'steps', 'notice', 'agent']);
  assert.deepEqual(blocks.filter((b) => b.type === 'agent').map((b) => (b as { final: boolean }).final), [false, true]);
  assert.equal((blocks[1] as { items: SessionItem[] }).items.length, 3);
  assert.equal(stepsSummary((blocks[1] as { items: SessionItem[] }).items), 'Ran 2 commands (1 failed)');
  assert.equal(stepsSummary((blocks[4] as { items: SessionItem[] }).items), 'Edited 2 files');
  assert.equal(stepsSummary([{ id: 't', kind: 'tool', name: 'x', input: '', result: '', status: 'done' }, { id: 's', kind: 'web-search', query: 'q', status: 'done' }]), 'Used a tool · Searched the web');
  assert.equal(stepsSummary([{ id: 'r', kind: 'reasoning', text: 'hm' }]), 'Thought it through');
  // A turn still going, its answer still streaming, has it as its last block.
  assert.equal((turnBlocks({ items: [cmd('c'), { id: 'a', kind: 'agent', text: 'So far' }] }).at(-1) as { final: boolean }).final, true);
  assert.equal(turnBlocks({ items: [{ id: 'a', kind: 'agent', text: 'Then' }, cmd('c', { status: 'running', exitCode: null })] }).some((b) => b.type === 'agent' && b.final), false);
  assert.deepEqual([commandOutcome(cmd('x') as never).tone, commandOutcome(cmd('x', { exitCode: 2 }) as never).word, commandOutcome(cmd('x', { status: 'running', exitCode: null }) as never).tone, commandOutcome(cmd('x', { status: 'declined', exitCode: null }) as never).word], ['ok', 'exit 2', 'running', 'declined']);
  assert.equal(toolInputLine('{"q":"flaky test","limit":5}'), 'q: flaky test, limit: 5');
  assert.equal(toolInputLine('plain words'), 'plain words');
});

test('diffs as numbered lines, with what was added and taken out', () => {
  const lines = parseDiff('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -3,3 +3,4 @@ fn\n keep\n-old\n+new\n+more\n\\ No newline at end of file\n');
  assert.deepEqual(lines.map((l) => [l.kind, l.old ?? null, l.new ?? null]), [
    ['meta', null, null], ['meta', null, null], ['meta', null, null], ['meta', null, null], ['hunk', null, null],
    ['ctx', 3, 3], ['del', 4, null], ['add', null, 4], ['add', null, 5], ['meta', null, null],
  ]);
  assert.equal(lines[5]!.text, 'keep');
  // A new file's "diff" that is only its text is all added; a removed one all taken out.
  assert.deepEqual(parseDiff('one\ntwo', 'add').map((l) => [l.kind, l.new]), [['add', 1], ['add', 2]]);
  assert.deepEqual(diffCounts({ path: 'gone', change: 'delete', diff: 'a\nb\nc' }), { added: 0, removed: 3 });
  assert.deepEqual(diffCounts({ path: 'x', change: 'update', diff: '@@ -1,2 +1,2 @@\n-a\n+b\n c' }), { added: 1, removed: 1 });
  assert.deepEqual(parseDiff(''), []);
});

test('durations, limits and failures in plain words', () => {
  assert.deepEqual([formatDuration(420), formatDuration(4200), formatDuration(12_400), formatDuration(72_000), formatDuration(3_840_000), formatDuration(null)], ['0.4 s', '4.2 s', '12 s', '1m 12s', '1h 4m', '']);
  const at = new Date(NOW); at.setHours(at.getHours() + 2, 20, 0, 0);
  const blocked = { windows: [{ label: '5 hours', usedPercent: 100, resetsAt: at.getTime() }, { label: 'week', usedPercent: 40, resetsAt: NOW + 5 * 86_400_000 }], blocked: true };
  assert.equal(limitResetsAt(blocked), at.getTime());
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  assert.deepEqual(limitsLine(blocked, NOW), { text: `Usage limit reached · resets ${time}`, blocked: true });
  assert.deepEqual(limitsLine({ windows: [{ label: '5 hours', usedPercent: 12, resetsAt: null }, { label: 'week', usedPercent: 31.6, resetsAt: null }], blocked: false }, NOW), { text: 'week: 32% used', blocked: false });
  assert.equal(limitsLine(undefined), null);
  assert.equal(failureText('codex', { error: 'You hit your limit', limited: true }, blocked, NOW), `Codex hit its usage limit, so this turn did not run. It can work again at ${time}.`);
  assert.equal(failureText('claude-code', { error: null, limited: true }, null, NOW), 'Claude Code hit its usage limit, so this turn did not run. It can work again when the limit resets.');
  assert.equal(failureText('codex', { error: ' boom ' }), 'boom');
  assert.equal(failureText('codex', { error: null }), 'Codex stopped with an error.');
});

test('the stream applied on a copy: what did not change stays the same object', () => {
  const kept: SessionItem = { id: 'u', kind: 'user', text: 'Go' };
  const growing: SessionItem = { id: 'a', kind: 'agent', text: 'Hel' };
  const old: SessionTurn = { id: 't0', status: 'done', items: [{ id: 'x', kind: 'agent', text: 'Before' }], error: null, startedAt: 1, endedAt: 2 };
  const turns: SessionTurn[] = [old, { id: 't1', status: 'running', items: [kept, growing], error: null, startedAt: 3, endedAt: null }];
  const next = applySessionEvent(turns, { type: 'item-delta', turnId: 't1', itemId: 'a', field: 'text', delta: 'lo' });
  assert.notEqual(next, turns);
  assert.equal(next[0], old);
  assert.equal(next[1]!.items[0], kept);
  assert.equal((next[1]!.items[1] as { text: string }).text, 'Hello');
  assert.equal((growing as { text: string }).text, 'Hel', 'the drawn item is not changed');
  const done = applySessionEvent(next, { type: 'turn-completed', turnId: 't1', status: 'done', error: null, at: 9 });
  assert.equal(next[1]!.status, 'running');
  assert.deepEqual([done[1]!.status, done[1]!.endedAt], ['done', 9]);
  const fresh = applySessionEvent(done, { type: 'item-started', turnId: 't2', item: { id: 'u2', kind: 'user', text: 'More' } });
  assert.deepEqual(fresh.map((t) => t.id), ['t0', 't1', 't2']);
  assert.equal(applySessionEvent(fresh, { type: 'state-changed', state: 'idle', turnId: 't2' }).length, 3);
});

test('events the copy already has are applied again without harm: a delta with its offset is not added twice', () => {
  // The history was read just after "Hel" + "lo" arrived; the stream then replays from before them.
  const read: SessionTurn[] = [{ id: 't', status: 'running', items: [{ id: 'a', kind: 'agent', text: 'Hello' }], error: null, startedAt: 1, endedAt: null }];
  let turns = applySessionEvent(read, { type: 'item-delta', turnId: 't', itemId: 'a', field: 'text', delta: 'Hel', offset: 0 });
  turns = applySessionEvent(turns, { type: 'item-delta', turnId: 't', itemId: 'a', field: 'text', delta: 'lo', offset: 3 });
  assert.equal((turns[0]!.items[0] as { text: string }).text, 'Hello');
  // One that reaches past what it has adds only the new part; one past a gap is added whole.
  turns = applySessionEvent(turns, { type: 'item-delta', turnId: 't', itemId: 'a', field: 'text', delta: 'lo there', offset: 3 });
  assert.equal((turns[0]!.items[0] as { text: string }).text, 'Hello there');
  turns = applySessionEvent(turns, { type: 'item-delta', turnId: 't', itemId: 'a', field: 'text', delta: '!', offset: 40 });
  assert.equal((turns[0]!.items[0] as { text: string }).text, 'Hello there!');
  // Without an offset (the hub did not see the item begin), a delta is appended as before.
  turns = applySessionEvent(turns, { type: 'item-delta', turnId: 't', itemId: 'a', field: 'text', delta: '?' });
  assert.equal((turns[0]!.items[0] as { text: string }).text, 'Hello there!?');
  // A start and an end replayed over a copy that has them set the same things again.
  turns = applySessionEvent(turns, { type: 'turn-completed', turnId: 't', status: 'done', error: null, at: 9 });
  const again = applySessionEvent(turns, { type: 'turn-completed', turnId: 't', status: 'done', error: null, at: 9 });
  assert.deepEqual(again, turns);
  const item = { id: 'c', kind: 'command' as const, command: 'ls', cwd: '/', output: 'a\n', exitCode: 0, status: 'done' as const, durationMs: 1 };
  const twice = applySessionEvent(applySessionEvent(again, { type: 'item-completed', turnId: 't', item }), { type: 'item-completed', turnId: 't', item });
  assert.equal(twice[0]!.items.filter((i) => i.id === 'c').length, 1);
});

test('the sky counts coding sessions and names the agent', () => {
  const none = { count: 2, waiting: 0, working: 1 };
  assert.equal(skyChats(none, undefined), none);
  assert.equal(skyChats(none, [link({ archived: true })]), none);
  const working = skyChats({ count: 0, waiting: 0, working: 0 }, [link({ lastState: 'working', workingSince: ago(2) })], NOW);
  assert.deepEqual(working, { count: 1, waiting: 0, working: 1, workingWho: 'Codex' });
  assert.deepEqual(chatsLine(working), { count: '1 chat', state: 'Codex is working', waiting: false });
  // An old "working" nobody watches any more is idle.
  assert.equal(storedState(link({ lastState: 'working', workingSince: ago(400) }), NOW), 'idle');
  const both = skyChats({ count: 1, waiting: 0, working: 1 }, [link({ lastState: 'working', workingSince: ago(2) })], NOW);
  assert.equal(chatsLine(both)!.state, 'OpenClaw and Codex are working');
  const asks = skyChats({ count: 1, waiting: 0, working: 0 }, [link({ agent: 'claude-code', lastState: 'needs-you', workingSince: ago(1), asking: { kind: 'command', title: 'Run rm -rf build' } })], NOW);
  assert.deepEqual(chatsLine(asks), { count: '2 chats', state: 'Claude Code needs you', waiting: true });
  const answered = skyChats({ count: 0, waiting: 0, working: 0 }, [link({ settledAt: ago(1), seenAt: ago(5) }), link({ id: 'cs2', settledAt: ago(1), seenAt: ago(0) })], NOW);
  assert.deepEqual([answered.waiting, chatsLine(answered)!.state], [1, '1 waiting on you']);
  assert.equal(chatsState({ count: 1, waiting: 1, working: 0, waitingWho: 'OpenClaw', asks: true }), 'waiting on you');
  assert.equal(linkUnread(link({ settledAt: ago(1), seenAt: ago(5) }), 'working'), false);
  assert.equal(namesLine(['OpenClaw', 'Codex', 'Codex', 'Claude Code']), 'OpenClaw, Codex and Claude Code');

  const asking = link({ id: 'cs7', title: 'Clean the build', lastState: 'needs-you', workingSince: ago(1), asking: { kind: 'command', title: 'Run rm -rf build' } });
  const talk = skyTalk(null, [link({ settledAt: ago(3), seenAt: ago(9), lastLine: 'Done.' }), asking], NOW)!;
  assert.deepEqual(talk.waiting, { threadId: 'code:cs7', title: 'Clean the build', text: 'Codex needs you: Run rm -rf build', at: asking.touchedAt, more: 1, who: 'Codex' });
  assert.deepEqual(talk.threads, []);
  // OpenClaw's chat that waits on him comes first; the sessions count in its "more".
  const claw = { waiting: { threadId: 't1', title: 'A', text: 'Hi', at: ago(1), more: 0 }, threads: [{ id: 't1', title: 'A', waiting: true }] };
  assert.deepEqual(skyTalk(claw, [asking], NOW)!.waiting, { ...claw.waiting, more: 1 });
  assert.equal(skyTalk(claw, [link()], NOW), claw);
  assert.equal(skyTalk(null, [], NOW), null);
});
