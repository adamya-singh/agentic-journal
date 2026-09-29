import type { JobEmployerStage, JobEmployerUpdate } from './types';
import {
  easternInput,
  elapsed,
  epoch,
  groupOpportunities,
  summarize,
  observedPatterns,
  type Milestone,
  type Overview,
  type OverviewRow,
} from './job-overview';

/**
 * View-layer helpers for /jobs/overview. Pure and React-free so the page's
 * filter semantics, chart buckets, and attention rules are unit-testable.
 * Nothing here feeds the AI evidence bundle; `summarize` stays the single
 * source for the fingerprinted statistics.
 */

export const MILESTONE_LABELS: Record<Milestone['kind'], string> = {
  'assessment-completed': 'Assessment completed',
  'assessment-passed': 'Assessment passed',
  'assessment-failed': 'Assessment failed',
  'interview-scheduled': 'Interview scheduled',
  'interview-completed': 'Interview completed',
  withdrawn: 'Withdrawn',
};
export const AUTOMATION_LABELS: Record<OverviewRow['automation'], string> = {
  'likely automated': 'Likely automated',
  'rapid response': 'Rapid response',
  'explicitly automated': 'Explicitly automated',
  unknown: 'Timing unknown',
};
export const OUTCOME_KEYS = [
  'received',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'awaiting',
] as const;
export type OutcomeKey = (typeof OUTCOME_KEYS)[number];
export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  received: 'Acknowledged',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  awaiting: 'No decision yet',
};
export const STAGE_ORDER: JobEmployerStage[] = [
  'received',
  'assessment',
  'interview',
  'offer',
  'rejected',
];
/** Mirror `observedPatterns` thresholds so UI copy cannot drift from the math. */
export const MIN_GROUP_N = 10;
export const MIN_OUTCOMES = 5;
export const ANALYSIS_OVERDUE_MS = 36 * 3600000;

export type Insight = {
  kind: 'hypothesis' | 'experiment';
  text: string;
  limitations: string;
  applicationIds: string[];
  eventIds: string[];
};
export type AnalysisState = {
  report: null | { generatedAt: string; cutoff: string; model: string; insights: Insight[] };
  stale: boolean;
  error: null | { message: string; at?: string };
};
export type OverviewData = Overview & {
  metrics: ReturnType<typeof summarize>;
  analysis: AnalysisState;
};

const INFORMATIONAL = ['assessment-reminder', 'still-reviewing'];
export const informational = (e: JobEmployerUpdate) => INFORMATIONAL.includes(e.eventKind ?? '');
export const withdrawn = (r: OverviewRow) => r.milestones.some((m) => m.kind === 'withdrawn');
export const acknowledged = (r: OverviewRow) =>
  r.events.some((e) => e.stage !== null && !informational(e));

// ---------- time ----------

export function easternDay(iso?: string) {
  return epoch(iso) === undefined ? '' : easternInput(iso!).slice(0, 10);
}
export function formatEastern(iso?: string, style: 'datetime' | 'date' | 'time' = 'datetime') {
  const t = epoch(iso);
  if (t === undefined) return 'Unknown';
  return new Date(t).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    ...(style === 'date'
      ? { dateStyle: 'medium' }
      : style === 'time'
        ? { timeStyle: 'short' }
        : { dateStyle: 'medium', timeStyle: 'short' }),
  });
}
/** "5 min ago", "3 h ago", "12 d ago", "in 2 d", or "" when the timestamp is unusable. */
export function relativeTime(iso: string | undefined, now: number) {
  const t = epoch(iso);
  if (t === undefined) return '';
  const diff = now - t;
  const minutes = Math.round(Math.abs(diff) / 60000);
  if (minutes < 1) return 'just now';
  const unit =
    minutes < 60
      ? `${minutes} min`
      : minutes < 2880
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}
/** "3 min after submitting", "around submission", or "timing unknown"; never "Around submission after submitting". */
export function sinceSubmission(ms: number | null) {
  const text = elapsed(ms);
  return text === 'Around submission'
    ? 'around submission'
    : text === 'Unknown'
      ? 'timing unknown'
      : text === 'Invalid chronology'
        ? 'before submission (invalid)'
        : `${text} after submitting`;
}
/** Shortest honest label for an age in days, used in "No decision · 12 d". */
export function ageDays(iso: string | undefined, now: number) {
  const t = epoch(iso);
  return t === undefined ? null : Math.max(0, Math.floor((now - t) / 86400000));
}

// ---------- filters ----------

export type Period = 'all' | '30' | '90' | 'custom';
export type TableStatus = 'submitted' | 'all' | 'unsubmitted' | 'closed';
export type OverviewFilters = {
  period: Period;
  start: string; // Eastern YYYY-MM-DD, custom period only
  end: string;
  resume: string;
  family: string;
  category: string;
  search: string;
  outcome: '' | OutcomeKey;
  status: TableStatus; // table only
  day: string; // Eastern YYYY-MM-DD from a chart click
  merge: boolean; // fold confirmed duplicate groups into one row
};
export type Cited = { label: string; ids: string[] } | null;
export type SortKey = 'submitted' | 'company' | 'activity';
export const SORT_LABELS: Record<SortKey, string> = {
  submitted: 'Latest submitted',
  company: 'Company',
  activity: 'Last activity',
};
export const DEFAULT_FILTERS: OverviewFilters = {
  period: 'all',
  start: '',
  end: '',
  resume: '',
  family: '',
  category: '',
  search: '',
  outcome: '',
  status: 'submitted',
  day: '',
  merge: false,
};
const QUERY_KEYS: Record<keyof OverviewFilters, string> = {
  period: 'p',
  start: 'from',
  end: 'to',
  resume: 'resume',
  family: 'family',
  category: 'category',
  search: 'q',
  outcome: 'outcome',
  status: 'status',
  day: 'day',
  merge: 'merge',
};
const PERIODS: Period[] = ['all', '30', '90', 'custom'];
const STATUSES: TableStatus[] = ['submitted', 'all', 'unsubmitted', 'closed'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function filtersFromQuery(params: URLSearchParams): OverviewFilters {
  const f: OverviewFilters = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(QUERY_KEYS) as (keyof OverviewFilters)[]) {
    const v = params.get(QUERY_KEYS[key]);
    if (v === null) continue;
    if (key === 'merge') f.merge = v === '1';
    else if (key === 'period') {
      if (PERIODS.includes(v as Period)) f.period = v as Period;
    } else if (key === 'status') {
      if (STATUSES.includes(v as TableStatus)) f.status = v as TableStatus;
    } else if (key === 'outcome') {
      if (OUTCOME_KEYS.includes(v as OutcomeKey)) f.outcome = v as OutcomeKey;
    } else if (key === 'start' || key === 'end' || key === 'day') {
      if (DAY.test(v)) f[key] = v;
    } else f[key] = v.slice(0, 200);
  }
  if (f.period !== 'custom') f.start = f.end = '';
  return f;
}
export function filtersToQuery(f: OverviewFilters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const key of Object.keys(QUERY_KEYS) as (keyof OverviewFilters)[]) {
    const v = f[key];
    if (key === 'merge') {
      if (v) params.set(QUERY_KEYS.merge, '1');
    } else if (v && v !== DEFAULT_FILTERS[key]) params.set(QUERY_KEYS[key], String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return params.toString();
}
export type Chip = { key: keyof OverviewFilters | 'cited'; label: string };
/** Removable chips for every filter that narrows the numbers (status and merge are shown elsewhere). */
export function activeChips(f: OverviewFilters, cited: Cited): Chip[] {
  const chips: Chip[] = [];
  if (f.period === 'custom')
    chips.push({
      key: 'period',
      label: `${f.start || 'Start'} → ${f.end || 'today'}`,
    });
  else if (f.period !== 'all') chips.push({ key: 'period', label: `Last ${f.period} days` });
  if (f.resume) chips.push({ key: 'resume', label: `Resume: ${f.resume}` });
  if (f.family) chips.push({ key: 'family', label: f.family });
  if (f.category) chips.push({ key: 'category', label: f.category });
  if (f.search.trim()) chips.push({ key: 'search', label: `“${f.search.trim()}”` });
  if (f.outcome) chips.push({ key: 'outcome', label: OUTCOME_LABELS[f.outcome] });
  if (f.day) chips.push({ key: 'day', label: `Activity on ${f.day}` });
  if (cited) chips.push({ key: 'cited', label: cited.label });
  return chips;
}
export function chipPatch(key: Chip['key']): Partial<OverviewFilters> {
  if (key === 'period') return { period: 'all', start: '', end: '' };
  if (key === 'cited') return {};
  return { [key]: '' } as Partial<OverviewFilters>;
}
export function periodBounds(f: OverviewFilters, now: number): { from: string; to: string } {
  if (f.period === 'custom') return { from: f.start, to: f.end };
  if (f.period === 'all') return { from: '', to: '' };
  return {
    from: easternDay(new Date(now - Number(f.period) * 86400000).toISOString()),
    to: '',
  };
}
const inRange = (day: string, from: string, to: string) =>
  (!from || day >= from) && (!to || day <= to);

export function expandIds(ids: string[], groups: Overview['groups']) {
  const set = new Set(ids);
  for (const g of groups)
    if (g.listingIds.some((id) => set.has(id))) g.listingIds.forEach((id) => set.add(id));
  return set;
}
export function matchesOutcome(r: OverviewRow, outcome: OverviewFilters['outcome']) {
  if (!outcome) return true;
  if (outcome === 'received') return acknowledged(r);
  if (outcome === 'awaiting') return !r.substantive && !withdrawn(r);
  return !!r.first[outcome];
}
const activeOnDay = (r: OverviewRow, day: string) =>
  easternDay(r.submittedAt) === day ||
  r.events.some((e) => !informational(e) && e.stage !== null && easternDay(e.receivedAt) === day);

export type View = {
  /** Merge + attribute filters, every status, no period. */
  records: OverviewRow[];
  /** Submitted records inside the submission period: the basis for every statistic. */
  cohort: OverviewRow[];
  /** Cohort narrowed by the outcome tile and any cited set: chart and evidence cards. */
  focus: OverviewRow[];
  /** Rows shown in the applications table. */
  table: OverviewRow[];
  closedBeforeSubmit: number;
  merged: number;
};
export function deriveView(
  rows: OverviewRow[],
  groups: Overview['groups'],
  f: OverviewFilters,
  cited: Cited,
  now: number,
): View {
  const base = f.merge && groups.length ? groupOpportunities(rows, groups) : rows;
  const q = f.search.trim().toLowerCase();
  const records = base.filter(
    (r) =>
      (!f.resume || r.resume === f.resume) &&
      (!f.family || r.family === f.family) &&
      (!f.category || r.categories.includes(f.category as never)) &&
      (!q || `${r.company} ${r.role}`.toLowerCase().includes(q)),
  );
  const { from, to } = periodBounds(f, now);
  const cohort = records.filter(
    (r) => r.submitted && (!from && !to ? true : inRange(easternDay(r.submittedAt), from, to)),
  );
  const citedSet = cited ? expandIds(cited.ids, groups) : null;
  const focus = cohort.filter(
    (r) => matchesOutcome(r, f.outcome) && (!citedSet || citedSet.has(r.id)),
  );
  const unsubmitted = records.filter((r) => !r.submitted);
  const byStatus =
    f.status === 'submitted'
      ? focus
      : f.status === 'all'
        ? [...focus, ...unsubmitted]
        : unsubmitted.filter((r) => (f.status === 'closed') === (r.status === 'closed'));
  return {
    records,
    cohort,
    focus,
    table: f.day ? byStatus.filter((r) => activeOnDay(r, f.day)) : byStatus,
    closedBeforeSubmit: unsubmitted.filter((r) => r.status === 'closed').length,
    merged: rows.length - base.length,
  };
}

// ---------- current stage ----------

export type CurrentStage = 'none' | JobEmployerStage | 'withdrawn';
export const CURRENT_STAGE_ORDER: CurrentStage[] = ['none', ...STAGE_ORDER, 'withdrawn'];
export const CURRENT_STAGE_LABELS: Record<CurrentStage, string> = {
  none: 'No reply',
  received: 'Acknowledged only',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};
/** Latest non-informational employer stage; mirrors the server's `deriveEmployerStage`. */
export function currentStage(r: OverviewRow): CurrentStage {
  if (withdrawn(r)) return 'withdrawn';
  const newestFirst = [...r.events].sort(
    (a, b) =>
      (epoch(b.receivedAt) ?? 0) - (epoch(a.receivedAt) ?? 0) ||
      (epoch(b.appliedAt) ?? 0) - (epoch(a.appliedAt) ?? 0),
  );
  for (const e of newestFirst) {
    if (informational(e)) continue;
    if (e.stage === null) return 'none';
    if (e.stage !== 'received') return e.stage;
  }
  return newestFirst.some((e) => e.stage === 'received' && !informational(e)) ? 'received' : 'none';
}
export function stageDistribution(rows: OverviewRow[]) {
  const counts = Object.fromEntries(CURRENT_STAGE_ORDER.map((s) => [s, 0])) as Record<
    CurrentStage,
    number
  >;
  for (const r of rows) counts[currentStage(r)]++;
  return counts;
}
export function tileCounts(cohort: OverviewRow[], stats: ReturnType<typeof summarize>) {
  return {
    submitted: stats.submitted,
    received: cohort.filter(acknowledged).length,
    assessment: stats.counts.assessment,
    interview: stats.counts.interview,
    offer: stats.counts.offer,
    rejected: stats.counts.rejected,
    awaiting: stats.awaiting,
  } satisfies Record<'submitted' | OutcomeKey, number>;
}

// ---------- rows ----------

export function lastActivityAt(r: OverviewRow): string | undefined {
  const candidates = [
    r.submittedAt,
    ...r.events.filter((e) => !informational(e)).map((e) => e.receivedAt),
    ...r.milestones.map((m) => m.occurredAt),
  ];
  let best: string | undefined;
  for (const c of candidates) {
    const t = epoch(c);
    if (t !== undefined && (best === undefined || t > (epoch(best) ?? -Infinity))) best = c;
  }
  return best;
}
export function sortRows(rows: OverviewRow[], sort: SortKey) {
  return [...rows].sort((a, b) =>
    sort === 'company'
      ? a.company.localeCompare(b.company) || a.role.localeCompare(b.role)
      : sort === 'activity'
        ? (epoch(lastActivityAt(b)) ?? 0) - (epoch(lastActivityAt(a)) ?? 0)
        : (epoch(b.submittedAt) ?? 0) - (epoch(a.submittedAt) ?? 0),
  );
}

// ---------- activity ----------

export type ActivityBucket = {
  day: string; // first Eastern day in the bucket
  end?: string; // last day, week buckets only
  submissions: string[];
  responses: { id: string; stage: JobEmployerStage }[];
};
const dayToMs = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const msToDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** One bucket per Eastern day between `from` and `to` (inclusive), gaps filled. */
export function dailyActivity(
  rows: OverviewRow[],
  from: string,
  to: string,
  now: number,
): ActivityBucket[] {
  const days = rows.map((r) => easternDay(r.submittedAt)).filter(Boolean);
  const start = from || (days.length ? days.reduce((a, b) => (a < b ? a : b)) : '');
  const finish = to || easternDay(new Date(now).toISOString());
  if (!start || !finish || start > finish) return [];
  const buckets = new Map<string, ActivityBucket>();
  for (let t = dayToMs(start); t <= dayToMs(finish); t += 86400000) {
    const day = msToDay(t);
    buckets.set(day, { day, submissions: [], responses: [] });
  }
  for (const r of rows) {
    if (r.submitted) buckets.get(easternDay(r.submittedAt))?.submissions.push(r.id);
    for (const e of r.events)
      if (e.stage !== null && !informational(e))
        buckets.get(easternDay(e.receivedAt))?.responses.push({ id: r.id, stage: e.stage });
  }
  return [...buckets.values()];
}
export function bucketActivity(days: ActivityBucket[], size = 7): ActivityBucket[] {
  const out: ActivityBucket[] = [];
  for (let i = 0; i < days.length; i += size) {
    const slice = days.slice(i, i + size);
    out.push({
      day: slice[0].day,
      end: slice[slice.length - 1].day,
      submissions: slice.flatMap((d) => d.submissions),
      responses: slice.flatMap((d) => d.responses),
    });
  }
  return out;
}
export function activitySeries(rows: OverviewRow[], from: string, to: string, now: number) {
  const days = dailyActivity(rows, from, to, now);
  return days.length > 90
    ? { unit: 'week' as const, buckets: bucketActivity(days) }
    : { unit: 'day' as const, buckets: days };
}

// ---------- timing ----------

export type TimingRow = {
  key: string;
  label: string;
  /** Plural noun for the "none recorded yet" sentence. */
  emptyLabel: string;
  n: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
};
const TIMING_LABELS: Record<string, string> = {
  assessment: 'Assessment invitation',
  interview: 'Interview',
  rejected: 'Rejection',
  'assessment-next': 'Assessment → next stage',
};
const TIMING_EMPTY: Record<string, string> = {
  assessment: 'assessment invitations',
  interview: 'interviews',
  rejected: 'rejections',
  'assessment-next': 'assessment follow-ups',
};
/** "a", "a or b", "a, b, or c". */
export function listOf(items: string[]) {
  return items.length <= 1
    ? items.join('')
    : items.length === 2
      ? `${items[0]} or ${items[1]}`
      : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}
/** Quartiles only once there are five observations; a median of two numbers is not a spread. */
export function timingRows(times: ReturnType<typeof summarize>['times']): TimingRow[] {
  return Object.entries(times).map(([key, v]) => ({
    key,
    label: TIMING_LABELS[key] ?? key,
    emptyLabel: TIMING_EMPTY[key] ?? key,
    n: v.n,
    median: v.n ? v.median : null,
    q1: v.n >= 5 ? v.q1 : null,
    q3: v.n >= 5 ? v.q3 : null,
  }));
}

// ---------- comparisons ----------

export const DIMENSION_LABELS: Record<string, string> = {
  resume: 'Resume',
  resumeHash: 'Resume version',
  family: 'Role family',
  location: 'Location',
  source: 'Source',
  category: 'Category',
  'posting-delay': 'Applied after posting',
};
type Stats = ReturnType<typeof summarize>;
type Pattern = ReturnType<typeof observedPatterns>[number];
export type ComparisonGroup = {
  value: string;
  n: number;
  ids: string[];
  hits: Record<string, number>;
  eligible: boolean;
};
export type ComparisonCard = {
  dimension: string;
  label: string;
  outcomes: string[];
  groups: ComparisonGroup[];
  patterns: Pattern[];
};
/**
 * Dimensions worth showing: at least two named groups meeting the pattern
 * threshold. Smaller or Unknown groups stay visible but muted, per the docs'
 * "unknown values remain visible" rule.
 */
export function comparisonCards(stats: Stats, patterns: Pattern[]): ComparisonCard[] {
  const dimensions = [...new Set(stats.comparisons.map((c) => c.dimension))];
  return dimensions.flatMap((dimension) => {
    const all = stats.comparisons.filter((c) => c.dimension === dimension);
    const named = all.filter((c) => c.n >= MIN_GROUP_N && !c.value.includes('Unknown'));
    if (named.length < 2) return [];
    const outcomes = ['assessment', 'interview', 'offer', 'rejected'].filter((k) =>
      all.some((c) => c.outcomes[k] > 0),
    );
    return [
      {
        dimension,
        label: DIMENSION_LABELS[dimension] ?? dimension,
        outcomes,
        groups: [...all]
          .sort((a, b) => b.n - a.n)
          .map((c) => ({
            value: c.value,
            n: c.n,
            ids: c.ids,
            hits: c.outcomes,
            eligible: c.n >= MIN_GROUP_N && !c.value.includes('Unknown'),
          })),
        patterns: patterns.filter((p) => p.dimension === dimension),
      },
    ];
  });
}
export function comparisonEmptyState(stats: Stats) {
  let best: { label: string; groups: string } | null = null;
  let bestSecond = -1;
  for (const dimension of new Set(stats.comparisons.map((c) => c.dimension))) {
    const named = stats.comparisons
      .filter((c) => c.dimension === dimension && !c.value.includes('Unknown'))
      .sort((a, b) => b.n - a.n);
    const second = named[1]?.n ?? -1;
    if (second > bestSecond) {
      bestSecond = second;
      best = {
        label: DIMENSION_LABELS[dimension] ?? dimension,
        groups: named
          .slice(0, 3)
          .map((c) => `${c.value} ${c.n}`)
          .join(' / '),
      };
    }
  }
  const need = `Comparisons need at least ${MIN_GROUP_N} mature applications in each of two groups`;
  return best && bestSecond >= 0
    ? `${need}. Closest so far: ${best.label} — ${best.groups}.`
    : `${need}. ${stats.eligible} applications are mature enough right now.`;
}

// ---------- detail timeline ----------

export type TimelineEntry =
  | { kind: 'submitted'; at: string }
  | { kind: 'event'; at: string; event: JobEmployerUpdate }
  | { kind: 'milestone'; at: string; milestone: Milestone };
/** Submission sits at the verified attempt time when known: acknowledgement emails can land before the confirmation was recorded. */
export function timeline(r: OverviewRow): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const submittedAt = r.baseline ?? r.submittedAt;
  if (submittedAt) entries.push({ kind: 'submitted', at: submittedAt });
  for (const e of r.events) entries.push({ kind: 'event', at: e.receivedAt, event: e });
  for (const m of r.milestones) entries.push({ kind: 'milestone', at: m.occurredAt, milestone: m });
  return entries.sort((a, b) => (epoch(a.at) ?? 0) - (epoch(b.at) ?? 0));
}

// ---------- attention ----------

export type AttentionItem = {
  kind:
    | 'assessment-open'
    | 'interview-upcoming'
    | 'interview-unrecorded'
    | 'emails-pending'
    | 'email-error'
    | 'analysis-error'
    | 'analysis-overdue';
  id?: string;
  title: string;
  detail: string;
  milestoneKind?: Milestone['kind'];
};
export function attentionItems(
  data: Pick<Overview, 'rows' | 'emailUpdates'> & { analysis: AnalysisState },
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of data.rows) {
    if (!r.submitted || withdrawn(r)) continue;
    const invite = r.first.assessment;
    if (invite && !r.milestones.some((m) => m.kind.startsWith('assessment-'))) {
      const inviteAt = epoch(invite.receivedAt) ?? 0;
      const decided = ['rejected', 'offer', 'interview'].some(
        (k) => (epoch(r.first[k]?.receivedAt) ?? -Infinity) >= inviteAt,
      );
      if (!decided)
        items.push({
          kind: 'assessment-open',
          id: r.id,
          title: `${r.company} · ${r.role}`,
          detail: [
            `Assessment invited ${relativeTime(invite.receivedAt, now)}`,
            invite.deadline ? `due ${formatEastern(invite.deadline)}` : '',
            'completion not recorded',
          ]
            .filter(Boolean)
            .join(' · '),
          milestoneKind: 'assessment-completed',
        });
    }
    const scheduled = r.milestones
      .filter((m) => m.kind === 'interview-scheduled')
      .sort((a, b) => (epoch(b.occurredAt) ?? 0) - (epoch(a.occurredAt) ?? 0))[0];
    if (scheduled) {
      const at = epoch(scheduled.occurredAt) ?? 0;
      const completed = r.milestones.some(
        (m) => m.kind === 'interview-completed' && (epoch(m.occurredAt) ?? 0) >= at,
      );
      if (at > now)
        items.push({
          kind: 'interview-upcoming',
          id: r.id,
          title: `${r.company} · ${r.role}`,
          detail: `Interview ${formatEastern(scheduled.occurredAt)} (${relativeTime(scheduled.occurredAt, now)})`,
        });
      else if (!completed)
        items.push({
          kind: 'interview-unrecorded',
          id: r.id,
          title: `${r.company} · ${r.role}`,
          detail: `Interview was scheduled for ${formatEastern(scheduled.occurredAt)}; outcome not recorded`,
          milestoneKind: 'interview-completed',
        });
    }
  }
  if (data.emailUpdates.pending > 0)
    items.push({
      kind: 'emails-pending',
      title: `${data.emailUpdates.pending} employer email${data.emailUpdates.pending === 1 ? '' : 's'} to confirm`,
      detail: 'Unconfirmed matches are left out of every number here until you resolve them on the Board',
    });
  if (data.emailUpdates.lastError)
    items.push({
      kind: 'email-error',
      title: 'Inbox check failed',
      detail: data.emailUpdates.lastError.message,
    });
  const { report, stale, error } = data.analysis;
  if (error)
    items.push({ kind: 'analysis-error', title: 'Last analysis failed', detail: error.message });
  else if (stale && (!report || now - (epoch(report.generatedAt) ?? 0) > ANALYSIS_OVERDUE_MS))
    items.push({
      kind: 'analysis-overdue',
      title: report ? 'AI report is out of date' : 'No AI report yet',
      detail: report
        ? `Evidence changed and the scheduled run has not caught up since ${formatEastern(report.generatedAt)}`
        : 'Run the analysis once to get hypotheses and experiments',
    });
  return items;
}
