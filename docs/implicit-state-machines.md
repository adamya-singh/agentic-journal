# Implicit state machines in Agentic Journal

Survey date: 2026-11-06 (master @ d7be929). Read-only audit; nothing was changed.
Updated 2026-11-12 (master @ 4712f80): every defect in section 2 was re-read against the code
(none had been fixed; corrections are marked "2026-11-12"), and the code added in those 30 commits
(Sunrise, task workspace, session index, deploy queue) was swept: defects 23–47 and catalogue
sections 3.6 and 3.7. Nothing was run or reproduced in either pass.

An *implicit state machine* here is a lifecycle that lives in a status string, a set of flags,
timestamps, list membership or a lock/lease field, where the transitions are spread over several
writers (routes, workers, CLIs, OpenClaw skills, the UI) instead of one transition table.

**Headline:** there is no explicit transition table anywhere in the app. The closest things are
pure helper sets with guards — done-at proposals (`src/app/api/tasks/done-proposals/store.ts`),
`applyRankOp` (`src/lib/media/ranking.ts`), `needsFill` (`src/lib/brief-agent.ts:64`) and the
compass CLI subcommands under one flock. About 70 machines were found on 2026-11-06 and about 40
more on 2026-11-12 (about 110 in all); the catalogue is below, grouped by domain, after the
cross-cutting patterns and the defects that fell out of the sweep. The newer code adds a few more
pure helpers of the same kind: `nextWorkRecord` (`src/lib/hook-work.ts`), `chatState` /
`mergeChatHistory` (`src/lib/task-chat.ts`), `waitReasons` (`src/lib/deploy-queue.ts`).

Line numbers drift; function names are the stable reference. Items marked ✓ were re-checked
against the code by hand; the rest come from the sweep and are cited but not re-verified.

---

## 0. What was changed on 2026-11-13 (branch `fix/implicit-state-machines`)

Sections 1–4 below describe the code as surveyed and are kept as written. This table says what
became of each defect. "Fixed" means changed and covered by the test suite or a new test; nothing
was reproduced against production data, and the deploy script was not run.

| Defect | Outcome |
|---|---|
| 1 | Re-read: by design. "In Progress" fulfils the plan (he started it as planned) and leaves the task open. What was wrong is fixed: WeekView showed "(done)" (now "(started)"), no logged entry was written, and the reply said "marked in progress". |
| 2, 34 | Fixed. `/api/tasks/today/complete` takes `completed: true/false`; asking for the state it is already in changes nothing. Every caller that knows which way it means now says so. Sunrise rolls back the optimistic daily on failure. |
| 3, 23, 24 | Fixed, not run. The deploy script keeps the previous Next and Mastra builds until the new build answers a request, rolls back on any failure after the stop (`trap`), and `scripts/recover-build.sh` puts back a build an interrupted deploy left aside (also run before the service starts). |
| 25 | Fixed. `check()` re-reads the request after looking. `journal-mode.sh dev/prod` takes the deploy lock. |
| 4, 21 | Fixed. Nothing checked reads `unknown`; cron catch-up reads back to the cursor. |
| 5 | Fixed. `preparing` names its worker and is reset when that worker is gone; `ready` is written only if the file is still the one that was claimed. |
| 6, 43 | Fixed. A logged range is added as well as completing the plan; plan-action writes the logged entry its reference points at and refuses replanned or cancelled plans. Completing a missed plan late is by design. |
| 7 | Fixed. Retiming removes only auto-plans that are still active. |
| 8 | Fixed. A blocker reported again after it was answered comes back pending. |
| 9, 42 | Fixed. `setApplicationStatus` refuses to leave `submitted` or `closed`; the answers route refuses finished applications and reads a confirm answer only in the request that gave it. |
| 10 | Fixed differently: the stage is still recorded (it is the evidence that later confirms the submit), but the Simplify move is not claimable until the submit is confirmed. |
| 11 | Fixed. A worker `closed` after an unconfirmed Submit asks him instead of archiving. Worker `submitted` keeps a tracker target set by email. |
| 12 | Fixed. Confirm claims the addition under the inbox lock; the route no longer stages twice. |
| 13 | Fixed. Undo clears `votedIn` and restarts the sighting count. |
| 14 | Fixed. A refused token renewal marks the account disconnected until it is connected again. |
| 15, 46 | Fixed. Stale `.recovery` markers are dropped; an unsigned media lock is reclaimed after 30 s; a lock is only released by the process that holds it. |
| 16 | Partly. Reopening a withdrawn card drops its old decision; a due snooze is stored as open on the next upsert; card writes hold a cross-process lock. `move` still has no executor. |
| 17, 31, 47 (brief) | Fixed. Queued fills fail with a reason when the CLI is missing; a fill carries a run id; `action-done` names the fill it was clicked on. |
| 18, 19 | Left. Only at `/?hero=dawn`. |
| 20 | Left. Dropped → finished after watching the last episode reads as correct; refreshing finished shows and un-watching need a decision about what should happen. |
| 22 | Left. The queue file is read for counts. |
| 26, 27, 47 (chat) | Fixed. Stale turns are settled on every read that shows "working", and at once if sent before this server started; a late answer clears "never answered"; a reply settles only its own turn. |
| 28, 29, 30 | Fixed. Journal-made tabs are kept on disk and forgotten only once closed; a viewport is forgotten only once cleared; each viewer holds the browser separately. |
| 32 | Left. Documented trade-off (commit 2fd8e48). |
| 33 | Partly. Ingest skips a file that vanished. Sidecars are not pruned: the chats and work text are his writing, and a completed task can be un-completed. |
| 35, 36, 37 | Fixed, except the form-size ratchet (intended). |
| 38 | Fixed on the client: saves go one at a time, newest last; a failed "take theirs" keeps his edits. Two tabs editing the same work is still last-writer-wins. |
| 39, 40, 41 | Fixed. |
| 44 | Fixed. A running segment names its runner; a dead runner's segment is picked up even at the retry cap; a live one is not retried or reset underneath. Status writes keep segments the run does not own as found on disk. |
| 45 | Prepared, not applied: `docs/patches/agentic-journal-cli.patch` (stale lock recovery, zoned timestamps) for `~/agent-skills/skills/agentic-journal`. The app takes the CLI's lock for the Omi journal ledger (`src/lib/cli-file-lock.ts`); task and journal routes still do not. |

Also left: the one-helper-for-"submitted" consolidation (only `isApplicationFinished` and
`isApplicationRunning` were added; the board's polling uses the latter), `listings.json` (the
postings skill writes it directly), the keep-on-disk copies (Unwind's `wanted` is a different
fact from the acquisition's), and media jobs left `running` (recovered when the worker starts,
and nothing runs while it is down).

---

## 1. Cross-cutting patterns

### 1.1 "Set any status from any status" writers
The central writer exists but validates nothing about from → to:

| Machine | Writer |
|---|---|
| Job application status | `setApplicationStatus` (`src/app/api/jobs/application-store-utils.ts:644`) — records history only |
| Job posting status | `api/jobs/update/route.ts` + the postings skill writes `listings.json` directly |
| Unwind show state ✓ | `setShowState` (`src/lib/media/unwind-store.ts:360`) |
| Roadmap checkpoint | `roadmap/route.ts` add/update-checkpoint |
| Bugs/Features | `setStatus` (`src/lib/bugs-features/store.ts:183`) |
| Feed item | `vote` / `skip` (`src/lib/media/feed-store.ts:208`) — no from-state check, a `candidate` can be voted |
| Employer stage | `applyEmployerUpdate` (`src/app/api/jobs/email-update-utils.ts`) — `offer`/`rejected` can be overwritten |
| Acquisition retry ✓ | `retryAcquisition` (`src/lib/media/acquisition-store.ts:127`) — from any status, incl. `ready` |

### 1.2 One state, many derivations
The same question is answered differently in different files:

- **"Is this application submitted?"** — at least 9 derivations: `job-overview.ts` (`submittedAt || status || listing applied`), `job-board-stages.ts`, `job-email-updates.ts`, reviews route, `JobListings.tsx` (counts `closed` as sent), `ApplicationReviewPanel.tsx`, casebook (`appliedAt = submittedAt ?? submissionAttemptedAt` but the count uses `submittedAt` only), email-updates route.
- **"Is an application running?"** — `lease && expiresAt > now`, recomputed in ~8 places; `useJobBoardState.ts` uses `counts.inProgress > 0` instead, which includes unleased retry waits, so it polls every 5 s with nothing running.
- **"Is the OA done/open?"** — task membership (`assessment-preview-utils.ts`), milestones (`job-overview-view.ts`), casebook rounds (`interviews/view.ts`), `AssessmentsCard.tsx`.
- **"Was this task done/logged?"** — `task-actions.ts`, `WeekView.tsx`, `TaskLists.tsx`, `plan-lifecycle-utils.ts`, the journal read route, the Python CLI resolver, `task-brief.ts`.
- **Media watch status** — no status field; `finished|watching|want|none` derived in `inbox.ts` and again in `QuickAdd.tsx`, plus page filters, badges, `rankable`.
- **Library file "playable"** — four different rules (`library.ts`, media route, unwind CLI, `unwind-view.ts`).
- **Stale task** — `horizon.ts` and `task-brief.ts` use different staleness rules.
- **Omi chunk/segment coverage** — worker and transcripts route each compute it.

### 1.3 Two implementations writing the same files
The Next app (TS) and the Python `agentic-journal` CLI in `~/agent-skills/skills/agentic-journal/scripts`
both implement task completion, Current/Today rollover, staged sync, plan linking, missed-plan
marking, auto-plan from due time and the Omi journal-link ledger, and write the same JSON.

- The CLI locks with `<file>.lock` (O_EXCL); the app never checks those locks and writes tmp+rename.
- They disagree in places: CLI plan linking only considers `active` plans (the app also re-completes `missed`/`completed`); the CLI snapshot drops `projects`; CLI `completedAt` has no `Z`, so JS reads it as local time; the CLI never seeds Current; TS and Python disagree on `unprocessed + stale` Omi segments (TS ineligible, Python eligible).
- Compass period status is likewise derived in TS (`src/lib/compass/dates.ts`) and Python (`compass.py`), Python having an extra `unknown`.

### 1.4 Timestamps as leases, with uneven recovery

| Claim | Timeout | Recovery |
|---|---|---|
| Job application lease | 30 min | reconcile every 5 min (`instrumentation.ts`) |
| Simplify tracker sync lease | lease | reconcile → `failed` + retry now |
| Media job `running` | — | only at worker start (`recoverInterrupted`) |
| Quick-add inbox `reading` | 15 min | reset to `queued` |
| Torrent metadata `preparing` | 120 s | retry in 5 min |
| Jellyfin playback session | 120 s / 6 h | reaped by the guard loop |
| Brief-agent `running` | 15 min | re-queued; no run token, so a late first run can overwrite |
| Brief chat `pendingSince` | 11 min | settled on read; late reply matched by `sessionKey` only, not turn |
| Done-at proposal `thinking` | 3 min | → `failed` on read (has a turn guard ✓) |
| Bookmarks worker heartbeat | 90 s | file deleted on exit |
| Manual-browser lease (`manualUntil`) | 2 min | in-process only |
| **Library file `preparing`** ✓ | **none** | **stuck forever after a crash** |
| **Omi segment `running`** ✓ | **none** | always "retryable", so a second runner processes it concurrently; the UI spins until the worker restarts and resumes by `operationName` (2026-11-12: not forever, except defect 44) |
| Task chat `outsideRunAt` | 90 s | lapses by TTL |
| Task chat `pendingSince` on Sunrise | 11 min | settled only when that task's chat is opened (defect 26) |
| Brief-agent `queued` | none | stays queued while the OpenClaw CLI file is missing (defect 17) |
| Journal-made browser tabs (`made`) | none | in-process only; forgotten on restart (defect 28) |
| Python CLI `<file>.lock` | none | pid written but never checked; a killed CLI blocks later CLI writes (defect 45) |
| Media `<name>.lock` with an empty owner | none | bookmarks has a 30 s mtime rule, media does not (defect 46) |

### 1.5 Cross-process read-modify-write without a lock
Atomic rename, but no lock, while more than one process writes:

- `action-cards/cards.json` ✓ — the Next API and `scripts/action-cards.ts` (which imports the store and writes the file directly; the store comment's "synchronous, so no interleave" covers only one process).
- `omi-transcripts/<date>.status.json` ✓ — worker, retry API and manual CLI; `runTranscribeDay` reads once and rewrites the whole file repeatedly.
- `omi-journal-links/` — TS route unlocked, Python side locked.
- `jobs/listings.json` — no lock; written from inside the applications lock and by the postings skill.
- `uptime/history.json` — in-process single-flight only.
- `deploy-queued.json` ✓ — the `queue`/`cancel` CLI and the 5-minute timer's `check()` (defect 25).
- `brief-agent.json`, `brief-chats.json`, `hook-work.json`, `workspace-tabs.json` — "only the Next
  server writes this file" is a comment in each store, not a lock; a dev server on the same data
  dir would interleave whole-file rewrites and run a second brief worker.

### 1.6 The same fact stored in several places
- Keep-on-disk: `Acquisition.wanted`, `MediaTitle.download`, `UnwindStore.wanted` — `addSource` clears one without cancelling the acquisition.
- Job worker on/off: `store.workerEnabled` and the OpenClaw cron's `enabled`.
- Email updates on/off: `state.enabled` and the cron state; `record` doesn't check `enabled`.
- X `accountId` in `credentials.json` and `state.json`, written in two locked steps.
- Media `watching` vs Unwind `Show.state === 'watching'`.
- Action card `snoozeUntil` on both the card and the decision.
- A chat turn's outcome: `error` on the thread and the reply merged from session history (defect 27).
- Which sessions belong to a task: `threads[].sessionKey` in `brief-chats.json`, and the session
  index matching the key pattern (`session-index/view.ts`) against the format in `task-chat.ts`.
- Engine state mirrored in React: Sunrise `open` and `tray` live in `engine.ts` and again in `SunriseHero.tsx`.

---

## 2. Defects that fell out of the sweep

Ordered roughly by how likely they bite. ✓ = re-checked by hand.

1. ✓ **Journal "In Progress" marks a plan completed.** `applyPlanActionInJournal` takes `_action` and ignores it (`plan-lifecycle-utils.ts:621`); the route then replies "Plan marked in progress." (`plan-action/route.ts:165`). WeekView's In Progress button sends it.
2. ✓ **Task completion is a toggle.** `/api/tasks/today/complete` uncompletes if a completion exists (`today/complete/route.ts:73`). WeekView calls it after appending a log (`WeekView.tsx:523`), so a repeat call undoes the completion; the Cedar `completeTask` tool is in the same position. 2026-11-12: Sunrise now depends on the toggle: done and undo in `TaskPane.tsx` (`done`) are the same POST.
3. ✓ **Deploy can leave everything stopped.** After a good Next build, `deploy-production.sh` deletes `.next-previous` (line 202) and then runs pnpm install and the Mastra build under `set -e` with no trap. A failure there exits with every service stopped and no restore. 2026-11-12: worse now that deploys run unattended from the 5-minute queue timer by default; the queue clears the request on failure, so nothing retries. See also 23–25.
4. ✓ **Uptime reports "operational" when nothing has been checked.** `worstStatus` starts at `operational` and ranks `unknown`/`paused` at 0 (`src/lib/uptime/history.ts:312-326`).
5. ✓ **Library files can be stuck in `preparing`** with no recovery; and `prepare` (`src/lib/media/library.ts:304`) writes `ready` without re-checking that a concurrent scan hasn't reset the file to `settling`, so a stale probe can be marked ready.
6. **Logged range with an active plan is dropped.** journal/update marks the plan completed and returns without appending the logged range (`journal/update/route.ts` around `completeEarliestActiveTaskPlanInPlace`, line 223); `completedByLogRef` then points at nothing. The CLI appends.
7. **Retiming a task deletes plan history.** `handleDueDateSetup`'s removal predicate ignores `planStatus`, so completed/missed/rescheduled auto-plans are deleted and `replannedFromPlanId` links dangle (`src/app/api/tasks/due-date-utils.ts`).
8. **Stuck `awaiting-user-input` with nothing pending.** Action questions get deterministic ids and `mergeApplicationQuestions` keeps an earlier non-pending resolution, so a second "Automation needs help" or a second submission-confirm on the same page comes back already answered — not claimable, nothing to answer. (Inferred from merge logic, not reproduced.) 2026-11-12: re-read and reachable where the question has no `pageUrl` ("Automation needs help", the reconcile confirm question), since the id is then constant. One exit exists: an answers POST with empty `responses` moves it to in-progress.
9. ✓ **Submitted can be re-stamped via the API.** The submission-confirm branch of the answers route has no status check (`answers/route.ts:125-145`; only `submittedByHand` is guarded at line 108). Any later answers POST on a submitted application re-runs `markApplicationSubmitted`: new `submittedAt`, Simplify sync re-queued, `cardId` dropped. Only the UI hides the form. 2026-11-12: the same branch has no `closed` check either, so it can flip `closed` to `submitted`; see 42.
10. **Employer stage on an unsubmitted application.** "Trackable" includes awaiting-submission-confirmation, which is also true mid-run after submission-attempted; an email can set `employerStage` and queue a Simplify move before submission is confirmed.
11. **Worker `closed` ignores a landed submit.** The `closed` branch (`update/route.ts:392`) doesn't check `submissionAttemptedAt`.
12. **Quick-add confirm can apply twice.** `confirm` (`src/lib/media/inbox.ts:342`) checks state on an unlocked snapshot, then writes two files under separate locks; the route also calls `stageAcquisition` again after `confirm` already did.
13. **Feed undo leaves residue.** Undo restores `seen` but not `seenCount`/`votedIn`, so an undone item is auto-skipped on its next sighting (`seenCount >= 2`, `feed-store.ts:250`). One `state` is shared across lenses, and `wipeShort` strands items queued only under `short`. 2026-11-12: the auto-skip needs `seenCount` already ≥ 1 and a different day; the `wipeShort` claim was not re-traced.
14. **Bookmarks shows "connected" with a dead token.** `connected = !!accessToken`; a failed refresh leaves the token in place.
15. **Bookmarks `.recovery` lock has no stale check**; a crash while holding it blocks reclaiming stale main locks.
16. **Action cards:** `handed` is both answered and live (2026-11-12: it can still leave by `withdraw` or a re-decide, so "never finished" was overstated; the stale decision below needs handed → withdrawn → reopened; all of this is now reachable from Sunrise too); snoozed-and-due shows as open but stays stored as `snoozed`; `upsertCard` reopening a withdrawn card keeps a stale `decision`; the `move` outcome has no executor.
17. **Brief-agent fill stays `queued` forever** when the OpenClaw CLI is unavailable; the card polls every 8 s indefinitely. 2026-11-12: "unavailable" means the CLI file is missing (a down gateway takes the `failed` path), and it recovers on the next schedule once the file exists. Sunrise's `TaskPane` polls the same way.
18. **FarSide 760 ms timer.** `openCard` rolls, then `setOpen(id)` after a fixed 760 ms (`FarSide.tsx:405`); rolling back inside that window makes the card pop up on the next settle. dawn-space has the same pattern (250 ms replay re-enters 3D). 2026-11-12: reachable only at `/?hero=dawn`; Sunrise loads `DawnSpace` but never calls `focusTask`.
19. **BriefLayer chat stuck at `closing`** if the brief unmounts before `animationend`. 2026-11-12: only at `/?hero=dawn`, and not permanent: the next brief plays the out-animation and closes, a 300 ms flash.
20. **Unwind:** dropped → finished is possible via `watch`; finished shows are excluded from episode refresh, so new seasons never appear; `recordWatched` is one-way.
21. **Uptime cron cursor** advances to the newest run even when the 3-page cap was hit first, leaving a permanent gap.
22. **Omi queue file** (`omi-transcription-queue/`) is written at ingest and never dequeued. 2026-11-12 correction: the transcripts route does read it for `queueChunkCount`/`queueUpdatedAt`, and files are per day, so growth is per day.

Added 2026-11-12 (✓ = re-checked by hand; the rest were traced by the sweep unless marked inferred):

23. ✓ **An interrupted deploy destroys the only good build on its next run.** `deploy-production.sh` starts with an unconditional `rm -rf "$PREVIOUS_BUILD_DIR"` (line 173). If the previous run was killed mid-build (reboot, the unit's `TimeoutStartSec`, Ctrl-C), `.next` has no `BUILD_ID` and `.next-previous` held the good build. The queue makes the next run automatic: a killed `check` writes no `last` and keeps `queued`.
24. **`npm ci` failing early leaves services stopped** with the build untouched and nothing restarted (`deploy-production.sh`, after the stop block).
25. ✓ **A cancelled deploy can come back.** `check()` (`scripts/deploy-queue.ts:14`) reads `queued`, awaits `playing()` and `chats()` (up to about 2 min), then writes `{...queued, checkedAt, waitingOn}` without re-reading. A `cancel` during the await is undone; a `queue` gets its `lastRequestedAt` rolled back.
26. **Sunrise shows a chat as "working" indefinitely after a restart mid-turn.** `sunrise/load.ts` counts `working` from raw `pendingSince`; `settleStalePending` runs only from the brief-chat GET and send. Every deploy restarts the server.
27. **A chat can show an answer and "OpenClaw never answered" together.** `error` is cleared only by the next send; `mergeChatHistory` adds the real reply and never touches `error`.
28. **Tabs the Journal opened leak.** `made` is in memory only, so after a restart `closeBrowserTab` returns false for them; within a process the id is removed from `made` before `Target.closeTarget`, so a failed close can't be retried (`src/lib/openclaw-browser.ts`).
29. **A viewport override can be forgotten while still applied.** `setBrowserViewport(null)` and `resetBrowserViewports` drop the record before the CDP call.
30. **One browser lease, two viewers, no owner.** `endManualBrowserSession` zeroes `manualUntil` and closes every CDP connection, so the task workspace's `end` tears down an open job-application viewer and the reverse. (Extends E1.) Inferred: a frame poll arriving after `end` re-arms the lease for 2 min.
31. **`action-done` can mark the wrong action.** Action ids are `a1..` renumbered on each fill; the route takes an `actionId` with no fill token, so a click on a pre-refill brief marks the new fill's action. Older than d7be929.
32. **A post never leaves a full bookmark folder.** `folderPostIds` keeps older posts whenever a read returns 20, the read side unions `membership` with `web`, and nothing in this repo writes `web`.
33. **Sidecars are never pruned.** `ingest` only upserts, so a digest removed from the inbox stays indexed; `hook-work.json`, `brief-chats.json` and `workspace-tabs.json` keep entries for closed tasks (`brief-agent.json` is pruned). One vanished inbox file aborts a whole ingest run (`statSync` outside a try; the timer retries in 15 min).
34. ✓ **A failed daily toggle leaves the sun inverted from the journal.** `toggleDaily` (`engine.ts:1471`) sets an override that `update` clears only when the server agrees; on failure the hero only toasts and refreshes. The endpoint is a toggle, so pressing again flips both sides and they stay inverted until remount.
35. **An open card that disappears leaves an empty risen pane.** `openCard` becomes null but `engine.open` and `working` stay; the only exit is Escape, and on a narrow screen the pane covers the stage.
36. **Sunrise engine residue:** form size only ratchets down per window size (`sizeFor`, intended, but no way back up); folded ghosts keep `lastBox` from before a resize; a second glide within 420 ms loses its `gliding` class to the first timer, and the `timers` set only grows.
37. **Locked scrolling can hide its own control.** `html.sr-held` is restored from localStorage, the lock button is hidden under `.narrow`, and Escape only handles `full`; under 700 px the only exit is toggling Full page on and off.
38. **WorkCard autosave has no sequence guard** (an older save's reply shows "Saved" over a newer one), and **`takeTheirs` drops pending edits if the reset fails** (`TaskPane.tsx`). Inferred: hook-work save is last-writer-wins across tabs, since `nextWorkRecord` doesn't compare `baseHash` with the stored record.
39. **Workspace chat ordering.** A poll started before `send` returns can overwrite the sent thread with a snapshot that has no pending turn, re-enabling the composer; `send` sets `current` on reply even if he navigated away (`WorkspaceChats.tsx`).
40. **Browser surface.** One `error` slot has four writers and every good frame clears it, so finish/upload/input failures vanish within one poll (`stream.ts`); "Open the page again" isn't disabled while opening, so a double press opens two tabs and the first is never closed (`BrowserSurface.tsx`).
41. **`decideCard` doesn't compensate on a thrown error.** The created task is removed only on `success: false`, not when the decide POST rejects, and `SunriseHero` has no catch (`horizon/card-actions.ts`).
42. **A stale "retry" answer keeps clearing `submissionAttemptedAt`.** The answers route matches any answered confirm question on every POST, so after one "retry" each later POST removes the guard against a second Submit click. The empty-POST exit from defect 8 does this silently.
43. **Plan-action leaves `completedByLogRef` pointing at nothing** on the WeekView button path (same dangling reference as 6), and can "complete" a missed or rescheduled plan, since it matches by `planId` regardless of `planStatus`.
44. **Omi `running` can be stuck for good.** In `isRetryable` (`omi-transcribe-worker.mjs`) the retry cap is tested before the `running` case, so a segment left `running` on its last allowed try is never picked up.
45. **The Python CLI's lock has no stale recovery** (`io_utils.py`), and every `utcnow().isoformat()` stamp across the CLI is naive UTC, not only `completedAt` (1.3).
46. **A media lock with an empty owner is never reclaimed** (`ownerGone('')` is false and `media/store.ts` has no mtime fallback). Narrow window. Inferred: an unreadable `/proc` makes `ownerGone` treat a live owner as dead.
47. **Smaller, same family:** the horizon session Picker applies stale search replies (the Sunrise copy has the guard); the 3D entry gate is hidden on the far side before the first load but not after; brief fill has two reapers of stale `running` and `fillOne` sets `running` from any status, safe only because of the single in-process worker flag; a chat reply has no turn token (inferred, safe while the 10 min kill beats the 11 min settle).

Checked and **not** a defect: `markEmailProcessed` always writing `sawUnconfirmedSubmits: true`
is intentional — it limits the second look to entries recorded before unconfirmed submits were
matchable. YouTube refusing a different signed-in account is the pinned-account design.

---

## 3. Catalogue

### 3.1 Jobs (`src/app/api/jobs/**`, `src/lib/job-*`, `src/lib/interviews/**`)

| # | Machine | State lives in | States | Main writers | Notes |
|---|---|---|---|---|---|
| J1 | Posting | `JobListing.status` + `statusHistory`, `listings.json` | saved, starred, applied, archived | UI update route, postings skill (direct file write), worker `submitted`→applied, worker `closed`→archived | Human cancel doesn't archive, worker close does; restore never reopens a closed application |
| J2 | Application worker | `JobApplicationRecord.status`, `applications.json` | unstarted, in-progress, awaiting-user-input, submitted, closed | claim, worker update route (~10 branches), answers, reviews, reconcile, email | `in-progress` means running / retry-wait / resumed; `closed` terminal; `submitted` not API-protected |
| J3 | Lease | `lease {token, claimedAt, expiresAt}` | none / live / expired (derived) | claim; ~15 release sites | Only one live lease globally, but tracker sync and OA preview ignore it and the manual-browser block |
| J4 | Retry counters | `attemptCount`, `failureStreak`, `nextRetryAt`, `lastError` | 5 / 30 / 120 min ladder, limit 3 | `recordApplicationFailure`, reconcile | `lastError.retryable` never read; `resumeRequestedAt` never cleared on claim; tracker sync uses a different backoff |
| J5 | Autopilot / review hold | `awaitingInputSince`, `autoCompleteEligibleAt` (+24 h), `reviewHoldSince`, `autoSubmitEligibleAt` (+48 h) | waiting, draftable, review-held, auto-submittable | `setApplicationStatus`, review hold/release, autopilot route, migration script | Claim selection logic mirrored by hand in two functions |
| J6 | Simplify tracker move | `simplifySync {status, targetStatus, lease, …}` | pending, in-progress, synced, failed (parked if no `nextRetryAt`) | worker submitted, `markApplicationSubmitted`, `queueSimplifyStageSync`, tracker-sync route, reconcile | Worker `submitted` erases a `targetStatus` set by email during the run |
| J7 | Employer stage | `employerStage` + `employerUpdates[]` | received, assessment, interview, offer, rejected, (none) | email cron, UI resolve, UI set-stage | `stage: null` means both reset and informational; no terminal state |
| J8 | Email candidates | `emailUpdates.pending[]`, `processed{}` | unseen → queued → applied / ignored | email-updates route | `lastError` cleared only by a successful record |
| J9 | OA task + preview | `assessmentTask.preview.status` | requested, saved, blocked, failed (`attempts` ≤ 3) | `requestDuePreviews`, OA preview CLI | `requested` at 3 attempts shows nothing; save is two-file non-atomic; second OA invite in `assessment` creates no task |
| J10 | Interview task | `interviewTask` | open = task id in General (derived) | `ensureInterviewTask` | Pointer written before the task |
| J11 | Question resolution | `JobApplicationQuestion.resolution` | pending, answered, skipped, auto-resolved | answers, reviews, bank, worker | Submission-confirm detected by string-matching the prompt in 6 places |
| J12 | Submission attempt | `submissionAttemptedAt`, `submittedAt`, `closedAt`, `cancelledAt` | not attempted, attempted, confirmed, ambiguous, stalled, retried | update route, answers, reviews | `cancelledAt` and the overview's `withdrawn` milestone don't know about each other |
| J13 | Answer review queue | `reviewItems[]` | pending, confirmed, corrected, left-blank, redo-requested, dismissed | update route, reviews route | Explicit guard: only `pending` moves; worker `closed` leaves pending items |
| J14 | Screenshot capture | `screenshotCapture` timestamps | none, capturing, failed, complete | update route, reconcile, cancel | Quiet close and real failure stored identically |
| J15 | Worker switch | `workerEnabled` + cron enabled | on / off | control route, answers route, skill wake, migration | Two homes |
| J16 | Overview milestones | `overview-metadata.json` | 6 kinds, append-only with `supersedes` | overview route | Closest to explicit; no ordering between kinds |
| J17 | Casebook | `InterviewProcess.outcome`, `StoredRound.cancelled`; `RoundState` derived | done, upcoming, capture, unscheduled, unrecorded, cancelled | interviews API, import CLI, OA preview | The OA preview note flips the OA round to `done` before the OA is taken |
| J18 | Overview analysis | `overview-analysis.json` fingerprint | fresh / stale / error (derived) | daily cron, POST | Stale error shown ahead of "overdue" |
| J19 | Board stage | derived only (`jobBoardStage`, `src/lib/job-board-stages.ts:24`) | needs, queued, applying, submitted, heard, closed, archived | — | Pure derivation with fixed precedence |

### 3.2 Tasks, journal, planning (`src/app/api/tasks/**`, `src/app/api/journal/**`, Python CLI)

| # | Machine | State lives in | States | Main writers | Notes |
|---|---|---|---|---|---|
| T1 | Task tier | **which file the task sits in**: General, Current, Today snapshot, completed snapshot, let-go, misc | misc, general, current, today-selected, today-automatic, completed-for-date, let-go, deleted | add, current/today routes, complete, let-go, remove, promote, roadmap, capture, Mastra tools, CLI | Remove/let-go don't clean journal plans, roadmap refs, chats, cards, `assessmentTask`; daily → non-daily after completion makes an impossible combo |
| T2 | Current/Today rollover | `tasks/current/metadata.json` | uninitialized, seeded, materialized-through-D | `ensureCurrentSystemThroughToday` at the top of most routes (incl. GETs) | Read endpoints write files; CLI port never seeds or runs staged sync |
| T3 | Journal `staged` | `journal.staged[]` | in / out | "single writer" sync plus `handleDueDateSetup`, journal/update, CLI | Not actually single-writer |
| T4 | Due-time auto-plan | `autoPlannedFromDueTime: true` on entries | auto-planned / staged / none | `handleDueDateSetup` (+ CLI copy) | Removal ignores `planStatus` (defect 7) |
| T5 | Journal plan lifecycle | `entryMode` + `planStatus`, `missedAt`, `completedByLogRef`, `replanned*` | active (also implicit when missing), missed, rescheduled, completed, canceled | lazy `markMissedPlansForDate` on reads, append, update, plan-action, replan, complete-text-plan, done-at undo, CLI | The most spread-out machine; `canceled` is never written; "Start now" logs and completes the earliest plan, so started and done can't be told apart; delete doesn't touch plans |
| T6 | Done-at proposals | `ProposalStatus`, `done-proposals.json` | thinking, proposed, needs-more, failed, accepted, declined | pure helpers + inline route branches | Semi-explicit; done-at undo leaves it `accepted` |
| T7 | Brief-agent fill | `AgentRecord.status`, `brief-agent.json` | queued, running, done, failed (`failures` ≤ 3) | `scheduleBriefFills`, worker | Explicit guard `needsFill`; no run token |
| T8 | Brief chat | `pendingSince`, `error` | idle, pending, failed | brief-chat route | Late reply matched by session, not turn |
| T9 | Roadmap checkpoint | `RoadmapCheckpointStatus` | not-started, in-progress, completed | roadmap route, Mastra tool | Not tied to linked tasks; a once-completed daily task counts as done forever |
| T10 | Action cards | `CardStatus` + `decision` + `snoozeUntil` | open, handed, agreed, snoozed, dismissed, withdrawn | CLI upsert/withdraw (cron), UI decide/undo | See defect 16; agree → task is a client-side two-step with a compensating delete |
| T11 | Bugs/Features | `status` + `shippedAt` | open, shipped | PATCH from the drawer | Trivially explicit; "sent to Claude Code" isn't tracked |
| T12 | Capture priority ledger | `capture-priority/<NY-date>.json` | requested, prioritized, skipped | app (requested), CLI (resolve, guarded) | Requests for deleted tasks stay `requested`; NY dates vs server-local rollover |
| T13 | Omi → journal links | `omi-journal-links/<date>.json` | unprocessed, requested, skipped, ignored (legacy), logged, stale (derived) | TS route (unlocked), Python skill (locked) | TS/Python disagree on stale; `requested` written even when the cron wasn't queued |
| T14 | Horizon zone | derived (`src/lib/horizon.ts`) | hold, ignition, climb, altitude, orbit | — | Staleness rule differs from `task-brief.ts` |
| T15 | Task modals | component `useState` | EditTask: editing/saving/complete/error; Resort: admit-choice/loading/comparing/reordering/complete/error; PriorityComparison: entering-task/inserting/complete/error | — | Single owner, low risk |

### 3.3 Media (`src/lib/media/**`, `src/app/api/media/**`, workers)

| # | Machine | State lives in | States | Main writers | Notes |
|---|---|---|---|---|---|
| M1 | Acquisition request | `Acquisition.status`, `acquisition.json` | wanted, searching, downloading, importing, ready, paused, attention | request / stage / cancel / retry, worker recompute every 30 s | Optimistic `revision`, but retry doesn't bump it; retry of a seasonless series loses the "Choose seasons" hint; records never deleted |
| M2 | Keep-on-disk | 3 copies (see 1.6) | wanted / not | `projectFlags`, `applyAddition`, `want`, `addSource`, cancel | Copies diverge |
| M3 | Torrent admission + metadata | `metadata[hash] {preparing, …}`, guard heartbeats | candidate, preparing, added, timed-out, removed | acquisition guard (10 s) | `preparing` overloaded; `allowed` depends on another process's heartbeat |
| M4 | Media stack / VPN / AC awake | `config.json enabled/networkMode`, `vpn.json` | enabled, disabled; vpn ready/stale (25 s) | media-stack CLI, root vpn-status service, ac-awake | Never auto-disabled; the guard re-checks each tick |
| M5 | IMDb/YouTube job queue | `MediaJob.status`, `state.json` | queued, running, succeeded, failed | `addJob` (~8 callers), worker | Stale `running` recovered only at startup; `job.note` written but never shown |
| M6 | Watch status | `watched`, `watchlist`, `watching`, `yourRating`, `favorite` flags | no single field | IMDb merge, worker, inbox, setFlags, `recordWatched`, YouTube | `watching && watched` representable; an IMDb read can revert a local watched |
| M7 | Ranking | `Ranking {tiers, pending, skipped}` | unsorted, pending, placed, skipped | `applyRankOp` | Explicit reducer; duel progress is client-only and lost on close; server doesn't check `rankable` |
| M8 | Quick-add inbox | `Entry.status`, `Addition.state` | queued, reading, ready, failed; pending, added, dismissed | `addText`, `clarify`, `retryEntry`, in-process worker, `confirm` | Defect 12; failed entries never pruned |
| M9 | Local library file | `LibFile.status`, `library.json` | settling, new, preparing, ready, failed | scan, library worker, CLI retry | Defect 5; retry is CLI-only |
| M10 | Unwind show | `Show.state` | deck, watching, paused, finished, dropped | `setShowState` (any → any), `savePosition`, `watch`, `calibrate`, acquisition | Defect 20 |
| M11 | Official channels / calibration | `approved`, `calibrated` | proposed / approved; loved, want, not | Unwind store | Rejecting a channel leaves its sources playable |
| M12 | Feed item | `FeedItem.state` | candidate, new, seen, up, down, skipped | `addTo`, refill, promote, `markSeen`, vote, skip, judge cron | Defect 13; nothing terminal, nothing deleted |
| M13 | Feed judgment epochs | `rejected`, `shortJudged.period`, `tasteJudged.version` | — | judge run | Taste judgments against an old card are never invalidated |
| M14 | YouTube intake | `VideoStatus` + `decidedBy`; account / pendingAccount / cursor | pending, kept, skipped; unconfirmed, confirmed, importing | API decide/rule routes, worker | "Kept" really means a `yt:` title exists in `state.json`; two files, two renames |
| M15 | Diet TBPN watch | `Watch {position, done}` | new, started, watched (derived) | `savePosition`, `markWatched` | `done=false` overrides YouTube progress |
| M16 | Jellyfin playback | `playback-sessions.json` | reserved, active, stopped, zombie | `createPlayback`, heartbeat, stop, guard reaper | One global slot; `stopPlayback` reads without the lock |
| M17 | Player / watch UI | component state | `playing/ready/muted/failed`; source fallback jellyfin → file → youtube | — | `failed` sticks until remount |

### 3.4 Omi, bookmarks, compass, uptime, OpenClaw

| # | Machine | State lives in | States | Main writers | Notes |
|---|---|---|---|---|---|
| O1 | Omi transcription segment | `<date>.status.json` | pending, running, completed, failed (+ missing derived); superseded = deleted | worker, retry API, manual CLI | Running has no lease; lost updates; a retry silently switches batch → sync recognition; worker and CLI use different segment-id schemes in one file |
| O2 | Omi chunk queue | `omi-transcription-queue/` | queued | ingest | Never consumed |
| O3 | Omi week view | ~12 `useState`s; live: connected, delayed, disconnected, unknown | — | — | `refreshToday` has no request guard and clears action errors |
| B1 | X bookmarks sync job | `state.json job.status` + phase/cursor | queued, running, paused, completed, cancelled | `startSync`, `cancelSync`, `recoverInterrupted`, worker | `cancelled` is resumable; cancel-while-running is a flag |
| B2 | Bookmarks locks | mkdir + pid | held, stale | store | Defect 15 |
| B3 | X OAuth | `credentials.json pending/tokens`, `lastConnectionError.stage` | pending, connected, refreshing, failed | OAuth routes | Defect 14; a new begin invalidates an older tab's callback |
| C1 | Compass period | front matter + date (derived) | closed, upcoming, active, review-due, expired (+ unknown in Python) | — | Two implementations |
| C2 | Compass draft → period | draft file ± `approved:`, `opened:`, `closed:` | pending, approved, current, closed | compass CLI under flock | `open` is several non-atomic writes; commits opt-in |
| C3 | Compass mid-period edit | dirty git tree | pending / committed / reverted | OpenClaw write tool, commit-edit, revert-edit | "One pending edit" enforced only by prose in SKILL.md |
| U1 | Uptime component | `history.json current[id]` | operational, degraded, partial, major, paused, unknown | 5-min tick, stale GET | Defect 4; removed cron jobs never pruned |
| U2 | Unit timeline | derived from journald | up, down | — | Each boot resets to down; defect 21 |
| U3 | Deploy | phases in `scripts/deploy-production.sh` + flock | stopped → deps → build → restore? → Mastra → start → verify | deploy script | Defect 3; `journal-mode.sh` stops/starts the same units without the deploy lock |
| E1 | Manual-browser lease | in-process `manualUntil` (2 min) | active / idle | frame GET / input POST / end | Hidden viewer lets it lapse; unmounting one viewer ends another's session |
| E2 | CDP connection / file chooser | per-target promise, `fileChoosers` map | connected; file requested | openclaw-browser | Navigate-by-click leaves a stale "wants a file" bar |
| E3 | Browser viewer UI | opening / live / error / finishing | — | — | Error and frame coexist |

### 3.5 Horizon / home UI (`src/components/horizon/**`)

| # | Machine | State lives in | States | Notes |
|---|---|---|---|---|
| H1 | Far-side roll | ref angle/goal, `farSettled`, `halfRef`, parent `farInfo.far`, DOM `hz-rolled`, `open` | near, rolling, far-settled, card-open, absorbing | "Far" derived three ways; defect 18 |
| H2 | Pull back | `z` ref, `out`/`outRef`, parent `pullOut`, DOM `hz-pulling` | near (0), further (1), dragging | Blocked by reading other components' DOM classes through a MutationObserver |
| H3 | Dawn space 3D | `mode`, `t`, `settled`, `fly`, pending focus, DOM classes | flat, entering, live, settled | `settled` not reset going flat; 250 ms replay re-enters 3D |
| H4 | BriefLayer | `sel`, `mode` (none/tether/full), `briefs` (missing = loading, null = error), `chat` (closed/open/closing) | — | "Flying" implicit; defect 19 |
| H5 | FlagAction button | `phase` | idle, confirm, running, done | Seeded from server `doneActions`, reset on every new fill |
| H6 | HorizonHero | data / error / completing / undo / doneUndo / letGoAsk | — | Error shown only when there's no data, so a failed refresh is invisible |
| H7 | Bugs/Features drawer | `draft.editingId` + `stash` (localStorage) | new, editing, stashed | — |

### 3.6 Added since d7be929: server side

| # | Machine | State lives in | States | Main writers | Notes |
|---|---|---|---|---|---|
| N1 | Deploy build swap | `.next/BUILD_ID`, `.next-previous/`, systemd units, stamp files, flock | serving, stopped, set aside, built, previous dropped, started, verified | `deploy-production.sh` as straight-line `set -e`; `restore_previous_build` is the only back-edge | Extends U3; no `trap`, nothing on boot; defects 3, 23, 24 |
| N2 | Deploy queue | `~/.local/state/agentic-journal/deploy-queued.json`, `deploy-last.json` | none, queued, queued + waiting, deploying (flock only), last ok / failed | `scripts/deploy-queue.ts` `queue`, `cancel`, `check()` on a 5-min timer | Unlocked read-modify-write; a failed deploy clears the request by design; defect 25 |
| N3 | Brief fill | `AgentRecord.status`, `failures`, `fingerprint`, `brief-agent.json` | queued, running, done, failed; derived resting (3 failures, < 1 day), stale | `scheduleBriefFills`, `nextQueued`, `fillOne`, `action-done` route | Supersedes T7; stale `running` reaped in two places; defects 17, 31, 47 |
| N4 | Task chat thread | `pendingSince`, `error`, `seenAt`, `outsideRunAt` (90 s), `brief-chats.json` | working, waiting, idle (derived by `chatState`) + `error` | brief-chat route send / `answer()` / seen / new, `sync.ts` via `mergeChatHistory` | Supersedes T8; sync throttle maps are in memory; defects 26, 27 |
| N5 | Hook work | `body`, `baseHash`, `startedAt`, `hook-work.json` | not opened, started, edited; derived `newer` | hook-work route through `nextWorkRecord` | Reducer is explicit; no version check on save (defect 38) |
| N6 | Journal-made tabs and viewports | `globalThis.__openclawBrowser`: `made`, `fitted`, `fitWatch` | per tab: foreign, made, fitted | `openBrowserUrl`, `closeBrowserTab`, `setBrowserViewport`, `resetBrowserViewports` | Process memory only; shares E1's lease; defects 28–30 |
| N7 | Session index | inbox files → `index.db` (`sessions.hash`, `feedback`) | in inbox, indexed, changed; feedback link / not / none; derived `live` | `ingest()` (15-min timer, CLI), `setFeedback` | `live` derives from `ended` within 20 min but digests arrive on a 15-min timer; defect 33 |
| N8 | Store locks | bookmarks lock dirs, media `<name>.lock`, owner `pid boot start` (`lock-owner.ts`) | free, held, held by a dead owner | `withLock` in both stores | Extends B2; defects 15, 46 |
| N9 | Bookmark folder membership | `folders.json` `membership`, `web` | in folder / not | `importFolders`, `importFolder` | Defect 32 |
| N10 | Workspace pasted pages | `workspace-tabs.json` | listed / removed | workspace-tabs route via `withPastedPage` / `withoutPastedPage` | Explicit list reducers, one writer; never pruned |

### 3.7 Added since d7be929: Sunrise home and task workspace (`src/components/sunrise/**`)

Sunrise is the default home page; Horizon Dawn (3.5) stays at `/?hero=dawn`. The engine keeps most
state in private fields plus root CSS classes and timers.

| # | Machine | State lives in | States | Notes |
|---|---|---|---|---|
| S1 | Workspace open/close | `engine.ts` `open`, `workBox`, `paneFrom`, classes `working` / `risen`; mirrored in React `open` | closed, growing, risen, shrinking | Defect 35 |
| S2 | Side turn | `farSide`, `turning`, classes `farside` / `turn-out` / `turn-in` | today, turning-out, turning-in, far | Two nested timers; inferred: a task opened in the 300 ms turn-out survives the swap |
| S3 | Hover | `hot`, `hotTimer`, `settleTimer`, classes `hovering` / `settling` | none, pending, hot, settling | Inferred: a pending timer can fire on a removed thing and suppress the 5-min re-solve |
| S4 | Camera | `view`, `pinch`, classes `zoomed` / `gliding` | home, moved, gliding | Defect 36 |
| S5 | Hold | `locked`, `full`, `hero.sr-fullpage`, `html.sr-held`, `localStorage['sunrise-hold']` | free, locked, full | `start` writes `locked` directly, bypassing `applyHold`; defect 37 |
| S6 | Subject drill-in | `subject`, `backButton.hidden`, `.here` | all / in subject | |
| S7 | Tray | `trayKind`, `tray.hidden`; mirrored in React `tray` | closed / one of 6 kinds | One open/close pair; `closeTray` called from 8 places |
| S8 | Optimistic dailies | `dailyDone` map over `data.horizon.dailies` | server / overridden | Defect 34 |
| S9 | Thing lifecycle | per-Thing `level`, `hook`, `shown`, `lifted`, `lastBox`, classes `gone` / `ghost` / `opened` / `leaving` / `hot` | absent, on ring, folded ghost, lifted, hot, opened, leaving | `render` rebuilds the class string wholesale; defect 36 |
| S10 | Form-size ratchet | `sizeFor`, `narrowForms`, `narrowSeat` | index 0–5 per window size, subject, side | One-way; defect 36 |
| S11 | Engine life | `ready`, `destroyed`, `resolving`, `timers` set | constructed, ready, destroyed | `resolving` not in try/finally (inferred) |
| S12 | Inside 3D | sky classes `hz-live` / `hz-on3d` / `hz-settled`, written by DawnSpace, read by the engine | flat / live | Same DOM-class coupling as H2, H3; defect 47 |
| S13 | Hero overlays | `SunriseHero.tsx` `undo` + timer (8 s), `openCard` (derived), `proposals` poll (3 s), `letGoAsk` | — | `space` (off / loading / on) is an explicit union |
| S14 | Brief load and fill poll | `TaskPane.tsx` `brief` (undefined / null / value), derived `filling`, `seenBody` | loading, failed, loaded, filling (8 s) | `loadBrief` has no request guard; the pane is keyed by task id, so replies can't cross tasks |
| S15 | Work load and WorkCard autosave | `work`; `state`, `saved` / `timer` / `latest` refs | opening, none, present; idle, saving, saved, failed | Defect 38 |
| S16 | Column layout | `cols`, `briefOpen`, `chatsOpen` | 3 / 2 / 1 columns × brief × chats | A fix-up effect repairs combinations the handlers allow |
| S17 | Surfaces and tabs | `picked`, `armed`, `opened`, `pages`, `pasted`; `selectedId` derived | per tab: listed, armed, opened, closed | Derivation is pure (`deriveSurfaces`) |
| S18 | Pane actions | `busy` / `error`; add-page `adding` / `addText` / `addBad`; `Fix` `phase` | idle, saving, error; closed, typing, invalid; idle, confirm, running, done | Inferred: `Fix` under `key={i}` can carry `done` to the next flag |
| S19 | Task chats | `WorkspaceChats.tsx` `current`, `thread`, `threads`, `sending`, `error`, `draft` | list, new, in thread × idle, sending, pending | Defect 39 |
| S20 | Sessions lists | `WorkspaceSessions.tsx` and `horizon/CardSessions.tsx`: `view`, `failed`, `picking`, `error` | loading, failed, empty, rows, picking | Defect 47 |
| S21 | Card decision | `horizon/card-actions.ts` `decideCard` | task made → decided, or compensated | Returns a discriminated union; defect 41 |
| S22 | Frame stream | `openclaw-browser/stream.ts` `frame`, `error`, `live` + effect locals | off, waiting, live, stalled, failing with backoff | Defect 40 |
| S23 | Surface open, fit / zoom | `BrowserSurface.tsx` `opening`, `openError`, `tried`; `fitted`, `fitSize`, `zoomed` | not opened, opening, open, failed; natural, zoomed, fitted | Defect 40 |
| S24 | Viewer session | `OpenClawBrowserViewer.tsx` `targetId`, `workerBusyWith`, `finishing`, `uploading` | opening, open, finishing | Extends E3; doesn't reset on a `listingId` change (the caller mounts per listing) |

---

## 4. Where explicit machines would pay off most

The sweep was asked only to find these, but the payoff ranking is clear from the defect list:

1. **Journal plan lifecycle (T5)**: most writers, two implementations, and two live bugs (defects 1, 6). It is the clearest case for one `transitionPlan(entry, event)` function used by every route and ported to the CLI.
2. **Job application status (J2 + J12)**: give `setApplicationStatus` an allowed-transitions table and have it refuse leaving `submitted`/`closed`; collapse the nine "submitted" derivations into one helper.
3. **Task completion (T1)**: split the toggle into idempotent `complete` / `uncomplete`.
4. **Leases**: give library `preparing` and Omi `running` the same `{claimedAt, expiresAt}` treatment the job queue already has.

Added 2026-11-12:

5. **Deploy (N1 + N2)**: now unattended, and it has the two defects that can take the Journal down for good (3, 23). A phase marker file plus a `trap` that restores `.next-previous`, and never deleting `.next-previous` unless `.next/BUILD_ID` exists, would cover both.
6. **Answers route (J2 + J12)**: the submission-confirm branch needs a status check and should consume the confirm answer once (defects 9, 42).
7. **Optimistic client state against toggle endpoints (S8, T1)**: same root as item 3; idempotent `complete` / `uncomplete` removes defect 34 as well.
