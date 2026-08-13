# Jobs Application Pipeline — UX Review

## Status (updated 2026-08-13)

- **Items 1–3 shipped** (the "unblock flow"): Needs-you queue (oldest-first, above the
  stats row, clickable awaiting-input stat), answer-entry safety (dirty-check on all
  close paths, localStorage drafts with restore + pruning, progress header,
  next-unanswered jump, honest partial-save banner, dynamic save button, modal `key`),
  and answer-bank reuse (server-side tiered `bankMatch` enrichment, "use previous
  answer" chips, saved-answers browser with edit/delete via the new
  `/api/jobs/applications/answer-bank` route). Plus the item-6 freebie: submitted
  applications no longer show the save CTA. Page silently refetches on tab focus.
- **Item 4 shipped** (2026-08-13): file-kind questions have a real upload flow —
  multipart POST + magic-byte validation to `application-files/`, `file:<uploadId>/
  <name>` answer references validated by the answers route, chips with
  view/replace/remove in the modal, bank reuse with existence-gated matches, and a
  `stage-answer-file` command + amended skill contract so the worker attaches the
  file via its verified upload procedure. Verified end-to-end by unblocking the
  stuck Strada transcript application with a real upload.
- **Remaining**: item 5 (screenshot-capture debugging, worker-side), rest of item 6
  (render submission evidence, closed-applications view).

A design review of the `/jobs` page conducted 2026-08-13, focused on (a) the flows for
entering information needed by pending applications and (b) the flows for viewing
applications and their screenshots. Findings combine a live walkthrough with a full
code map of `JobListings.tsx`, `JobApplicationModal.tsx`, `useJobBoardState.ts`, and
the `/api/jobs/applications/*` routes.

Live data at review time: 236 listings (~149 in the active table), **63 applications
`awaiting-user-input` carrying 390 pending questions (max 44 in one application)**,
9 in progress, 7 submitted, 46 closed; answer bank has 23 entries against 450
questions; **0 complete screenshot captures, 3 incomplete**, and the only screenshots
on disk belong to a deleted application record.

## Core diagnosis

The pipeline is built as a **monitoring surface, not a workflow**. The single most
valuable action on the page — unblocking applications that are waiting on the user —
has no dedicated surface, no filter, and no queue. The signal is a small
`Needs input · N` pill in column 2 of a 12-column horizontally-scrolling table.
Meanwhile the machinery built for trust (screenshots, submission evidence) is
effectively invisible in practice.

## 1. Finding the work (biggest gap)

- The stats row ("63 awaiting input") is inert text — not clickable, not a filter.
  The only filter on the page is "Show Applied". Finding blocked applications is a
  manual scan of 149 rows.
- Sorting is starred-first only (and only 1 listing is starred) — effectively no sort.
  No search, no pagination, no status grouping.
- Data loads once on mount: no polling, no revalidation. Worker state changes while
  the page is open are invisible until manual reload — likely why 390 questions
  accumulated silently.
- 46 closed applications are unreachable: closing archives the listing and archived
  listings are filtered out of both views. `closedReason` and history render nowhere.

## 2. Entering answers (`JobApplicationModal`)

Structurally decent (clean sections, radio/checkbox rendering, per-question skip,
"Accept suggestions" bulk action) but built for 4-question applications; real ones
have up to 44:

1. **One accidental Esc destroys everything.** Esc, backdrop-click, and the X all
   close instantly with no dirty check, no draft persistence, no autosave. The
   scariest defect on the page.
2. **Silent partial saves.** Empty answers dropped without comment; no client-side
   `required` enforcement; modal closes on success regardless of how many questions
   remain. The worker only resumes at `pendingAfter === 0`, so saving 5 of 44 looks
   like success and does nothing — with no "N remaining" feedback.
3. **No progress affordance.** No answered/total counter, no jump-to-next-unanswered,
   no autofocus, no ⌘↵ save, no focus trap, no body-scroll lock.
4. **Answering happens blind.** `question.pageUrl` is stored but never rendered (grey
   "Application page" text only); no screenshot is captured when the worker blocks on
   a question, so there is zero visual context for what form is being filled.
5. **File questions are unanswerable.** `kind: "file"` ("attach your transcript")
   renders as a textarea; nothing typed there attaches a file.
6. **The answer bank barely exists as a feature.** 23 saved answers / 450 questions;
   only 20 questions carry an agent suggestion; no answer-bank browser, no "reuse
   previous answer" picker, no edit/delete. Boilerplate (work authorization, etc.) is
   retyped across 63 applications — the exact toil the system exists to remove.
7. Fragile plumbing: the submission-confirmation dropdown is string-matched on the
   exact prompt text (`'Confirm whether this application was submitted'`) in both UI
   and server — a wording change silently degrades it to free text that 400s. The
   modal has no `key` and doesn't re-key on data refresh: background updates can swap
   questions mid-typing or silently unmount the modal.

## 3. Viewing applications and screenshots

- **The screenshot gallery has effectively never displayed anything**: 0 complete
  captures, 3 incomplete, orphaned files on disk. Submission is gated on a complete
  capture, but capture keeps failing — the designed trust loop (see the filled form
  before submission) is not happening. Root-causing capture failure is worker-side
  work, not UI.
- When screenshots exist, the viewer will struggle: thumbnails are the full-resolution
  PNGs (≤25 MB each) served `Cache-Control: no-store` — full re-download on every
  modal open, no thumbnail derivatives, no loading skeletons (Pi over Tailscale).
  Lightbox-in-modal Esc handling relies on capture-phase `stopImmediatePropagation` —
  functional but brittle coupling.
- **Submitted applications undersell themselves**: `submissionEvidence` (confirmation
  URL + message, present on 5 of 7 submissions) is never rendered, while the modal
  shows a "Save and resume application" CTA — actively wrong on a finished
  application. Progress history is a collapsed bare status+timestamp list.
- Status vocabulary diverges: the stats row's "24 submitted" vs the store's 7
  submitted + 46 closed; `closed` has no count chip and no view.

## 4. Table-level noise

- Company descriptions render inline → ~250px rows (same issue the old main page had).
- Salary data surfaces raw and wrong ("0/hr", "28K/yr – 17K/yr" inverted, "not
  listed").
- The Notes column (min-w-64 max-w-96) forces horizontal scroll that can push the
  status pill — the most important cell — off-screen.
- Enabling an Apply-to category checkbox silently wakes the worker (side effect, no
  confirmation); the disabled Start button explains itself only via an amber
  "Missing: …" filename fragment with no hint of where resume files belong
  (`readiness.resumeDirectory` is returned by the API and never rendered).
- Data quirks surfaced by the review: at least one listing with `position` undefined;
  screenshots directory orphaned from a deleted application.

## Fix priorities (by leverage)

1. **A "Needs you" queue** — make the awaiting-input count a door to a dedicated,
   ordered work surface (or at minimum a status filter).
2. **Answer-entry safety** — dirty-check on close + draft persistence, progress
   counter, honest save feedback ("5 saved · 39 remaining — worker resumes at 0").
3. **Answer bank as a real feature** — inline "reuse previous answer" suggestions;
   boilerplate answered once, ever.
4. **Fix or remove file questions** — real upload, or auto-skip with a "apply
   manually" note.
5. **Debug screenshot capture** (worker-side) — the trust loop is the point.
6. **Truthful terminal states** — render submission evidence, remove the wrong CTA on
   submitted apps, give closed applications a view.

Items 1–3 form one coherent "unblock flow" phase and would remove most of the daily
friction.
