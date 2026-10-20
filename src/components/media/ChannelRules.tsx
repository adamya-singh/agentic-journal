'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { ChannelRule, ChannelRuleRow, Previous } from '@/lib/media/youtube-store';

const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed';
const small = '!px-2.5 !py-1 !text-xs';
const outline = 'border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';
const keepClass =
  'border border-emerald-600 text-emerald-700 hover:!bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:!bg-emerald-950';
const skipClass = `${outline} text-gray-600 dark:text-gray-300`;
const segment =
  'px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-not-allowed';

type Rules = Record<string, ChannelRule | null>;
type Saved = { previous: Previous; previousRules: Rules };
async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/media/youtube${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const p = await r.json();
  if (!r.ok || !p.success) throw new Error(p.error || 'Channel rules could not be loaded.');
  return p.data;
}

// The same per-channel avatar colors as the channel cards.
const AVATAR = [
  'bg-indigo-500',
  'bg-teal-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-orange-600',
];
const avatar = (key: string) =>
  AVATAR[[...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];
const names = (rows: ChannelRuleRow[]) =>
  rows.length <= 3
    ? rows.map((c) => c.name).join(', ')
    : `${rows
        .slice(0, 3)
        .map((c) => c.name)
        .join(', ')} and ${rows.length - 3} more`;
const waiting = (rows: ChannelRuleRow[]) => rows.reduce((n, c) => n + c.arrived, 0);
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

type View = 'rules' | 'kept' | 'skipped' | 'all';
// Everything you decided went one way, and anything waiting came after that:
// the channels where "Remember" was most likely forgotten.
const keptAll = (c: ChannelRuleRow) => c.kept > 0 && !c.skipped && c.pending === c.arrived;
const skippedAll = (c: ChannelRuleRow) => c.skipped > 0 && !c.kept && c.pending === c.arrived;
const VIEWS: { id: View; label: string; match: (c: ChannelRuleRow) => boolean; empty: string }[] = [
  {
    id: 'rules',
    label: 'With a rule',
    match: (c) => !!c.rule,
    empty:
      'No channel has a rule yet. Set one here, or tick “Remember for new videos” on a channel.',
  },
  {
    id: 'kept',
    label: 'Kept everything',
    match: keptAll,
    empty: 'No channel has every decided video kept yet.',
  },
  {
    id: 'skipped',
    label: 'Skipped everything',
    match: skippedAll,
    empty: 'No channel has every decided video skipped yet.',
  },
  { id: 'all', label: 'All channels', match: () => true, empty: 'No channels yet.' },
];

/**
 * What happens to new videos from each channel: always keep, always skip, or
 * ask each time. Sits above the channel list; offers to make a rule for
 * channels you decided wholesale without ticking "Remember".
 */
export function ChannelRules({
  version,
  onChanged,
}: {
  // Bumped by the page after decisions elsewhere, so counts and rules reload.
  version: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<ChannelRuleRow[]>();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('rules');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; saved: Saved }>();
  const load = useCallback(async () => {
    try {
      setRows((await call<{ channels: ChannelRuleRow[] }>('/rules')).channels);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Channel rules could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async (rules: Rules, text: string) => {
    setBusy(true);
    try {
      const saved = await call<Saved>('/rules', { rules });
      await load();
      onChanged();
      const n = Object.keys(saved.previous).length;
      if (Object.keys(saved.previousRules).length)
        setToast({
          text: n
            ? `${text}. ${plural(n, 'waiting video')} ${Object.values(rules).includes('skip') ? 'skipped' : 'kept'} now.`
            : text,
          saved,
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const undo = async ({ previous, previousRules }: Saved) => {
    setToast(undefined);
    try {
      await call('/restore', { previous, rules: previousRules });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed.');
    }
  };

  if (!rows) return null;
  const keeping = rows.filter((c) => c.rule === 'keep').length;
  const skipping = rows.filter((c) => c.rule === 'skip').length;
  // Channels decided wholesale without "Remember": the likely missing rules.
  const keptNoRule = rows.filter((c) => keptAll(c) && !c.rule);
  const skippedNoRule = rows.filter((c) => skippedAll(c) && !c.rule);
  const show = (v: View) => {
    setView(v);
    setShown(20);
    setOpen(true);
  };
  const q = query.trim().toLowerCase();
  const current = VIEWS.find((v) => v.id === view)!;
  const listed = rows.filter(
    (c) =>
      current.match(c) &&
      (!q || c.name.toLowerCase().includes(q) || c.handle?.toLowerCase().includes(q)),
  );

  const suggestion = (list: ChannelRuleRow[], rule: ChannelRule) =>
    list.length > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
        <p className="min-w-0 flex-1 basis-64 text-sm text-gray-600 dark:text-gray-300">
          You {rule === 'keep' ? 'kept' : 'skipped'} everything you decided from{' '}
          <b className="text-gray-900 dark:text-gray-100">{plural(list.length, 'channel')}</b>{' '}
          without a rule: {names(list)}.
          {waiting(list) > 0 &&
            ` ${plural(waiting(list), 'newer video')} from them ${waiting(list) === 1 ? 'is' : 'are'} waiting and would be ${rule === 'keep' ? 'kept' : 'skipped'} too.`}
        </p>
        <span className="flex gap-2">
          <button
            className={`${button} ${small} ${rule === 'keep' ? keepClass : skipClass}`}
            disabled={busy}
            onClick={() =>
              void save(
                Object.fromEntries(list.map((c) => [c.key, rule])),
                `New videos from ${plural(list.length, 'channel')} will be ${rule === 'keep' ? 'kept' : 'skipped'}`,
              )
            }
          >
            {list.length === 1 ? `Always ${rule} its videos` : `Always ${rule} all ${list.length}`}
          </button>
          <button
            className={`${button} ${small} ${outline}`}
            onClick={() => show(rule === 'keep' ? 'kept' : 'skipped')}
          >
            Choose
          </button>
        </span>
      </div>
    );

  return (
    <section
      aria-labelledby="channel-rules-heading"
      className="mb-5 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 id="channel-rules-heading" className="font-semibold">
            New videos
          </h4>
          <p className="text-sm text-gray-500">
            {keeping || skipping ? (
              <>
                {keeping > 0 && (
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">
                    {plural(keeping, 'channel')} always kept
                  </span>
                )}
                {keeping > 0 && skipping > 0 && ' · '}
                {skipping > 0 && (
                  <span className="font-medium text-gray-700 dark:text-gray-200">
                    {plural(skipping, 'channel')} always skipped
                  </span>
                )}
                {' · '}every other channel asks each time.
              </>
            ) : (
              'Every channel asks each time. A rule decides its new videos for you.'
            )}
          </p>
        </div>
        <button
          className={`${button} ${small} ${outline}`}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : show(keeping || skipping ? 'rules' : 'all'))}
        >
          {open ? 'Close' : 'Manage rules'}
          <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {suggestion(keptNoRule, 'keep')}
      {suggestion(skippedNoRule, 'skip')}
      {open && (
        <div className="grid gap-3 border-t border-gray-200 pt-3 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={`${button} ${small} rounded-full ${view === v.id ? 'bg-gray-900 text-white hover:!bg-gray-800 dark:bg-gray-100 dark:text-gray-900' : outline}`}
                  aria-pressed={view === v.id}
                  onClick={() => {
                    setView(v.id);
                    setShown(20);
                  }}
                >
                  {v.label}
                  <span className="tabular-nums opacity-60">{rows.filter(v.match).length}</span>
                </button>
              ))}
            </div>
            <label className="relative w-full sm:w-56">
              <span className="sr-only">Find a channel</span>
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(20);
                }}
                placeholder="Find a channel"
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-sm placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-950"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            A rule decides new videos from later syncs, and catches up on ones that arrived since
            you last decided that channel. Other waiting videos stay for you.
          </p>
          {listed.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">
              {q ? `No channel matches “${query.trim()}”.` : current.empty}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {listed.slice(0, shown).map((c) => (
                <li
                  key={c.key}
                  className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-2 sm:grid-cols-[28px_minmax(0,1fr)_auto]"
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white ${avatar(c.key)}`}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.name}
                      {c.handle && <span className="font-normal text-gray-500"> {c.handle}</span>}
                    </p>
                    <p className="text-xs tabular-nums text-gray-500">
                      {c.kept > 0 && `Kept ${c.kept}`}
                      {c.kept > 0 && (c.skipped > 0 || c.pending > 0) && ' · '}
                      {c.skipped > 0 && `Skipped ${c.skipped}`}
                      {c.skipped > 0 && c.pending > 0 && ' · '}
                      {c.pending > 0 &&
                        (c.arrived === c.pending
                          ? `${c.pending} new since you decided`
                          : `${c.pending} to decide`)}
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label={`New videos from ${c.name}`}
                    className="col-span-2 inline-flex justify-self-start overflow-hidden rounded-lg border border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900 sm:col-span-1 sm:justify-self-end"
                  >
                    {(
                      [
                        ['keep', 'Always keep'],
                        [null, 'Ask'],
                        ['skip', 'Always skip'],
                      ] as const
                    ).map(([rule, label], i) => {
                      const on = (c.rule ?? null) === rule;
                      return (
                        <button
                          key={label}
                          className={`${segment} ${i ? 'border-l border-gray-300 dark:border-gray-700' : ''} ${
                            on
                              ? rule === 'keep'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : rule === 'skip'
                                  ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900'
                                  : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                          }`}
                          aria-pressed={on}
                          disabled={busy}
                          onClick={() =>
                            !on &&
                            void save(
                              { [c.key]: rule },
                              rule
                                ? `New videos from ${c.name} will always be ${rule === 'keep' ? 'kept' : 'skipped'}`
                                : `${c.name} will ask about new videos`,
                            )
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {listed.length > shown && (
            <button className={`${button} ${outline} w-full`} onClick={() => setShown(shown + 20)}>
              Show more ({listed.length - shown} left)
            </button>
          )}
        </div>
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
        >
          {toast.text}
          <button className="font-semibold underline" onClick={() => void undo(toast.saved)}>
            Undo
          </button>
        </div>
      )}
    </section>
  );
}
