'use client';

import React from 'react';
import Link from 'next/link';
import type { CasebookView, InterviewQuestion, NoteKind, NoteView, ProcessView, RoundView } from '@/lib/interviews/types';
import { CASEBOOK_CSS } from './casebook-css';
import {
  AUTHOR, DayRuler, DocChip, Icon, KC, Logo, Markdown, NOTE_KIND, Pips, ROUND_TAG, RingLogo, TalkStrip,
  ago, fmt, fmtLong, fmtTime, ini, kb, roundIcon, toDate,
} from './parts';

type View = 'processes' | 'questions' | 'people';
type Side = 'reader' | 'timeline' | 'people';
const QT: Record<InterviewQuestion['type'], [string, string]> = {
  behavioral: ['Behavioral', 'behav'], coding: ['Coding', 'tech'], system: ['Systems', 'tech'], ml: ['ML breadth', 'ml'], recruiter: ['Recruiter', 'screen'], fit: ['Fit and motivation', 'fit'],
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
  return json.data as T;
}
const post = <T,>(body: unknown) => api<T>('/api/jobs/interviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Selection survives a process's key changing from listing:ID to its stored id on the first write. */
const sid = (p: ProcessView) => (p.listingId ? `L:${p.listingId}` : p.key);
const lastAt = (p: ProcessView) => p.events[p.events.length - 1]?.at ?? p.appliedAt ?? '';
const byRecent = (a: ProcessView, b: ProcessView) => (toDate(lastAt(b))?.getTime() ?? 0) - (toDate(lastAt(a))?.getTime() ?? 0);
const isNow = (p: ProcessView) => p.rounds.some((r) => r.state === 'capture' || r.state === 'upcoming');
const called = (p: ProcessView) => p.rounds.some((r) => r.kind !== 'oa' && ['done', 'capture'].includes(r.state));

function groups(ps: ProcessView[]): [string, ProcessView[], boolean][] {
  const now = ps.filter(isNow);
  const needs = ps.filter((p) => !isNow(p) && p.outcome.kind === 'open');
  const rest = ps.filter((p) => !now.includes(p) && !needs.includes(p));
  const offers = rest.filter((p) => p.outcome.kind === 'offer');
  const deep = rest.filter((p) => p.outcome.kind !== 'offer' && called(p));
  const early = rest.filter((p) => !offers.includes(p) && !deep.includes(p));
  return [
    ['Now', now.sort(byRecent), false], ['Needs a check-in', needs.sort(byRecent), false], ['Offers', offers.sort(byRecent), false],
    ['Reached interviews', deep.sort(byRecent), false], ['Ended early', early.sort(byRecent), early.length > 6],
  ];
}

export function Casebook() {
  const [data, setData] = React.useState<CasebookView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<View>('processes');
  const [season, setSeason] = React.useState<string | null>(null);
  const [sel, setSel] = React.useState<string | null>(null);
  const [doc, setDoc] = React.useState<string | null>(null);
  const [side, setSide] = React.useState<Side>('reader');
  const [q, setQ] = React.useState('');
  const [showEarly, setShowEarly] = React.useState(false);
  const [bodies, setBodies] = React.useState<Record<string, string> | null>(null);
  const [composing, setComposing] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setData(await api<CasebookView>('/api/jobs/interviews'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the casebook');
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  // Deep links: /jobs/interviews?process=<id|listing:ID>&view=questions, or &note=<id> to open one note
  const linked = React.useRef(false);
  React.useEffect(() => {
    if (!data || linked.current) return;
    linked.current = true;
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    if (v === 'questions' || v === 'people') setView(v);
    const want = params.get('process');
    const p = want && data.processes.find((x) => x.key === want || `listing:${x.listingId}` === want || x.listingId === want);
    const note = params.get('note');
    if (p) { setSeason(p.season); setSel(sid(p)); if (note && p.notes.some((n) => n.id === note)) setDoc(note); }
  }, [data]);

  const now = React.useMemo(() => new Date(data?.now ?? Date.now()), [data?.now]);
  const seasonId = season ?? data?.seasons[0]?.id ?? null;
  const inSeason = React.useMemo(() => (data?.processes ?? []).filter((p) => p.season === seasonId), [data, seasonId]);
  const grouped = React.useMemo(() => groups(inSeason), [inSeason]);
  const current = inSeason.find((p) => sid(p) === sel) ?? grouped.flatMap((g) => g[1])[0];

  React.useEffect(() => {
    if (!current) return;
    if (!doc || !current.notes.some((n) => n.id === doc)) {
      const pick = current.notes.find((n) => n.talk) ?? current.notes.find((n) => n.round !== 'before' && n.kind !== 'file') ?? current.notes[0];
      setDoc(pick?.id ?? null);
    }
  }, [current, doc]);

  // Searching note text needs every body once; they're small Markdown files.
  React.useEffect(() => {
    if (q.trim().length < 2 || bodies) return;
    api<{ bodies: Record<string, string> }>('/api/jobs/interviews/note?all=1').then((d) => setBodies(d.bodies)).catch(() => setBodies({}));
  }, [q, bodies]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName ?? '')) {
        const input = document.getElementById('cb-search') as HTMLInputElement | null;
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = (p: ProcessView) => { setSel(sid(p)); setDoc(null); setSide('reader'); setComposing(false); };
  const openDoc = (id: string) => {
    setDoc(id); setSide('reader');
    if (window.innerWidth < 1380) document.getElementById('cb-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (error && !data) return <div className="cb"><style>{CASEBOOK_CSS}</style><div className="cb-body empty">{error} <button className="btn sm" onClick={() => void load()}>Try again</button></div></div>;
  if (!data) return <div className="cb"><style>{CASEBOOK_CSS}</style><div className="cb-body empty">Loading the casebook…</div></div>;

  const counts = { processes: data.processes.length, questions: data.questions.length, people: data.processes.reduce((n, p) => n + p.people.length, 0) };
  return (
    <div className="cb">
      <style>{CASEBOOK_CSS}</style>
      <div className="cb-top">
        <div className="cb-title">Interviews <i>casebook</i></div>
        <div className="cb-views" role="group" aria-label="View">
          {([['processes', 'Processes'], ['questions', 'Question bank'], ['people', 'People and lessons']] as [View, string][]).map(([k, label]) => (
            <button key={k} type="button" className="cb-vbtn" aria-pressed={view === k} onClick={() => setView(k)}>{label}<span className="c">{counts[k]}</span></button>
          ))}
        </div>
      </div>
      <div className="cb-body">
        {view === 'questions' ? <QuestionBank data={data} />
          : view === 'people' ? <PeopleLessons data={data} now={now} />
            : (
              <div className="cb-dos">
                <ProcessList
                  data={data} seasonId={seasonId} setSeason={(s) => { setSeason(s); setSel(null); setDoc(null); setShowEarly(false); }}
                  grouped={grouped} current={current} select={select} q={q} setQ={setQ} bodies={bodies} showEarly={showEarly} setShowEarly={setShowEarly} now={now}
                />
                {current ? (
                  <>
                    <CaseFile key={sid(current)} p={current} data={data} now={now} doc={doc} openDoc={openDoc} reload={load} composing={composing} setComposing={setComposing} />
                    <aside className="side" id="cb-side">
                      <div className="sbox glass">
                        <div className="stabs" role="group" aria-label="Side panel">
                          {(['reader', 'timeline', 'people'] as Side[]).map((k) => (
                            <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)}>{k === 'reader' ? 'Reader' : k === 'timeline' ? 'Timeline' : 'People'}</button>
                          ))}
                        </div>
                        <div className="sbody">
                          {side === 'reader' ? <Reader key={`${current.key}|${doc}`} p={current} note={current.notes.find((n) => n.id === doc)} reload={load} />
                            : side === 'timeline' ? <Timeline p={current} />
                              : <People p={current} />}
                        </div>
                      </div>
                    </aside>
                  </>
                ) : <div className="glass empty">Nothing in this season yet.</div>}
              </div>
            )}
      </div>
    </div>
  );
}

function ProcessList(props: {
  data: CasebookView; seasonId: string | null; setSeason: (s: string) => void; grouped: [string, ProcessView[], boolean][];
  current?: ProcessView; select: (p: ProcessView) => void; q: string; setQ: (q: string) => void; bodies: Record<string, string> | null;
  showEarly: boolean; setShowEarly: (v: boolean) => void; now: Date;
}) {
  const { data, seasonId, grouped, current, select, q, bodies, now } = props;
  const s = data.seasons.find((x) => x.id === seasonId);
  const needle = q.trim().toLowerCase();
  const hits = (p: ProcessView) => (needle.length < 2 || !bodies ? 0 : p.notes.filter((n) => (bodies[`${p.key}|${n.id}`] ?? '').toLowerCase().includes(needle)).length);
  const match = (p: ProcessView) => !needle || `${p.company} ${p.role}`.toLowerCase().includes(needle) || hits(p) > 0;
  const ps = data.processes.filter((p) => p.season === seasonId);
  const when = (p: ProcessView) => {
    const cap = p.rounds.find((r) => r.state === 'capture');
    if (cap) return <span className="w now">call {ago(cap.at, now)}</span>;
    const up = p.rounds.find((r) => r.state === 'upcoming');
    if (up) return <span className="w now">{fmt(up.at, now)} {fmtTime(up.at)}</span>;
    if (p.rounds.some((r) => r.state === 'unrecorded')) return <span className="w warn">OA unrecorded</span>;
    if (p.rounds.some((r) => r.state === 'unscheduled')) return <span className="w warn">no time set</span>;
    return <span className="w">{fmt(lastAt(p), now)}</span>;
  };
  return (
    <div className="cb-list">
      <div className="seg" role="group" aria-label="Season" style={{ alignSelf: 'flex-start' }}>
        {data.seasons.map((x) => <button key={x.id} type="button" aria-pressed={x.id === seasonId} onClick={() => props.setSeason(x.id)}>{x.label}<small>{x.count}</small></button>)}
      </div>
      <div className="sum">
        {s?.submitted !== undefined && <span><b>{s.submitted}</b> sent</span>}
        <span><b>{ps.length}</b> {s?.submitted !== undefined ? 'replied' : 'processes'}</span>
        <span><b>{ps.filter(called).length}</b> reached a call</span>
        <span><b>{ps.filter((p) => p.outcome.kind === 'offer').length}</b> offers</span>
      </div>
      <label className="search"><Icon name="search" small />
        <input id="cb-search" placeholder="Search companies and every note" value={q} onChange={(e) => props.setQ(e.target.value)} aria-label="Search companies and notes" /><kbd>/</kbd>
      </label>
      {grouped.map(([name, list, fold]) => {
        const shown = list.filter(match);
        if (!shown.length) return null;
        const folded = fold && !props.showEarly && !needle;
        return (
          <div className="grp" key={name}>
            <h4><span className="lab">{name}</span><span className="lab" style={{ color: 'var(--faint)' }}>{shown.length}</span></h4>
            {folded ? (
              <button type="button" className="more" onClick={() => props.setShowEarly(true)}>
                <Icon name="inbox" small /><span>{shown.length} with no call · {shown.slice(0, 3).map((p) => p.company).join(', ')}…</span>
              </button>
            ) : shown.map((p) => (
              <button key={sid(p)} type="button" className="pr" aria-current={current && sid(current) === sid(p)} onClick={() => select(p)}>
                <Logo p={p} />
                <span className="c">{p.company}<Pips p={p} /></span>
                {when(p)}
                <span className="r">{p.role}{hits(p) > 0 && <span style={{ color: 'var(--em)' }}> · {hits(p)} in notes</span>}</span>
              </button>
            ))}
          </div>
        );
      })}
      <div className="lab" style={{ color: 'var(--faint)', padding: '2px 6px' }}>{s?.range} · {s?.source}</div>
    </div>
  );
}

function OutcomeChip({ p, now }: { p: ProcessView; now: Date }) {
  const cap = p.rounds.find((r) => r.state === 'capture');
  if (cap) return <span className="out o-now"><i />Call {ago(cap.at, now)}</span>;
  return <span className={`out o-${p.outcome.kind}`}><i />{p.outcome.label}</span>;
}

function CaseFile({ p, data, now, doc, openDoc, reload, composing, setComposing }: {
  p: ProcessView; data: CasebookView; now: Date; doc: string | null; openDoc: (id: string) => void; reload: () => Promise<void>;
  composing: boolean; setComposing: (v: boolean) => void;
}) {
  const start = toDate(p.appliedAt);
  const end = p.outcome.kind === 'open' ? now : toDate(p.outcome.at) ?? now;
  const days = start ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 864e5)) : undefined;
  const questions = data.questions.filter((x) => x.processId === p.key);
  const calls = p.rounds.filter((r) => r.kind !== 'oa' && ['done', 'capture'].includes(r.state)).length;
  const before = p.notes.filter((n) => n.round === 'before');
  const after = p.notes.filter((n) => n.round === 'after');
  const lessons = data.lessons.filter((l) => l.processId === p.key);
  const [flagError, setFlagError] = React.useState<string | null>(null);
  return (
    <main className="cb-case">
      <section className="hero glass">
        <div style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="eb">{data.seasons.find((s) => s.id === p.season)?.label}<span style={{ color: 'var(--dim)' }}>·</span><OutcomeChip p={p} now={now} />{p.source === 'imported' && <span style={{ color: 'var(--dim)' }}>imported</span>}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {p.postingUrl && <a className="btn" href={p.postingUrl} target="_blank" rel="noreferrer"><Icon name="ext" small />Posting</a>}
            {p.listingId && <Link className="btn" href={`/jobs/overview?application=${encodeURIComponent(p.listingId)}`}>Overview</Link>}
            <button type="button" className="btn pri" onClick={() => setComposing(!composing)}><Icon name="plus" small />Note</button>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 20, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
          <RingLogo p={p} />
          <div className="who">
            <h2>{p.company}</h2>
            <div className="role">{p.role}</div>
            <div className="facts">
              {p.location && <span>{p.location}</span>}{p.term && <span>{p.term}</span>}{p.comp && <span>{p.comp}</span>}
              {p.appliedAt && <span>applied {fmt(p.appliedAt, now, true)}</span>}
            </div>
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          <div className="tele">
            <div><b>{days ?? '—'}{days !== undefined && 'd'}</b><span>{p.outcome.kind === 'open' ? 'since applied' : 'applied → end'}</span></div>
            <div><b>{calls}</b><span>{calls === 1 ? 'call' : 'calls'}</span></div>
            <div><b>{questions.length}</b><span>questions</span></div>
            <div><b>{p.people.length}</b><span>people</span></div>
            <div><b>{p.notes.length}</b><span>notes</span></div>
          </div>
          <DayRuler p={p} now={now} />
        </div>
      </section>

      {composing && <NewNote p={p} onDone={async (id) => { setComposing(false); if (id) { await reload(); openDoc(id); } }} />}

      {p.flags.filter((f) => !f.resolved).map((f) => (
        <div key={f.id} className="glass flag">
          <span style={{ color: 'var(--c-oa)', flex: 'none', minWidth: 0 }}><Icon name="flag" /></span>
          <span>{f.text}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            {f.options.map((o) => (
              <button key={o.label} type="button" className="btn sm" onClick={async () => {
                try { await post({ action: 'resolve-flag', process: p.key, flagId: f.id, option: o.label }); await reload(); } catch (e) { setFlagError(e instanceof Error ? e.message : 'That did not save'); }
              }}>{o.label}</button>
            ))}
          </span>
          {flagError && <span className="err">{flagError}</span>}
        </div>
      ))}

      <section>
        <div className="sech"><h3>Rounds</h3><span className="lab">{p.rounds.length} {p.rounds.length === 1 ? 'step' : 'steps'}</span></div>
        {before.length > 0 && (
          <div style={{ margin: '0 0 16px 54px' }}>
            <div className="lab" style={{ marginBottom: 8 }}>Before the first call</div>
            <div className="docs">{before.map((n) => <DocChip key={n.id} note={n} active={n.id === doc} onOpen={() => openDoc(n.id)} />)}</div>
          </div>
        )}
        {p.rounds.length === 0 && p.outcome.kind !== 'open' && (
          <div className="glass empty"><Icon name="inbox" /> No call. {p.company} {p.outcome.kind === 'rejected' ? `declined on ${fmt(p.outcome.at, now)}` : 'never replied'}.</div>
        )}
        <div className="rounds">
          {p.rounds.map((r) => (
            <div key={r.id} className={`rnd ${r.state}`} style={{ ['--k' as string]: r.state === 'capture' ? 'var(--now)' : KC(r.kind) }}>
              <span className="node"><Icon name={roundIcon(r)} /></span>
              {r.state === 'capture'
                ? <Capture p={p} r={r} now={now} onDone={reload} />
                : <RoundCard p={p} r={r} now={now} questions={questions.filter((x) => x.round === r.id)} doc={doc} openDoc={openDoc} reload={reload} />}
            </div>
          ))}
          {p.outcome.kind !== 'open' && (p.rounds.length > 0 || after.length > 0) && (
            <div className="rnd done" style={{ ['--k' as string]: p.outcome.kind === 'offer' ? 'var(--c-offer)' : p.outcome.kind === 'rejected' ? 'var(--c-reject)' : 'var(--c-applied)' }}>
              <span className="node"><Icon name={p.outcome.kind === 'offer' ? 'star' : 'flag'} /></span>
              <div className="rbox glass">
                <div className="rtop"><div><span className="kind">{p.outcome.kind === 'offer' ? 'offer' : 'outcome'}</span><div className="ti" style={{ marginTop: 8 }}>{p.outcome.label}</div></div><div className="w">{p.outcome.at && <span>{fmtLong(p.outcome.at)}</span>}</div></div>
                {p.outcome.note && <div className="rnote" style={{ color: 'var(--ink2)' }}>{p.outcome.note}</div>}
                {after.length > 0 && <div className="docs">{after.map((n) => <DocChip key={n.id} note={n} active={n.id === doc} onOpen={() => openDoc(n.id)} />)}</div>}
              </div>
            </div>
          )}
        </div>
      </section>

      {lessons.length > 0 && (
        <section>
          <div className="sech"><h3>What you took from it</h3></div>
          <div style={{ display: 'grid', gap: 18 }}>{lessons.map((l) => <div key={l.id} className="lesson">{l.text}<small>{l.source} · {fmt(l.date, now, true)}</small></div>)}</div>
        </section>
      )}
    </main>
  );
}

function RoundCard({ p, r, now, questions, doc, openDoc, reload }: {
  p: ProcessView; r: RoundView; now: Date; questions: InterviewQuestion[]; doc: string | null; openDoc: (id: string) => void; reload: () => Promise<void>;
}) {
  const notes = p.notes.filter((n) => n.round === r.id);
  const talk = notes.find((n) => n.talk);
  const [setting, setSetting] = React.useState(false);
  return (
    <div className="rbox glass">
      <div className="rtop">
        <div><span className="kind">{ROUND_TAG[r.kind]}</span><div className="ti" style={{ marginTop: 8, textDecoration: r.state === 'cancelled' ? 'line-through' : undefined }}>{r.name}</div></div>
        <div className="w">
          {r.at && r.state !== 'unscheduled' && <span>{fmtLong(r.at)}{(r.time || fmtTime(r.at)) && ` · ${r.time || fmtTime(r.at)}`}</span>}
          {r.duration && <span>{r.duration}</span>}
          {r.people.length > 0 && <><span className="avs">{r.people.map((n) => <span key={n} className="av" title={n}>{ini(n)}</span>)}</span><span>{r.people.join(', ')}</span></>}
        </div>
      </div>
      {r.format && <div className="rnote">{r.format}</div>}
      {r.note && <div className="rnote">{r.note}</div>}
      {r.state === 'cancelled' && <div className="rnote" style={{ color: 'var(--c-reject)' }}>Cancelled before it happened.</div>}
      {r.state === 'upcoming' && <div className="rnote" style={{ color: 'var(--now)' }}>Booked for {fmtLong(r.at)} {fmtTime(r.at)}</div>}
      {r.state === 'unrecorded' && (
        <div className="rnote" style={{ color: 'var(--c-oa)' }}>
          Invited {fmt(r.at, now)} · completion not recorded. {p.listingId && <Link href={`/jobs/overview?application=${encodeURIComponent(p.listingId)}`} style={{ color: 'var(--em)' }}>Record it on Overview</Link>}
        </div>
      )}
      {r.state === 'unscheduled' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="rnote">Invited {fmt(r.invitedAt, now)} · no time recorded yet.</div>
          {setting ? <SetTime p={p} r={r} onDone={async (saved) => { setSetting(false); if (saved) await reload(); }} />
            : <div><button type="button" className="btn sm" onClick={() => setSetting(true)}><Icon name="clock" small />Set the time</button></div>}
        </div>
      )}
      {talk?.talk && <TalkStrip talk={talk.talk} label="Transcript" />}
      {questions.length > 0 && (
        <div className="qs">{questions.map((x) => (
          <div key={x.id} className="q" style={{ ['--k' as string]: KC(QT[x.type][1]) }}><i /><span>{x.text}{x.answer && <small>{x.answer}</small>}</span></div>
        ))}</div>
      )}
      {notes.length > 0 && <div className="docs">{notes.map((n) => <DocChip key={n.id} note={n} active={n.id === doc} onOpen={() => openDoc(n.id)} />)}</div>}
    </div>
  );
}

function SetTime({ p, r, onDone }: { p: ProcessView; r: RoundView; onDone: (saved: boolean) => void }) {
  const [at, setAt] = React.useState('');
  const [duration, setDuration] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <form style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }} onSubmit={async (e) => {
      e.preventDefault();
      if (!at) return;
      try {
        await post({ action: 'set-round', process: p.key, id: r.id, at: new Date(at).toISOString(), ...(duration.trim() ? { duration: duration.trim() } : {}) });
        onDone(true);
      } catch (x) { setErr(x instanceof Error ? x.message : 'That did not save'); }
    }}>
      <label className="field" htmlFor={`at-${r.id}`}>When<input id={`at-${r.id}`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required /></label>
      <label className="field" htmlFor={`dur-${r.id}`}>How long<input id={`dur-${r.id}`} placeholder="30 min" value={duration} onChange={(e) => setDuration(e.target.value)} style={{ width: 110 }} /></label>
      <button className="btn sm pri" type="submit">Save</button>
      <button className="btn sm" type="button" onClick={() => onDone(false)}>Cancel</button>
      {err && <span className="err">{err}</span>}
    </form>
  );
}

const SECTIONS = ['Band and equity', 'Next round', 'The team', 'What they asked', 'Follow-ups'];

/** The write-up box for a call that just ended: autosaves to the round's notes file. */
function Capture({ p, r, now, onDone }: { p: ProcessView; r: RoundView; now: Date; onDone: () => Promise<void> }) {
  const draftKey = `cb-draft:${p.listingId ?? p.key}:${r.id}`;
  const [text, setText] = React.useState('');
  const [noteId, setNoteId] = React.useState<string | null>(null);
  const [key, setKey] = React.useState(p.key);
  const [status, setStatus] = React.useState<string>('Saved as you type');
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = React.useRef<Promise<void> | null>(null);
  React.useEffect(() => { try { setText(localStorage.getItem(draftKey) ?? ''); } catch {} }, [draftKey]);
  const save = React.useCallback(async (body: string) => {
    if (!body.trim()) return;
    setStatus('Saving…');
    const run = (async () => {
      try {
        const res = await post<{ processId: string; note: { id: string } }>({ action: 'save-note', process: key, ...(noteId ? { noteId } : { title: `${r.name} notes`, kind: 'notes', round: r.id }), body });
        setNoteId(res.note.id); setKey(res.processId);
        setStatus(`Saved ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
      } catch (e) { setStatus(e instanceof Error ? `Not saved: ${e.message}` : 'Not saved'); }
    })();
    saving.current = run;
    await run;
  }, [key, noteId, r.id, r.name]);
  const change = (value: string) => {
    setText(value);
    try { localStorage.setItem(draftKey, value); } catch {}
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 900);
  };
  const insert = (section: string) => {
    const ta = ref.current;
    const at = ta?.selectionStart ?? text.length;
    const head = `## ${section}\n`;
    const pre = text.slice(0, at).replace(/\n*$/, '');
    const next = `${pre ? `${pre}\n\n` : ''}${head}${text.slice(at)}`;
    change(next);
    requestAnimationFrame(() => { const pos = (pre ? pre.length + 2 : 0) + head.length; ta?.focus(); ta?.setSelectionRange(pos, pos); });
  };
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <div className="cap">
      <div className="hd">
        <div>
          <span className="kind solid" style={{ ['--k' as string]: 'var(--now)' }}><Icon name="mic" small />Write it up</span>
          <h3>{r.name}{r.people.length ? ` with ${r.people[0].split(' ')[0]}` : ''}</h3>
          <div className="sub"><span className="pulse" />Ended {ago(r.at, now)}{r.duration ? ` · ${r.duration}` : ''}</div>
        </div>
        <button type="button" className="btn pri" disabled={!words} onClick={async () => {
          if (timer.current) clearTimeout(timer.current);
          await save(text);
          try { localStorage.removeItem(draftKey); } catch {}
          await onDone();
        }}><Icon name="check" small />Done</button>
      </div>
      <div className="ed">
        <div className="tb" aria-label="Add a section">{SECTIONS.map((s) => <button key={s} type="button" onClick={() => insert(s)}><Icon name="plus" small />{s}</button>)}</div>
        <textarea ref={ref} id={`capture-${r.id}`} aria-label={`${r.name} notes`} value={text} onChange={(e) => change(e.target.value)}
          placeholder="What did they say about the role, the band, the next round and the timeline? What did they ask you?" />
        <div className="ft"><span>{status}</span><span>{words} words</span></div>
      </div>
    </div>
  );
}

function NewNote({ p, onDone }: { p: ProcessView; onDone: (noteId?: string) => void }) {
  const [title, setTitle] = React.useState('');
  const [round, setRound] = React.useState(p.rounds.find((r) => r.state === 'capture')?.id ?? 'before');
  const [kind, setKind] = React.useState<NoteKind>('notes');
  const [body, setBody] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <form className="glass" style={{ padding: 18, display: 'grid', gap: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      try {
        const res = await post<{ note: { id: string } }>({ action: 'save-note', process: p.key, title: title.trim() || 'Notes', kind, round, body });
        onDone(res.note.id);
      } catch (x) { setErr(x instanceof Error ? x.message : 'That did not save'); }
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <label className="field" htmlFor="nn-title" style={{ flex: '2 1 220px' }}>Title<input id="nn-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Prep for the onsite" autoFocus /></label>
        <label className="field" htmlFor="nn-round" style={{ flex: '1 1 160px' }}>Goes with
          <select id="nn-round" value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="before">Before the first call</option>
            {p.rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            <option value="after">After / outcome</option>
          </select>
        </label>
        <label className="field" htmlFor="nn-kind" style={{ flex: '1 1 140px' }}>Kind
          <select id="nn-kind" value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
            {(['notes', 'prep', 'research', 'post-mortem'] as NoteKind[]).map((k) => <option key={k} value={k}>{NOTE_KIND[k][1]}</option>)}
          </select>
        </label>
      </div>
      <div className="ed"><textarea aria-label="Note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown is fine." /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn pri" type="submit" disabled={!body.trim()}>Save note</button>
        <button className="btn" type="button" onClick={() => onDone()}>Cancel</button>
        {err && <span className="err">{err}</span>}
      </div>
    </form>
  );
}

function Reader({ p, note, reload }: { p: ProcessView; note?: NoteView; reload: () => Promise<void> }) {
  const [body, setBody] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  React.useEffect(() => {
    if (!note || note.kind === 'file') return;
    let live = true;
    api<{ body: string }>(`/api/jobs/interviews/note?process=${encodeURIComponent(p.key)}&note=${encodeURIComponent(note.id)}`)
      .then((d) => { if (live) setBody(d.body); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not open the note'); });
    return () => { live = false; };
  }, [p.key, note]);
  if (!note) return <div className="empty"><Icon name="file" /><div>Pick a note to read it here.</div></div>;
  const k = NOTE_KIND[note.kind] ?? NOTE_KIND.file;
  const raw = `/api/jobs/interviews/note?process=${encodeURIComponent(p.key)}&note=${encodeURIComponent(note.id)}&raw=1`;
  return (
    <div>
      <div className="rmeta">
        <span className="kind solid" style={{ ['--k' as string]: KC(k[2]) }}>{k[1]}</span>
        <span>{AUTHOR[note.author]} · {fmtLong(note.date)}</span>
        {note.bytes > 0 && <span>{kb(note.bytes)}</span>}
        {note.kind !== 'file' && !editing && body !== null && <button type="button" className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => { setDraft(body); setEditing(true); }}><Icon name="pen" small />Edit</button>}
        {note.path && <span className="p">from ~/.openclaw/workspace/{note.path}</span>}
      </div>
      {note.kind === 'file' ? (
        ['png', 'jpg', 'jpeg', 'webp'].includes(note.ext ?? '')
          // eslint-disable-next-line @next/next/no-img-element -- a private screenshot served by this app
          ? <a href={raw} target="_blank" rel="noreferrer"><img src={raw} alt={note.title} style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 8 }} /></a>
          : <div className="empty"><Icon name="clip" /><div style={{ margin: '8px 0 12px' }}><b style={{ color: 'var(--ink)' }}>{note.title}</b><br />{kb(note.bytes)}</div><a className="btn" href={raw} target="_blank" rel="noreferrer"><Icon name="ext" small />{note.ext === 'pdf' ? 'Open the PDF' : 'Open the file'}</a></div>
      ) : editing ? (
        <form style={{ display: 'grid', gap: 10 }} onSubmit={async (e) => {
          e.preventDefault();
          try { await post({ action: 'save-note', process: p.key, noteId: note.id, body: draft }); setBody(draft); setEditing(false); await reload(); } catch (x) { setErr(x instanceof Error ? x.message : 'That did not save'); }
        }}>
          <div className="ed"><textarea aria-label={note.title} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ minHeight: 360 }} /></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn pri" type="submit">Save</button><button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <>
          {note.talk && <div style={{ marginBottom: 18 }}><TalkStrip talk={note.talk} label={note.title} /></div>}
          {body === null ? <div className="empty">{err ?? 'Opening…'}</div> : <Markdown body={body} />}
        </>
      )}
      {err && body !== null && <div className="err">{err}</div>}
    </div>
  );
}

function Timeline({ p }: { p: ProcessView }) {
  const k: Record<string, string> = { applied: 'applied', received: 'tech', oa: 'oa', invite: 'screen', screen: 'screen', interview: 'ml', offer: 'offer', rejected: 'reject', note: 'applied' };
  return (
    <ol className="tl">
      {[...p.events].reverse().map((e, i) => (
        <li key={`${e.at}-${i}`}>
          <span className={`d${['screen', 'interview', 'offer', 'rejected'].includes(e.kind) ? ' f' : ''}`} style={{ ['--k' as string]: KC(k[e.kind]) }} />
          <span><span className="l">{e.label}</span><br /><span className="w">{fmtLong(e.at)}{fmtTime(e.at) && ` · ${fmtTime(e.at)}`}</span>{e.summary && <div className="s">{e.summary}</div>}</span>
        </li>
      ))}
      {!p.events.length && <li><span className="d" style={{ ['--k' as string]: 'var(--line2)' }} /><span className="w">No dated events</span></li>}
    </ol>
  );
}

function People({ p }: { p: ProcessView }) {
  if (!p.people.length) return <div className="empty" style={{ textAlign: 'left', padding: 0 }}>No names on file yet. People who email you about this role show up here.</div>;
  return (
    <div className="ppl">
      {p.people.map((x) => (
        <div key={x.name} className="pc"><span className="av">{ini(x.name)}</span><span className="nm">{x.name}</span><span className="rl">{x.role ?? 'Emailed you'}</span><span className="co">{x.email ?? p.rounds.filter((r) => r.people.includes(x.name)).map((r) => r.name).join(' · ')}</span></div>
      ))}
    </div>
  );
}

function QuestionBank({ data }: { data: CasebookView }) {
  const [type, setType] = React.useState<'all' | InterviewQuestion['type']>('all');
  const [q, setQ] = React.useState('');
  const byKey = new Map(data.processes.map((p) => [p.key, p]));
  const needle = q.trim().toLowerCase();
  const list = data.questions.filter((x) => (type === 'all' || x.type === type) && (!needle || `${x.text} ${x.answer ?? ''} ${byKey.get(x.processId)?.company ?? ''}`.toLowerCase().includes(needle)));
  const types = Object.keys(QT) as InterviewQuestion['type'][];
  const roundName = (x: InterviewQuestion) => byKey.get(x.processId)?.rounds.find((r) => r.id === x.round)?.name ?? x.round;
  return (
    <div className="qb">
      <div className="qf">
        <label className="search" style={{ marginBottom: 10 }}><Icon name="search" small /><input placeholder="Search questions" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search questions" /></label>
        <button type="button" aria-pressed={type === 'all'} onClick={() => setType('all')} style={{ ['--k' as string]: 'var(--ink2)' }}><i />All questions<span>{data.questions.length}</span></button>
        {types.map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)} style={{ ['--k' as string]: KC(QT[t][1]) }}><i />{QT[t][0]}<span>{data.questions.filter((x) => x.type === t).length}</span></button>
        ))}
        <p style={{ fontSize: 12.5, color: 'var(--dim)', margin: '16px 10px 0', lineHeight: 1.5 }}>From your round notes, transcripts and prep. Questions from new calls get added here as you write them up.</p>
      </div>
      <div>
        <div className="sech"><h3>{type === 'all' ? 'Everything you have been asked' : QT[type][0]}</h3><span className="lab">{list.length}</span></div>
        <div className="qgrid">
          {list.map((x) => {
            const p = byKey.get(x.processId);
            return (
              <article key={x.id} className="qc glass" style={{ ['--k' as string]: KC(QT[x.type][1]) }}>
                <div className="src">{p && <Logo p={p} size="sm" />}<span style={{ color: 'var(--ink)' }}>{p?.company}</span><span>{roundName(x)}</span><span>{p && data.seasons.find((s) => s.id === p.season)?.label}</span></div>
                <div className="qt">{x.text}</div>
                {x.answer ? <div className="ans"><b>What you said</b>{x.answer}</div> : <div className="ans" style={{ color: 'var(--dim)' }}>No answer written down; the transcript has it.</div>}
              </article>
            );
          })}
          {!list.length && <div className="empty">No questions match.</div>}
        </div>
      </div>
    </div>
  );
}

function PeopleLessons({ data, now }: { data: CasebookView; now: Date }) {
  const people = data.processes.flatMap((p) => p.people.map((x) => ({ ...x, p })));
  const byKey = new Map(data.processes.map((p) => [p.key, p]));
  return (
    <div style={{ display: 'grid', gap: 34 }}>
      <section>
        <div className="sech"><h3>People you&apos;ve talked to</h3><span className="lab">{people.length}</span></div>
        <div className="pp">
          {people.map((x) => (
            <div key={`${x.p.key}-${x.name}`} className="pc glass"><span className="av">{ini(x.name)}</span><span className="nm">{x.name}</span><span className="rl">{x.role ?? 'Emailed you'}</span>
              <span className="co"><Logo p={x.p} size="sm" />{x.p.company} · {data.seasons.find((s) => s.id === x.p.season)?.label}</span></div>
          ))}
        </div>
      </section>
      <section>
        <div className="sech"><h3>Lessons</h3><span className="lab">from post-mortems and notes to yourself</span></div>
        <div style={{ display: 'grid', gap: 24, maxWidth: 820 }}>
          {data.lessons.map((l) => <div key={l.id} className="lesson">{l.text}<small>{byKey.get(l.processId)?.company} · {l.source} · {fmt(l.date, now, true)}</small></div>)}
        </div>
      </section>
    </div>
  );
}
