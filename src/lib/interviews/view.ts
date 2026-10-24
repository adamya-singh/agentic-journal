import type { Milestone } from '@/lib/job-overview';
import type { JobApplicationRecord, JobEmployerUpdate, JobListing } from '@/lib/types';
import { seasonFor } from './store';
import type {
  CasebookView, InterviewProcess, InterviewsIndex, NoteView, ProcessView, RoundKind, RoundView,
  StoredRound, TimelineKind,
} from './types';

// Pure: builds what the Interviews page shows from the casebook index plus live
// Jobs data. Rounds for a Jobs process are derived from employer emails and
// overview milestones; anything stored under the same round id overrides them.

const DAY = 864e5;
/** A round that ended this recently with no notes asks to be written up. */
export const CAPTURE_WINDOW_MS = 3 * DAY;
const HEARD_BACK = new Set(['assessment', 'interview', 'offer', 'rejected']);
const NOT_A_PERSON = /\b(team|hiring|recruit(ing|ment)?|careers?|talent|no-?reply|notifications?|jobs|people ops|university)\b/i;
const OUTCOME_LABEL = { offer: 'Offer', rejected: 'Rejected', 'no-reply': 'No reply', withdrawn: 'Withdrawn' } as const;

const epoch = (iso?: string) => {
  if (!iso) return NaN;
  return Date.parse(iso.length === 10 ? `${iso}T12:00:00-05:00` : iso);
};

export function kindFromName(name: string): RoundKind {
  if (/recruit|intro|screen|chat|phone|hr\b/i.test(name)) return 'screen';
  if (/assessment|\boa\b|hackerrank|codesignal|coderpad oa|challenge/i.test(name)) return 'oa';
  if (/\bml\b|machine learning|breadth/i.test(name)) return 'ml';
  if (/behaviou?ral/i.test(name)) return 'behav';
  if (/onsite|on-site|final|super ?day/i.test(name)) return 'onsite';
  if (/cod|leet|technical|system design|tech/i.test(name)) return 'tech';
  return 'other';
}

/** "Michelle Galan <michelle@roadrunner.ai>" → a person; "Roadrunner Hiring Team <no-reply@…>" → nobody. */
export function senderPerson(from?: string): { name: string; email?: string } | undefined {
  if (!from) return undefined;
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>/);
  const name = match?.[1]?.trim();
  const email = match?.[2]?.trim();
  if (!name || NOT_A_PERSON.test(name) || /no-?reply|notifications?@/i.test(email ?? '')) return undefined;
  if (!/^[A-Z][\p{L}'’.-]+(\s+[A-Z][\p{L}'’.-]+)+$/u.test(name)) return undefined;
  return { name, email };
}

function timelineEvent(update: JobEmployerUpdate): ProcessView['events'][number] {
  const base = { at: update.receivedAt, summary: update.summary, from: update.from };
  if (update.eventKind === 'assessment-reminder') return { ...base, kind: 'note', label: 'Assessment reminder' };
  if (update.eventKind === 'still-reviewing') return { ...base, kind: 'note', label: 'Still reviewing' };
  switch (update.stage) {
    case 'received': return { ...base, kind: 'received', label: 'Application received' };
    case 'assessment': return { ...base, kind: 'oa', label: update.assessmentType || 'Online assessment invite' };
    case 'interview': return { ...base, kind: 'invite', label: update.interviewRound || 'Interview invite' };
    case 'offer': return { ...base, kind: 'offer', label: 'Offer' };
    case 'rejected': return { ...base, kind: 'rejected', label: update.outcomeReason ? `Rejected · ${update.outcomeReason}` : 'Rejected' };
    default: return { ...base, kind: 'note', label: update.subject || 'Email' };
  }
}

interface DerivedRound extends RoundView { lastEventAt?: number }

/** OA and interview rounds a Jobs process has been through, from its emails and milestones. */
export function deriveRounds(updates: JobEmployerUpdate[], milestones: Milestone[]): DerivedRound[] {
  const sorted = [...updates].sort((a, b) => epoch(a.receivedAt) - epoch(b.receivedAt));
  const rounds: DerivedRound[] = [];
  for (const u of sorted) {
    if (u.stage !== 'assessment' || u.eventKind === 'assessment-reminder') continue;
    const done = milestones.some((m) => m.kind.startsWith('assessment-') && epoch(m.occurredAt) >= epoch(u.receivedAt));
    rounds.push({
      id: `oa-${u.id}`, name: u.assessmentType || 'Online assessment', kind: 'oa', at: u.receivedAt,
      people: [], state: done ? 'done' : 'unrecorded', noteIds: [],
      note: u.deadline ? `Due ${new Date(u.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}` : undefined,
    });
  }
  // Interview emails and "scheduled" milestones in time order. Emails before a round's
  // booked time belong to it; the first one after that time starts the next round.
  type Item = { t: number; u?: JobEmployerUpdate; m?: Milestone };
  const items: Item[] = [
    ...sorted.filter((u) => u.stage === 'interview').map((u) => ({ t: epoch(u.receivedAt), u })),
    ...milestones.filter((m) => m.kind === 'interview-scheduled').map((m) => ({ t: epoch(m.createdAt), m })),
  ].sort((a, b) => a.t - b.t);
  let current: DerivedRound | undefined;
  for (const item of items) {
    const past = current?.at && item.t > epoch(current.at) + 3600e3;
    if (item.u) {
      const u = item.u;
      if (!current || past) {
        current = { id: `int-${u.id}`, name: u.interviewRound || 'Interview', kind: 'other', people: [], state: 'unscheduled', invitedAt: u.receivedAt, noteIds: [] };
        rounds.push(current);
      } else if (u.interviewRound) current.name = u.interviewRound;
      const person = senderPerson(u.from);
      if (person && !current.people.includes(person.name)) current.people.push(person.name);
      current.lastEventAt = item.t;
    } else if (item.m) {
      if (!current || past || current.at) {
        current = { id: `ms-${item.m.id}`, name: item.m.note || 'Interview', kind: 'other', people: [], state: 'unscheduled', noteIds: [] };
        rounds.push(current);
      }
      current.at = item.m.occurredAt;
    }
  }
  for (const r of rounds) if (r.kind === 'other') r.kind = kindFromName(r.name);
  return rounds;
}

function overlay(rounds: RoundView[], stored: StoredRound[]): RoundView[] {
  const byId = new Map(stored.map((s) => [s.id, s]));
  const merged = rounds.map((r) => {
    const s = byId.get(r.id);
    return s ? { ...r, ...dropUndefined(s), people: s.people ?? r.people, kind: s.kind ?? (s.name ? kindFromName(s.name) : r.kind) } : r;
  });
  for (const s of stored) {
    if (!rounds.some((r) => r.id === s.id)) {
      merged.push({ id: s.id, name: s.name ?? 'Round', kind: s.kind ?? kindFromName(s.name ?? ''), at: s.at, time: s.time, duration: s.duration, people: s.people ?? [], format: s.format, note: s.note, cancelled: s.cancelled, state: 'done', noteIds: [] } as RoundView);
    }
  }
  return merged;
}

const dropUndefined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;

function settleStates(rounds: RoundView[], notes: NoteView[], now: number): RoundView[] {
  return rounds
    .map((r) => {
      const noteIds = notes.filter((n) => n.round === r.id && !n.draft).map((n) => n.id);
      let state = r.state;
      if ((r as RoundView & { cancelled?: boolean }).cancelled) state = 'cancelled';
      else if (r.kind === 'oa') state = r.state === 'unrecorded' && !noteIds.length ? 'unrecorded' : 'done';
      else if (r.at) {
        const t = epoch(r.at);
        if (t > now) state = 'upcoming';
        else state = !noteIds.length && now - t < CAPTURE_WINDOW_MS ? 'capture' : 'done';
      } else if (r.state === 'unscheduled') state = 'unscheduled';
      return { ...r, state, noteIds };
    })
    .sort((a, b) => (epoch(a.at ?? a.invitedAt) || 0) - (epoch(b.at ?? b.invitedAt) || 0));
}

export function reachOf(view: Pick<ProcessView, 'outcome' | 'rounds'>): number {
  if (view.outcome.kind === 'offer') return 1;
  const live = view.rounds.filter((r) => !['cancelled', 'unscheduled', 'upcoming'].includes(r.state));
  const oa = live.some((r) => r.kind === 'oa') ? 1 : 0;
  const calls = live.filter((r) => r.kind !== 'oa').length;
  return Math.min(0.92, 0.12 + oa * 0.12 + calls * 0.17);
}

function noteViews(stored: InterviewProcess | undefined): NoteView[] {
  return (stored?.notes ?? []).map(({ importedFrom, ...n }) => {
    const { file, ...rest } = n;
    void file;
    return { ...rest, ...(importedFrom ? { path: importedFrom } : {}) };
  });
}

function mergePeople(...lists: { name: string; role?: string; email?: string }[][]) {
  const out: { name: string; role?: string; email?: string }[] = [];
  for (const list of lists) for (const p of list) {
    const found = out.find((o) => o.name.toLowerCase() === p.name.toLowerCase());
    if (found) Object.assign(found, { ...dropUndefined(p), ...dropUndefined(found) });
    else out.push({ ...p });
  }
  return out;
}

export function jobsProcess(
  listing: JobListing,
  app: JobApplicationRecord | undefined,
  milestones: Milestone[],
  stored: InterviewProcess | undefined,
  index: InterviewsIndex,
  now: number,
): ProcessView {
  const updates = [...(app?.employerUpdates ?? [])].sort((a, b) => epoch(a.receivedAt) - epoch(b.receivedAt));
  const appliedAt = app?.submittedAt ?? app?.submissionAttemptedAt;
  const events: ProcessView['events'] = [
    ...(appliedAt ? [{ at: appliedAt, kind: 'applied' as TimelineKind, label: 'Applied' }] : []),
    ...updates.map(timelineEvent),
    ...milestones.filter((m) => m.kind === 'interview-scheduled').map((m) => ({ at: m.occurredAt, kind: 'screen' as TimelineKind, label: m.note || 'Interview' })),
  ].sort((a, b) => epoch(a.at) - epoch(b.at));
  const notes = noteViews(stored);
  const rounds = settleStates(overlay(deriveRounds(updates, milestones), stored?.rounds ?? []), notes, now);
  const rejected = updates.findLast((u) => u.stage === 'rejected');
  const stage = app?.employerStage;
  const outcome: ProcessView['outcome'] = stored?.outcome
    ? { kind: stored.outcome.kind, label: OUTCOME_LABEL[stored.outcome.kind], at: stored.outcome.at, note: stored.outcome.note }
    : stage === 'offer'
      ? { kind: 'offer', label: 'Offer', at: updates.findLast((u) => u.stage === 'offer')?.receivedAt }
      : stage === 'rejected'
        ? { kind: 'rejected', label: 'Rejected', at: rejected?.receivedAt, note: rejected?.outcomeReason }
        : { kind: 'open', label: stage === 'interview' ? 'Interviewing' : stage === 'assessment' ? 'Assessment' : 'Applied' };
  const senders = updates.map((u) => senderPerson(u.from)).filter((p): p is { name: string; email?: string } => !!p);
  const view: ProcessView = {
    key: stored?.id ?? `listing:${listing.id}`,
    season: stored?.season ?? seasonFor(appliedAt ?? updates[0]?.receivedAt ?? listing.savedAt),
    source: 'jobs',
    listingId: listing.id,
    company: listing.company,
    role: listing.positionTitle,
    location: stored?.location ?? listing.location,
    term: stored?.term,
    comp: stored?.comp ?? (listing.salary && !/not listed|unknown/i.test(listing.salary) ? listing.salary : undefined),
    domain: index.domains[listing.company.toLowerCase()],
    appliedAt,
    outcome,
    events,
    rounds,
    notes,
    people: mergePeople(stored?.people ?? [], senders),
    flags: stored?.flags ?? [],
    reach: 0,
    postingUrl: listing.link,
  };
  view.reach = reachOf(view);
  return view;
}

export function importedProcess(p: InterviewProcess, index: InterviewsIndex, now: number): ProcessView {
  const notes = noteViews(p);
  const resolved = new Map<string, string>();
  for (const f of p.flags ?? []) {
    const option = f.options.find((o) => o.label === f.resolved);
    if (option) resolved.set(option.roundId, option.at);
  }
  const rounds = p.rounds.map((r) => ({
    id: r.id, name: r.name ?? 'Round', kind: r.kind ?? kindFromName(r.name ?? ''), at: resolved.get(r.id) ?? r.at, time: r.time,
    duration: r.duration, people: r.people ?? [], format: r.format, note: r.note,
    state: (r.cancelled ? 'cancelled' : 'done') as RoundView['state'],
    noteIds: notes.filter((n) => n.round === r.id).map((n) => n.id),
  })).sort((a, b) => (epoch(a.at) || 0) - (epoch(b.at) || 0));
  const outcome: ProcessView['outcome'] = p.outcome
    ? { kind: p.outcome.kind, label: OUTCOME_LABEL[p.outcome.kind], at: p.outcome.at, note: p.outcome.note }
    : { kind: 'open', label: 'In progress' };
  const view: ProcessView = {
    key: p.id, season: p.season, source: 'imported', company: p.company, role: p.role, location: p.location, term: p.term, comp: p.comp,
    domain: index.domains[p.company.toLowerCase()],
    appliedAt: p.events?.find((e) => e.kind === 'applied')?.at,
    outcome, events: [...(p.events ?? [])].sort((a, b) => epoch(a.at) - epoch(b.at)), rounds, notes,
    people: p.people, flags: p.flags ?? [], reach: 0,
  };
  view.reach = reachOf(view);
  void now;
  return view;
}

const seasonLabel = (id: string) => id.replace('-', '–');
const seasonRange = (id: string) => `May ${id.slice(0, 4)} – Apr ${Number(id.slice(0, 4)) + 1}`;

export function buildCasebook(input: {
  index: InterviewsIndex;
  listings: JobListing[];
  applications: Record<string, JobApplicationRecord>;
  milestones: Record<string, Milestone[]>;
  now?: number;
}): CasebookView {
  const now = input.now ?? Date.now();
  const { index, listings, applications, milestones } = input;
  const byListing = new Map(index.processes.filter((p) => p.listingId).map((p) => [p.listingId!, p]));
  const processes: ProcessView[] = index.processes.filter((p) => !p.listingId).map((p) => importedProcess(p, index, now));
  for (const listing of listings) {
    const app = applications[listing.id];
    const stored = byListing.get(listing.id);
    if (!stored && !(app?.employerStage && HEARD_BACK.has(app.employerStage))) continue;
    const ms = (milestones[listing.id] ?? []).filter((m, _, all) => !all.some((n) => n.supersedes === m.id));
    processes.push(jobsProcess(listing, app, ms, stored, index, now));
  }
  const current = seasonFor(new Date(now).toISOString(), new Date(now));
  const submitted = (season: string) =>
    listings.filter((l) => {
      const a = applications[l.id];
      return a?.submittedAt && seasonFor(a.submittedAt) === season;
    }).length;
  const ids = [...new Set([current, ...processes.map((p) => p.season)])].sort().reverse();
  return {
    now: new Date(now).toISOString(),
    seasons: ids.map((id) => ({
      id, label: seasonLabel(id), range: seasonRange(id),
      source: processes.some((p) => p.season === id && p.source === 'jobs') || id === current ? 'Live from Jobs' : 'Imported from OpenClaw',
      count: processes.filter((p) => p.season === id).length,
      ...(id === current ? { submitted: submitted(id) } : {}),
    })),
    processes,
    questions: index.questions,
    lessons: index.lessons,
  };
}

export const __test = { epoch, settleStates, overlay };
