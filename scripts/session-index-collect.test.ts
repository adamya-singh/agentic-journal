// The session index's collector: digests from real-shaped Claude Code, Codex and OpenClaw transcripts, read from this
// machine's disk and from another device through a stand-in ssh, incrementally, and read-only on the device.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { appRecordOf, collectHost, localSource, parseListing, sshSource } from '../src/lib/session-index/collect.ts';
import { deviceCodex, noteDeviceCodex } from '../src/lib/session-index/devices.ts';
import { toRow } from '../src/lib/session-index/view.ts';
import { feedClaudeLine, feedCodexLine, finishDigest, KEEP_MSGS, mergeAccs, newAcc } from '../src/lib/session-index/digest.ts';
import { ingest } from '../src/lib/session-index/ingest.ts';
import { journalTitle, openclawDigests } from '../src/lib/session-index/openclaw.ts';
import { closeIndex, openIndex } from '../src/lib/session-index/store.ts';
import { parseTarget, sessionsFor } from '../src/lib/session-index/view.ts';
import type { SessionDigest } from '../src/lib/session-index/types.ts';

const TASK = '16dec41f-2a34-4d36-9ab4-47c902bbc1fd';
const OTHER = '11111111-1111-4111-8111-111111111111';
const CARD = 'ac_1a2b3c4d';
const STRANGER = '99999999-9999-4999-8999-999999999999';   // a uuid the Journal does not know (a message id)
const KNOWN = new Set([TASK, OTHER, CARD]);

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const write = (file: string, text: string | Buffer, mode = 0o644) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { mode }); };
const jl = (lines: unknown[]) => `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;

// ---- Real-shaped lines.

const claudeUser = (sid: string, text: string | unknown[], ts: string, extra: Record<string, unknown> = {}) => ({
  parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: text }, uuid: `u-${ts}`, timestamp: ts,
  origin: { kind: 'human' }, userType: 'external', entrypoint: 'cli', cwd: '/home/me/projects/robot', sessionId: sid, version: '2.1.302', gitBranch: 'main', ...extra,
});
const claudeAgent = (sid: string, msgId: string, block: unknown, ts: string, extra: Record<string, unknown> = {}) => ({
  parentUuid: null, isSidechain: false, type: 'assistant', message: { id: msgId, role: 'assistant', model: 'claude-opus-5-5', content: [block] },
  uuid: `a-${ts}`, timestamp: ts, cwd: '/home/me/projects/robot', sessionId: sid, gitBranch: 'main', ...extra,
});

function claudeTranscript(sid: string): unknown[] {
  return [
    { type: 'custom-title', customTitle: 'Gripper camera mount', sessionId: sid },
    { type: 'api-request-blob', sessionId: sid, hash: 'x', message: { role: 'user', content: `secret prompt ${TASK}` } },
    claudeUser(sid, `[aj:task:${TASK}] Fix the camera mount for task ${OTHER} (not ${STRANGER})`, '2026-11-10T10:00:00.000Z'),
    claudeAgent(sid, 'msg_1', { type: 'thinking', thinking: '', signature: 'sig' }, '2026-11-10T10:00:01.000Z'),
    claudeAgent(sid, 'msg_1', { type: 'text', text: 'Looking at the mount.' }, '2026-11-10T10:00:02.000Z'),
    claudeAgent(sid, 'msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/home/me/projects/robot/mount.py', old_string: 'a', new_string: 'b' } }, '2026-11-10T10:00:03.000Z'),
    claudeUser(sid, [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `edited; card ${CARD} mentioned in a file` }], '2026-11-10T10:00:04.000Z'),
    claudeAgent(sid, 'msg_2', { type: 'text', text: 'Done: the mount is fixed.' }, '2026-11-10T10:00:05.000Z'),
    claudeUser(sid, '<local-command-stdout>ok</local-command-stdout>', '2026-11-10T10:00:06.000Z'),
    claudeUser(sid, 'a reminder', '2026-11-10T10:00:07.000Z', { isMeta: true }),
    claudeUser(sid, 'sub-agent work', '2026-11-10T10:00:08.000Z', { isSidechain: true }),
    claudeAgent(sid, 'msg_3', { type: 'text', text: 'No response requested.' }, '2026-11-10T10:00:09.000Z', { message: { id: 'msg_3', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } }),
  ];
}

const codexMeta = (id: string, ts: string) => ({ timestamp: ts, type: 'session_meta', payload: { id, timestamp: ts, cwd: '/home/me/projects/site', originator: 'Codex Desktop', source: 'vscode', git: { branch: 'dev' } } });
const codexMsg = (role: 'user' | 'assistant', text: string, ts: string) => ({ timestamp: ts, type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });

function codexRollout(id: string, part: number): unknown[] {
  const ts = (s: number) => `2026-11-1${part}T09:00:${String(s).padStart(2, '0')}.000Z`;
  return [
    codexMeta(id, ts(0)),
    codexMsg('user', '<environment_context>\n  <cwd>/home/me/projects/site</cwd>\n</environment_context>', ts(1)),
    codexMsg('user', '# AGENTS.md instructions for /home/me/projects/site\n\nbe brief', ts(2)),
    codexMsg('user', part === 1 ? `Make the footer work for ${CARD}` : 'and the header too', ts(3)),
    { timestamp: ts(4), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/footer.tsx\n@@\n-a\n+b\n*** End Patch' } },
    codexMsg('assistant', part === 1 ? 'The footer works.' : 'The header works.', ts(5)),
    { timestamp: ts(6), type: 'event_msg', payload: { type: 'token_count' } },
  ];
}

test('a Claude Code transcript: his messages, the replies, files, ids it names, the title; not sidechains or Claude’s own notes', () => {
  const acc = newAcc('claude-code');
  for (const line of claudeTranscript('c1')) feedClaudeLine(acc, JSON.stringify(line), KNOWN);
  const d = finishDigest(acc, { host: 'laptop', path: '/x/c1.jsonl', projectOf: (cwd) => (cwd.endsWith('/robot') ? 'robot-arm' : null) });
  assert.equal(d.id, 'c1');
  assert.equal(d.title, 'Gripper camera mount');
  assert.equal(d.turns, 1);
  assert.deepEqual(d.msgs, [
    ['user', `[aj:task:${TASK}] Fix the camera mount for task ${OTHER} (not ${STRANGER})`],
    ['agent', 'Looking at the mount.'],
    ['agent', 'Done: the mount is fixed.'],
  ]);
  // The mark, and the Journal ids it names; not a uuid the Journal does not know, not what a tool's output said.
  assert.deepEqual(d.refs, [`aj:task:${TASK}`, TASK, OTHER]);
  assert.deepEqual(d.files, ['/home/me/projects/robot/mount.py']);
  assert.deepEqual([d.cwd, d.project, d.branch, d.started, d.ended, d.cut], ['/home/me/projects/robot', 'robot-arm', 'main', '2026-11-10T10:00:00.000Z', '2026-11-10T10:00:09.000Z', false]);
});

test('a long session keeps its first and last messages, and says it was cut', () => {
  const acc = newAcc('claude-code', 'long');
  for (let i = 0; i < 30; i++) feedClaudeLine(acc, JSON.stringify(claudeUser('long', `message ${i}`, `2026-11-10T10:00:${String(i).padStart(2, '0')}.000Z`)), KNOWN);
  const d = finishDigest(acc, { host: 'laptop', path: '/x' });
  assert.equal(d.turns, 30);
  assert.equal(d.msgs.length, 2 * KEEP_MSGS);
  assert.equal(d.msgs[0]![1], 'message 0');
  assert.equal(d.msgs.at(-1)![1], 'message 29');
  assert.equal(d.cut, true);
});

test('a Codex thread in two rollout files is one session; what Codex injects is not his', () => {
  const parts = [1, 2].map((part) => {
    const acc = newAcc('codex');
    for (const line of codexRollout('01a1-thread', part)) feedCodexLine(acc, JSON.stringify(line), KNOWN);
    return acc;
  });
  const d = finishDigest(mergeAccs(parts.reverse()), { host: 'wsl', path: '/x/rollout.jsonl.zst' }, { title: 'Footer work' });
  assert.equal(d.id, '01a1-thread');
  assert.equal(d.turns, 2);
  assert.deepEqual(d.msgs.map((m) => m[1]), [`Make the footer work for ${CARD}`, 'The footer works.', 'and the header too', 'The header works.']);
  assert.deepEqual(d.refs, [CARD]);
  assert.deepEqual(d.files, ['src/footer.tsx']);
  assert.deepEqual([d.title, d.branch, d.project, d.started], ['Footer work', 'dev', 'site', '2026-11-11T09:00:00.000Z']);
});

test('OpenClaw: a chat is one session with its title; a cron run only when it names a task; heartbeats never', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-db-'));
  const file = path.join(dir, 'agent.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`create table session_nodes(session_key text primary key, display_name text, label text);
    create table session_windows(session_id text primary key, session_key text, created_at integer);
    create table session_transcript_fts_content(id integer primary key, c0, c1, c2, c3, c4);`);
  const chat = `agent:main:journal-chat-${TASK}-1792200000000`;
  const brief = `agent:main:cron:journal-brief-${TASK}-1792100000000`;
  const job = 'agent:main:cron:5d0c2c8e-0000-4000-8000-000000000000';
  db.prepare('insert into session_nodes values (?,?,?)').run(chat, `journal-chat-${TASK}-1792200000000`, null);
  db.prepare('insert into session_nodes values (?,?,?)').run(job, 'Automation: Canvas to Journal Sync', null);
  db.prepare('insert into session_nodes values (?,?,?)').run('agent:main:dashboard:abc', 'Plan the week', null);
  const windows: [string, string, number][] = [['w-chat-1', chat, 1], ['w-chat-2', chat, 2], ['w-brief', brief, 3], ['w-run-1', job, 4], ['w-run-2', job, 5], ['w-dash', 'agent:main:dashboard:abc', 6], ['w-hb', 'agent:main:dashboard:abc:heartbeat', 7]];
  for (const w of windows) db.prepare('insert into session_windows values (?,?,?)').run(...w);
  const say = (sid: string, role: string, text: string, ts: number) => db.prepare('insert into session_transcript_fts_content(c0, c1, c3, c4) values (?,?,?,?)').run(text, sid, role, ts);
  say('w-chat-1', 'user', 'Conversation info: ⟦openclaw:ctx⟧\n```json\n{"message_id": "1"}\n```\n\nwhat is due?', 1_792_200_000_000);
  say('w-chat-1', 'assistant', 'Thursday.', 1_792_200_001_000);
  say('w-chat-2', 'user', 'and after that?', 1_792_200_002_000);
  say('w-brief', 'user', 'Agentic Journal is asking you to fill in the brief…', 1_792_100_000_000);
  say('w-run-1', 'user', 'sync canvas', 1_792_000_000_000);
  say('w-run-1', 'assistant', `updated task ${TASK}`, 1_792_000_001_000);
  say('w-run-2', 'user', 'sync canvas', 1_792_000_100_000);
  say('w-run-2', 'assistant', 'nothing new', 1_792_000_101_000);
  say('w-dash', 'user', 'plan my week', 1_792_000_200_000);
  say('w-hb', 'user', `heartbeat ${TASK}`, 1_792_000_300_000);
  db.close();
  const digests = openclawDigests({ known: KNOWN, host: 'laptop', dbPath: file, names: new Map([[TASK, 'Fix the camera mount']]) });
  const by = Object.fromEntries(digests.map((d) => [d.key, d]));
  assert.deepEqual(Object.keys(by).sort(), ['agent:main:dashboard:abc', brief, job, chat].sort());
  assert.equal(by[chat]!.id, 'w-chat-1');
  assert.equal(by[chat]!.title, 'Chat about “Fix the camera mount”');
  assert.deepEqual(by[chat]!.msgs, [['user', 'what is due?'], ['agent', 'Thursday.'], ['user', 'and after that?']]);
  assert.equal(by[chat]!.turns, 2);
  assert.equal(by[brief]!.title, 'Filled in the brief for “Fix the camera mount”');
  assert.equal(by[job]!.id, 'w-run-1');
  assert.deepEqual(by[job]!.refs, [TASK]);
  assert.equal(by[job]!.title, 'Automation: Canvas to Journal Sync');
  assert.equal(by['agent:main:dashboard:abc']!.title, 'Plan the week');
  assert.equal(journalTitle('agent:main:journal-chat-card-ac-1a2b3c4d-17', undefined), 'Chat about an action card');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- Collecting a device.

let dir: string;
const saved = { ...process.env };
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'si-collect-')));
  process.env.BACKEND_DATA_DIR = path.join(dir, 'data');
  process.env.PROJ_REGISTRY_DIR = path.join(dir, 'proj');
  process.env.PROJ_HOST = 'laptop';
  process.env.CODE_AGENTS_SSH_CONTROL = 'none';
  delete process.env.CODEX_HOME;
  write(path.join(dir, 'proj', 'registry.json'), JSON.stringify({ hosts: { laptop: { alias: 'ubuntu-laptop' }, wsl: { alias: 'win11' } } }));
  write(path.join(dir, 'proj', 'hosts', 'wsl.json'), JSON.stringify({ projects: { 'robot-arm': { path: '/home/me/projects/robot' } } }));
  write(path.join(dir, 'data', 'tasks', 'have-to-do.json'), JSON.stringify({ tasks: [{ id: TASK, text: 'Fix the camera mount' }, { id: OTHER, text: 'Other' }] }));
});
afterEach(() => {
  closeIndex();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A device's home with one Claude Code transcript, a Codex thread in two files (one compressed) and its name. */
function device(home: string) {
  write(path.join(home, '.claude', 'projects', '-home-me-projects-robot', 'c1.jsonl'), jl(claudeTranscript('c1')));
  // A sub-agent's transcript is not a session of its own.
  write(path.join(home, '.claude', 'projects', '-home-me-projects-robot', 'c1', 'subagents', 'agent-1.jsonl'), jl([claudeUser('c1', 'sub', '2026-11-10T11:00:00.000Z')]));
  write(path.join(home, '.codex', 'sessions', '2026', '11', '11', 'rollout-2026-11-11T09-00-00-01a1-thread.jsonl.zst'), zlib.zstdCompressSync(Buffer.from(jl(codexRollout('01a1-thread', 1)))));
  write(path.join(home, '.codex', 'sessions', '2026', '11', '12', 'rollout-2026-11-12T09-00-00-01a1-thread_seg.jsonl'), jl(codexRollout('01a1-thread', 2)));
  write(path.join(home, '.codex', 'session_index.jsonl'), jl([{ id: '01a1-thread', thread_name: 'old name' }, { id: '01a1-thread', thread_name: 'Footer and header' }]));
}

const inbox = (host: string) => fs.readdirSync(path.join(dir, 'data', 'session-index', 'inbox', host)).sort();
const digestOf = (host: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, 'data', 'session-index', 'inbox', host, name), 'utf8')) as SessionDigest;

/** Every file under a folder with its size and time: what must not change on a device. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.lstatSync(p); if (s.isDirectory()) walk(p); else out.push(`${p} ${s.size} ${s.mtimeMs}`); } };
  walk(root);
  return out.sort();
}

test('this machine: its transcripts become digests in its inbox, read again only when they change, and read on from where they were', async () => {
  const home = path.join(dir, 'home');
  device(home);
  process.env.HOME = home;
  const run = () => collectHost(localSource('laptop'), { deadline: Date.now() + 60_000, known: KNOWN });
  const first = await run();
  assert.deepEqual([first.reachable, first.files, first.read, first.sessions], [true, 4, 4, 2]);
  assert.deepEqual(inbox('laptop'), ['apps-laptop.json', 'claude-code-c1.json', 'codex-01a1-thread.json']);
  const codex = digestOf('laptop', 'codex-01a1-thread.json');
  assert.deepEqual([codex.title, codex.turns, codex.host], ['Footer and header', 2, 'laptop']);

  assert.equal((await run()).read, 0);

  // The transcript grows: only what was added is read, and it joins what was there.
  const file = path.join(home, '.claude', 'projects', '-home-me-projects-robot', 'c1.jsonl');
  fs.appendFileSync(file, jl([claudeUser('c1', `one more thing for ${OTHER}`, '2026-11-10T12:00:00.000Z')]));
  const grown = await run();
  assert.equal(grown.read, 1);
  const c1 = digestOf('laptop', 'claude-code-c1.json');
  assert.equal(c1.turns, 2);
  assert.equal(c1.msgs.at(-1)![1], `one more thing for ${OTHER}`);
  assert.equal(c1.ended, '2026-11-10T12:00:00.000Z');

  // Rewritten (not grown): read whole again.
  fs.writeFileSync(file, jl(claudeTranscript('c1').slice(0, 3)));
  await run();
  assert.equal(digestOf('laptop', 'claude-code-c1.json').turns, 1);

  // Gone from the disk: gone from the inbox, and from the index.
  ingest();
  assert.equal((openIndex().prepare('select count(*) as n from sessions').get() as { n: number }).n, 2);
  fs.rmSync(file);
  assert.equal((await run()).removed, 1);
  assert.deepEqual(ingest().removed, 1);
  assert.deepEqual((openIndex().prepare('select uid from sessions').all() as { uid: string }[]).map((r) => r.uid), ['codex:01a1-thread']);
});

test('a secret typed into a session is kept neither in its digest nor in what the collector saves between runs', async () => {
  const home = path.join(dir, 'home');
  const key = 'sk-' + 'ant-' + 'api03-' + 'Q'.repeat(30);
  write(path.join(home, '.claude', 'projects', '-home-me', 's1.jsonl'), jl([claudeUser('s1', `use this key ${key} for ${TASK}`, '2026-11-10T10:00:00.000Z')]));
  process.env.HOME = home;
  await collectHost(localSource('laptop'), { deadline: Date.now() + 60_000, known: KNOWN });
  const d = digestOf('laptop', 'claude-code-s1.json');
  assert.deepEqual([d.msgs[0]![1], d.redactions, d.refs], [`use this key [api key] for ${TASK}`, 1, [TASK]]);
  const saved = fs.readdirSync(path.join(dir, 'data', 'session-index'), { recursive: true }).map(String)
    .filter((f) => fs.statSync(path.join(dir, 'data', 'session-index', f)).isFile())
    .map((f) => fs.readFileSync(path.join(dir, 'data', 'session-index', f), 'utf8'));
  assert.ok(saved.length >= 3);
  assert.ok(saved.every((text) => !text.includes(key)));
});

test('another device over ssh: read-only, through a chatty login shell, and a device that cannot be reached keeps what it sent', async () => {
  const home = path.join(dir, 'pc');
  device(home);
  write(path.join(home, '.profile'), 'echo "Welcome to the PC."\n');
  const log = path.join(dir, 'ssh.log');
  write(path.join(dir, 'ssh'), `#!/bin/sh
printf '%s\\n' "$*" >> ${sh(log)}
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift; alias="$1"; shift
if [ "$alias" = nowhere ]; then echo "ssh: Could not resolve hostname nowhere: Name or service not known" >&2; exit 255; fi
cd / && exec env -i HOME=${sh(home)} PATH=/usr/bin:/bin SHELL=/bin/sh /bin/sh -c "$1"
`, 0o755);
  process.env.CODE_AGENTS_SSH = path.join(dir, 'ssh');
  const before = snapshot(home);
  const result = await collectHost(sshSource('wsl', 'win11'), { deadline: Date.now() + 60_000, known: KNOWN });
  assert.deepEqual([result.reachable, result.read, result.sessions], [true, 4, 2]);
  assert.deepEqual(snapshot(home), before, 'nothing on the device changed');
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /BatchMode=yes/);
  assert.doesNotMatch(calls, /codex app-server|\brm |\bmv |\btouch |\bmkdir |\bcp |\btee /, 'only reading commands ran');
  const c1 = digestOf('wsl', 'claude-code-c1.json');
  // Its folder is one of the device's proj projects.
  assert.deepEqual([c1.host, c1.project, c1.turns, c1.title], ['wsl', 'robot-arm', 1, 'Gripper camera mount']);

  // It grows over there: the read over ssh starts where the last one ended.
  fs.appendFileSync(path.join(home, '.claude', 'projects', '-home-me-projects-robot', 'c1.jsonl'), jl([claudeUser('c1', 'and the wrist', '2026-11-10T12:00:00.000Z')]));
  fs.writeFileSync(log, '');
  assert.equal((await collectHost(sshSource('wsl', 'win11'), { deadline: Date.now() + 60_000, known: KNOWN })).read, 1);
  assert.match(fs.readFileSync(log, 'utf8'), /tail -c \+\d+ -- /);
  assert.equal(digestOf('wsl', 'claude-code-c1.json').turns, 2);

  ingest();
  const view = sessionsFor(parseTarget(`task:${TASK}`)!);
  const row = view.rows.find((r) => r.uid === 'claude-code:c1')!;
  assert.equal(row.why, 'Started from this task');
  assert.equal(row.machine, 'PC');
  assert.equal(row.resume, `ssh -t win11 'exec "$SHELL" -lc "cd /home/me/projects/robot && claude --resume c1"'`);

  // Unreachable: says why, and leaves its digests alone.
  const gone = await collectHost(sshSource('wsl', 'nowhere'), { deadline: Date.now() + 60_000, known: KNOWN });
  assert.equal(gone.reachable, false);
  assert.match(gone.error ?? '', /Could not resolve hostname/);
  assert.ok(inbox('wsl').includes('claude-code-c1.json'));
});

test('a run out of time leaves the rest for the next one, newest first', async () => {
  const home = path.join(dir, 'home');
  device(home);
  process.env.HOME = home;
  const late = await collectHost(localSource('laptop'), { deadline: Date.now() - 1, known: KNOWN });
  assert.deepEqual([late.read, late.pending, late.sessions], [0, 4, 0]);
  const next = await collectHost(localSource('laptop'), { deadline: Date.now() + 60_000, known: KNOWN });
  assert.deepEqual([next.read, next.pending, next.sessions], [4, 0, 2]);
});

test('the listing: macOS stat lines and GNU find lines alike; a cut-off listing is not trusted', () => {
  const out = 'Welcome\nAJ-HOME /Users/me\nAJ-ROOT claude /Users/me/.claude/projects\n123 1731000000 /Users/me/.claude/projects/-Users-me/a b.jsonl\nAJ-ROOT codex /Users/me/.codex\n9 1731000000.5 /Users/me/.codex/sessions/r.jsonl.zst\nAJ-END\n';
  assert.deepEqual(parseListing(out), { home: '/Users/me', entries: [
    { kind: 'claude', size: 123, mtime: 1731000000000, path: '/Users/me/.claude/projects/-Users-me/a b.jsonl' },
    { kind: 'codex', size: 9, mtime: 1731000000500, path: '/Users/me/.codex/sessions/r.jsonl.zst' },
  ] });
  assert.throws(() => parseListing('AJ-HOME /x\n'), /did not finish/);
});

test('the Mac: its ChatGPT app’s Codex goes into its rows’ resume commands, and the Claude app’s ssh records read sshHost', () => {
  const out = 'AJ-HOME /Users/me\nAJ-CODEX /Users/me/.cursor/extensions/openai.chatgpt-1/bin/macos-aarch64/codex\nAJ-END\n';
  assert.deepEqual(parseListing(out), { home: '/Users/me', entries: [], codex: '~/.cursor/extensions/openai.chatgpt-1/bin/macos-aarch64/codex' });
  assert.equal(parseListing('AJ-HOME /Users/me\nAJ-END\n').codex, undefined);
  const app = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  write(path.join(dir, 'proj', 'registry.json'), JSON.stringify({ hosts: { laptop: { alias: 'ubuntu-laptop' }, mac: { alias: 'macbook' } } }));
  assert.equal(deviceCodex('mac'), null);
  noteDeviceCodex('mac', app);
  assert.equal(deviceCodex('mac'), app);
  const record = { uid: 'codex:th-1', app: 'codex', id: 'th-1', host: 'mac', cwd: '/Users/me/projects/notes', title: 'Notes', first: '', project: 'notes', started: null, ended: null, turns: 1 } as unknown as Parameters<typeof toRow>[0];
  assert.equal(toRow(record, 'linked', 'x').resume, `ssh -t macbook 'exec "$SHELL" -lc "cd /Users/me/projects/notes && ${app} resume th-1"'`);
  assert.equal(toRow({ ...record, app: 'claude-code', uid: 'claude-code:th-1' }, 'linked', 'x').resume, `ssh -t macbook 'exec "$SHELL" -lc "cd /Users/me/projects/notes && claude --resume th-1"'`);
  noteDeviceCodex('mac', null);
  assert.equal(deviceCodex('mac'), null);
  assert.equal(toRow(record, 'linked', 'x').resume, `ssh -t macbook 'exec "$SHELL" -lc "cd /Users/me/projects/notes && codex resume th-1"'`);
  // The Claude app writes its SSH sessions' host as sshHost.
  assert.equal(appRecordOf({ cliSessionId: 'c-1', title: 'On the PC', sshConfig: { sshHost: 'win11', sshPort: 22 }, bridgeSessionIds: ['session_01AbC'] })?.ssh, 'win11');
  assert.deepEqual(appRecordOf({ cliSessionId: 'c-1', bridgeSessionIds: ['session_01AbC'] })?.bridge, ['session_01AbC']);
});

test('rows: one OpenClaw row per session key; no resume command for a session in Windows itself; the Journal’s copies do not count by id', () => {
  const host = (h: string, digests: Partial<SessionDigest>[]) => {
    const box = path.join(dir, 'data', 'session-index', 'inbox', h);
    fs.mkdirSync(box, { recursive: true });
    for (const d of digests) fs.writeFileSync(path.join(box, `${d.app}-${d.id}.json`), JSON.stringify({ v: 1, host: h, path: '', key: null, title: '', cwd: '', project: '', branch: '', started: null, turns: 1, files: [], msgs: [['user', 'x']], cut: false, redactions: 0, ...d }));
  };
  const job = 'agent:main:cron:5d0c2c8e-0000-4000-8000-000000000000';
  host('laptop', [
    { app: 'openclaw', id: 'run1', key: job, refs: [TASK], ended: '2026-11-10T10:00:00Z', title: 'Canvas sync' },
    { app: 'openclaw', id: 'run2', key: job, refs: [TASK], ended: '2026-11-11T10:00:00Z', title: 'Canvas sync' },
  ]);
  host('wsl', [
    { app: 'claude-code', id: 'win', refs: [TASK], cwd: 'C:\\Users\\me', project: 'me', ended: '2026-11-09T10:00:00Z', title: 'In Windows' },
    { app: 'claude-code', id: 'exp', refs: [TASK], cwd: '/home/me/projects/handwired-agentic-journal-experimentation', project: 'handwired-agentic-journal-experimentation', title: 'Journal experiment' },
  ]);
  ingest();
  const rows = sessionsFor(parseTarget(`task:${TASK}`)!).rows;
  assert.deepEqual(rows.map((r) => r.uid), ['openclaw:run2', 'claude-code:win']);
  assert.equal(rows[1]!.resume, undefined);
});
