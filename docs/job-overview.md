# Job outcome overview

`/jobs/overview` reads the listing/application files without calling the application list endpoint or waking workers. Metrics are deterministic; the AI report is stored separately. All timestamps display in Eastern time, including milestone entry. Repeated fall-back wall times use the earlier EDT occurrence; nonexistent spring-forward times are rejected.

## Operation

- `GET /api/jobs/overview`: records, evidence, data coverage, comparisons, and report status. Optional query parameters: `company`, `resume`, `outcome`, `from`, `to` (ISO timestamps), `windowDays=7|14|30`, and `unique=true`.
- `POST /api/jobs/overview`: `action: milestone` with `listingId`, `kind`, ISO `occurredAt`, optional `note` and `supersedes`; `action: group` with `listingIds`; `action: ungroup` with `id`. Corrections append history. Group confirmation is reversible.
- `POST /api/jobs/overview/analysis`: `{force: true}` for an explicit refresh; `{force:false}` skips unchanged evidence. Reports contain only hypotheses and experiments; numeric metrics and observed associations are calculated in code. Suggestions with invalid citations or unsupported numerical claims are omitted. Model errors or a response without any valid suggestions retain the previous report.
- The startup hook declares a silent 9 AM America/New_York OpenClaw job idempotently. Its script calls the analysis endpoint. `JOB_OVERVIEW_MODEL` defaults to the existing Vertex model, `gemini-2.5-flash`. `JOB_OVERVIEW_SCHEDULER_DISABLED=1` disables registration for previews/tests.

## Historical rollout

Deploy the new API/normalizers before running backfills. Older running servers can discard unknown application fields when writing the shared JSON store.

1. Run `node --import ./scripts/test-register.mjs scripts/backfill-job-snapshots.mjs` to preview and add `--apply` to persist reconstructed snapshots. It uses the application-store lock and never guesses historical resume hashes. Rerunning skips existing snapshots.
2. The external worker skill is `/home/openclaw/.openclaw/workspace/skills/agentic-journal-job-email-updates/SKILL.md`; its CLI now supports `enrichment-context` and `enrich --file`. These changes live outside this repository and must travel with deployments to a different host.
3. Request the skill's historical enrichment mode. Context returns at most 50 known relevant message IDs with no `enrichedAt`; the worker rereads only those IDs, reports structured paraphrases, and continues until empty. No mailbox search, raw bodies, or attachments are involved; the only link kept is `assessmentUrl` (below). The endpoint does not replay stages, reset the poll cursor/processed ledger, or move Simplify cards. Failed reads remain resumable.

Submission snapshots are captured once through both submission paths. Manually confirmed historical submissions retain an unknown baseline. Prospective automated snapshots contain the effective resume hash; reconstructed snapshots never derive it from today's file.

## Online assessment tasks

When an application moves into the assessment stage (confident email, confirmed pending email, or manual stage change), `src/app/api/jobs/assessment-task-utils.ts` adds a have-to-do task, "Complete {Company} OA ({Role})", at the top of Current, due on the email's deadline when one is stated. Its notes carry the OA start link, deadline, type, platform, role, posting and application links, and each invitation/reminder email (subject, sender, time, summary, Gmail link). The task id is stored as `assessmentTask` on the application: while that task is open, reminders and enrichment refresh the notes above the marker line (text below it is kept) and fill in a missing due date; a new task is created only after the previous one is completed or removed.

`assessmentUrl` is the one URL the email agent may report: an https start link from an assessment invitation or reminder, which the agent never opens. It is shown only on the OA task and is not part of the AI report input. Set `JOB_EMAIL_GMAIL_ACCOUNT` in `.env` to the inbox the agent reads so Gmail links open in that account. `scripts/backfill-assessment-tasks.ts` adds missing tasks for applications already in assessment and refreshes open ones (preview by default, `--apply` to write).

## Interpretation

Outcomes mean ever reached, not a linear funnel. Closure before submission is not rejection. Unanswered applications stay unanswered. Repeated invitations count once; unresolved email matches never enter attributed rates.

Timing uses attempted/verified submission and employer receipt time, not backfill time. Intervals earlier than minus two minutes are excluded. Timing up to five minutes suggests automatic invitations; five to sixty minutes is rapid but uncertain. These labels do not prove human or ATS decisions.

Comparisons use applications observed for at least the selected window and count outcomes inside that window. Rates retain unknown groups. Exploratory patterns require at least ten applications in each compared group and five outcomes across those groups; Wilson intervals show sampling uncertainty, not adjustment for selection bias or multiple comparisons.

AI input includes calculated statistics, cited employer reasons, milestone kinds/times, and allowlisted job-related qualification answers with provenance. Demographic prompts, credentials, private URLs, arbitrary notes, and the answer bank are excluded. The UI's raw-answer detail stays local to the authenticated/private app environment.

## UI

`/jobs/overview` is one card, read top to bottom: what needs you, where things stand, timing and evidence, then the records.

- **Filters** live in the sticky bar and every number below it follows them, except the AI report, which reads all records and says so. The period is a *submission* period: it narrows submitted applications only; unsubmitted and closed records are never period-filtered. Active filters render as removable chips; the scope line states what the numbers cover ("95 submitted · 291 records").
- **Outcome tiles use facet semantics.** They are computed from the cohort before the outcome filter, so selecting "Rejected" rings that tile and narrows the chart, evidence cards, and table without zeroing the other tiles. Outcomes mean "ever reached" and overlap; the bar beneath ("Where they stand now") is the partition of current stage, mirroring the server's employer-stage derivation, with a `withdrawn` milestone taking precedence.
- **Cited sets** ("Show these applications" on a comparison, pattern, or AI insight) narrow the view to specific ids. They expand to every member of a confirmed duplicate group so merged rows still match, and they are not written to the URL.
- **Needs you** lists employer-side items no agent can resolve: an assessment invitation with no `assessment-*` milestone (and no later decision), an interview milestone in the future or in the past without a recorded outcome, pending employer emails (linking to `/jobs#email-updates`), an inbox error, an analysis error, or an analysis that is stale *and* more than 36 hours old. Plain staleness is only a badge on the report card, since the 9 AM run refreshes it. Duplicate candidates appear in a quiet band on the Applications card because there is no dismiss action.
- **Recording milestones** always goes through the detail modal with the time editable ("Record completion" pre-selects the kind); nothing is stamped with "now" silently. Corrections show a banner naming the milestone being corrected.
- **Sparse data** is the normal case: response-time quartiles need five observations, comparison dimensions need two named groups of ten, and each card says what is missing instead of rendering "Unknown".
- **URL keys** (`history.replaceState`, no server round trip): `p` (all|30|90|custom), `from`, `to`, `resume`, `family`, `category`, `q`, `outcome` (received|assessment|interview|offer|rejected|awaiting), `status` (submitted|all|unsubmitted|closed; default submitted), `day`, `merge`, `w` (7|14|30), `sort` (submitted|company|activity), `application` (open detail). `/jobs?application=<listingId>` opens the same record on the Board.
- View-layer derivations (`deriveView`, `currentStage`, `attentionItems`, `dailyActivity`, `comparisonCards`) live in `src/lib/job-overview-view.ts` with tests in `scripts/job-overview-view.test.ts`. `summarize` is unchanged and remains the fingerprinted input to the AI report.

## Validation

`npm test`, `npx tsc --noEmit`, and `npm run build`. Tests use isolated stores and mocked model failures; they do not contact employers or submit applications.
