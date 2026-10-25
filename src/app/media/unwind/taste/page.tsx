'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Instrument_Serif } from 'next/font/google';
import { ArrowLeft, Check, Loader2, Plus, X } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { feedApi } from '@/components/media/feed/api';
import { DUSK, DuskSky, PosterImg, button, outline } from '@/components/media/unwind/ui';
import type { NeverRule, OfficialChannel, TasteCard } from '@/lib/media/unwind-store';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });
type Answer = 'loved' | 'want' | 'not';
interface TasteData {
  taste: TasteCard;
  channels: OfficialChannel[];
  calibrate: { id: string; kind: 'series' | 'film'; title: string; year?: string; poster?: string; answer: Answer | null }[];
  anchors: { id: string; title: string; poster?: string }[];
}
const card = 'rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-gray-900';
const eyebrow = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300';
const input =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-gray-950';
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'loved', label: 'Loved it' },
  { value: 'want', label: 'Want to' },
  { value: 'not', label: 'Not me' },
];

export default function TastePage() {
  const [data, setData] = useState<TasteData>();
  const [draft, setDraft] = useState<TasteCard>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await feedApi<TasteData>('unwind/taste');
      setData(d);
      setDraft(d.taste);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const edit = (patch: Partial<TasteCard>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setSaved(false);
  };
  const setNever = (i: number, patch: Partial<NeverRule>) => edit({ never: draft!.never.map((n, j) => (j === i ? { ...n, ...patch } : n)) });
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await feedApi('unwind/taste', { summary: draft.summary, moods: draft.moods, anchors: draft.anchors, never: draft.never });
      await load();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const answer = async (id: string, a: Answer | null) => {
    setData((d) => d && { ...d, calibrate: d.calibrate.map((c) => (c.id === id ? { ...c, answer: a } : c)) });
    try {
      await feedApi('unwind/calibrate', { id, answer: a });
      if (!dirty) await load();
    } catch (e) {
      setError((e as Error).message);
      void load();
    }
  };
  const channel = async (channelId: string, approved: boolean) => {
    try {
      await feedApi('unwind/channel', { channelId, approved });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className={`${serif.variable} min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
      <AppHeader title="Media" subtitle="Taste card" />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
        <section className={`relative overflow-hidden rounded-3xl ${DUSK} px-5 py-6 text-white sm:px-8 sm:py-8`}>
          <DuskSky sun="sm" />
          <div className="relative flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <Link href="/media/unwind" className="inline-flex items-center gap-1 text-xs font-medium text-white/65 hover:text-white">
                <ArrowLeft size={13} /> Unwind
              </Link>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-pink-200/90">Taste card</p>
              <h1 className="mt-1 font-[family-name:var(--font-instrument-serif)] text-[38px] leading-[1] sm:text-[48px]">
                What fun looks like <em className="text-[#ffc2a8]">for you.</em>
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-white/80">
                OpenClaw reads this before it picks anything for Unwind. Every line is yours to edit, and your votes keep it honest.
              </p>
            </div>
            <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={`${button} bg-white text-[#3b1f5e] hover:bg-white/90`}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null} {saved && !dirty ? 'Saved' : 'Save card'}
            </button>
          </div>
        </section>

        {error && (
          <div role="alert" className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button>
          </div>
        )}

        {!draft || !data ? (
          <p role="status" className="flex items-center gap-2 py-16 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> Loading your taste card…
          </p>
        ) : (
          <>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section aria-labelledby="summary-h" className={card}>
                <p className={eyebrow}>In a sentence or three</p>
                <h2 id="summary-h" className="mb-3 mt-1 text-[15px] font-semibold">What Unwind is for</h2>
                <label htmlFor="summary" className="sr-only">Summary</label>
                <textarea id="summary" rows={5} value={draft.summary} onChange={(e) => edit({ summary: e.target.value })} className={`${input} resize-y leading-relaxed`} />
                <p className="mt-2 text-xs text-gray-500">Version {data.taste.version}. A new version makes OpenClaw re-judge what is waiting.</p>
              </section>

              <section aria-labelledby="judge-h" className={card}>
                <p className={eyebrow}>How a pick is judged</p>
                <h2 id="judge-h" className="mb-3 mt-1 text-[15px] font-semibold">Two scores, and a pick needs both</h2>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="font-semibold">Fun</dt>
                    <dd className="text-gray-600 dark:text-gray-400">Would you enjoy it on an evening off? Lectures and news score low here; they belong in Pretrain.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Fit</dt>
                    <dd className="text-gray-600 dark:text-gray-400">Would the person in your compass be fine having watched it? Brainrot scores low however fun it is.</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-gray-500">In when fun is at least 0.6 and fit at least 0.45.</p>
              </section>
            </div>

            <section aria-labelledby="moods-h" className={`${card} mt-4`}>
              <p className={eyebrow}>You light up for</p>
              <h2 id="moods-h" className="mb-4 mt-1 text-[15px] font-semibold">Moods OpenClaw picks from</h2>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {draft.moods.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`mood-${i}`}>Mood</label>
                    <input id={`mood-${i}`} value={m.name} onChange={(e) => edit({ moods: draft.moods.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} className={`${input} !w-48 shrink-0 font-semibold`} />
                    <label className="sr-only" htmlFor={`mood-ex-${i}`}>Examples</label>
                    <input id={`mood-ex-${i}`} value={m.examples} placeholder="Examples" onChange={(e) => edit({ moods: draft.moods.map((x, j) => (j === i ? { ...x, examples: e.target.value } : x)) })} className={input} />
                    <button type="button" aria-label={`Remove ${m.name}`} onClick={() => edit({ moods: draft.moods.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10">
                      <X size={15} />
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => edit({ moods: [...draft.moods, { name: '', examples: '' }] })} className={`${outline} mt-3`}>
                <Plus size={15} /> Add a mood
              </button>
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="anchors-h" className={card}>
                <p className={eyebrow}>Already loved</p>
                <h2 id="anchors-h" className="mb-4 mt-1 text-[15px] font-semibold">Anchors: “more like these”</h2>
                <ul className="flex flex-wrap gap-3">
                  {data.anchors
                    .filter((a) => draft.anchors.includes(a.id))
                    .map((a) => (
                      <li key={a.id} className="relative w-[84px]">
                        <PosterImg src={a.poster} title={a.title} />
                        <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-gray-600 dark:text-gray-400">{a.title}</p>
                        <button type="button" aria-label={`Remove ${a.title}`} onClick={() => edit({ anchors: draft.anchors.filter((x) => x !== a.id) })} className="absolute -right-1.5 -top-1.5 rounded-full bg-gray-900 p-1 text-white shadow">
                          <X size={11} />
                        </button>
                      </li>
                    ))}
                </ul>
                <p className="mt-3 text-xs text-gray-500">“Loved it” below adds a title here.</p>
              </section>

              <section aria-labelledby="never-h" className={`${card} !border-rose-200 dark:!border-rose-500/30`}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700 dark:text-rose-300">Never, even to unwind</p>
                <h2 id="never-h" className="mb-4 mt-1 text-[15px] font-semibold">Ruled out before the judge sees them</h2>
                <ul className="space-y-4">
                  {draft.never.map((n, i) => (
                    <li key={i} className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <input id={`never-on-${i}`} type="checkbox" checked={n.on} onChange={(e) => setNever(i, { on: e.target.checked })} className="h-[18px] w-[18px] accent-rose-600" />
                        <label htmlFor={`never-on-${i}`} className="sr-only">On</label>
                        <input aria-label="Rule name" value={n.name} onChange={(e) => setNever(i, { name: e.target.value })} className={`${input} font-semibold`} />
                        <button type="button" aria-label={`Remove ${n.name}`} onClick={() => edit({ never: draft.never.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10">
                          <X size={15} />
                        </button>
                      </div>
                      <div key={`${i}:${draft.never.length}`} className="grid gap-1.5 pl-7 sm:grid-cols-2">
                        <input aria-label="Channels" placeholder="Channels: @handle, @handle" defaultValue={n.channels.join(', ')} onBlur={(e) => setNever(i, { channels: list(e.target.value) })} className={`${input} text-xs`} />
                        <input aria-label="Title words" placeholder="Title words: askreddit, …" defaultValue={n.keywords.join(', ')} onBlur={(e) => setNever(i, { keywords: list(e.target.value) })} className={`${input} text-xs`} />
                      </div>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => edit({ never: [...draft.never, { name: '', channels: [], keywords: [], on: true }] })} className={`${outline} mt-3`}>
                  <Plus size={15} /> Add a rule
                </button>
              </section>
            </div>

            <section aria-labelledby="cal-h" className={`${card} mt-4`}>
              <p className={eyebrow}>Calibrate</p>
              <h2 id="cal-h" className="mb-4 mt-1 text-[15px] font-semibold">One tap each. “Want to” puts it on deck.</h2>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {data.calibrate.map((c) => (
                  <li key={c.id}>
                    <PosterImg src={c.poster} title={c.title} kind={c.kind} className={c.answer === 'not' ? 'opacity-40 grayscale' : ''} />
                    <p className="mt-1.5 truncate text-[13px] font-semibold">{c.title}</p>
                    <div role="radiogroup" aria-label={`Your take on ${c.title}`} className="mt-1.5 flex flex-wrap gap-1">
                      {ANSWERS.map((a) => (
                        <button
                          key={a.value}
                          type="button"
                          role="radio"
                          aria-checked={c.answer === a.value}
                          onClick={() => void answer(c.id, c.answer === a.value ? null : a.value)}
                          className={`min-h-[32px] rounded-lg border px-2 text-[11px] font-semibold transition ${c.answer === a.value ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-500/15 dark:text-violet-200' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5'}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section id="channels" aria-labelledby="ch-h" className={`${card} mt-4`}>
              <p className={eyebrow}>Official channels</p>
              <h2 id="ch-h" className="mb-1 mt-1 text-[15px] font-semibold">Studios whose full uploads play in Unwind</h2>
              <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">OpenClaw only uses full episodes from channels you approve here.</p>
              <ul className="space-y-2">
                {data.channels.map((c) => (
                  <li key={c.channelId} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm dark:border-white/10">
                    <span className="min-w-0 flex-1">
                      <a href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                        {c.name}
                      </a>
                      <span className="ml-2 text-xs text-gray-500">{c.approved ? 'Approved' : `Proposed by ${c.proposedBy === 'you' ? 'you' : 'OpenClaw'}`}</span>
                    </span>
                    {!c.approved && (
                      <button type="button" onClick={() => void channel(c.channelId, true)} className={`${outline} !px-2.5 !py-1.5 text-xs`}>
                        <Check size={13} /> Approve
                      </button>
                    )}
                    <button type="button" onClick={() => void channel(c.channelId, false)} className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
                      {c.approved ? 'Remove' : 'Skip'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
