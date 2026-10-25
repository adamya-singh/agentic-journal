'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Film, Heart, Loader2, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import type { AddStatus, Candidate, InboxView, Settings } from '@/lib/media/inbox';

const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed';
const STATUS_LABEL: Record<AddStatus, string> = {
  finished: 'Finished',
  watching: 'Watching',
  want: 'Want to watch',
  none: 'Just add',
};
const EXAMPLES = [
  'finished severance, loved it',
  'the chainsaw anime, want to see',
  'interstellar, keep on disk',
  'halfway through the bear',
];
type Api = <T>(path: string, body?: unknown) => Promise<T>;
type Pending = InboxView['pending'][number];

// The quick-add box: type what you remember, OpenClaw reads it, you confirm the match.
export function QuickAdd({ api, onLibraryChanged }: { api: Api; onLibraryChanged: () => void }) {
  const [inbox, setInbox] = useState<InboxView>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [example, setExample] = useState(0);
  const load = useCallback(async () => {
    try {
      setInbox(await api<InboxView>('/inbox'));
    } catch {
      // The page shows its own load errors; the box just waits for the next poll.
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  // Poll only while OpenClaw has something to read.
  const reading = inbox?.reading.length || 0;
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [reading, load]);
  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 4000);
    return () => clearInterval(t);
  }, []);
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    setError('');
    try {
      const data = await api<InboxView | { title: string; inbox: InboxView }>(path, body);
      if ('inbox' in data) {
        setInbox(data.inbox);
        setAdded(data.title);
        onLibraryChanged();
      } else setInbox(data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!text.trim() || busy) return;
    if (await act('/inbox/add', { text })) setText('');
  };
  const waiting = (inbox?.pending.length || 0) + (inbox?.unmatched.length || 0);
  return (
    <section aria-labelledby="quick-add-heading" className="mb-8">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id="quick-add-heading" className="flex items-center gap-1.5 text-base font-semibold">
            <Sparkles size={16} className="text-indigo-500" /> Add from memory
          </h3>
          <p className="text-xs text-gray-500">
            Type it however it comes to you. OpenClaw works out what you mean, you confirm it below.
          </p>
        </div>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={Math.min(4, Math.max(1, text.split('\n').length))}
            maxLength={2000}
            placeholder={EXAMPLES[example]}
            aria-label="Something you watched or want to watch"
            className="min-h-[44px] w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[15px] outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-700 dark:bg-gray-950 dark:focus:bg-gray-950"
          />
          <button
            type="submit"
            className={`${button} h-[44px] shrink-0 bg-indigo-600 !px-4 text-white hover:!bg-indigo-700`}
            disabled={busy || !text.trim()}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span className="hidden sm:inline">Add</span>
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {added && (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <Check size={14} /> Added {added} to your library.
            <button className="ml-1 text-gray-400 hover:text-gray-600" aria-label="Dismiss" onClick={() => setAdded('')}>
              <X size={13} />
            </button>
          </p>
        )}
        {inbox && (inbox.reading.length > 0 || inbox.failed.length > 0) && (
          <ul className="mt-3 space-y-1.5">
            {inbox.reading.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200"
              >
                <Loader2 size={14} className="shrink-0 animate-spin" />
                <span className="min-w-0 flex-1 truncate">
                  {r.status === 'reading' ? 'OpenClaw is reading' : 'Waiting for OpenClaw'} “{r.text}”
                </span>
                {r.status === 'queued' && (
                  <button
                    className="text-indigo-400 hover:text-indigo-700"
                    aria-label={`Cancel “${r.text}”`}
                    disabled={busy}
                    onClick={() => void act('/inbox/dismiss-entry', { id: r.id })}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
            {inbox.failed.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-sm dark:border-amber-900"
              >
                <span className="min-w-0 flex-1">
                  “{f.text}” <span className="text-amber-700 dark:text-amber-300">· {f.error}</span>
                </span>
                <button className={`${button} !px-2 !py-1 !text-xs`} disabled={busy} onClick={() => void act('/inbox/retry', { id: f.id })}>
                  <RotateCcw size={12} /> Retry
                </button>
                <button
                  className={`${button} !px-2 !py-1 !text-xs text-gray-500`}
                  disabled={busy}
                  onClick={() => void act('/inbox/dismiss-entry', { id: f.id })}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {inbox && waiting > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold">
            Waiting for you <span className="font-normal text-gray-500">· {waiting} to confirm</span>
          </h4>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {inbox.pending.map((p) => (
              <PendingCard key={p.id} p={p} busy={busy} act={act} />
            ))}
            {inbox.unmatched.map((u) => (
              <Unmatched key={u.id} u={u} busy={busy} act={act} />
            ))}
          </div>
        </div>
      )}
      {inbox && inbox.recent.some((r) => r.state === 'added') && !waiting && (
        <p className="mt-2 truncate px-1 text-xs text-gray-500">
          Recently added:{' '}
          {inbox.recent
            .filter((r) => r.state === 'added')
            .map((r) => r.title)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

function startSettings(p: Pending, pick: string): Settings {
  const known = p.known[pick] || {};
  return {
    // What you just said wins; otherwise keep how it already sits in your library.
    status: p.settings.status !== 'none' ? p.settings.status : known.status || 'none',
    favorite: p.settings.favorite || !!known.favorite,
    download: p.settings.download || !!known.download,
  };
}

function PendingCard({
  p,
  busy,
  act,
}: {
  p: Pending;
  busy: boolean;
  act: (path: string, body: unknown) => Promise<boolean>;
}) {
  const [pick, setPick] = useState(p.candidates[0].id);
  const [settings, setSettings] = useState<Settings>(() => startSettings(p, p.candidates[0].id));
  const touched = useRef(false);
  const [hinting, setHinting] = useState(false);
  const [hint, setHint] = useState('');
  const choose = (id: string) => {
    setPick(id);
    if (!touched.current) setSettings(startSettings(p, id));
  };
  const set = (patch: Partial<Settings>) => {
    touched.current = true;
    setSettings((s) => ({ ...s, ...patch }));
  };
  const picked = p.candidates.find((c) => c.id === pick)!;
  const inLibrary = !!p.known[pick];
  const toImdb =
    (settings.status === 'finished' && p.known[pick]?.status !== 'finished') ||
    (settings.status === 'want' && !p.known[pick]?.status);
  return (
    <article className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-gray-500" title={p.text}>
            “{p.phrase}”
          </p>
          {p.note && <p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-300">OpenClaw: {p.note}</p>}
          {p.fallback && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
              OpenClaw couldn’t be reached, so these are IMDb’s matches for your words.
              <button
                className="font-medium underline underline-offset-2"
                disabled={busy}
                onClick={() => void act('/inbox/retry', { id: p.entryId })}
              >
                Ask OpenClaw again
              </button>
            </p>
          )}
        </div>
        <button
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          aria-label={`Skip “${p.phrase}”`}
          title="Skip"
          disabled={busy}
          onClick={() => void act('/inbox/dismiss', { id: p.id })}
        >
          <X size={16} />
        </button>
      </div>
      <div role="radiogroup" aria-label="Which one you meant" className="mt-3 grid max-w-[440px] grid-cols-4 gap-2">
        {p.candidates.map((c) => (
          <Option key={c.id} c={c} selected={c.id === pick} known={!!p.known[c.id]} onPick={() => choose(c.id)} />
        ))}
      </div>
      <p className="mt-2 text-sm">
        <a href={`https://www.imdb.com/title/${picked.id}/`} target="_blank" rel="noreferrer" className="font-semibold hover:text-indigo-500">
          {picked.title}
        </a>
        <span className="text-gray-500">
          {' '}
          · {[picked.year, picked.label].filter(Boolean).join(' · ')}
          {picked.cast && ` · ${picked.cast}`}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Where you are with it" className="flex flex-wrap rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {(['finished', 'watching', 'want', 'none'] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={settings.status === s}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${settings.status === s ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
              onClick={() => set({ status: s })}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <Toggle on={settings.favorite} onClick={() => set({ favorite: !settings.favorite })} label="Favorite" tone="rose">
          <Heart size={13} fill={settings.favorite ? 'currentColor' : 'none'} />
        </Toggle>
        <Toggle on={settings.download} onClick={() => set({ download: !settings.download })} label="Keep on disk" tone="sky">
          <Download size={13} />
        </Toggle>
      </div>
      {hinting ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (hint.trim() && (await act('/inbox/clarify', { id: p.id, hint }))) setHinting(false);
          }}
        >
          <input
            autoFocus
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={500}
            placeholder="Which one, then? e.g. the 2008 one with Christian Bale"
            aria-label="Which one you meant"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950"
          />
          <button className={`${button} !py-1.5 bg-gray-900 text-white hover:!bg-gray-700 dark:bg-gray-100 dark:text-gray-900`} disabled={busy || !hint.trim()}>
            Ask
          </button>
          <button type="button" className={`${button} !py-1.5 text-gray-500`} onClick={() => setHinting(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button className={`${button} !px-2 !py-1.5 !text-xs text-gray-500`} disabled={busy} onClick={() => setHinting(true)}>
            None of these
          </button>
          <div className="flex items-center gap-2">
            {toImdb && <span className="text-[11px] text-gray-400">Also saves to IMDb</span>}
            <button
              className={`${button} bg-indigo-600 !py-1.5 text-white hover:!bg-indigo-700`}
              disabled={busy}
              onClick={() => void act('/inbox/confirm', { id: p.id, pick, settings })}
            >
              <Check size={14} /> {inLibrary ? 'Update' : 'Add to library'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function Option({ c, selected, known, onPick }: { c: Candidate; selected: boolean; known: boolean; onPick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      aria-label={`${c.title}${c.year ? ` (${c.year})` : ''}, ${c.label}`}
      title={`${c.title}${c.year ? ` (${c.year})` : ''} · ${c.label}`}
      onClick={onPick}
      className={`group relative overflow-hidden rounded-lg text-left ring-offset-2 transition focus-visible:outline-none dark:ring-offset-gray-900 ${selected ? 'ring-2 ring-indigo-500' : 'opacity-70 hover:opacity-100'}`}
    >
      <div className="aspect-[2/3] bg-gray-100 dark:bg-gray-800">
        {c.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.poster} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
            <Film size={24} />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-1.5 pb-1 pt-5 text-white">
        <p className="line-clamp-2 text-[11px] font-semibold leading-tight">{c.title}</p>
        <p className="text-[10px] text-white/75">{[c.year, c.type === 'Movie' ? null : 'Series'].filter(Boolean).join(' · ')}</p>
      </div>
      {selected && (
        <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white">
          <Check size={12} />
        </span>
      )}
      {known && (
        <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-semibold text-white">In library</span>
      )}
    </button>
  );
}

function Toggle({
  on,
  onClick,
  label,
  tone,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  tone: 'rose' | 'sky';
  children: React.ReactNode;
}) {
  const active =
    tone === 'rose'
      ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
      : 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${on ? active : 'border-gray-200 text-gray-500 hover:text-gray-800 dark:border-gray-700 dark:hover:text-gray-200'}`}
    >
      {children} {label}
    </button>
  );
}

function Unmatched({
  u,
  busy,
  act,
}: {
  u: InboxView['unmatched'][number];
  busy: boolean;
  act: (path: string, body: unknown) => Promise<boolean>;
}) {
  const [hint, setHint] = useState('');
  return (
    <article className="min-w-0 rounded-2xl border border-dashed border-gray-300 p-4 text-sm dark:border-gray-700">
      <p className="text-gray-500">“{u.phrase}”</p>
      <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
        Nothing on IMDb matched{u.note ? `. OpenClaw: ${u.note}` : '.'}
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (hint.trim()) void act('/inbox/clarify', { id: u.id, hint });
        }}
      >
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          maxLength={500}
          placeholder="Add a hint: year, an actor, what it’s about"
          aria-label={`A hint for “${u.phrase}”`}
          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 dark:border-gray-700 dark:bg-gray-950"
        />
        <button className={`${button} !py-1.5`} disabled={busy || !hint.trim()}>
          Ask
        </button>
        <button type="button" className={`${button} !py-1.5 text-gray-500`} disabled={busy} onClick={() => void act('/inbox/dismiss', { id: u.id })}>
          Skip
        </button>
      </form>
    </article>
  );
}
