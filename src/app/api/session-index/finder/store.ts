// The "Ask OpenClaw" chats of the "+ Link a session" panels, one per task, in session-index/finder.json (owner only,
// like the rest of the index). Only the Next server writes it, and every read-modify-write here is synchronous, so
// writes cannot interleave. Not tasks/brief-chats.json: these are not chats about the task, and nothing that lists a
// task's chats, its sky bubbles or what waits on him reads this file.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonFileAtomic } from '@/lib/backend-data';
import { sessionIndexDir } from '@/lib/session-index/store';
import { readFinderFile, settleFinder, type FinderChat } from '@/lib/session-finder';

type Chats = Record<string, FinderChat>;

const COMMENT = 'Chats with OpenClaw from a task’s “+ Link a session” panel, looking for a session to link; one per task, each one OpenClaw session.';
const SERVER_STARTED_AT = Date.now() - process.uptime() * 1000;

export const finderFilePath = () => path.join(sessionIndexDir(), 'finder.json');

function read(): Chats {
  try {
    return readFinderFile(JSON.parse(fs.readFileSync(finderFilePath(), 'utf8')));
  } catch {
    return {};
  }
}

function write(chats: Chats): void {
  const file = finderFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeJsonFileAtomic(file, { _comment: COMMENT, v: 1, chats });
  try { fs.chmodSync(file, 0o600); } catch { /* not ours to change */ }
}

export function mutateFinderChats<T>(fn: (chats: Chats) => T): T {
  const chats = read();
  const out = fn(chats);
  write(chats);
  return out;
}

/** One task's chat, with a turn that can no longer come back given up on first. */
export function readFinderChat(taskId: string, now = new Date()): FinderChat | null {
  const chat = read()[taskId] ?? null;
  if (chat && settleFinder({ ...chat }, now, SERVER_STARTED_AT)) {
    return mutateFinderChats((chats) => {
      const c = chats[taskId];
      if (c) settleFinder(c, now, SERVER_STARTED_AT);
      return c ?? null;
    });
  }
  return chat;
}
