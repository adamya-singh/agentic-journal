# Cursor-Inspired Redesign Plan

A design review of the main page (`/`) conducted 2026-08-11, with the mindset of a
design-led product team (Cursor/Linear school). Goal: diagnose why the frontend adds
enough friction that using the app as a second brain does not feel effortless, and lay
out the redesign direction.

## Product promise

The app should let the user tell it something (currently a task) and handle all the
work of storing, organizing, prioritizing, and remembering it. A user may capture a
huge number of tasks, some untouched for months or years, and the frontend must still
make it easy to view, filter, scroll, and surface any of them. Omi journal ingestion
exists for the same reason: reduce capture friction.

That promise has exactly two moments that matter:

1. **Capture** — "I tell it something, it does the rest."
2. **Recall** — "Months later, I can instantly surface it."

## Core diagnosis

The main page is optimized for neither moment. It is a *monitoring dashboard*: one
route stacking week grid → Today lists (Have/Want) → Current lists (Have/Want) →
General lists (Have/Want) → job board, ~37,000px (~41 screens) tall, rendering
everything at once (237 open tasks, 303 completed, 230 job listings — no
virtualization, no pagination, no search).

Dashboards are what you build when the software can't be trusted to manage state, so
the user supervises it. That is the opposite of a second brain: every visit asks the
user to re-absorb everything instead of doing one thing.

## The 7 frictions

### 1. Capture is the least-developed interaction in the app

Two ways to add a task: a small "+" on each list header that opens a modal, or typing
to Cedar chat.

- The "+" is buried mid-page and forces a **have-to-do vs. want-to-do decision before
  the thought is even typed** — classification at capture time, when classification is
  supposed to be the app's job.
- The chat path requires opening a panel, composing a sentence, and waiting on an LLM
  round-trip for something as small as "buy drone parts."
- No omnipresent capture field, no keyboard shortcut, no ⌘K.

For a second brain, capture must cost less than the thought itself. This is the single
highest-leverage fix. (Omi ingestion attacks capture friction from the hardware side —
right instinct — but only covers spoken life, not the "thought while working" case.)

### 2. Recall doesn't exist as a feature

With 237 open tasks, the only retrieval tools are scrolling, a Due-sort toggle, and a
Group toggle.

- **No text search anywhere in the app.**
- Project tags like `(aviro)` and `(stanford-cs336-summer)` render as pills but are
  not clickable filters.
- No date range, no "show me everything about X."
- **Completed tasks vanish**: they leave the lists for `completed-index.json` and no
  UI ever shows them again — 303 memories that are write-only.

For tasks that may sleep for months or years this is fatal: the moment a task scrolls
below the fold it is functionally gone, and the user knows it — which quietly destroys
trust in the system, which suppresses capture. Friction at recall poisons capture.

### 3. The three-stage funnel is an engine concept rendered as layout

General → Current → Today is a good *data model*, but the UI shows it as six stacked
lists, so the same task appears up to three times (e.g. "apply to jobs" in Today, in
Current, and as General #1 with an "in Current" badge). The user must hold the
pipeline's mental model and visually reconcile duplicates — reconciliation work the
app promised to own. Pipeline stage should be a badge or filter on *one* list, not
three copies of the list.

### 4. False-precision priority

The General lists are strictly rank-ordered 1..N (currently 1–81 on Have to Do).
Nobody maintains a real total order over 81 items; below rank ~10 the numbers are
noise, but their prominence implies they are meaningful — more supervision burden.

### 5. Per-row visual noise

Every task row permanently shows five colorful action icons (edit, add-subtask, play,
clock, delete), plus up to five competing status signals per row: red/green left
border, "Daily" pill, project pill, "in Current" badge, due text. Rows should show
*content*; actions belong on hover or behind one menu, with a single accent-color
system that carries meaning.

### 6. The job board doesn't belong on this page

It is a different activity (pipeline review) with different rhythms, and it is ~80% of
the page height — 149 filtered rows at ~250px each because full company descriptions
render inline in a table column. Projects and Transcripts already have their own
routes; Jobs is the section that most deserves one. Removing it alone turns the main
page from 41 screens into ~8.

### 7. Polish debt that reads as "unfinished"

- The Chat-Modes/Theme panel sits permanently in the page header like a debug
  leftover.
- The Cedar debugger bug-icon overlaps and partially covers the "Projects" button.
- A multi-screen blank gap sits between the Tasks section and Job Listings.
- The week-view legend asks the user to memorize four dot colors.

## Redesign direction

- **Make capture the spine.** One always-visible input at the top (and ⌘K from
  anywhere): type a fragment, hit enter, done. No list choice, no modal. The agent
  classifies, tags, and prioritizes asynchronously and shows a small undoable toast
  ("→ Want to do · aviro"). This is the "effortless" moment the product hangs on.
- **Build the Library view.** A search-first page over *all* tasks ever — open,
  completed, ancient — with instant fuzzy text search, clickable project/tag chips,
  status and date filters, and a virtualized list. This is the second-brain payoff
  surface, currently missing entirely.
- **Collapse the funnel to one list** with stage badges/filters; Today is the only
  always-expanded slice on the main page.
- **Main page = today only:** this week's grid + today's short list + the capture
  bar. Everything else (Library, Jobs, Projects, Transcripts) is a route.
- **Add proactive resurfacing.** "Remembering" should be active: a small
  agent-curated shelf ("stale 3 months, related to what you did yesterday") — the
  Jarvis behavior the agent infrastructure already supports.
