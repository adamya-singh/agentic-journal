'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteView, ProcessView, RoundView, TalkSummary } from '@/lib/interviews/types';

export const TZ = { timeZone: 'America/New_York' } as const;
export const toDate = (s?: string) => (!s ? undefined : new Date(s.length === 10 ? `${s}T12:00:00-05:00` : s));
export function fmt(s: string | undefined, now: Date, withYear = false) {
  const d = toDate(s);
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = withYear || d.getFullYear() !== now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}), ...TZ });
}
export const fmtLong = (s?: string) => {
  const d = toDate(s);
  return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...TZ }) : '';
};
export const fmtTime = (s?: string) => {
  const d = toDate(s);
  return d && s && s.length > 10 ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...TZ }) : '';
};
export function ago(s: string | undefined, now: Date) {
  const d = toDate(s);
  if (!d) return '';
  const m = Math.round((now.getTime() - d.getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
export const KC = (kind: string) => `var(--c-${kind})`;
export const ini = (name: string) => name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(n > 10240 ? 0 : 1)} KB` : n ? `${n} B` : '');

const PATHS: Record<string, string> = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  clip: '<path d="m21 12-8.5 8.5a5 5 0 0 1-7-7L14 5a3.3 3.3 0 0 1 4.7 4.7L10.2 18a1.7 1.7 0 0 1-2.4-2.4L15.5 8"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  dollar: '<path d="M12 3v18M16.5 7.5c-.6-1.4-2.2-2.3-4.5-2.3-2.6 0-4.3 1.3-4.3 3.1 0 4.4 9 2.4 9 7.2 0 1.9-1.9 3.3-4.7 3.3-2.5 0-4.3-1-5-2.6"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  brief: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6z"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 5 2V4.5A2.5 2.5 0 0 0 9 4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-5 2V4.5A2.5 2.5 0 0 1 15 4z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-7a1.5 1.5 0 0 1 3 0V12M14 6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.3-4a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
};
export function Icon({ name, small }: { name: string; small?: boolean }) {
  return <svg className={`i${small ? ' s' : ''}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] ?? '' }} />;
}

export const NOTE_KIND: Record<string, [string, string, string]> = {
  'job-description': ['brief', 'Job description', 'applied'], prep: ['bulb', 'Prep', 'screen'], research: ['dollar', 'Research', 'oa'],
  notes: ['pen', 'Notes', 'tech'], transcript: ['mic', 'Transcript', 'ml'], oa: ['code', 'OA notes', 'oa'], 'post-mortem': ['flag', 'Post-mortem', 'reject'],
  outcome: ['flag', 'Outcome', 'reject'], offer: ['star', 'Offer', 'offer'], emails: ['mail', 'Emails', 'screen'], file: ['clip', 'File', 'applied'],
};
export const AUTHOR: Record<string, string> = { import: 'Imported', claude: 'Claude Code', you: 'You', openclaw: 'OpenClaw' };
export const ROUND_TAG: Record<string, string> = { screen: 'screen', oa: 'assessment', tech: 'coding', ml: 'ml breadth', behav: 'behavioral', fit: 'fit', onsite: 'onsite', other: 'interview' };
export const roundIcon = (r: RoundView) =>
  r.state === 'capture' ? 'mic' : r.state === 'cancelled' ? 'x' : r.state === 'unscheduled' || r.state === 'upcoming' ? 'clock'
    : r.kind === 'oa' ? 'code' : r.kind === 'screen' ? 'phone' : r.kind === 'ml' ? 'brain' : r.kind === 'fit' ? 'hand' : r.kind === 'behav' ? 'users' : 'code';

export function Logo({ p, size = '' }: { p: Pick<ProcessView, 'company' | 'domain'>; size?: '' | 'sm' | 'xl' }) {
  const [failed, setFailed] = React.useState(false);
  const letter = p.company.replace(/[^A-Za-z]/g, '')[0] ?? '?';
  if (!p.domain || failed) return <span className={`logo letter ${size}`} aria-hidden="true">{letter}</span>;
  return (
    <span className={`logo ${size}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own cached logo route */}
      <img src={`/api/jobs/interviews/logo?domain=${encodeURIComponent(p.domain)}`} alt={`${p.company} logo`} loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

/** The company's logo inside a ring of its rounds, one arc per round in that round's color. */
export function RingLogo({ p }: { p: ProcessView }) {
  const rounds = p.rounds.filter((r) => r.state !== 'cancelled');
  const n = Math.max(1, rounds.length);
  const size = 124, R = 54, C = size / 2, gap = 0.12;
  return (
    <span style={{ position: 'relative', width: size, height: size, flex: 'none', display: 'inline-grid', placeItems: 'center' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--line)" strokeWidth="1" />
        {rounds.map((r, i) => {
          const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n + gap / 2, a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n - gap / 2;
          const col = r.state === 'capture' ? 'var(--now)' : r.state === 'unscheduled' || r.state === 'upcoming' ? 'var(--line2)' : KC(r.kind);
          return (
            <path key={r.id} d={`M${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}`}
              stroke={col} strokeWidth={r.state === 'capture' ? 5.5 : 4} fill="none" strokeLinecap="round"
              strokeDasharray={r.state === 'unscheduled' || r.state === 'upcoming' ? '2 5' : undefined} style={{ filter: `drop-shadow(0 0 5px ${col})` }} />
          );
        })}
      </svg>
      <Logo p={p} size="xl" />
    </span>
  );
}

/** One small colored square per round the process got through. */
export function Pips({ p }: { p: ProcessView }) {
  const done = p.rounds.filter((r) => ['done', 'capture'].includes(r.state));
  if (!done.length) return null;
  return <span className="pips" aria-label={`${done.length} rounds`}>{done.map((r) => <i key={r.id} style={{ ['--k' as string]: r.state === 'capture' ? 'var(--now)' : KC(r.kind) }} />)}</span>;
}

export function DayRuler({ p, now }: { p: ProcessView; now: Date }) {
  const start = toDate(p.appliedAt);
  if (!start) return null;
  const marks = [
    ...p.rounds.filter((r) => r.at && r.state !== 'unscheduled').map((r) => ({ id: r.id, name: r.name, at: r.at!, k: r.state === 'capture' ? 'now' : r.state === 'cancelled' ? 'reject' : r.kind })),
    ...(p.outcome.at && p.outcome.kind !== 'open' ? [{ id: 'end', name: p.outcome.label, at: p.outcome.at, k: p.outcome.kind === 'offer' ? 'offer' : p.outcome.kind === 'rejected' ? 'reject' : 'applied' }] : []),
  ].map((m) => ({ ...m, d: (toDate(m.at)!.getTime() - start.getTime()) / 864e5 })).filter((m) => m.d >= 0).sort((a, b) => a.d - b.d);
  const last = p.outcome.kind === 'open' ? (now.getTime() - start.getTime()) / 864e5 : 0;
  const end = Math.max(8, last, ...marks.map((m) => m.d)) * 1.04;
  const short = (name: string) => {
    const r = name.match(/round (\d)/i);
    return r ? `R${r[1]}` : name.length > 14 ? `${name.slice(0, 13)}…` : name;
  };
  return (
    <div style={{ marginTop: 22 }}>
      <div className="lab" style={{ marginBottom: 12 }}>Days since applying</div>
      <svg width="100%" height="60" style={{ overflow: 'visible', display: 'block' }} role="img" aria-label="Rounds placed by days since applying">
        <line x1="0" x2="100%" y1="37" y2="37" stroke="var(--line2)" />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={`${f * 100}%`} x2={`${f * 100}%`} y1="34" y2="40" stroke="var(--line2)" />
            <text x={`${f * 100}%`} y="54" textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontFamily="var(--mono)" fontSize="10" fill="var(--faint)">D+{Math.round(f * end)}</text>
          </g>
        ))}
        {p.outcome.kind === 'open' && <line x1={`${(last / end) * 100}%`} x2={`${(last / end) * 100}%`} y1="26" y2="44" stroke="var(--now)" strokeDasharray="2 3" />}
        {marks.map((m, i) => {
          const x = (m.d / end) * 100, ly = [4, 15, 26][i % 3], col = m.k === 'now' ? 'var(--now)' : KC(m.k);
          return (
            <g key={m.id}>
              <line x1={`${x}%`} x2={`${x}%`} y1={ly + 4} y2="37" stroke={col} strokeWidth="1.5" opacity=".8" />
              <circle cx={`${x}%`} cy="37" r={m.k === 'now' ? 6 : 4.5} fill={col} style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
              <text x={`${x}%`} y={ly} textAnchor={x < 8 ? 'start' : x > 88 ? 'end' : 'middle'} fontFamily="var(--mono)" fontSize="10.5" fill="var(--ink2)">{short(m.name)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function TalkStrip({ talk, label }: { talk: TalkSummary; label: string }) {
  const W = 600;
  return (
    <div className="talk">
      <div className="hd"><span>{label} · {Math.round(talk.total / 60)} min · {talk.turns} turns</span><span>You spoke <b>{talk.youShare}%</b> of the time</span></div>
      <svg viewBox={`0 0 ${W} 46`} preserveAspectRatio="none" role="img" aria-label="Who spoke when: top lane them, bottom lane you">
        {talk.segs.map(([s, len, who], i) => (
          <rect key={i} x={(s / talk.total) * W} y={who === 'them' ? 7 : 25} width={Math.max(0.8, (len / talk.total) * W - 0.6)} height="14" rx="2"
            fill={who === 'you' ? 'var(--em)' : 'var(--ink2)'} opacity={who === 'you' ? 0.95 : 0.45} />
        ))}
      </svg>
      <div className="hd"><span>top: them · bottom: you</span><span>from transcript timestamps</span></div>
    </div>
  );
}

export function Markdown({ body }: { body: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

export function DocChip({ note, active, onOpen }: { note: NoteView; active: boolean; onOpen: () => void }) {
  const k = NOTE_KIND[note.kind] ?? NOTE_KIND.file;
  return (
    <button type="button" className="dc" aria-pressed={active} onClick={onOpen} style={{ ['--k' as string]: KC(k[2]) }}>
      <span className="ic"><Icon name={k[0]} /></span>
      <span className="t">{note.title}</span>
      <span className="m">{AUTHOR[note.author]} · {fmtLong(note.date).replace(/^\w+, /, '')}{note.bytes ? ` · ${kb(note.bytes)}` : ''}</span>
    </button>
  );
}
