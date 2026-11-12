// Keeps a thread in step with its OpenClaw session: what was said there outside the Journal (in OpenClaw's own
// app) is read from the session's history and merged into the thread (lib/task-chat.ts mergeChatHistory).
// It never holds a page up: a sync is asked for and runs behind the request; the next read of the thread has what
// it found. One history call runs at a time, a thread is not asked again sooner than the caller allows, and a
// thread whose history could not be read is left as it is and asked less often.
import { isOpenClawCliAvailable, parseJsonObjectOutput, runOpenClawCli } from '@/lib/openclaw-cron';
import { mergeChatHistory, readChatHistory, type TaskChatThread } from '@/lib/task-chat';
import { updateChatThreads } from './store';

const HISTORY_LIMIT = 80;
const CALL_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface SyncState {
  asked: Map<string, number>;                 // session key → when its history was last asked for
  failures: Map<string, number>;              // session key → failed calls in a row
  running: Map<string, Promise<boolean>>;     // session key → the call that is out
  line: Promise<unknown>;                     // one call at a time
}
// One server process, but each route bundle may load this module separately.
const shared = globalThis as typeof globalThis & { __briefChatSync?: SyncState };
const state: SyncState = (shared.__briefChatSync ??= { asked: new Map(), failures: new Map(), running: new Map(), line: Promise.resolve() });

/** The session's history could not be read the last time it was asked for (OpenClaw is there, the call failed). */
export function chatSyncFailed(sessionKey: string): boolean {
  return (state.failures.get(sessionKey) ?? 0) > 0;
}

async function readHistory(sessionKey: string) {
  const stdout = await runOpenClawCli(
    ['gateway', 'call', 'chat.history', '--params', JSON.stringify({ sessionKey, limit: HISTORY_LIMIT }), '--timeout', String(CALL_TIMEOUT_MS), '--json'],
    CALL_TIMEOUT_MS + 5000,
  );
  const history = readChatHistory(parseJsonObjectOutput(stdout));
  if (!history) throw new Error('chat.history printed no history');
  return history;
}

/**
 * Brings one thread up to date with its session, unless that was done within `minIntervalMs` (or is being done).
 * Resolves to whether the thread changed. Never rejects: without the CLI, or when the call fails, the thread stays
 * as the store has it.
 */
export function syncChatThread(thread: Pick<TaskChatThread, 'taskId' | 'id' | 'sessionKey'>, minIntervalMs: number): Promise<boolean> {
  const { taskId, id, sessionKey } = thread;
  const out = state.running.get(sessionKey);
  if (out) return out;
  if (!isOpenClawCliAvailable()) return Promise.resolve(false);
  const failures = state.failures.get(sessionKey) ?? 0;
  const wait = failures > 0 ? Math.min(MAX_BACKOFF_MS, Math.max(minIntervalMs, 5000 * 2 ** (failures - 1))) : minIntervalMs;
  if (Date.now() - (state.asked.get(sessionKey) ?? 0) < wait) return Promise.resolve(false);
  state.asked.set(sessionKey, Date.now());
  const run = state.line.then(async () => {
    try {
      const history = await readHistory(sessionKey);
      state.failures.delete(sessionKey);
      // Read, merge and write in one synchronous step, so a reply landing at the same moment is not lost.
      return updateChatThreads((all) => {
        const stored = (all[taskId] ?? []).find((t) => t.id === id);
        return !!stored && stored.sessionKey === sessionKey && mergeChatHistory(stored, history, new Date());
      });
    } catch (error) {
      state.failures.set(sessionKey, failures + 1);
      if (failures === 0) console.warn(`brief chat ${taskId}: could not read the OpenClaw session's history:`, error instanceof Error ? error.message.split('\n')[0] : error);
      return false;
    } finally {
      state.running.delete(sessionKey);
    }
  });
  state.running.set(sessionKey, run);
  state.line = run;
  return run;
}

/** Asks for every one of these threads that has something in it, behind the request, each at most once a minute. */
export function syncChatThreadsSoon(threads: TaskChatThread[], minIntervalMs = 60_000): void {
  for (const thread of threads) if (thread.messages.length > 0) void syncChatThread(thread, minIntervalMs);
}
