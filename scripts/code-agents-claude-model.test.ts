// The Claude bridge's mapping from the Agent SDK's shapes to the Journal's (bridge/mapping.ts), and its plain
// helpers (bridge/claude-bridge.ts): a transcript read back as turns, shaped like the real ones read in Stage 0
// (empty signed thinking, Bash "Exit code" results, edits, plans, MCP and sub-agent calls, interrupts, background
// task notices, Claude Code's own messages); file diffs; models; usage windows; approvals; the child's environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approvalFor, fileEdits, historyTurns, limitSummary, limitWindow, limitWindows, modelEntries, nativeSession, sessionRuleOptions, TurnBuilder } from '../bridge/mapping.ts';
import { cleanChildEnv, findClaude, transcriptCwd } from '../bridge/claude-bridge.ts';
import type { SdkSessionMessage } from '../bridge/sdk-types.ts';
import type { EventBody } from '../src/lib/code-agents/protocol';

const CWD = '/home/me/repo';
const BASE = Date.parse('2026-11-16T15:00:00.000Z');
let clock = BASE;
const msg = (type: 'user' | 'assistant', uuid: string, message: SdkSessionMessage['message'], extra: Partial<SdkSessionMessage> = {}): SdkSessionMessage => ({
  type, uuid, session_id: 's1', parent_tool_use_id: null, timestamp: new Date((clock += 1000)).toISOString(), message, ...extra,
});
const said = (id: string, content: SdkSessionMessage['message']['content'], model = 'claude-fable-5-2') => ({ id, model, role: 'assistant', content });

test('a transcript read back as turns', () => {
  const transcript: SdkSessionMessage[] = [
    msg('user', 'u1', { role: 'user', content: 'Make the tests pass' }, { origin: { kind: 'human' } }),
    msg('assistant', 'a1', said('msg_1', [{ type: 'thinking', thinking: '', signature: 'sig' } as never])),
    msg('assistant', 'a2', said('msg_1', [{ type: 'text', text: 'Running them.' }])),
    msg('assistant', 'a3', said('msg_1', [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }])),
    msg('user', 'r1', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', content: 'Exit code 1\n1 failing', is_error: true }] }),
    msg('assistant', 'a4', said('msg_2', [{ type: 'tool_use', id: 'toolu_e', name: 'Edit', input: { file_path: `${CWD}/src/a.ts`, old_string: 'one', new_string: 'two' } }])),
    msg('user', 'r2', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_e', content: 'The file has been updated successfully.' }] }),
    msg('assistant', 'a5', said('msg_2', [{ type: 'tool_use', id: 'toolu_t', name: 'TodoWrite', input: { todos: [{ content: 'Fix a', status: 'completed', activeForm: 'Fixing a' }, { content: 'Fix b', status: 'in_progress', activeForm: 'Fixing b' }] } }])),
    msg('assistant', 'a6', said('msg_3', [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { description: 'Map the code', subagent_type: 'Explore', prompt: 'Look around' } }])),
    // Inside the sub-agent: left out.
    msg('assistant', 'sub1', said('msg_sub', [{ type: 'text', text: 'sub-agent talk' }]), { parent_tool_use_id: 'toolu_a' }),
    msg('user', 'r3', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: [{ type: 'text', text: 'Found 3 files' }] }] }),
    msg('assistant', 'a7', said('msg_4', [{ type: 'tool_use', id: 'toolu_m', name: 'mcp__github__create_issue', input: { title: 'Bug' } }])),
    msg('user', 'r4', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_m', content: 'The user declined this from the Agentic Journal.', is_error: true }] }),
    msg('assistant', 'a8', said('msg_5', [{ type: 'text', text: 'Done: both fixed.' }])),
    // Second turn: stopped.
    msg('user', 'u2', { role: 'user', content: [{ type: 'text', text: 'Now deploy' }] }),
    msg('assistant', 'a9', said('msg_6', [{ type: 'tool_use', id: 'toolu_d', name: 'Bash', input: { command: 'npm run deploy' } }])),
    msg('user', 'r5', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_d', content: 'Interrupted', is_error: true }] }),
    msg('user', 'i1', { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }),
    msg('assistant', 'a10', said('msg_7', [{ type: 'text', text: 'No response requested.' }], '<synthetic>')),
    // Third: a background task reported back.
    msg('user', 'u3', { role: 'user', content: '<task-notification>\n<task-id>x</task-id>' }, { origin: { kind: 'task-notification' } }),
    msg('assistant', 'a11', said('msg_8', [{ type: 'text', text: 'The task finished.' }])),
    // Fourth: failed on the usage limit, in Claude Code's own words.
    msg('user', 'u4', { role: 'user', content: 'Keep going' }),
    msg('assistant', 'a12', said('msg_9', [{ type: 'text', text: 'Claude AI usage limit reached|1794900000' }], '<synthetic>')),
  ];
  const turns = historyTurns(transcript, CWD);
  assert.deepEqual(turns.map((t) => [t.id, t.status, t.error, t.limited ?? false]), [
    ['u1', 'done', null, false],
    ['u2', 'interrupted', null, false],
    ['u3', 'done', null, false],
    ['u4', 'failed', 'Claude AI usage limit reached|1794900000', true],
  ]);
  const [first, second, third, fourth] = turns;
  // Empty signed thinking is not shown; sub-agent messages are left out.
  assert.deepEqual(first!.items.map((i) => `${i.kind}:${i.id}`), ['user:u1', 'agent:msg_1:1', 'command:toolu_b', 'file-change:toolu_e', 'plan:toolu_t', 'tool:toolu_a', 'tool:toolu_m', 'agent:msg_5:0']);
  const items = Object.fromEntries(first!.items.map((i) => [i.id, i]));
  assert.deepEqual(items.toolu_b, { id: 'toolu_b', kind: 'command', command: 'npm test', cwd: CWD, output: 'Exit code 1\n1 failing', exitCode: 1, status: 'failed', durationMs: 1000, startedAt: BASE + 4000, endedAt: BASE + 5000 });
  const edit = items.toolu_e as Extract<typeof items.toolu_e, { kind: 'file-change' }>;
  assert.deepEqual([edit.status, edit.files[0]!.path, edit.files[0]!.change], ['done', `${CWD}/src/a.ts`, 'update']);
  assert.equal(edit.files[0]!.diff, '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-one\n+two');
  assert.deepEqual((items.toolu_t as { steps: unknown }).steps, [{ text: 'Fix a', status: 'done' }, { text: 'Fix b', status: 'running' }]);
  assert.deepEqual([(items.toolu_a as { name: string }).name, (items.toolu_a as { input: string }).input, (items.toolu_a as { result: string }).result], ['Agent', 'Explore: Map the code', 'Found 3 files']);
  assert.deepEqual([(items.toolu_m as { name: string }).name, (items.toolu_m as { status: string }).status], ['github.create_issue', 'declined']);
  // "No response requested." is Claude Code's own and not an error: not shown.
  assert.deepEqual(second!.items.map((i) => i.kind), ['user', 'command']);
  assert.deepEqual(third!.items.map((i) => [i.kind, i.kind === 'notice' ? i.text : '']), [['notice', 'A background task reported back.'], ['agent', '']]);
  assert.deepEqual(fourth!.items.map((i) => [i.kind, i.kind === 'notice' ? i.level : '']), [['user', ''], ['notice', 'error']]);
});

test('a live turn says each change, and gives the same ids as the transcript', () => {
  const events: EventBody[] = [];
  const b = new TurnBuilder('t1', CWD, 1, (e) => events.push(e));
  b.user('t1', 'Hi', 1);
  b.stream({ type: 'message_start', message: { id: 'msg_x' } }, 2);
  b.stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, 2);
  b.stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm.' } }, 2);
  b.stream({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }, 3);
  b.stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } }, 3);
  b.stream({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } }, 3);
  b.stream({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_w', name: 'Write', input: {} } }, 4);
  b.stream({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"file' } }, 4);
  // The whole blocks follow, one assistant message each; the transcript keeps thinking empty.
  b.assistant({ message: said('msg_x', [{ type: 'thinking', thinking: '' }]) }, 5);
  b.assistant({ message: said('msg_x', [{ type: 'text', text: 'Hello' }]) }, 5);
  b.assistant({ message: said('msg_x', [{ type: 'tool_use', id: 'toolu_w', name: 'Write', input: { file_path: `${CWD}/new.txt`, content: 'a\nb\n' } }]) }, 6);
  b.toolResults([{ type: 'tool_result', tool_use_id: 'toolu_w', content: 'File created' }], { type: 'create', filePath: `${CWD}/new.txt` }, 7);
  assert.deepEqual(events.map((e) => e.type + ('itemId' in e ? `:${e.itemId}` : 'item' in e ? `:${e.item.id}` : '')), [
    'item-completed:t1', 'item-started:msg_x:0', 'item-delta:msg_x:0', 'item-started:msg_x:1', 'item-delta:msg_x:1', 'item-delta:msg_x:1',
    'item-started:toolu_w', 'item-completed:msg_x:0', 'item-completed:msg_x:1', 'item-updated:toolu_w', 'item-completed:toolu_w',
  ]);
  const items = b.turn.items;
  assert.deepEqual(items.map((i) => [i.kind, 'text' in i ? i.text : '']), [['user', 'Hi'], ['reasoning', 'Hmm.'], ['agent', 'Hello'], ['file-change', '']]);
  const write = items[3] as Extract<(typeof items)[number], { kind: 'file-change' }>;
  assert.deepEqual([write.status, write.files[0]!.change, write.files[0]!.diff], ['done', 'add', '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b']);
  // A tool still open when the turn ends ends with it.
  b.assistant({ message: said('msg_y', [{ type: 'tool_use', id: 'toolu_g', name: 'Grep', input: { pattern: 'TODO', path: 'src' } }]) }, 8);
  b.finish('interrupted', null, false, 9);
  const grep = b.turn.items.at(-1) as Extract<(typeof items)[number], { kind: 'tool' }>;
  assert.deepEqual([grep.name, grep.input, grep.status, b.turn.status, b.turn.endedAt], ['Grep', 'TODO in src', 'failed', 'interrupted', 9]);
  // A sub-agent's steps show as progress on the call that started it.
  const c = new TurnBuilder('t2', CWD, 1);
  c.assistant({ message: said('m', [{ type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'Look', subagent_type: 'Explore' } }]) }, 1);
  c.subagent('toolu_task', { type: 'assistant', message: said('s', [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/a/b.ts' } }]) });
  assert.equal((c.turn.items[0] as { result: string }).result, 'Working: Read /a/b.ts');
});

test('an edit with the tool’s own patch; MultiEdit', () => {
  const own = { structuredPatch: [{ oldStart: 10, oldLines: 2, newStart: 10, newLines: 2, lines: [' keep', '-old', '+new'] }] };
  assert.equal(fileEdits('Edit', { file_path: `${CWD}/x.ts`, old_string: 'old', new_string: 'new' }, CWD, own)[0]!.diff, '--- a/x.ts\n+++ b/x.ts\n@@ -10,2 +10,2 @@\n keep\n-old\n+new');
  const multi = fileEdits('MultiEdit', { file_path: '/elsewhere/y.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: '' }] }, CWD);
  assert.equal(multi[0]!.diff, '--- /elsewhere/y.ts\n+++ /elsewhere/y.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n@@ -1,1 +1,0 @@\n-c');
  assert.equal(fileEdits('Write', { file_path: `${CWD}/z`, content: 'q' }, CWD, { type: 'update' })[0]!.change, 'update');
});

test('models, usage windows, the agent’s own list, approvals', () => {
  assert.deepEqual(modelEntries([
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Use the default model' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    { value: 'claude-fable-5-2[1m]', resolvedModel: 'claude-fable-5-2[1m]', displayName: 'Fable', description: '' },
  ]), [
    { id: 'opus', label: 'Opus', description: 'Opus 5.5', efforts: ['low', 'high'], defaultEffort: null, isDefault: true },
    { id: 'claude-fable-5-2[1m]', label: 'Fable', efforts: [], defaultEffort: null, isDefault: false },
  ]);
  const five = limitWindow({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.82, resetsAt: 1794900000 })!;
  const week = limitWindow({ status: 'rejected', rateLimitType: 'seven_day' })!;
  assert.deepEqual([five.label, five.usedPercent, five.resetsAt], ['5 hours', 82, 1794900000000]);
  assert.deepEqual(limitSummary([five, week]), { windows: [{ label: '5 hours', usedPercent: 82, resetsAt: 1794900000000 }, { label: 'week', usedPercent: 100, resetsAt: null }], blocked: true });
  assert.equal(limitWindow({ status: 'allowed' }), null);

  assert.deepEqual(nativeSession({ sessionId: 's', summary: 'A very long first prompt that goes on and on and on, past the sixty characters of a title', lastModified: 5, firstPrompt: 'A very long first prompt' }, CWD), {
    sessionId: 's', title: 'A very long first prompt that goes on and on and on, past…', preview: 'A very long first prompt', cwd: CWD, createdAt: 5, updatedAt: 5,
  });
  assert.equal(nativeSession({ sessionId: 's', summary: 'x', customTitle: 'Mine', lastModified: 5, cwd: '/b' }, CWD).title, 'Mine');

  const bash = approvalFor('Bash', { command: 'rm -rf build', description: 'Clean' }, { suggestions: [{ type: 'addRules' }] }, CWD);
  assert.deepEqual([bash.kind, bash.title, bash.command, bash.detail, bash.decisions], ['command', 'Run rm -rf build', 'rm -rf build', 'Clean', ['allow', 'allow-session', 'deny', 'cancel']]);
  // A command with a blank line in it (a heredoc) is carried whole, apart from the words about it.
  const heredoc = "cat > notes.md <<'EOF'\n# Notes\n\nSecond paragraph.\nEOF\nwc -l notes.md";
  const long = approvalFor('Bash', { command: heredoc, description: 'Write the notes' }, {}, CWD);
  assert.deepEqual([long.command, long.detail], [heredoc, 'Write the notes']);
  assert.equal(approvalFor('Bash', { command: 'ls' }, {}, CWD).detail, undefined);
  // No "don't ask again" when Claude Code says the rule would grant too much.
  assert.deepEqual(approvalFor('Bash', { command: 'x' }, { suggestions: [{ type: 'addRules' }], suppressAlwaysAllowRule: true }, CWD).decisions, ['allow', 'deny', 'cancel']);
  const edit = approvalFor('Edit', { file_path: `${CWD}/a.ts` }, { blockedPath: '/etc' }, CWD);
  assert.deepEqual([edit.kind, edit.title, edit.files, edit.detail], ['file-change', 'Edit a.ts', [`${CWD}/a.ts`], 'It touches /etc.']);
  assert.deepEqual([approvalFor('ExitPlanMode', { plan: '1. Do it' }, {}, CWD).title, approvalFor('WebFetch', { url: 'https://x' }, { displayName: 'Fetch' }, CWD).title], ['Claude is ready to leave plan mode and start', 'Use Fetch']);
});

test('Claude Code runs on this device’s login, labelled as the Journal’s', () => {
  const env = cleanChildEnv({
    PATH: '/usr/bin', HOME: '/home/me', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
    CLAUDE_CODE_OAUTH_TOKEN: 'inherited', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CONFIG_DIR: '/c',
  });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/me', CLAUDE_CODE_ENTRYPOINT: 'agentic-journal', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' });
  // A token given to the bridge on purpose is the one thing passed on.
  assert.equal(cleanChildEnv({ CLAUDE_BRIDGE_OAUTH_TOKEN: 'mine', CLAUDE_CODE_OAUTH_TOKEN: 'inherited' }).CLAUDE_CODE_OAUTH_TOKEN, 'mine');
  assert.equal(findClaude({ CLAUDE_CLI_PATH: '/opt/claude' }), '/opt/claude');
});

test('a session’s folder from its transcript, when the SDK’s info has none', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
  try {
    const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
    fs.mkdirSync(path.join(dir, 'projects', '-home-me-repo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'projects', '-home-me-repo', `${id}.jsonl`), `${JSON.stringify({ type: 'queue-operation' })}\n${JSON.stringify({ type: 'user', message: { content: 'say "cwd"' }, cwd: '/home/me/repo' })}\n`);
    assert.equal(await transcriptCwd(id, dir), '/home/me/repo');
    assert.equal(await transcriptCwd('11111111-1111-4111-8111-111111111111', dir), null);
    assert.equal(await transcriptCwd('../../etc/passwd', dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('shapes from the real CLI (2.1.302 / 2.1.326): task list, steer, Stop, its own messages, usage, session modes', () => {
  const stopped = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
  const transcript: SdkSessionMessage[] = [
    msg('user', 'u1', { role: 'user', content: 'Make two tasks' }),
    msg('assistant', 'a1', said('m1', [{ type: 'tool_use', id: 'ts', name: 'ToolSearch', input: { query: 'select:TaskCreate' } }])),
    msg('user', 'r0', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ts', content: [{ type: 'tool_reference' } as never] }] }),
    msg('assistant', 'a2', said('m2', [{ type: 'thinking', thinking: 'Two tasks, then run them.', signature: 's' } as never])),
    msg('assistant', 'a3', said('m2', [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: 'Run date', activeForm: 'Running date' } }])),
    msg('assistant', 'a4', said('m2', [{ type: 'tool_use', id: 'c2', name: 'TaskCreate', input: { subject: 'Run uname' } }])),
    msg('user', 'r1', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'Task #1 created successfully: Run date' }] }),
    msg('user', 'r2', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c2', content: 'Task #2 created successfully: Run uname' }] }),
    msg('assistant', 'a5', said('m3', [{ type: 'tool_use', id: 'up', name: 'TaskUpdate', input: { taskId: '1', status: 'in_progress' } }])),
    msg('user', 'r3', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'up', content: 'Updated task #1 status' }] }),
    // He steered: kept as a message taken into the running turn.
    msg('user', 'q1', { role: 'user', content: 'and say hi' }, { isQueuedCommand: true }),
    msg('assistant', 'a6', said('m4', [{ type: 'text', text: 'hi' }])),
    // A second turn, stopped in the middle of a command.
    msg('user', 'u2', { role: 'user', content: 'Sleep' }),
    msg('assistant', 'a7', said('m5', [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'sleep 60' } }])),
    msg('user', 'r4', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: stopped, is_error: true }] }),
    msg('user', 'i1', { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }),
  ];
  // Written when the next message came, long after: not shown, and not the end of the stopped turn.
  transcript.push({ ...msg('assistant', 'syn', said('m6', [{ type: 'text', text: 'No response requested.' }], '<synthetic>')), timestamp: new Date(clock + 3_600_000).toISOString() });
  transcript.push(msg('user', 'u3', { role: 'user', content: 'Done with 2' }));
  transcript.push(msg('assistant', 'a8', said('m7', [{ type: 'tool_use', id: 'up2', name: 'TaskUpdate', input: { taskId: '2', status: 'completed' } }])));
  const [one, two, three] = historyTurns(transcript, CWD);
  assert.deepEqual(one!.items.map((i) => `${i.kind}:${i.id}`), ['user:u1', 'reasoning:m2:0', 'plan:tasks:u1', 'user:q1', 'agent:m4:0']);
  assert.deepEqual((one!.items[2] as { steps: unknown }).steps, [{ text: 'Running date', status: 'running' }, { text: 'Run uname', status: 'pending' }]);
  assert.deepEqual([two!.status, two!.items.map((i) => `${i.kind}:${(i as { status?: string }).status ?? ''}`)], ['interrupted', ['user:', 'command:failed']]);
  assert.ok(two!.endedAt! - two!.startedAt! < 10_000);
  // The list lives across turns: a later turn finds task 2 by its number.
  assert.deepEqual((three!.items[1] as { steps: unknown }).steps, [{ text: 'Running date', status: 'running' }, { text: 'Run uname', status: 'done' }]);

  // Live: thinking without its text (the default through the SDK) is no item; a summary is, begun with its words.
  const events: EventBody[] = [];
  const b = new TurnBuilder('t1', CWD, 1, (e) => events.push(e));
  b.stream({ type: 'message_start', message: { id: 'mx' } }, 1);
  b.stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, 1);
  b.stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }, 1);
  b.stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'ts2', name: 'ToolSearch', input: {} } }, 2);
  b.assistant({ message: said('mx', [{ type: 'thinking', thinking: '' }]) }, 2);
  b.assistant({ message: said('mx', [{ type: 'tool_use', id: 'ts2', name: 'ToolSearch', input: { query: 'x' } }]) }, 2);
  assert.deepEqual(events, []);
  // A tool cut short while the turn is being stopped reads failed; the same words otherwise are a refusal.
  b.assistant({ message: said('my', [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'sleep 9' } }]) }, 3);
  b.stopping = true;
  b.toolResults([{ type: 'tool_result', tool_use_id: 'b2', content: stopped, is_error: true }], 'Error: stopped', 4);
  assert.equal((b.turn.items.at(-1) as { status: string }).status, 'failed');

  // Usage: per window in unifiedWindows (2.1.326 adds each window's status).
  const real = { status: 'allowed' as const, resetsAt: 1795244400, rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.21, resetsAt: 1795244400, status: 'allowed' }, five_hour: { utilization: 1, resetsAt: 1794950000, status: 'rejected' } } };
  assert.equal(limitWindow(real), null);
  assert.deepEqual(limitSummary(limitWindows(real)), { windows: [{ label: 'week', usedPercent: 21, resetsAt: 1795244400000 }, { label: '5 hours', usedPercent: 100, resetsAt: 1794950000000 }], blocked: true });

  // "Allow for this session" on an edit is a mode; rules and folders as before; full access never comes this way.
  assert.deepEqual(sessionRuleOptions([
    { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'session' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
  ]), { allowedTools: ['Bash(npm test)'], permissionMode: 'acceptEdits' });

  // Claude Code's descriptions repeat what the approval says already.
  assert.equal(approvalFor('Write', { file_path: `${CWD}/x.txt` }, { description: 'x.txt' }, CWD).detail, undefined);
  assert.equal(approvalFor('Bash', { command: 'ls', description: 'List' }, { description: 'List' }, CWD).detail, 'List');
});
