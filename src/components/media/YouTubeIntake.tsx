'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, RotateCcw, X } from 'lucide-react';
import type {
  Bucket,
  ChannelSort,
  ChannelSummary,
  Previous,
  VideoRow,
  VideoStatus,
  YouTubeSummary,
} from '@/lib/media/youtube-store';
import { ChannelRules } from './ChannelRules';

const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed';
const small = '!px-2.5 !py-1 !text-xs';
const outline = 'border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900';
const keepClass =
  'border border-emerald-600 text-emerald-700 hover:!bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:!bg-emerald-950';
const skipClass = `${outline} text-gray-600 dark:text-gray-300`;

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/media/youtube${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const p = await r.json();
  if (!r.ok || !p.success) throw new Error(p.error || 'YouTube could not be loaded.');
  return p.data;
}

export function YouTubeMark({ className = 'h-3.5 w-5' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative inline-block shrink-0 rounded-[4px] bg-red-600 after:absolute after:left-1/2 after:top-1/2 after:-translate-x-[35%] after:-translate-y-1/2 after:border-y-[3.5px] after:border-l-[6px] after:border-y-transparent after:border-l-white after:content-[''] ${className}`}
    />
  );
}

const hours = (sec: number) => {
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
const clock = (sec?: number) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};
const day = (iso?: string) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: iso.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric',
      })
    : '';
// A stable avatar color per channel, from the indigo–teal–amber family the page uses.
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

function Thumb({
  id,
  video,
  className = '',
}: {
  id: string;
  video?: VideoRow;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-video shrink-0 overflow-hidden rounded-md bg-gray-200 dark:bg-gray-800 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
        referrerPolicy="no-referrer"
      />
      {video?.short && (
        <span className="absolute left-1 top-1 rounded bg-red-600 px-1 text-[10px] font-bold text-white">
          SHORT
        </span>
      )}
      {(video?.live || video?.durationSec) && (
        <span className="absolute bottom-1.5 right-1 rounded bg-black/80 px-1 text-[11px] font-semibold tabular-nums text-white">
          {video.live ? 'LIVE' : clock(video.durationSec)}
        </span>
      )}
      {video?.progress !== undefined && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/40">
          <span
            className="block h-full bg-red-600"
            style={{ width: `${Math.round(video.progress * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}

// Videos per page of a grid; four columns at desktop width.
const PAGE = 24;
type GridFilter = { channel: string } | { bucket: Bucket } | { oneOffs: true };
const filterKey = (f: GridFilter) =>
  'channel' in f
    ? `channel=${encodeURIComponent(f.channel)}`
    : 'bucket' in f
      ? `bucket=${f.bucket}`
      : 'oneoffs=1';

// The videos of one channel, bucket or the one-offs, each with its own Keep / Skip.
function VideoGrid({
  filter,
  version,
  onDecided,
}: {
  filter: GridFilter;
  version: number;
  onDecided: (previous: Previous, label: string) => void;
}) {
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [total, setTotal] = useState<number>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  // The filter arrives as a fresh object on every render; key the requests on its value,
  // or each re-render of the page (it polls every few seconds) would refetch the grid.
  const query = filterKey(filter);
  const shown = useRef(PAGE);
  const load = useCallback(
    async (offset: number, limit = PAGE) => {
      try {
        const r = await call<{ total: number; videos: VideoRow[] }>(
          `/videos?${query}&offset=${offset}&limit=${limit}`,
        );
        setTotal(r.total);
        setRows((old) => {
          const next = offset ? [...old, ...r.videos] : r.videos;
          shown.current = Math.max(PAGE, next.length);
          return next;
        });
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Videos could not be loaded.');
      }
    },
    [query],
  );
  // Reload what is shown so far after decisions elsewhere (bulk actions, undo).
  useEffect(() => {
    void load(0, shown.current);
  }, [load, version]);
  const more = async () => {
    setLoadingMore(true);
    await load(rows.length);
    setLoadingMore(false);
  };
  const set = async (v: VideoRow, status: VideoStatus) => {
    const next = v.status === status ? 'pending' : status;
    setBusy(v.id);
    try {
      const r = await call<{ previous: Previous }>('/decide', { ids: [v.id], status: next });
      setRows((old) =>
        old.map((x) => (x.id === v.id ? { ...x, status: next, decidedBy: 'you' } : x)),
      );
      onDecided(r.previous, '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className="col-span-full border-t border-gray-200 pt-3 dark:border-gray-800">
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {/* Columns follow the grid's own width, not the window's: it sits in a full-width
          channel card or under the group cards. Each card's single column may shrink below
          the thumbnail's natural 320px, so cards never spill into their neighbours. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] gap-3">
        {rows.map((v) => (
          <div
            key={v.id}
            className={`grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-1.5 rounded-lg border p-1.5 transition-opacity ${
              v.status === 'kept'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                : v.status === 'skipped'
                  ? 'border-transparent opacity-50'
                  : 'border-transparent'
            }`}
          >
            <a
              href={v.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${v.title} on YouTube`}
            >
              <Thumb id={v.id} video={v} />
            </a>
            <p className="line-clamp-2 text-sm font-medium leading-snug" title={v.title}>
              {v.title}
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-gray-500">
                {'channel' in filter ? '' : `${v.channelName} · `}
                {v.progress !== undefined ? `${Math.round(v.progress * 100)}% · ` : ''}
                {day(v.lastWatchedDay)}
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  className={`${button} ${small} ${keepClass} ${v.status === 'kept' ? '!bg-emerald-100 dark:!bg-emerald-900' : ''}`}
                  aria-pressed={v.status === 'kept'}
                  disabled={busy === v.id}
                  onClick={() => void set(v, 'kept')}
                >
                  Keep
                </button>
                <button
                  className={`${button} ${small} ${skipClass} ${v.status === 'skipped' ? '!bg-gray-100 dark:!bg-gray-800' : ''}`}
                  aria-pressed={v.status === 'skipped'}
                  disabled={busy === v.id}
                  onClick={() => void set(v, 'skipped')}
                >
                  Skip
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
      {total === undefined && !error ? (
        <p role="status" className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Loading videos…
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            Showing {rows.length} of {total}. Kept videos join Your library; skipped ones stay
            hidden.
          </span>
          {rows.length < (total ?? 0) && (
            <button
              className={`${button} ${small} ${outline}`}
              disabled={loadingMore}
              onClick={() => void more()}
            >
              {loadingMore && <Loader2 size={12} className="animate-spin" />} Show more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChannelCard({
  c,
  open,
  version,
  onToggle,
  onAct,
  onDecided,
}: {
  c: ChannelSummary;
  open: boolean;
  version: number;
  onToggle: () => void;
  onAct: (status: 'kept' | 'skipped' | 'pending', remember: boolean) => void;
  onDecided: (previous: Previous, label: string) => void;
}) {
  const [remember, setRemember] = useState(false);
  const done = c.pending === 0;
  return (
    <div
      className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:p-4 ${
        done
          ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950'
          : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
      }`}
    >
      <span
        className={`grid h-10 w-10 place-items-center rounded-full text-base font-bold text-white sm:h-11 sm:w-11 ${avatar(c.key)}`}
      >
        {c.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{c.name}</span>
          {c.kept > 0 && (
            <span className="rounded-md bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Kept {c.kept}
            </span>
          )}
          {c.skipped > 0 && (
            <span className="rounded-md bg-gray-100 px-1.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              Skipped {c.skipped}
            </span>
          )}
          {c.rule && (
            <span className="rounded-md bg-indigo-50 px-1.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
              New videos: always {c.rule}
            </span>
          )}
        </div>
        <p className="text-sm tabular-nums text-gray-500">
          {c.total} videos · {hours(c.watchedSec)} watched
          {c.handle ? ` · ${c.handle}` : ''} · last {day(c.lastWatchedDay)}
        </p>
        {!done && !open && (
          <div className="mt-2 flex gap-1.5 overflow-hidden">
            {c.samples.map((id) => (
              <Thumb key={id} id={id} className="w-[88px] sm:w-[104px]" />
            ))}
          </div>
        )}
      </div>
      <div className="col-span-2 grid justify-items-start gap-2 sm:col-span-1 sm:justify-items-end">
        {done ? (
          <button
            className={`${button} ${small} ${outline}`}
            onClick={() => onAct('pending', false)}
          >
            <RotateCcw size={13} /> Decide again
          </button>
        ) : (
          <div
            role="group"
            aria-label={c.name}
            className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <button
              className="px-3 py-1.5 font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:text-emerald-300 dark:hover:bg-emerald-950"
              onClick={() => onAct('kept', remember)}
            >
              Keep all {c.pending}
            </button>
            <button
              className="border-l border-gray-300 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              onClick={() => onAct('skipped', remember)}
            >
              Skip all
            </button>
            <button
              className={`border-l border-gray-300 px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:border-gray-700 ${
                open
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
              aria-expanded={open}
              onClick={onToggle}
            >
              Pick
            </button>
          </div>
        )}
        {!done && (
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              className="accent-indigo-600"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            Remember for new videos
          </label>
        )}
      </div>
      {open && <VideoGrid filter={{ channel: c.key }} version={version} onDecided={onDecided} />}
    </div>
  );
}

const BUCKETS: { id: Bucket; title: string; text: string }[] = [
  { id: 'barely', title: 'Watched under 20%', text: 'Opened, then left within the first minutes.' },
  { id: 'live', title: 'Live streams', text: 'Streams and premieres that played live.' },
];
const SORTS: { id: ChannelSort; label: string }[] = [
  { id: 'videos', label: 'Most videos' },
  { id: 'hours', label: 'Most hours' },
  { id: 'recent', label: 'Recent' },
];

/**
 * Your YouTube watch history, waiting to be kept or skipped. Whole groups
 * first (barely-watched, live streams, a channel at a time), then single
 * videos where a channel is mixed.
 */
export function YouTubeIntake({
  syncing,
  onLibraryChanged,
  onSync,
}: {
  // A youtube-sync job is queued or running.
  syncing: boolean;
  onLibraryChanged: () => void;
  onSync: () => void;
}) {
  const [data, setData] = useState<YouTubeSummary>();
  const [sort, setSort] = useState<ChannelSort>('videos');
  const [open, setOpen] = useState<string>();
  const [shown, setShown] = useState(20);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => Promise<void> }>();
  const load = useCallback(async () => {
    try {
      setData(await call<YouTubeSummary>(`?sort=${sort}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'YouTube could not be loaded.');
    }
  }, [sort]);
  useEffect(() => {
    void load();
  }, [load]);
  // Only an import changes the queue on its own: poll while one runs, then read once more.
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => void load(), 4000);
    return () => {
      clearInterval(t);
      void load();
    };
  }, [syncing, load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = async () => {
    await load();
    setVersion((v) => v + 1);
    onLibraryChanged();
  };
  const run = async (
    fn: () => Promise<{ previous: Previous; previousRule?: 'keep' | 'skip' }>,
    label: (n: number) => string,
    channel?: string,
  ) => {
    setBusy(true);
    try {
      const r = await fn();
      const n = Object.keys(r.previous).length;
      await refresh();
      setToast({
        text: label(n),
        undo: async () => {
          await call('/restore', {
            previous: r.previous,
            ...(channel ? { rules: { [channel]: r.previousRule ?? null } } : {}),
          });
          await refresh();
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (yes: boolean) => {
    setBusy(true);
    try {
      await call('/account', { confirm: yes });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const decided = data.kept + data.skipped;
  const statusBand = (syncing || data.importing) && data.account && (
    <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Loader2 size={16} className="animate-spin text-red-600" />
      <div>
        <p className="text-sm font-semibold">
          Reading your YouTube history · {data.total.toLocaleString()} videos so far
        </p>
        <p className="text-xs text-gray-500">
          {data.coverage?.oldestDay ? `Back to ${day(data.coverage.oldestDay)} so far. ` : ''}
          You can review while it reads.
        </p>
      </div>
    </div>
  );

  // Not connected yet: the first sync reads which account is signed in.
  if (!data.account && !data.pendingAccount)
    return (
      <section
        aria-label="YouTube"
        className="mb-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700"
      >
        <div className="flex items-center gap-3">
          <YouTubeMark className="h-4 w-6" />
          <div>
            <p className="font-semibold">Bring in your YouTube history</p>
            <p className="text-sm text-gray-500">
              OpenClaw reads your watch history in its browser. You decide what joins your library.
            </p>
          </div>
        </div>
        <button className={`${button} ${outline}`} disabled={syncing} onClick={onSync}>
          {syncing ? <Loader2 size={15} className="animate-spin" /> : <YouTubeMark />} Connect
          YouTube
        </button>
      </section>
    );

  if (data.pendingAccount)
    return (
      <section
        aria-label="Confirm YouTube account"
        className="mb-10 rounded-xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/50"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <YouTubeMark className="h-4 w-6" />
            <div>
              <p className="font-semibold">
                OpenClaw&apos;s browser is signed in to YouTube as {data.pendingAccount.name}
                {data.pendingAccount.handle ? ` (${data.pendingAccount.handle})` : ''}. Is this you?
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                The import only reads this account&apos;s history, and every later sync checks it is
                still the same one.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className={`${button} bg-indigo-600 text-white hover:!bg-indigo-700`}
              disabled={busy}
              onClick={() => void confirm(true)}
            >
              <Check size={15} /> Yes, import my history
            </button>
            <button
              className={`${button} ${outline}`}
              disabled={busy}
              onClick={() => void confirm(false)}
            >
              <X size={15} /> No, that&apos;s not me
            </button>
          </div>
        </div>
        {data.account && (
          <p className="mt-2 text-xs text-gray-500">
            Previously confirmed: {data.account.name}
            {data.account.handle ? ` (${data.account.handle})` : ''}.
          </p>
        )}
      </section>
    );

  if (!data.total) return <div className="mb-10">{statusBand}</div>;

  // Nothing left to decide: one line, with the full view on request.
  if (!data.pending && !expanded && !(syncing || data.importing))
    return (
      <section
        aria-label="YouTube"
        className="mb-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4 text-sm dark:border-gray-800"
      >
        <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <YouTubeMark />
          YouTube: {data.kept.toLocaleString()} kept · {data.skipped.toLocaleString()} skipped
          {data.lastSyncAt ? ` · synced ${new Date(data.lastSyncAt).toLocaleDateString()}` : ''}
        </span>
        <button className={`${button} ${small}`} onClick={() => setExpanded(true)}>
          Review channels <ChevronDown size={13} />
        </button>
      </section>
    );

  const channels = data.channels.slice(0, shown);
  const openBucket = BUCKETS.find((b) => open === `bucket:${b.id}`);
  return (
    <section aria-labelledby="youtube-heading" className="mb-10">
      {statusBand}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="youtube-heading" className="flex items-center gap-2 text-xl font-semibold">
            <YouTubeMark /> From YouTube
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Decide whole groups first. Open a channel only when you want some of its videos and not
            others.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums">
            <b>{decided.toLocaleString()}</b>
            <span className="text-gray-500"> of {data.total.toLocaleString()} decided</span>
          </span>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <span
              className="block h-full rounded-full bg-indigo-500"
              style={{ width: `${(decided / data.total) * 100}%` }}
            />
          </span>
          {!data.pending && (
            <button className={`${button} ${small}`} onClick={() => setExpanded(false)}>
              Collapse
            </button>
          )}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {BUCKETS.filter((b) => data.buckets[b.id] > 0 || open === `bucket:${b.id}`).map((b) => {
          const n = data.buckets[b.id];
          const isOpen = open === `bucket:${b.id}`;
          return (
            <div
              key={b.id}
              className={`grid content-start gap-2 rounded-xl border bg-white p-4 dark:bg-gray-900 ${
                isOpen
                  ? 'border-indigo-300 dark:border-indigo-800'
                  : 'border-gray-200 dark:border-gray-800'
              } ${n ? '' : 'opacity-60'}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <b>{b.title}</b>
                <span className="text-2xl font-bold tabular-nums">{n.toLocaleString()}</span>
              </div>
              <p className="text-sm text-gray-500">{b.text}</p>
              <div className="flex gap-2">
                <button
                  className={`${button} ${small} ${skipClass}`}
                  disabled={!n || busy}
                  onClick={() =>
                    void run(
                      () => call('/bucket', { bucket: b.id }),
                      (k) => `Skipped ${k.toLocaleString()} ${b.title.toLowerCase()}`,
                    )
                  }
                >
                  Skip all
                </button>
                <button
                  className={`${button} ${small} ${outline}`}
                  disabled={!n}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? undefined : `bucket:${b.id}`)}
                >
                  {isOpen ? 'Close' : 'Look through'}
                </button>
              </div>
            </div>
          );
        })}
        {/* The open group's videos get the full width under both cards, not half of it. */}
        {openBucket && (
          <VideoGrid
            key={openBucket.id}
            filter={{ bucket: openBucket.id }}
            version={version}
            onDecided={() => void refresh()}
          />
        )}
      </div>
      <ChannelRules version={version} onChanged={() => void load()} />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="font-semibold">Channels</h4>
          <p className="text-sm text-gray-500">
            Most-watched first. &ldquo;Remember&rdquo; applies your choice to new videos from that
            channel.
          </p>
        </div>
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              className={`${button} ${small} rounded-full ${sort === s.id ? 'bg-gray-900 text-white hover:!bg-gray-800 dark:bg-gray-100 dark:text-gray-900' : outline}`}
              aria-pressed={sort === s.id}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2.5">
        {channels.map((c) => (
          <ChannelCard
            key={c.key}
            c={c}
            open={open === c.key}
            version={version}
            onToggle={() => setOpen(open === c.key ? undefined : c.key)}
            onDecided={() => void refresh()}
            onAct={(status, remember) =>
              void run(
                () => call('/channel', { channel: c.key, status, remember }),
                (n) =>
                  status === 'pending'
                    ? `Reopened ${n} from ${c.name}`
                    : `${status === 'kept' ? 'Kept' : 'Skipped'} ${n} from ${c.name}${remember ? '. New videos will follow.' : ''}`,
                c.key,
              )
            }
          />
        ))}
      </div>
      {data.channels.length > shown && (
        <button className={`${button} ${outline} mt-3 w-full`} onClick={() => setShown(shown + 20)}>
          Show more channels ({data.channels.length - shown} left)
        </button>
      )}
      {data.oneOffs.videos > 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 p-4 dark:border-gray-700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              <b className="text-gray-900 dark:text-gray-100">One-offs</b> ·{' '}
              {data.oneOffs.channels.toLocaleString()} channels you watched once or twice (
              {data.oneOffs.videos.toLocaleString()} videos, {data.oneOffs.pending.toLocaleString()}{' '}
              to decide)
            </span>
            <span className="flex gap-2">
              <button
                className={`${button} ${small} ${skipClass}`}
                disabled={!data.oneOffs.pending || busy}
                onClick={() =>
                  void run(
                    () => call('/bucket', { bucket: 'oneOffs' }),
                    (k) => `Skipped ${k.toLocaleString()} one-off videos`,
                  )
                }
              >
                Skip all
              </button>
              <button
                className={`${button} ${small} ${outline}`}
                aria-expanded={open === 'oneoffs'}
                onClick={() => setOpen(open === 'oneoffs' ? undefined : 'oneoffs')}
              >
                {open === 'oneoffs' ? 'Close' : 'Look through'}
              </button>
            </span>
          </div>
          {open === 'oneoffs' && (
            <div className="mt-3">
              <VideoGrid
                filter={{ oneOffs: true }}
                version={version}
                onDecided={() => void refresh()}
              />
            </div>
          )}
        </div>
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-gray-100 dark:text-gray-900"
        >
          {toast.text}
          {toast.undo && (
            <button
              className="font-semibold underline"
              onClick={() => {
                const undo = toast.undo!;
                setToast(undefined);
                void undo().catch((e) => setError(e instanceof Error ? e.message : 'Undo failed.'));
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
