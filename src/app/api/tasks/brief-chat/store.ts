// Chats with OpenClaw about tasks, one thread per task, in tasks/brief-chats.json. Only the Next server
// writes this file and every read-modify-write below is synchronous, so writes cannot interleave.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { TaskChatThread } from '@/lib/task-chat';

interface ChatFile {
  _comment: string;
  schemaVersion: 1;
  threads: Record<string, TaskChatThread>;
}

export function briefChatFilePath(): string {
  return path.join(tasksDataDir(), 'brief-chats.json');
}

function read(): ChatFile {
  const empty: ChatFile = {
    _comment: 'Chats with OpenClaw from the Horizon task brief, keyed by task id. Each thread is one OpenClaw session.',
    schemaVersion: 1,
    threads: {},
  };
  const file = briefChatFilePath();
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as ChatFile;
    return { ...empty, threads: data.threads && typeof data.threads === 'object' ? data.threads : {} };
  } catch {
    return empty;
  }
}

export function mutateChatThreads<T>(fn: (threads: Record<string, TaskChatThread>) => T): T {
  const data = read();
  const result = fn(data.threads);
  writeJsonFileAtomic(briefChatFilePath(), data);
  return result;
}

export function readChatThread(taskId: string): TaskChatThread | undefined {
  return read().threads[taskId];
}
