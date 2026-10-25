// Reads quick adds with OpenClaw, one at a time, inside the Next server (like
// the Horizon brief worker). Each entry is one agent turn in a fresh session;
// the reply is checked against IMDb before anything shows up for you to confirm.
// If OpenClaw can't be reached, IMDb's own matches for your words stand in.
import { extractJsonObject } from '@/lib/done-at';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { readState } from './store.ts';
import {
  fallback,
  parseReply,
  readInbox,
  readPrompt,
  verify,
  withInbox,
  RUNNING_TIMEOUT_MS,
  type Addition,
  type Entry,
} from './inbox.ts';

const STATE = Symbol.for('agentic-journal.media-inbox-worker');
type WorkerState = { running: boolean };
function state(): WorkerState {
  const g = globalThis as { [STATE]?: WorkerState };
  g[STATE] ??= { running: false };
  return g[STATE];
}
export const inboxWorkerDisabled = () => process.env.MEDIA_INBOX_AGENT_DISABLED === '1';

// Cheap when there is nothing to do; called on every add and every inbox load.
export function kickInbox() {
  if (inboxWorkerDisabled()) return;
  const now = Date.now();
  const stale = (e: Entry) =>
    e.status === 'reading' && now - Date.parse(e.startedAt || e.createdAt) > RUNNING_TIMEOUT_MS;
  const inbox = readInbox();
  if (!inbox.entries.some((e) => e.status === 'queued' || stale(e))) return;
  void run();
}

async function run() {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    for (;;) {
      const now = Date.now();
      // An entry that was reading when the server restarted never finishes; read it again.
      const entry = await withInbox((inbox) => {
        for (const e of inbox.entries)
          if (e.status === 'reading' && now - Date.parse(e.startedAt || e.createdAt) > RUNNING_TIMEOUT_MS)
            e.status = 'queued';
        const next = inbox.entries.find((e) => e.status === 'queued');
        if (next) Object.assign(next, { status: 'reading', startedAt: new Date().toISOString() });
        return next ? { ...next } : undefined;
      });
      if (!entry) return;
      await readOne(entry);
    }
  } catch (error) {
    console.error('Media quick add worker:', error);
  } finally {
    s.running = false;
  }
}

async function readOne(entry: Entry) {
  let additions: Addition[] = [];
  let usedFallback = false;
  let error: string | undefined;
  try {
    if (!isOpenClawCliAvailable()) throw new Error('OpenClaw is not available here.');
    const library = Object.values(readState().titles)
      .filter((t) => t.source !== 'youtube' && t.collections.length)
      .slice(-40)
      .map((t) => `${t.title}${t.year ? ` (${t.year})` : ''}`);
    const reply = await runOpenClawAgentTurn({
      message: readPrompt(entry.text, library),
      sessionKey: `agent:main:journal-media-add-${entry.id}`,
      timeoutMs: 6 * 60_000,
    });
    const reading = parseReply(extractJsonObject(reply));
    if (!reading) {
      console.warn(`media quick add ${entry.id}: unusable reply:`, reply.slice(0, 500));
      throw new Error('OpenClaw’s answer couldn’t be read.');
    }
    additions = await verify(reading);
  } catch (e) {
    console.error(`media quick add ${entry.id}:`, String((e as Error)?.message).split('\n')[0]);
    additions = await fallback(entry.text);
    usedFallback = true;
    if (!additions.length) error = 'OpenClaw couldn’t read this and IMDb found nothing for it.';
  }
  await withInbox((inbox) => {
    const e = inbox.entries.find((x) => x.id === entry.id);
    if (!e || e.status !== 'reading') return; // dismissed meanwhile
    Object.assign(e, {
      status: error ? 'failed' : 'ready',
      finishedAt: new Date().toISOString(),
      error,
      fallback: usedFallback && !error ? true : undefined,
      additions: [...e.additions, ...additions],
    });
  });
}
