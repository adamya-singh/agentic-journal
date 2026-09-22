import type { JobApplicationRecord, JobListing, JobApplicationsStoreData } from './types';

export const CALCULATION_VERSION = '1';
export const milestoneKinds = [
  'assessment-completed',
  'assessment-passed',
  'assessment-failed',
  'interview-scheduled',
  'interview-completed',
  'withdrawn',
] as const;
export type Milestone = {
  id: string;
  kind: (typeof milestoneKinds)[number];
  occurredAt: string;
  createdAt: string;
  source: 'manual';
  note: string;
  supersedes?: string;
};
export type SubmissionSnapshot = {
  capturedAt: string;
  reconstructed: boolean;
  timestampSource: 'automated' | 'manual-confirmation' | 'historical';
  baseline?: string;
  listing: JobListing;
  resumeVariant: string;
  resumeHash?: string;
  answers: { prompt: string; answer: string | string[] | undefined; provenance: string }[];
  evidence: JobApplicationRecord['submissionEvidence'];
  screenshots: JobApplicationRecord['screenshotCapture'];
};
export type OverviewExtras = {
  milestones: Record<string, Milestone[]>;
  groups: { id: string; listingIds: string[] }[];
};
export const epoch = (s?: string) =>
  s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : undefined;
export function duration(start?: string, end?: string) {
  const a = epoch(start),
    b = epoch(end);
  return a === undefined || b === undefined ? null : b - a;
}
export function automation(ms: number | null) {
  return ms === null || ms < -120000
    ? 'unknown'
    : ms <= 300000
      ? 'likely automated'
      : ms <= 3600000
        ? 'rapid response'
        : 'unknown';
}
export function elapsed(ms: number | null) {
  return ms === null
    ? 'Unknown'
    : ms < -120000
      ? 'Invalid chronology'
      : Math.abs(ms) <= 120000
        ? 'Around submission'
        : ms < 3600000
          ? `${Math.round(ms / 60000)} min`
          : ms < 86400000
            ? `${(ms / 3600000).toFixed(1)} hr`
            : `${(ms / 86400000).toFixed(1)} days`;
}
export function roleFamily(title: string) {
  return /machine learning|\bml\b|research|scientist/i.test(title)
    ? 'ML / Research'
    : /infra|platform|compiler|distributed/i.test(title)
      ? 'Infrastructure'
      : /\bai\b|agent/i.test(title)
        ? 'Applied AI'
        : 'Software / Other';
}
export function canonical(url: string) {
  try {
    const u = new URL(url);
    const requisition = u.pathname.match(/(?:_|\/)((?:JR|REQ|R)-?\d{4,})(?:\/|$)/i)?.[1];
    if (requisition) return `${u.hostname.toLowerCase()}/requisition/${requisition.toUpperCase()}`;
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(source|gh_src|ref|referral)$/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    const query = u.searchParams.toString();
    return (
      u.hostname.toLowerCase() +
      u.pathname.replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '') +
      (query ? `?${query}` : '')
    );
  } catch {
    return '';
  }
}
export function makeSnapshot(
  a: JobApplicationRecord,
  listing: JobListing,
  reconstructed = true,
  manual = false,
): SubmissionSnapshot {
  const reliable = !manual && !!a.submissionAttemptedAt;
  return {
    capturedAt: new Date().toISOString(),
    reconstructed,
    timestampSource: reconstructed ? 'historical' : manual ? 'manual-confirmation' : 'automated',
    baseline: reliable
      ? a.submissionAttemptedAt
      : !manual &&
          (!reconstructed || !!(a.submissionEvidence?.message || a.submissionEvidence?.url))
        ? a.submittedAt
        : undefined,
    listing: structuredClone(listing),
    resumeVariant: a.resumeOverride ?? a.resumeVariant,
    answers: a.questions.map((q) => ({
      prompt: q.prompt,
      answer: q.answer === undefined ? undefined : structuredClone(q.answer),
      provenance: q.generatedAnswer ? 'generated' : q.resolution,
    })),
    evidence: structuredClone(a.submissionEvidence),
    screenshots: structuredClone(a.screenshotCapture),
  };
}
export function overview(
  listings: JobListing[],
  store: JobApplicationsStoreData,
  extras: OverviewExtras,
  now = Date.now(),
) {
  const rows = listings.map((l) => {
    const a = store.applications[l.id];
    const snap = a?.submissionSnapshot;
    const metadata = snap?.listing ?? l;
    const submitted = !!a?.submittedAt || a?.status === 'submitted' || l.status === 'applied';
    const manual = /confirmed manually/i.test(a?.submissionEvidence?.message ?? '');
    const baseline = snap
      ? snap.baseline
      : !manual
        ? (a?.submissionAttemptedAt ??
          (a?.submissionEvidence?.message || a?.submissionEvidence?.url
            ? a.submittedAt
            : undefined))
        : undefined;
    const events = [...(a?.employerUpdates ?? [])].sort(
      (x, y) => (epoch(x.receivedAt) ?? Infinity) - (epoch(y.receivedAt) ?? Infinity),
    );
    const first = Object.fromEntries(
      ['assessment', 'interview', 'offer', 'rejected'].map((s) => [
        s,
        events.find(
          (e) =>
            e.stage === s &&
            !['assessment-reminder', 'still-reviewing'].includes(e.eventKind ?? ''),
        ),
      ]),
    );
    const ms = duration(baseline, first.assessment?.receivedAt);
    const history = extras.milestones[l.id] ?? [];
    const milestones = history.filter((m) => !history.some((n) => n.supersedes === m.id));
    return {
      id: l.id,
      company: metadata.company,
      role: metadata.positionTitle,
      location: metadata.location,
      source: metadata.source.name,
      categories: metadata.applicationCategories,
      family: roleFamily(metadata.positionTitle),
      resume: snap?.resumeVariant ?? a?.resumeVariant ?? 'Unknown',
      resumeHash: snap?.resumeHash ?? 'Unknown historical version',
      postedDate: metadata.postedDate,
      submitted,
      submittedAt: a?.submittedAt,
      baseline,
      status: a?.status ?? 'unstarted',
      events,
      first,
      assessmentMs: ms,
      automation:
        first.assessment?.automation === 'explicit' ? 'explicitly automated' : automation(ms),
      milestones,
      milestoneHistory: history,
      snapshot: snap,
      evidence: a?.submissionEvidence,
      answers:
        snap?.answers ??
        a?.questions.map((q) => ({
          prompt: q.prompt,
          answer: q.answer,
          provenance: q.resolution,
        })) ??
        [],
      url: a?.canonicalApplicationUrl ?? l.link,
      substantive: events.some((e) => e.stage && e.stage !== 'received'),
      reconstructed: !snap || snap.reconstructed,
    };
  });
  const keys = new Map<string, string[]>();
  rows
    .filter((r) => r.submitted)
    .forEach((r) => {
      const k = canonical(r.url);
      if (k) keys.set(k, [...(keys.get(k) ?? []), r.id]);
    });
  return {
    version: CALCULATION_VERSION,
    generatedAt: new Date(now).toISOString(),
    emailUpdates: {
      lastPolledAt: store.emailUpdates.lastPolledAt,
      lastError: store.emailUpdates.lastError,
      pending: store.emailUpdates.pending.length,
    },
    rows,
    duplicateCandidates: [...keys.values()].filter((ids) => ids.length > 1),
    groups: extras.groups,
  };
}
export type Overview = ReturnType<typeof overview>;
export type OverviewRow = Overview['rows'][number];
export function groupOpportunities(
  rows: OverviewRow[],
  groups: OverviewExtras['groups'],
): OverviewRow[] {
  const ids = new Set(groups.flatMap((g) => g.listingIds));
  return [
    ...rows.filter((r) => !ids.has(r.id)),
    ...groups.flatMap((g) => {
      const members = rows
        .filter((r) => g.listingIds.includes(r.id))
        .sort((a, b) => (epoch(a.baseline) ?? Infinity) - (epoch(b.baseline) ?? Infinity));
      if (!members.length) return [];
      const initial = members[0];
      const events = members
        .flatMap((r) => r.events)
        .filter(
          (e, i, all) =>
            all.findIndex((other) =>
              e.gmailMessageId ? other.gmailMessageId === e.gmailMessageId : other.id === e.id,
            ) === i,
        )
        .sort((a, b) => (epoch(a.receivedAt) ?? Infinity) - (epoch(b.receivedAt) ?? Infinity));
      const first = Object.fromEntries(
        ['assessment', 'interview', 'offer', 'rejected'].map((k) => [
          k,
          events.find(
            (e) =>
              e.stage === k &&
              !['assessment-reminder', 'still-reviewing'].includes(e.eventKind ?? ''),
          ),
        ]),
      );
      const assessmentMs = duration(initial.baseline, first.assessment?.receivedAt);
      return [
        {
          ...initial,
          events,
          first,
          assessmentMs,
          automation:
            first.assessment?.automation === 'explicit'
              ? 'explicitly automated'
              : automation(assessmentMs),
          substantive: members.some((r) => r.substantive),
          milestones: members.flatMap((r) => r.milestones),
        },
      ];
    }),
  ];
}

export function easternInput(iso: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function easternIso(input: string) {
  const guess = Date.parse(input + 'Z');
  if (!Number.isFinite(guess)) throw new Error('Enter a valid Eastern date and time');
  // Resolve Eastern wall-clock time; reject nonexistent spring-forward times.
  for (const offset of [4, 5]) {
    const iso = new Date(guess + offset * 3600000).toISOString();
    if (easternInput(iso) === input) return iso;
  }
  throw new Error('This Eastern time does not exist because of daylight saving time');
}
export function summarize(rows: OverviewRow[], windowDays = 14, now = Date.now()) {
  const submitted = rows.filter((r) => r.submitted);
  const outcomes = ['assessment', 'interview', 'offer', 'rejected'] as const;
  const counts = Object.fromEntries(
    outcomes.map((k) => [k, submitted.filter((r) => r.first[k]).length]),
  );
  const times = Object.fromEntries(
    ['assessment', 'interview', 'rejected', 'assessment-next'].map((k) => {
      const values = submitted
        .flatMap((r) => {
          const next =
            k === 'assessment-next'
              ? r.events.find(
                  (e) =>
                    ['interview', 'offer', 'rejected'].includes(e.stage ?? '') &&
                    (epoch(e.receivedAt) ?? 0) >
                      (epoch(r.first.assessment?.receivedAt) ?? Infinity),
                )
              : undefined;
          const ms = duration(
            k === 'assessment-next' ? r.first.assessment?.receivedAt : r.baseline,
            k === 'assessment-next' ? next?.receivedAt : r.first[k]?.receivedAt,
          );
          return ms !== null && ms >= -120000 ? [Math.max(0, ms)] : [];
        })
        .sort((a, b) => a - b);
      const q = (p: number) => {
        if (!values.length) return null;
        const i = (values.length - 1) * p;
        return values[Math.floor(i)] + (values[Math.ceil(i)] - values[Math.floor(i)]) * (i % 1);
      };
      return [k, { n: values.length, q1: q(0.25), median: q(0.5), q3: q(0.75) }];
    }),
  );
  const eligible = submitted.filter(
    (r) => epoch(r.baseline) !== undefined && now - epoch(r.baseline)! >= windowDays * 86400000,
  );
  const dimensions = [
    'resume',
    'resumeHash',
    'family',
    'location',
    'source',
    'category',
    'posting-delay',
  ] as const;
  const comparisons = dimensions.flatMap((d) => {
    const value = (r: OverviewRow) =>
      d === 'category'
        ? r.categories.join(', ') || 'Unknown'
        : d === 'posting-delay'
          ? (() => {
              const t = duration(r.postedDate, r.baseline);
              return t === null || t < 0
                ? 'Unknown'
                : t <= 7 * 86400000
                  ? 'Within 7 days'
                  : 'After 7 days';
            })()
          : r[d];
    return [...new Set(eligible.map(value))].map((v) => {
      const group = eligible.filter((r) => value(r) === v);
      return {
        dimension: d,
        value: v,
        n: group.length,
        ids: group.map((r) => r.id),
        outcomes: Object.fromEntries(
          outcomes.map((k) => [
            k,
            group.filter((r) => {
              const t = duration(r.baseline, r.first[k]?.receivedAt);
              return t !== null && t >= -120000 && t <= windowDays * 86400000;
            }).length,
          ]),
        ),
      };
    });
  });
  return {
    submitted: submitted.length,
    counts,
    awaiting: submitted.filter(
      (r) => !r.substantive && !r.milestones.some((m) => m.kind === 'withdrawn'),
    ).length,
    closed: rows.filter((r) => !r.submitted && r.status === 'closed').length,
    times,
    comparisons,
    eligible: eligible.length,
    unknownTiming: submitted.filter((r) => !r.baseline).length,
    reconstructed: submitted.filter((r) => r.reconstructed).length,
  };
}

export function observedPatterns(stats: ReturnType<typeof summarize>) {
  const interval = (hits: number, n: number) => {
    const z = 1.96,
      p = hits / n,
      den = 1 + (z * z) / n,
      center = (p + (z * z) / (2 * n)) / den,
      spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
    return [Math.max(0, center - spread), Math.min(1, center + spread)];
  };
  const patterns = stats.comparisons.flatMap((a, i) =>
    stats.comparisons.slice(i + 1).flatMap((b) => {
      if (
        a.dimension !== b.dimension ||
        a.n < 10 ||
        b.n < 10 ||
        a.value.includes('Unknown') ||
        b.value.includes('Unknown')
      )
        return [];
      return ['assessment', 'interview', 'offer', 'rejected']
        .filter((k) => a.outcomes[k] + b.outcomes[k] >= 5)
        .map((k) => ({
          dimension: a.dimension,
          outcome: k,
          a,
          b,
          difference: a.outcomes[k] / a.n - b.outcomes[k] / b.n,
          aInterval: interval(a.outcomes[k], a.n),
          bInterval: interval(b.outcomes[k], b.n),
        }));
    }),
  );
  return patterns.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).slice(0, 3);
}
