import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tasksDataDir } from './backend-data.ts';
import { stackConfig } from './media/stack-config.ts';
import { jellyCall } from './media/stack-clients.ts';

// A deploy takes the Journal down for 10+ minutes and loads every core, so a queued deploy waits
// until nothing has played and no OpenClaw chat or coding session has moved for this long. The
// agentic-journal-deploy-queue timer looks every 5 minutes.
export const QUIET_MS = 15 * 60_000;
// A coding session's "working" stamp older than this is from a turn nobody is watching any more
// (the same as WORKING_STALE_MS in src/lib/code-agents/hub.ts).
export const CODE_WORKING_STALE_MS = 3 * 60 * 60_000;

export interface Queued {
  firstRequestedAt: string;
  lastRequestedAt: string;
  checkedAt?: string;
  waitingOn?: string[];
}
export interface LastRun {
  startedAt: string;
  finishedAt: string;
  head: string;
  exitCode: number | null;
}
export interface Playing {
  DeviceName?: string;
  Client?: string;
  LastPlaybackCheckIn?: string;
  NowPlayingItem?: { Name?: string };
  PlayState?: { IsPaused?: boolean };
}
export interface Chat {
  key: string;
  kind?: string;
  label?: string;
  updatedAt: number;
}
/** A coding session (Codex, Claude Code) as tasks/code-sessions.json has it; only what the gate reads. */
export interface CodeTurn {
  agent: string;
  title: string;
  workingSince?: string | null;
  settledAt?: string | null;
}

const stateDir = () =>
  process.env.DEPLOY_QUEUE_DIR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'agentic-journal');
const file = (name: string) => path.join(stateDir(), name);
export function read<T>(name: 'queued' | 'last'): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file(`deploy-${name}.json`), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}
export function write(name: 'queued' | 'last', value: Queued | LastRun | undefined) {
  const target = file(`deploy-${name}.json`);
  if (value === undefined) return fs.rmSync(target, { force: true });
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(`${target}.tmp`, target);
}

/** Why a queued deploy must keep waiting at `now`; empty when it may start. */
export function waitReasons(now: Date, playing: Playing[] | Error, chats: Chat[] | Error, code: CodeTurn[] | Error = []): string[] {
  const reasons: string[] = [];
  // /etc/cron.d/ps4-halo-daily-reboot reboots at 05:00. A reboot mid-deploy brings the Journal up
  // with its previous build set aside and the new one unfinished, so nothing is served.
  const minute = now.getHours() * 60 + now.getMinutes();
  if (minute >= 4 * 60 + 15 && minute < 5 * 60 + 15) reasons.push('the 05:00 daily reboot is close');
  if (playing instanceof Error) reasons.push(`cannot tell whether anything is playing (${playing.message})`);
  else
    for (const p of playing)
      if (p.NowPlayingItem && now.getTime() - Date.parse(p.LastPlaybackCheckIn || '') < QUIET_MS)
        reasons.push(
          `${p.DeviceName || p.Client || 'a device'} is ${p.PlayState?.IsPaused ? 'paused on' : 'playing'} ${p.NowPlayingItem.Name || 'something'}`,
        );
  if (chats instanceof Error) reasons.push(`cannot read OpenClaw chats (${chats.message})`);
  else
    for (const c of chats) {
      const ago = now.getTime() - c.updatedAt;
      // Cron runs and the heartbeat are OpenClaw talking to itself; everything else has a person
      // behind it (iOS, dashboard, Telegram, Journal briefs).
      if (c.kind !== 'cron' && !c.key.endsWith(':heartbeat') && ago < QUIET_MS)
        reasons.push(`OpenClaw chat ${c.label || c.key} was active ${Math.round(ago / 60_000)} min ago`);
    }
  // A coding session's turn keeps running in the agent through a deploy, but he would lose the page he follows it on.
  if (code instanceof Error) reasons.push(`cannot read coding sessions (${code.message})`);
  else
    for (const c of code) {
      const name = `${c.agent === 'claude-code' ? 'Claude Code' : c.agent === 'codex' ? 'Codex' : c.agent} session ${c.title}`;
      const since = Date.parse(c.workingSince || '');
      const settled = Date.parse(c.settledAt || '');
      if (now.getTime() - since < CODE_WORKING_STALE_MS) reasons.push(`${name} is working`);
      else if (now.getTime() - settled < QUIET_MS)
        reasons.push(`${name} was active ${Math.round((now.getTime() - settled) / 60_000)} min ago`);
    }
  return reasons;
}

export async function playing(): Promise<Playing[] | Error> {
  try {
    const c = stackConfig();
    if (!c.enabled || !c.jellyfin.adminKey) return [];
    const route = `Sessions?activeWithinSeconds=${QUIET_MS / 1000}`;
    return await jellyCall<Playing[]>(c, route, undefined, 'GET', true);
  } catch (e) {
    // Jellyfin not running means nothing can be playing.
    return (e as Error).message === 'Media service is unreachable.' ? [] : (e as Error);
  }
}

export async function chats(): Promise<Chat[] | Error> {
  try {
    const { stdout } = await promisify(execFile)(
      process.env.OPENCLAW_CLI_PATH || 'openclaw',
      ['sessions', '--active', String(QUIET_MS / 60_000), '--all-agents', '--json'],
      { timeout: 120_000, maxBuffer: 32 << 20 },
    );
    return JSON.parse(stdout).sessions;
  } catch (e) {
    return e as Error;
  }
}

/** Every coding session link (tasks/code-sessions.json, written by src/lib/code-agents/store.ts). */
export function codeTurns(): CodeTurn[] | Error {
  try {
    const file = JSON.parse(fs.readFileSync(path.join(tasksDataDir(), 'code-sessions.json'), 'utf8'));
    const out: CodeTurn[] = [];
    for (const list of Object.values(file?.sessions ?? {}))
      for (const l of Array.isArray(list) ? list : [])
        if (l && !l.archived) out.push({ agent: String(l.agent), title: String(l.title || l.sessionId), workingSince: l.workingSince, settledAt: l.settledAt });
    return out;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? [] : (e as Error);
  }
}
