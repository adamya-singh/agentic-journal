'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { JobsNavigation } from '@/components/JobsNavigation';
import {
  elapsed,
  groupOpportunities,
  easternInput,
  easternIso,
  epoch,
  milestoneKinds,
  summarize,
  observedPatterns,
  type Overview,
  type OverviewRow,
} from '@/lib/job-overview';

type Analysis = {
  report: null | {
    generatedAt: string;
    cutoff: string;
    model: string;
    insights: {
      kind: string;
      text: string;
      limitations: string;
      applicationIds: string[];
      eventIds: string[];
    }[];
  };
  stale: boolean;
  error: null | { message: string };
};
type Data = Overview & { analysis: Analysis };
const date = (s?: string) =>
  s
    ? new Date(s).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Unknown';
const day = (s?: string) =>
  s
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(s))
    : '';
const control =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800';
const button = control + ' hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-gray-200 dark:border-gray-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {headers.map((h) => (
              <th key={h} className="p-3 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">{children}</tbody>
      </table>
    </div>
  );
}
function Cell({ children }: { children: React.ReactNode }) {
  return <td className="p-3 align-top">{children}</td>;
}

export default function JobsOverview() {
  const [data, setData] = useState<Data>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [period, setPeriod] = useState('all'),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [search, setSearch] = useState(''),
    [company, setCompany] = useState(''),
    [family, setFamily] = useState(''),
    [category, setCategory] = useState(''),
    [resume, setResume] = useState(''),
    [outcome, setOutcome] = useState(''),
    [auto, setAuto] = useState(''),
    [windowDays, setWindowDays] = useState(14),
    [sort, setSort] = useState('recent'),
    [selected, setSelected] = useState<string>(),
    [drill, setDrill] = useState<string[] | null>(null),
    [unique, setUnique] = useState(false);
  const [kind, setKind] = useState<(typeof milestoneKinds)[number]>('assessment-completed'),
    [when, setWhen] = useState(''),
    [note, setNote] = useState(''),
    [correct, setCorrect] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs/overview', { cache: 'no-store' });
      if (!r.ok) throw new Error('Could not load overview');
      setData(await r.json());
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    const id = setInterval(refresh, 60000);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (selected) {
      opener.current = document.activeElement as HTMLElement;
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
      opener.current?.focus();
    }
  }, [selected]);
  useEffect(() => {
    if (drill) document.getElementById('explorer')?.scrollIntoView({ behavior: 'smooth' });
  }, [drill]);
  function saveMilestone(listingId: string) {
    try {
      void mutate({
        action: 'milestone',
        listingId,
        kind,
        occurredAt: easternIso(when),
        note,
        ...(correct ? { supersedes: correct } : {}),
      });
    } catch (e) {
      setError(String(e));
    }
  }
  async function mutate(body: unknown) {
    setBusy(true);
    try {
      const r = await fetch('/api/jobs/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await load();
      setCorrect('');
      setNote('');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    setBusy(true);
    try {
      const r = await fetch('/api/jobs/overview/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const rows = useMemo(() => {
    let all = data?.rows ?? [];
    if (unique && data) all = groupOpportunities(all, data.groups);
    return all.filter((r) => {
      const submittedDay = day(r.submittedAt);
      const lower =
        period === 'custom'
          ? start
          : period === 'all'
            ? ''
            : day(new Date(Date.now() - Number(period) * 86400000).toISOString());
      return (
        (!lower || submittedDay >= lower) &&
        (!(period === 'custom' && end) || submittedDay <= end) &&
        (!company || r.company === company) &&
        (!family || r.family === family) &&
        (!category || r.categories.includes(category as never)) &&
        (!resume || r.resume === resume) &&
        (!auto || r.automation === auto) &&
        (!search || `${r.company} ${r.role}`.toLowerCase().includes(search.toLowerCase())) &&
        (!outcome ||
          (outcome === 'awaiting'
            ? !r.substantive && r.submitted && !r.milestones.some((m) => m.kind === 'withdrawn')
            : outcome === 'closed'
              ? !r.submitted && r.status === 'closed'
              : !!r.first[outcome]))
      );
    });
  }, [data, period, start, end, company, family, category, resume, auto, search, outcome, unique]);
  const stats = useMemo(() => summarize(rows, windowDays), [rows, windowDays]);
  const visible = rows
    .filter((r) => !drill || drill.includes(r.id))
    .sort((a, b) =>
      sort === 'company'
        ? a.company.localeCompare(b.company)
        : sort === 'response'
          ? (a.assessmentMs ?? Infinity) - (b.assessmentMs ?? Infinity)
          : (epoch(b.submittedAt) ?? 0) - (epoch(a.submittedAt) ?? 0),
    );
  const active = data?.rows.find((r) => r.id === selected);
  const history = Object.entries(
    rows
      .filter((r) => r.submitted && r.submittedAt)
      .reduce<Record<string, OverviewRow[]>>((acc, r) => {
        const key = day(r.submittedAt);
        (acc[key] ??= []).push(r);
        return acc;
      }, {}),
  ).sort(([a], [b]) => b.localeCompare(a));
  const responseHistory = Object.entries(
    rows.reduce<Record<string, { id: string; stage: string }[]>>((acc, r) => {
      for (const e of r.events) {
        if (!e.stage || e.stage === 'received') continue;
        const key = day(e.receivedAt);
        (acc[key] ??= []).push({ id: r.id, stage: e.stage });
      }
      return acc;
    }, {}),
  ).sort(([a], [b]) => b.localeCompare(a));
  const open = (id: string) => {
    setCorrect('');
    setSelected(id);
  };
  const select = (label: string, value: string, set: (s: string) => void, values: string[]) => (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <select
        className={control}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setDrill(null);
        }}
      >
        <option value="">All</option>
        {[...new Set(values)].sort().map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader
        title="Job applications overview"
        subtitle="Outcomes, response times, and evidence"
      />
      <main className="max-w-7xl mx-auto px-4 py-5 space-y-8">
        <JobsNavigation />
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs flex flex-col gap-1">
            Submission period
            <select
              className={control}
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setDrill(null);
              }}
            >
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {period === 'custom' && (
            <>
              <label>
                From{' '}
                <input
                  type="date"
                  className={control}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                Through{' '}
                <input
                  type="date"
                  className={control}
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </>
          )}
          <button className={button} onClick={() => void load()}>
            Refresh
          </button>
          <label className="text-sm">
            <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />{' '}
            Count confirmed unique opportunities
          </label>
        </div>
        <p className="text-sm text-gray-500">
          Dates in Eastern time · Email check: {date(data?.emailUpdates.lastPolledAt)} ·{' '}
          {data?.emailUpdates.pending ?? 0} unresolved matches excluded.{' '}
          {data?.emailUpdates.lastError && (
            <span role="alert">Email checker: {data.emailUpdates.lastError.message}</span>
          )}
        </p>
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        {!data && <p role="status">Loading application data…</p>}
        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {[
                ['Submitted', stats.submitted, 'submitted'],
                ['Assessments', stats.counts.assessment, 'assessment'],
                ['Interviews', stats.counts.interview, 'interview'],
                ['Offers', stats.counts.offer, 'offer'],
                ['Rejections', stats.counts.rejected, 'rejected'],
                ['Awaiting response', stats.awaiting, 'awaiting'],
                ['Closed before submit', stats.closed, 'closed'],
              ].map(([label, count, key]) => (
                <button
                  key={key}
                  className="border rounded-lg p-4 text-left hover:border-indigo-500 dark:border-gray-700"
                  onClick={() =>
                    setDrill(
                      rows
                        .filter((r) =>
                          key === 'submitted'
                            ? r.submitted
                            : key === 'awaiting'
                              ? r.submitted &&
                                !r.substantive &&
                                !r.milestones.some((m) => m.kind === 'withdrawn')
                              : key === 'closed'
                                ? !r.submitted && r.status === 'closed'
                                : !!r.first[key],
                        )
                        .map((r) => r.id),
                    )
                  }
                >
                  <div className="text-2xl font-semibold">{count}</div>
                  <div className="text-xs text-gray-500 mt-1">{label}</div>
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Outcomes mean ever reached, and can overlap. Silence is not rejection.{' '}
              {stats.unknownTiming} submitted records lack a reliable timing baseline;{' '}
              {stats.reconstructed} have reconstructed or missing submission snapshots.
            </p>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Response times</h2>
              <p className="text-sm text-gray-500">
                Conditional on observed responses with reliable timestamps; unanswered applications
                are not included.
              </p>
              <Table
                headers={['Interval', 'Responses', '25th percentile', 'Median', '75th percentile']}
              >
                {Object.entries(stats.times).map(([k, v]) => (
                  <tr key={k}>
                    <Cell>
                      {k === 'assessment-next' ? 'Assessment → next stage' : `Application → ${k}`}
                    </Cell>
                    <Cell>{v.n}</Cell>
                    <Cell>{elapsed(v.q1)}</Cell>
                    <Cell>{elapsed(v.median)}</Cell>
                    <Cell>{elapsed(v.q3)}</Cell>
                  </tr>
                ))}
              </Table>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Assessments</h2>
              <p className="text-sm text-gray-500">
                Timing rule v1: ≤5 minutes suggests automation; 5–60 minutes is a rapid response
                with uncertain automation. Slower responses do not establish human review. ±2
                minutes is shown as around submission.
              </p>
              <Table
                headers={[
                  'Application',
                  'Invitation / speed',
                  'Automation',
                  'Details',
                  'Milestones / subsequent outcomes',
                ]}
              >
                {rows
                  .filter((r) => r.first.assessment)
                  .map((r) => (
                    <tr key={r.id}>
                      <Cell>
                        <button
                          className="text-indigo-600 dark:text-indigo-300 text-left"
                          onClick={() => open(r.id)}
                        >
                          {r.company}
                          <br />
                          {r.role}
                        </button>
                      </Cell>
                      <Cell>
                        {date(r.first.assessment?.receivedAt)}
                        <br />
                        {elapsed(r.assessmentMs)}
                      </Cell>
                      <Cell>
                        {r.automation}
                        <br />
                        <span className="text-xs">
                          {r.automation === 'likely automated' ? 'Timing suggests this' : ''}
                        </span>
                      </Cell>
                      <Cell>
                        {r.first.assessment?.provider ?? 'Provider unknown'} ·{' '}
                        {r.first.assessment?.assessmentType ?? 'Type unknown'}
                        <br />
                        Due: {date(r.first.assessment?.deadline)}
                      </Cell>
                      <Cell>
                        {r.milestones.map((m) => m.kind).join(', ') || 'Completion not recorded'}
                        <br />
                        {['interview', 'offer', 'rejected']
                          .filter(
                            (k) =>
                              r.first[k] &&
                              (epoch(r.first[k]?.receivedAt) ?? 0) >=
                                (epoch(r.first.assessment?.receivedAt) ?? Infinity),
                          )
                          .join(', ') || 'No subsequent outcome recorded'}
                      </Cell>
                    </tr>
                  ))}
              </Table>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Outcome comparisons</h2>
              <label className="text-sm">
                Observation window{' '}
                <select
                  className={control}
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value))}
                >
                  {[7, 14, 30].map((n) => (
                    <option key={n} value={n}>
                      {n} days
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-gray-500">
                {stats.eligible} mature applications eligible. Each rate is an outcome within this
                window / applications observed for at least this long. Associations do not establish
                causes; role, company, timing, and resume selection can confound comparisons.
                Unknown values remain visible.
              </p>
              <details>
                <summary className="cursor-pointer text-indigo-600 dark:text-indigo-300">
                  Compare resume, role, location, source, category, and posting delay
                </summary>
                <Table
                  headers={[
                    'Dimension',
                    'Group',
                    'Eligible',
                    'Assessment',
                    'Interview',
                    'Offer',
                    'Rejection',
                  ]}
                >
                  {stats.comparisons.map((c) => (
                    <tr key={c.dimension + c.value}>
                      <Cell>{c.dimension}</Cell>
                      <Cell>
                        <button
                          className="text-indigo-600 dark:text-indigo-300 text-left"
                          onClick={() => setDrill(c.ids)}
                        >
                          {c.value}
                        </button>
                      </Cell>
                      <Cell>{c.n}</Cell>
                      {['assessment', 'interview', 'offer', 'rejected'].map((k) => (
                        <Cell key={k}>
                          {c.outcomes[k]}/{c.n} ({Math.round((c.outcomes[k] / c.n) * 100)}%)
                        </Cell>
                      ))}
                    </tr>
                  ))}
                </Table>
              </details>
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Evidence and explanations</h2>
              {observedPatterns(stats).map((p) => (
                <article
                  key={p.dimension + p.outcome + p.a.value + p.b.value}
                  className="border-l-2 border-gray-300 pl-4 text-sm"
                >
                  <p className="font-medium">
                    Observed association · {p.dimension} / {p.outcome}
                  </p>
                  <p>
                    {p.a.value}: {p.a.outcomes[p.outcome]}/{p.a.n} versus {p.b.value}:{' '}
                    {p.b.outcomes[p.outcome]}/{p.b.n} within {windowDays} days.
                  </p>
                  <p className="text-gray-500">
                    95% rate intervals:{' '}
                    {p.aInterval.map((v) => `${Math.round(v * 100)}%`).join('–')} versus{' '}
                    {p.bInterval.map((v) => `${Math.round(v * 100)}%`).join('–')}. Exploratory
                    comparison; company, role, timing, and selection may explain differences. Not a
                    causal finding.
                  </p>
                  <button
                    className="text-indigo-600 dark:text-indigo-300"
                    onClick={() => setDrill([...p.a.ids, ...p.b.ids])}
                  >
                    Inspect supporting applications
                  </button>
                </article>
              ))}
              <p className="text-sm text-gray-500">
                Employer-stated reasons appear below. Generic rejection emails mean reason not
                provided. AI hypotheses are not established causes.
              </p>
              {rows
                .filter((r) => r.first.rejected)
                .map((r) => (
                  <p key={r.id} className="text-sm">
                    <button
                      className="text-indigo-600 dark:text-indigo-300"
                      onClick={() => open(r.id)}
                    >
                      {r.company} · {r.role}
                    </button>
                    : {r.first.rejected?.outcomeReason ?? 'Reason not provided'}{' '}
                    {r.first.rejected?.supportingParaphrase && (
                      <span>— {r.first.rejected.supportingParaphrase}</span>
                    )}
                  </p>
                ))}
              <button className={button} disabled={busy} onClick={() => void analyze()}>
                {busy ? 'Working…' : 'Analyze now'}
              </button>
              <p className="text-xs text-gray-500">
                Daily at 9 AM Eastern when evidence changes. Analysis covers all records, regardless
                of filters. Generated: {date(data.analysis.report?.generatedAt)} · Cutoff:{' '}
                {date(data.analysis.report?.cutoff)} ·{' '}
                {data.analysis.stale ? 'Needs refresh' : 'Current'}
                {data.analysis.error && ` · ${data.analysis.error.message}`}
              </p>
              {data.analysis.report?.insights.map((i, index) => (
                <article key={index} className="border-l-2 border-indigo-400 pl-4 py-2">
                  <p className="text-xs uppercase text-gray-500">{i.kind}</p>
                  <p>{i.text}</p>
                  <p className="text-sm text-gray-500">{i.limitations}</p>
                  <div className="flex gap-3 flex-wrap">
                    {i.applicationIds.map((id) => (
                      <button
                        key={id}
                        className="text-sm text-indigo-600 dark:text-indigo-300"
                        onClick={() => open(id)}
                      >
                        {data.rows.find((r) => r.id === id)?.company}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Activity history</h2>
              <p className="text-xs text-gray-500">
                Submission dates and employer receipt dates for the selected application cohort;
                repeated employer messages are counted as events.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <details>
                  <summary>Submissions by day</summary>
                  <Table headers={['Date (Eastern)', 'Applications']}>
                    {history.map(([d, rs]) => (
                      <tr key={d}>
                        <Cell>{d}</Cell>
                        <Cell>
                          <button
                            className="text-indigo-600"
                            onClick={() => setDrill(rs.map((r) => r.id))}
                          >
                            {rs.length}
                          </button>
                        </Cell>
                      </tr>
                    ))}
                  </Table>
                </details>
                <details>
                  <summary>Employer responses by day</summary>
                  <Table headers={['Date (Eastern)', 'Events']}>
                    {responseHistory.map(([d, es]) => (
                      <tr key={d}>
                        <Cell>{d}</Cell>
                        <Cell>
                          <button
                            className="text-indigo-600"
                            onClick={() => setDrill(es.map((e) => e.id))}
                          >
                            {es.length}: {es.map((e) => e.stage).join(', ')}
                          </button>
                        </Cell>
                      </tr>
                    ))}
                  </Table>
                </details>
              </div>
            </section>
            {(data.duplicateCandidates.length > 0 || data.groups.length > 0) && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Potential duplicate opportunities</h2>
                <p className="text-sm text-gray-500">
                  Matching canonical application URLs are candidates, not confirmed duplicates.
                  Recorded applications are counted separately by default.
                </p>
                {data.duplicateCandidates.map((ids, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      {ids.map((id) => data.rows.find((r) => r.id === id)?.company).join(' / ')} —{' '}
                      {ids.length} records
                    </span>
                    {ids.map((id) => (
                      <button key={id} className="text-indigo-600" onClick={() => open(id)}>
                        {data.rows.find((r) => r.id === id)?.role}
                      </button>
                    ))}
                    <button
                      className={button}
                      disabled={
                        busy || data.groups.some((g) => g.listingIds.some((id) => ids.includes(id)))
                      }
                      onClick={() => void mutate({ action: 'group', listingIds: ids })}
                    >
                      Confirm same opportunity
                    </button>
                  </div>
                ))}
                {data.groups.map((g) => (
                  <p key={g.id}>
                    Confirmed group:{' '}
                    {g.listingIds
                      .map((id) => data.rows.find((r) => r.id === id)?.company)
                      .join(', ')}{' '}
                    <button
                      className={button}
                      onClick={() => void mutate({ action: 'ungroup', id: g.id })}
                    >
                      Undo grouping
                    </button>
                  </p>
                ))}
              </section>
            )}
            <section id="explorer" className="space-y-4">
              <h2 className="text-lg font-semibold">Application explorer</h2>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-xs gap-1">
                  Search
                  <input
                    className={control}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Company or role"
                  />
                </label>
                {select(
                  'Company',
                  company,
                  setCompany,
                  data.rows.map((r) => r.company),
                )}
                {select(
                  'Role family',
                  family,
                  setFamily,
                  data.rows.map((r) => r.family),
                )}
                {select(
                  'Category',
                  category,
                  setCategory,
                  data.rows.flatMap((r) => r.categories),
                )}
                {select(
                  'Resume',
                  resume,
                  setResume,
                  data.rows.map((r) => r.resume),
                )}
                {select('Outcome', outcome, setOutcome, [
                  'assessment',
                  'interview',
                  'offer',
                  'rejected',
                  'awaiting',
                  'closed',
                ])}
                {select('Automation', auto, setAuto, [
                  'likely automated',
                  'rapid response',
                  'explicitly automated',
                  'unknown',
                ])}
                <label className="flex flex-col text-xs gap-1">
                  Sort
                  <select
                    className={control}
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="recent">Latest submitted</option>
                    <option value="company">Company</option>
                    <option value="response">Fastest assessment</option>
                  </select>
                </label>
              </div>
              {drill && (
                <button className={button} onClick={() => setDrill(null)}>
                  Clear drill-down
                </button>
              )}
              <p className="text-sm">{visible.length} records</p>
              <Table
                headers={[
                  'Application',
                  'Submitted (Eastern)',
                  'Resume',
                  'Employer outcomes',
                  'Status',
                ]}
              >
                {visible.map((r) => (
                  <tr key={r.id}>
                    <Cell>
                      <button
                        className="text-indigo-600 dark:text-indigo-300 text-left"
                        onClick={() => open(r.id)}
                      >
                        {r.company}
                        <br />
                        {r.role}
                      </button>
                    </Cell>
                    <Cell>{date(r.submittedAt)}</Cell>
                    <Cell>
                      {r.resume}
                      <br />
                      <span className="text-xs text-gray-500">
                        {r.reconstructed ? 'Reconstructed metadata' : 'Captured at submission'}
                      </span>
                    </Cell>
                    <Cell>
                      {Object.keys(r.first)
                        .filter((k) => r.first[k])
                        .join(', ') || 'None recorded'}
                    </Cell>
                    <Cell>{r.status}</Cell>
                  </tr>
                ))}
              </Table>
            </section>
          </>
        )}
      </main>
      <dialog
        ref={dialog}
        onCancel={() => setSelected(undefined)}
        onClose={() => setSelected(undefined)}
        className="w-[min(900px,95vw)] max-h-[90vh] rounded-xl p-6 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 backdrop:bg-black/50"
      >
        {active && (
          <div className="space-y-5">
            {error && (
              <p role="alert" className="text-red-600">
                {error}
              </p>
            )}
            <div className="flex justify-between gap-4">
              <h2 className="text-xl font-semibold">
                {active.company} · {active.role}
              </h2>
              <button className={button} onClick={() => setSelected(undefined)}>
                Close
              </button>
            </div>
            <p>
              Submitted: {date(active.submittedAt)} · Timing baseline: {date(active.baseline)}
            </p>
            <p className="text-sm text-gray-500">
              {active.snapshot?.timestampSource ?? 'Historical record'} ·{' '}
              {active.reconstructed
                ? 'Reconstructed; exact historical contents may be unavailable'
                : 'Immutable submission snapshot'}{' '}
              · Resume hash: {active.resumeHash}
            </p>
            <p>{active.evidence?.message}</p>
            <h3 className="font-semibold">Employer timeline</h3>
            {active.events.map((e) => (
              <div key={e.id} className="border-l pl-3">
                <p>
                  {date(e.receivedAt)} · {e.stage ?? e.eventKind}
                </p>
                <p>{e.summary}</p>
                <p className="text-xs text-gray-500">
                  Recorded {date(e.appliedAt)} · Evidence {e.id}
                </p>
              </div>
            ))}
            <h3 className="font-semibold">Milestones</h3>
            {active.milestones.map((m) => (
              <p key={m.id}>
                {date(m.occurredAt)} · {m.kind} · {m.note}{' '}
                <button
                  className="text-indigo-600"
                  onClick={() => {
                    setCorrect(m.id);
                    setKind(m.kind);
                    setNote(m.note);
                    setWhen(easternInput(m.occurredAt));
                  }}
                >
                  Correct
                </button>
              </p>
            ))}
            <form
              className="flex flex-wrap gap-3 items-end"
              onSubmit={(e) => {
                e.preventDefault();
                saveMilestone(active.id);
              }}
            >
              <label className="text-xs flex flex-col gap-1">
                Milestone
                <select
                  className={control}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  {milestoneKinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs flex flex-col gap-1">
                Event time (Eastern; repeated fall hour uses EDT)
                <input
                  required
                  className={control}
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                />
              </label>
              <label className="text-xs flex flex-col gap-1">
                Note
                <input
                  maxLength={500}
                  className={control}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <button className={button} disabled={busy}>
                {correct ? 'Save correction' : 'Add milestone'}
              </button>
            </form>
            <details>
              <summary>Correction history</summary>
              {active.milestoneHistory.map((m) => (
                <p key={m.id}>
                  {m.kind} · entered {date(m.createdAt)} {m.supersedes ? '(correction)' : ''}
                </p>
              ))}
            </details>
            <details>
              <summary>Submitted answers ({active.answers.length})</summary>
              {active.answers.map((q, i) => (
                <div key={i} className="my-3">
                  <p className="font-medium">{q.prompt}</p>
                  <p className="whitespace-pre-wrap break-words">
                    {Array.isArray(q.answer) ? q.answer.join(', ') : (q.answer ?? 'Not recorded')}
                  </p>
                  <p className="text-xs text-gray-500">{q.provenance}</p>
                </div>
              ))}
            </details>
            {active.snapshot?.screenshots?.screenshots.map((s) => (
              <p key={s.id} className="text-sm">
                <a
                  className="text-indigo-600"
                  href={`/api/jobs/applications/screenshots/${active.id}/${s.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Screenshot: {s.label} · page {s.pageNumber} · {date(s.capturedAt)}
                </a>
              </p>
            ))}
          </div>
        )}
      </dialog>
    </div>
  );
}
