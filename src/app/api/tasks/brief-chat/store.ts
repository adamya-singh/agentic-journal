// Chats with OpenClaw about tasks, several threads per task, in tasks/brief-chats.json. Only the Next server
// writes this file and every read-modify-write below is synchronous, so writes cannot interleave.
// Version 1 of the file held one thread per task; it is read as version 2 (lib/task-chat.ts migrateChatThreads)
// and written back that way on the next change, after a copy of the old file is set aside.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { CHAT_SCHEMA_VERSION, migrateChatThreads, type TaskChatThread } from '@/lib/task-chat';

type Threads = Record<string, TaskChatThread[]>;

const COMMENT = 'Chats with OpenClaw from a task’s workspace, keyed by task id; each task has a list of threads and each thread is one OpenClaw session.';

export function briefChatFilePath(): string {
  return path.join(tasksDataDir(), 'brief-chats.json');
}

function read(): { threads: Threads; migrated: boolean; unreadable: boolean } {
  const file = briefChatFilePath();
  if (!fs.existsSync(file)) return { threads: {}, migrated: false, unreadable: false };
  try {
    return { ...migrateChatThreads(JSON.parse(fs.readFileSync(file, 'utf-8'))), unreadable: false };
  } catch {
    return { threads: {}, migrated: false, unreadable: true };
  }
}

/** Sets the file as it stands aside before it is first rewritten in a new shape, so nothing he said can be lost. */
function keepCopy(suffix: string): void {
  const file = briefChatFilePath();
  const copy = path.join(path.dirname(file), `brief-chats.${suffix}.json`);
  try { if (fs.existsSync(file) && !fs.existsSync(copy)) fs.copyFileSync(file, copy); } catch { /* the write below still goes ahead */ }
}

export function mutateChatThreads<T>(fn: (threads: Threads) => T): T {
  const data = read();
  if (data.migrated) keepCopy('v1');
  if (data.unreadable) keepCopy(`unreadable-${Date.now()}`);
  const result = fn(data.threads);
  writeJsonFileAtomic(briefChatFilePath(), { _comment: COMMENT, schemaVersion: CHAT_SCHEMA_VERSION, threads: data.threads });
  return result;
}

/** Every task's threads, for reading only. */
export function readAllChatThreads(): Threads {
  return read().threads;
}

export function readChatThreads(taskId: string): TaskChatThread[] {
  return read().threads[taskId] ?? [];
}
