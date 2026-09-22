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
3. Request the skill's historical enrichment mode. Context returns at most 50 known relevant message IDs with no `enrichedAt`; the worker rereads only those IDs, reports structured paraphrases, and continues until empty. No mailbox search, raw bodies, links, or attachments are involved. The endpoint does not replay stages, reset the poll cursor/processed ledger, or move Simplify cards. Failed reads remain resumable.

Submission snapshots are captured once through both submission paths. Manually confirmed historical submissions retain an unknown baseline. Prospective automated snapshots contain the effective resume hash; reconstructed snapshots never derive it from today's file.

## Interpretation

Outcomes mean ever reached, not a linear funnel. Closure before submission is not rejection. Unanswered applications stay unanswered. Repeated invitations count once; unresolved email matches never enter attributed rates.

Timing uses attempted/verified submission and employer receipt time, not backfill time. Intervals earlier than minus two minutes are excluded. Timing up to five minutes suggests automatic invitations; five to sixty minutes is rapid but uncertain. These labels do not prove human or ATS decisions.

Comparisons use applications observed for at least the selected window and count outcomes inside that window. Rates retain unknown groups. Exploratory patterns require at least ten applications in each compared group and five outcomes across those groups; Wilson intervals show sampling uncertainty, not adjustment for selection bias or multiple comparisons.

AI input includes calculated statistics, cited employer reasons, milestone kinds/times, and allowlisted job-related qualification answers with provenance. Demographic prompts, credentials, private URLs, arbitrary notes, and the answer bank are excluded. The UI's raw-answer detail stays local to the authenticated/private app environment.

## Validation

`npm test`, `npx tsc --noEmit`, and `npm run build`. Tests use isolated stores and mocked model failures; they do not contact employers or submit applications.
