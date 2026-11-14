// Runs the task worker's batched sort (src/lib/task-sort.ts): 30 tasks to one OpenClaw turn with no tools, one turn
// at a time, at most one per 10 minutes and 12 a day, never 23:00–08:00, and only while the sweep is on. Called from
// the five-minute interval (src/instrumentation.ts) and when Adamya turns the sweep on. The turn reads nothing and
// changes nothing, so it does not wait for OpenClaw's browser; its session key is cron-prefixed so the deploy queue
// does not count it as a chat. TASK_SORT_DISABLED=1 turns it off, as do TASK_WORKER_DISABLED and
// TASK_WORKER_SWEEP_DISABLED. Without the OpenClaw CLI it does nothing.
import { extractJsonObject } from '@/lib/done-at';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { readShortTermCompass } from '@/lib/compass/read';
import {
  applySortOutcome,
  buildSortBatch,
  buildSortPrompt,
  countSortRun,
  decideSortBatch,
  sortCandidates,
  sortDomain,
  validateSortReply,
  SORT_TURN_TIMEOUT_MS,
  type SortDecision,
} from '@/lib/task-sort';
import { openTasks, sweepDisabled, taskWorkDisabled } from './actions';
import { mutateTaskWork, readTaskWorkFile } from './store';

export const taskSortDisabled = () => process.env.TASK_SORT_DISABLED === '1' || taskWorkDisabled() || sweepDisabled();

export interface SortDeps {
  available: () => boolean;
  turn: (input: { message: string; sessionKey: string; timeoutMs: number }) => Promise<string>;
  forAgents: () => string;
}

const cliDeps: SortDeps = {
  available: isOpenClawCliAvailable,
  turn: (input) => runOpenClawAgentTurn(input),
  forAgents: () => {
    try {
      return readShortTermCompass().forAgents;
    } catch {
      return '';
    }
  },
};

const STATE = Symbol.for('agentic-journal.task-sort');
function state(): { running: boolean } {
  const g = globalThis as { [STATE]?: { running: boolean } };
  return (g[STATE] ??= { running: false });
}

export interface SortRunResult {
  decision: SortDecision | 'no-cli' | 'sorted' | 'failed';
  sent?: number;
  sorted?: number;
  failed?: number;
  rested?: number;
  problems?: string[];
}

export const sortSessionKey = (now: Date) => `agent:main:cron:journal-sort-${now.getTime()}`;

/** Sends one sort batch when one is due. Never throws; safe to call on every tick. */
export async function runTaskSortIfDue(now = new Date(), deps: SortDeps = cliDeps): Promise<SortRunResult> {
  const s = state();
  let mine = false;
  try {
    if (taskSortDisabled()) return { decision: 'disabled' };
    if (!deps.available()) return { decision: 'no-cli' };
    const data = readTaskWorkFile();
    // The cheap reasons first: the task lists are read only when a batch could go.
    const early = decideSortBatch({ now, disabled: false, sweepEnabled: data.meta.sweepEnabled, running: s.running, runs: data.meta.sortRuns, candidates: 1 });
    if (early !== 'run') return { decision: early };
    const { refs, byId } = openTasks();
    const candidates = sortCandidates(data.records, refs, data.sort, now);
    const decision = decideSortBatch({
      now, disabled: false, sweepEnabled: data.meta.sweepEnabled, running: s.running, runs: data.meta.sortRuns, candidates: candidates.length,
    });
    if (decision !== 'run') return { decision };

    s.running = mine = true;
    // Counted when it starts, so a turn that dies with the server still paces the next one.
    mutateTaskWork((d) => { d.meta.sortRuns = countSortRun(d.meta.sortRuns, now); });
    const batch = buildSortBatch(candidates.map((ref) => {
      const { task } = byId.get(ref.taskId)!;
      return { taskId: task.id, text: task.text, dueDate: task.dueDate, projects: task.projects, notesMarkdown: task.notesMarkdown, fingerprint: ref.fingerprint };
    }));
    const message = buildSortPrompt(batch, { now, forAgents: deps.forAgents() });

    let raw: unknown = null;
    let turnError: string | null = null;
    try {
      raw = extractJsonObject(await deps.turn({ message, sessionKey: sortSessionKey(now), timeoutMs: SORT_TURN_TIMEOUT_MS }));
    } catch (error) {
      turnError = error instanceof Error ? error.message : String(error);
      console.error('Task sort: OpenClaw turn failed:', turnError);
    }
    const check = validateSortReply(raw, batch.aliases);
    if (!turnError && check.problems.length) console.warn('Task sort: reply problems:', check.problems.slice(0, 10).join('; '));

    // The tasks as they are now: one handed over or edited while the turn ran is left for the next batch.
    const after = openTasks().refs;
    const outcome = mutateTaskWork((d) => {
      const domain = new Map(sortDomain(d.records, after).map((r) => [r.taskId, r.fingerprint]));
      return applySortOutcome(d, batch.tasks, check, (id) => domain.get(id) ?? null, now);
    });
    return {
      decision: turnError ? 'failed' : 'sorted', sent: batch.tasks.length, ...outcome,
      problems: turnError ? [turnError] : check.problems,
    };
  } catch (error) {
    console.error('Task sort failed:', error);
    return { decision: 'failed', problems: [error instanceof Error ? error.message : String(error)] };
  } finally {
    if (mine) s.running = false;
  }
}
