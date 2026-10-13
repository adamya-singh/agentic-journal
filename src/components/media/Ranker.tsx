'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Film, Loader2, Undo2, X } from 'lucide-react';
import type { MediaTitle, MediaView, Ranking, Tier } from '@/lib/media/types';
import {
  TIERS,
  TIER_LABEL,
  applyRankOp,
  rankedList,
  unsorted,
  type RankOp,
} from '@/lib/media/ranking';

// Literal class names so Tailwind keeps them.
export const TIER_CLASS: Record<Tier, string> = {
  S: 'bg-amber-400 text-amber-950',
  A: 'bg-indigo-500 text-white',
  B: 'bg-teal-500 text-teal-950',
  C: 'bg-gray-400 text-gray-900 dark:bg-gray-600 dark:text-white',
};
const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50';
const kbd =
  'rounded border border-b-2 border-gray-200 px-1 text-[11px] font-semibold dark:border-gray-700';

export function Poster({ title, className = '' }: { title?: MediaTitle; className?: string }) {
  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800 ${className}`}
    >
      {title?.poster && title.source === 'youtube' ? (
        <VideoFrame src={title.poster} />
      ) : title?.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={title.poster}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-gray-400">
          <Film size={18} />
        </div>
      )}
    </div>
  );
}

// A 16:9 video thumbnail inside a 2:3 poster frame: the whole frame stays
// visible over a blurred copy, so videos line up with posters in every row.
export function VideoFrame({ src }: { src: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-md"
        referrerPolicy="no-referrer"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="relative h-full w-full object-contain"
        referrerPolicy="no-referrer"
      />
      <span className="absolute bottom-1 right-1 h-2.5 w-3.5 rounded-[3px] bg-red-600 after:absolute after:left-[5px] after:top-[3px] after:border-y-[2.25px] after:border-l-[4px] after:border-y-transparent after:border-l-white after:content-['']" />
    </>
  );
}

const meta = (t?: MediaTitle) =>
  t?.source === 'youtube'
    ? [t.channel, 'YouTube'].filter(Boolean).join(' · ')
    : [
        t?.year,
        t?.type === 'TVSeries' ? 'Series' : t?.type,
        t?.imdbRating ? `IMDb ${t.imdbRating}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

interface Bounds {
  id: string;
  tier: Tier;
  lo: number;
  hi: number;
}
interface UndoEntry {
  ranking: Ranking;
  bounds?: Bounds;
  focusTier?: Tier;
  // Restores the server copy; absent when only the local search range changed.
  revert?: RankOp;
}

// Picks still needed: each new title costs about log2(n + 1) picks against n placed titles.
function picksLeft(r: Ranking, b?: Bounds) {
  let n = 0;
  for (const t of TIERS) {
    let have = r.tiers[t].length;
    for (const id of r.pending[t]) {
      n += b?.id === id ? Math.ceil(Math.log2(b.hi - b.lo + 1)) : Math.ceil(Math.log2(have + 1));
      have++;
    }
  }
  return n;
}

interface RankerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MediaView;
  // Rank one title (a new watch or a move) instead of working through the backlog.
  focusId?: string;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  onSaved: (view: MediaView) => void;
}

export function Ranker({ open, onOpenChange, data, focusId, api, onSaved }: RankerProps) {
  const [ranking, setRanking] = useState<Ranking>(data.ranking);
  const [bounds, setBounds] = useState<Bounds>();
  const [focusTier, setFocusTier] = useState<Tier>();
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [error, setError] = useState('');
  const [synced, setSynced] = useState<string>();
  const [saving, setSaving] = useState(0);
  const chain = useRef(Promise.resolve());
  const changed = useRef(false);

  const titles = useMemo(() => {
    const m: Record<string, MediaTitle> = {};
    for (const t of [...data.dismissed, ...data.picks, ...data.library]) m[t.id] = t;
    return m;
  }, [data]);

  // Each opening starts from the server's ranking; later polls do not reset work in progress.
  useEffect(() => {
    if (!open) return;
    setRanking(data.ranking);
    setBounds(undefined);
    setFocusTier(undefined);
    setUndo([]);
    setError('');
    setSynced(undefined);
    changed.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId]);

  const send = useCallback(
    (op: RankOp) => {
      changed.current = true;
      setSynced(undefined);
      setSaving((n) => n + 1);
      chain.current = chain.current
        .then(() => api<MediaView>('/ranking', op))
        .then(onSaved)
        .catch((e) =>
          setError(
            e instanceof Error
              ? `${e.message} Close and reopen the ranker to continue.`
              : 'Your ranking could not be saved.',
          ),
        )
        .finally(() => setSaving((n) => n - 1));
    },
    [api, onSaved],
  );

  const backlog = useMemo(() => unsorted(ranking, data.library), [ranking, data.library]);
  const focusPlaced = !!focusId && !!focusTier && ranking.tiers[focusTier].includes(focusId);
  type Step =
    | { kind: 'tier'; id: string }
    | { kind: 'compare'; id: string; tier: Tier }
    | { kind: 'done' };
  const step: Step = useMemo(() => {
    if (focusId) {
      if (!focusTier) return { kind: 'tier', id: focusId };
      if (focusPlaced) return { kind: 'done' };
      return { kind: 'compare', id: focusId, tier: focusTier };
    }
    if (backlog.length) return { kind: 'tier', id: backlog[0] };
    const tier = TIERS.find((t) => ranking.pending[t].length);
    return tier ? { kind: 'compare', id: ranking.pending[tier][0], tier } : { kind: 'done' };
  }, [focusId, focusTier, focusPlaced, backlog, ranking]);

  const b: Bounds | undefined =
    step.kind === 'compare'
      ? bounds?.id === step.id
        ? bounds
        : { id: step.id, tier: step.tier, lo: 0, hi: ranking.tiers[step.tier].length }
      : undefined;

  const remember = (revert?: RankOp) =>
    setUndo((u) => [...u.slice(-60), { ranking, bounds: b, focusTier, revert }]);

  const chooseTier = (tier: Tier | 'skip') => {
    if (step.kind !== 'tier') return;
    const op: RankOp =
      tier === 'skip' ? { op: 'skip', id: step.id } : { op: 'tier', id: step.id, tier };
    const wasRanked = rankedList(ranking).find((x) => x.id === step.id);
    remember(
      wasRanked
        ? {
            op: 'place',
            id: step.id,
            tier: wasRanked.tier,
            index: ranking.tiers[wasRanked.tier].indexOf(step.id),
          }
        : { op: 'unrank', id: step.id },
    );
    setRanking(applyRankOp(ranking, op));
    if (focusId && tier !== 'skip') setFocusTier(tier);
    send(op);
  };

  const answer = (better: boolean | 'same') => {
    if (step.kind !== 'compare' || !b) return;
    const mid = Math.floor((b.lo + b.hi) / 2);
    let { lo, hi } = b;
    if (better === 'same') lo = hi = mid + 1;
    else if (better) hi = mid;
    else lo = mid + 1;
    if (lo < hi) {
      remember();
      setBounds({ ...b, lo, hi });
      return;
    }
    const op: RankOp = { op: 'place', id: b.id, tier: b.tier, index: lo };
    remember({ op: 'tier', id: b.id, tier: b.tier });
    setRanking(applyRankOp(ranking, op));
    setBounds(undefined);
    send(op);
  };

  const back = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo(undo.slice(0, -1));
    setRanking(last.ranking);
    setBounds(last.bounds);
    setFocusTier(last.focusTier);
    if (last.revert) send(last.revert);
  };

  // Scores go to IMDb once the backlog (or the single title) is fully placed.
  useEffect(() => {
    if (!open || step.kind !== 'done' || !changed.current || synced !== undefined) return;
    setSynced('');
    chain.current = chain.current
      .then(() => api<{ queued: number; waiting: number; view: MediaView }>('/ranking/sync', {}))
      .then((r) => {
        onSaved(r.view);
        setSynced(
          r.queued
            ? `Sending ${r.queued} ${r.queued === 1 ? 'score' : 'scores'} to IMDb${r.waiting ? `; ${r.waiting} more after the current saves finish` : ''}.`
            : r.waiting
              ? `${r.waiting} ${r.waiting === 1 ? 'score waits' : 'scores wait'} for the current IMDb saves to finish.`
              : 'Ranking saved. IMDb already has the movie and TV scores; YouTube videos stay in the Journal.',
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Scores could not be queued.'));
  }, [open, step.kind, synced, api, onSaved]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const tier = ({ s: 'S', a: 'A', b: 'B', c: 'C', 1: 'S', 2: 'A', 3: 'B', 4: 'C' } as const)[
        k as 's'
      ];
      if (k === 'z') back();
      else if (step.kind === 'tier' && tier) chooseTier(tier);
      else if (step.kind === 'compare' && k === 'arrowleft') answer(true);
      else if (step.kind === 'compare' && k === 'arrowright') answer(false);
      else if (step.kind === 'compare' && k === 'arrowdown') answer('same');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const total = focusId ? 1 : data.library.filter((t) => t.watched || t.yourRating).length;
  const sorted = total - backlog.length;
  const ranked = rankedList(ranking);
  const focusRank = focusId ? ranked.find((x) => x.id === focusId) : undefined;
  const t = step.kind !== 'done' ? titles[step.id] : undefined;
  const stepName = step.kind === 'tier' ? 'sort' : step.kind === 'compare' ? 'order' : 'done';

  const tierStrip = (tier: Tier, ids: string[], extra = '') => (
    <div key={tier} className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2">
      <span
        className={`grid h-8 place-items-center rounded-md text-base font-extrabold ${TIER_CLASS[tier]}`}
      >
        {tier}
      </span>
      <div className="flex min-w-0 flex-wrap gap-0.5">
        {ids.length ? (
          ids.map((id) => (
            <Poster key={id} title={titles[id]} className={`w-[22px] !rounded-sm ${extra}`} />
          ))
        ) : (
          <span className="text-xs text-gray-400">Empty</span>
        )}
      </div>
    </div>
  );

  const side = (id: string, better: boolean, label: string) => {
    const x = titles[id];
    return (
      <button
        onClick={() => answer(better)}
        className="grid min-w-0 justify-items-center gap-2 rounded-2xl border-2 border-transparent p-2 text-center transition hover:border-indigo-500 hover:bg-indigo-50 active:scale-[.98] dark:hover:bg-indigo-950"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {label}
        </span>
        <Poster title={x} className="w-full max-w-[190px] !rounded-xl shadow-md" />
        <span className="font-semibold leading-tight">{x?.title}</span>
        <span className="text-xs text-gray-500">{meta(x)}</span>
      </button>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[94vh] w-[min(96vw,980px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
            <div>
              <Dialog.Title className="text-lg font-semibold">
                {focusId ? `Rank ${titles[focusId]?.title || 'this title'}` : 'Rank your media'}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-gray-500">
                {focusId
                  ? 'Pick a tier, then a few head-to-head picks find its exact place.'
                  : 'Sort each title into a tier, then head-to-head picks set the exact order.'}
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {!focusId &&
                (['sort', 'order', 'done'] as const).map((s, i) => (
                  <span
                    key={s}
                    className={`hidden items-center gap-1.5 sm:flex ${stepName === s ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}
                  >
                    <b
                      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${stepName === s ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}
                    >
                      {i + 1}
                    </b>
                    {s === 'sort'
                      ? `Tiers · ${sorted}/${total}`
                      : s === 'order'
                        ? `Order${stepName === 'order' ? ` · ≈${picksLeft(ranking, b)} picks` : ''}`
                        : 'Ranked'}
                  </span>
                ))}
              {saving > 0 && <Loader2 size={15} className="animate-spin text-gray-400" />}
              <Dialog.Close className={button} aria-label="Close ranker">
                <X size={16} />
              </Dialog.Close>
            </div>
          </div>
          {error && (
            <p
              role="alert"
              className="mx-5 mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
          <div className="overflow-y-auto p-5">
            {step.kind === 'tier' && (
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid justify-items-center gap-2 text-center">
                  {!focusId && (
                    <span className="text-xs text-gray-500">
                      {sorted + 1} of {total}
                    </span>
                  )}
                  <Poster title={t} className="w-40 !rounded-xl shadow-lg sm:w-48" />
                  <h3 className="mt-1 text-xl font-semibold">{t?.title}</h3>
                  <p className="text-sm text-gray-500">{meta(t)}</p>
                  <div className="mt-2 grid w-full max-w-lg grid-cols-4 gap-2">
                    {TIERS.map((tier) => (
                      <button
                        key={tier}
                        onClick={() => chooseTier(tier)}
                        className={`grid justify-items-center gap-0.5 rounded-xl px-1 pb-2 pt-3 transition hover:-translate-y-0.5 hover:brightness-105 ${TIER_CLASS[tier]}`}
                      >
                        <b className="text-3xl font-extrabold leading-none">{tier}</b>
                        <span className="text-xs font-semibold opacity-80">{TIER_LABEL[tier]}</span>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-center gap-1">
                    {!focusId && (
                      <button
                        className={`${button} text-gray-500`}
                        onClick={() => chooseTier('skip')}
                      >
                        Didn&apos;t really watch it
                      </button>
                    )}
                    <button
                      className={`${button} text-gray-500`}
                      onClick={back}
                      disabled={!undo.length}
                    >
                      <Undo2 size={14} /> Undo
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    <kbd className={kbd}>S</kbd> <kbd className={kbd}>A</kbd>{' '}
                    <kbd className={kbd}>B</kbd> <kbd className={kbd}>C</kbd> pick a tier ·{' '}
                    <kbd className={kbd}>Z</kbd> undo
                  </p>
                </div>
                <aside className="grid content-start gap-2 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <h4 className="text-sm font-semibold">Tiers so far</h4>
                  {TIERS.map((tier) =>
                    tierStrip(tier, [...ranking.tiers[tier], ...ranking.pending[tier]]),
                  )}
                </aside>
              </div>
            )}
            {step.kind === 'compare' && b && (
              <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
                <div>
                  <h3 className="text-center text-2xl font-semibold tracking-tight">
                    Which was better?
                  </h3>
                  <p className="mt-1 text-center text-sm text-gray-500">
                    {focusId ? 'Placing' : 'Ordering'} the {b.tier} tier · at most{' '}
                    {Math.ceil(Math.log2(b.hi - b.lo + 1))} more for this title
                  </p>
                  <div className="mx-auto mt-4 grid max-w-xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                    {side(b.id, true, focusId ? 'This one' : 'New to the order')}
                    <span className="text-sm font-semibold text-gray-400">or</span>
                    {side(
                      ranking.tiers[b.tier][Math.floor((b.lo + b.hi) / 2)],
                      false,
                      `#${Math.floor((b.lo + b.hi) / 2) + 1} in ${b.tier}`,
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <button
                      className={`${button} border border-gray-200 dark:border-gray-700`}
                      onClick={() => answer('same')}
                    >
                      About the same
                    </button>
                    <button
                      className={`${button} text-gray-500`}
                      onClick={back}
                      disabled={!undo.length}
                    >
                      <Undo2 size={14} /> Undo
                    </button>
                  </div>
                  <p className="mt-2 text-center text-xs text-gray-500">
                    <kbd className={kbd}>←</kbd> <kbd className={kbd}>→</kbd> pick ·{' '}
                    <kbd className={kbd}>↓</kbd> about the same · <kbd className={kbd}>Z</kbd> undo
                  </p>
                </div>
                <aside className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <h4 className="text-sm font-semibold">{b.tier} tier, in order</h4>
                  <p className="text-xs text-gray-500">It goes somewhere in the highlight.</p>
                  <ol className="mt-2 grid gap-0.5">
                    {ranking.tiers[b.tier].map((id, i) => {
                      const inside = i >= b.lo && i < b.hi,
                        mid = i === Math.floor((b.lo + b.hi) / 2);
                      return (
                        <li
                          key={id}
                          className={`grid grid-cols-[22px_24px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-0.5 text-[13px] ${inside ? 'bg-indigo-50 text-gray-900 dark:bg-indigo-950 dark:text-gray-100' : 'text-gray-400'} ${mid ? 'ring-2 ring-inset ring-indigo-500' : ''}`}
                        >
                          <span className="text-right text-xs tabular-nums">{i + 1}</span>
                          <Poster
                            title={titles[id]}
                            className={`w-6 !rounded-sm ${inside ? '' : 'opacity-40'}`}
                          />
                          <span className="truncate">{titles[id]?.title}</span>
                        </li>
                      );
                    })}
                  </ol>
                </aside>
              </div>
            )}
            {step.kind === 'done' && (
              <div className="grid gap-4">
                {focusRank ? (
                  <p className="text-lg font-semibold">
                    {titles[focusRank.id]?.title} is #{focusRank.rank} · {focusRank.tier} ·{' '}
                    {focusRank.score}/10
                  </p>
                ) : (
                  <p className="text-lg font-semibold">All {ranked.length} ranked.</p>
                )}
                <p className="text-sm text-gray-500" role="status">
                  {synced === undefined || synced === ''
                    ? changed.current
                      ? 'Queuing IMDb scores…'
                      : 'Nothing changed.'
                    : synced}
                </p>
                <div className="grid gap-3">
                  {TIERS.filter((tier) => ranking.tiers[tier].length).map((tier) => (
                    <div key={tier} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3">
                      <span
                        className={`grid place-items-center rounded-lg text-2xl font-extrabold ${TIER_CLASS[tier]}`}
                      >
                        {tier}
                      </span>
                      <ol className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5">
                        {ranked
                          .filter((x) => x.tier === tier)
                          .map((x) => (
                            <li
                              key={x.id}
                              className={`grid grid-cols-[24px_28px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-2 py-1 text-[13px] ${x.id === focusId ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'border-gray-200 dark:border-gray-800'}`}
                            >
                              <span className="text-right text-xs tabular-nums text-gray-500">
                                {x.rank}
                              </span>
                              <Poster title={titles[x.id]} className="w-7 !rounded-sm" />
                              <span className="truncate font-medium">{titles[x.id]?.title}</span>
                              <span className="font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">
                                {x.score}/10
                              </span>
                            </li>
                          ))}
                      </ol>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    className={`${button} text-gray-500`}
                    onClick={back}
                    disabled={!undo.length}
                  >
                    <Undo2 size={14} /> Undo
                  </button>
                  <Dialog.Close
                    className={`${button} bg-indigo-600 text-white hover:!bg-indigo-700`}
                  >
                    Done
                  </Dialog.Close>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
