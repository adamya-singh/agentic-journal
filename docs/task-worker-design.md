# Task worker: OpenClaw works on tasks without being asked

Proposal of 2026-11-13. Nothing here is built.

## What it is for

Today OpenClaw touches a task only when Adamya opens a chat on it. Three things follow from that:

- A task OpenClaw could start (look something up, draft the email, find the form) waits until Adamya thinks to ask.
- After OpenClaw sends something, nobody looks for the reply. The Boom rent-credit task is the example: two emails
  went out on Nov 13 and the task now waits on replies that nothing reads.
- "Hand to OpenClaw" on an action card only sets the card's status. No run ever picks it up.

The task worker closes all three. It is the job-application worker's shape applied to tasks: the Journal decides
which task is next, OpenClaw claims one task per run, does one step, records it, and stops to ask when the next
step is not its to take.

## What already exists and is reused

| Piece | Where | Used for |
|---|---|---|
| Progress log in the task's notes | `POST /api/tasks/progress`, `src/lib/task-progress.ts` | The only place the worker writes about a task |
| Brief fill (read-only, per task) | `src/app/api/tasks/brief-agent/` | Context for a run; refills after every progress entry |
| Lease, claim once, recover an expired lease | `src/app/api/jobs/application-store-utils.ts` | Copied, not shared |
| "Did it go out?" after an interrupted submit | `reconcileStaleJobApplicationLeases` | Copied for outward actions |
| Waking a cron only when there is work | `triggerJobApplicationWorker` | Copied |
| Compass "For agents" rules | `GET /api/compass` | Read at the start of every run |
| Session to task linking | `[aj:task:<id>]` mark, `src/lib/session-index` | Every run's prompt carries the mark |

The `Task` type does not change. As with briefs and chats, what the worker knows about a task lives in a sidecar.

## The record per task

`tasks/task-work.json`, keyed by task id. Only the Next server writes it (synchronous read-modify-write and an
atomic rename, as `brief-agent.json` does). A record for a task that is no longer open is pruned.

```ts
type TaskWorkStatus =
  | 'queued'      // the worker should take a step; `reason` says why
  | 'working'     // a run holds the lease
  | 'waiting'     // on someone outside; `checkAfter` says when to look for an answer
  | 'needs-you'   // questions or approvals for Adamya are open
  | 'resting'     // looked, nothing it can do now; `lookAgainAfter`
  | 'off';        // Adamya said hands off; only he changes this

interface TaskWork {
  status: TaskWorkStatus;
  reason: 'handed' | 'reply-check' | 'answered' | 'sweep' | 'retry';
  grant: 'prepare' | 'act-with-approval';        // see "What it may do"
  lease?: { token: string; claimedAt: string; expiresAt: string };
  attempted?: { what: string; at: string };      // set before any outward action, cleared after
  waiting?: { on: string; since: string; checkAfter: string; checks: number };
  items: NeedsYouItem[];                         // questions and approvals, each pending | answered | declined
  failures: number; nextRetryAt?: string;
  lookedAt?: string; fingerprint?: string;       // the brief agent's task fingerprint at the last look
}
```

Transitions go through one writer, `setTaskWorkStatus`, which refuses the ones not in this table:

| From | To | Caused by |
|---|---|---|
| none, resting | queued | Adamya hands the task; the sweep picks it; its fingerprint changed |
| waiting | queued | `checkAfter` passed |
| needs-you | queued | Adamya answered every open item |
| queued | working | claim |
| working | waiting, needs-you, resting, queued (retry) | the run's closing update |
| working | needs-you | lease expired with `attempted` set, or three failures in a row |
| working | queued | lease expired, nothing attempted (retry after 30 min, 2 h, 1 day) |
| any | off | Adamya |
| off | queued | Adamya |

## What it may do

This is the part that differs from jobs, where every application is the same kind of act. A task can be anything,
so the rule is about the kind of step, not the kind of task.

1. **Look.** Read the task, its notes, the brief, email, Canvas, the web, earlier sessions. Always allowed.
2. **Prepare.** Make things only Adamya sees: a draft in the task's notes, a list of what is due, the form found
   and its fields listed, a comparison of options. Allowed on any task that is not `off`.
3. **Act outward.** Send an email, submit a form, book, post, message a person. Never on its own judgment. The
   run records an approval item with the exact recipient and text, and stops. The next run acts only on items
   Adamya approved, and only with the approved text.
4. **Never, whatever the grant.** Spend money or enter payment details; sign or accept terms; submit or write
   graded coursework, an online assessment or a job application (those have their own skills and rules); delete
   anything; change account or security settings; complete, reword, re-date or remove the task itself.

Before an outward action the run posts `attempted`; after it, `progress`. A lease that expires in between leaves
the task in `needs-you` with "Did this go out?", and the worker never sends it again on its own. This is the
job worker's submit guard.

Looking for a reply to something already sent is level 1. A reply that arrives is recorded in Progress, and a
drafted answer becomes an approval item.

When it finds the task finished (the credit was applied, the form was accepted), it does not complete it. It
adds an item "Looks done: …", and Adamya's yes goes through the existing complete flow.

## Which task is next

`claimNextTaskWork` is deterministic and runs in the Journal. One live lease at a time across all tasks, and no
claim while a job application or Simplify lease is live, since both use OpenClaw's browser. The job claim gets
the same check in the other direction.

Order:

1. Handed by Adamya, or its open items were all answered.
2. `waiting` with `checkAfter` passed. First check a day after sending, then every two days, then weekly; after
   three weeks of silence, a `needs-you` item asks whether to follow up or stop.
3. Retries that are due.
4. The sweep: tasks with no record, or `resting` ones whose fingerprint changed or whose `lookAgainAfter` passed.
   Current queue first, then due within 14 days, then the rest by list order. Daily tasks and subtasks whose
   parent is `off` are skipped.

A chat that records progress with `waitingOn` also sets the task to `waiting`, so work started by hand is
watched too. That alone covers the Boom case.

## Cost

There are 262 open tasks. Giving each its own run is wasteful, since most are things only Adamya can do (go to
class, lift, read the chapter).

- **Sorting is batched.** Before the sweep claims anything, the Journal sends tasks without a record to OpenClaw
  30 at a time, title and first lines of notes only, with no tools. The answer per task is `nothing` (rest for
  30 days), `prepare` with one line on what, or `ask` with one question. About nine turns once, then only new
  and changed tasks.
- **The cron does not tick.** It is declared with a six-hourly schedule as a safety net. The Journal's
  five-minute interval calls `cron run` only when something is claimable, as it does for job applications.
- **A daily cap** on sweep runs (rule 4 above). Rules 1 to 3 are not capped: they exist because Adamya asked or
  something is due.
- Quiet from 23:00 to 08:00, and when the compass says exam-eve quiet.

## A run

Cron `Agentic Journal Task Worker`, isolated session, no delivery, 30-minute timeout, the same length as the
lease. Skill `agentic-journal-task-worker` in `~/agent-skills`.

1. `POST /api/tasks/work/claim`. Null means stop quietly. Claim exactly once.
2. The claim carries: the task with notes and Progress, parent and subtasks, the merged brief, open and answered
   items, the grant, the reason it was picked, the compass's For agents text, and the titles of earlier sessions
   on this task. The prompt carries `[aj:task:<id>]`.
3. Take one step at the level the grant and the answered items allow.
4. Close with exactly one of:
   - `progress` (did, next, waitingOn) and then `waiting`, `rest` or `continue` (back to queued);
   - `ask` with questions, or `propose` with approval items;
   - `retry` with a reason.
5. Never stop without one of those or `release`.

The worker writes through `/api/tasks/work/*` and `/api/tasks/progress` only. It does not use the
`agentic-journal` CLI's write commands, so that skill's dry-run and confirm rule stays as it is.

## Where Adamya sees it

- **In the task's brief:** one strip at the top with the state in words ("Waiting on SoCam since Nov 13, looks
  again Nov 15"), the open items with Approve, Edit, No, and a Hand to OpenClaw / Hands off switch.
- **On the home page:** open items across all tasks in one tray, oldest first.
- **Action cards:** agreeing to a `hand` outcome that names a task queues that task with reason `handed`.

## Build order

1. **Record and rules.** Store, `setTaskWorkStatus`, claim, updates, lease recovery, progress to waiting.
   Tests in the style of `scripts/job-transitions.test.ts`. No cron and no UI; nothing runs.
2. **Handed and waiting only.** The skill, the cron, the brief strip with items. The worker acts only on tasks
   Adamya handed over and on reply checks. This is the stage that fixes the Boom gap.
3. **The sweep.** Batched sorting, the daily cap, prepare-level work on tasks nobody handed over, the home tray.
4. **Action-card hand-offs** and standing grants on a task ("you may send follow-ups in this thread").

Stage 2 is useful on its own and is the place to stop and look at what the runs actually do before stage 3.

## Decided by Adamya (2026-11-13)

1. **Outward actions.** Every one needs his approval of its exact text. No timer sends it anyway. (Jobs do
   have such a timer, 24 h and 48 h; an email to a landlord is not a form field.)
2. **What the sweep covers.** All open tasks from the day stage 3 turns on, in the order under "Which task is
   next".
3. **Coursework.** Prepare only (what is due, where, the materials gathered), never the work itself.
4. **Daily cap on sweep runs.** 8, and 2 on the first day.
5. **Telegram.** One message a day at most, only when new items need him, linking to `/?task=<id>`.

The brief strip and the home tray are built for the phone layout (Brief tab, bottom sheet) and the laptop
together; the phone work comes first.
