'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Bookmark as BookmarkIcon,
  Search,
  Settings2,
  RefreshCw,
  Star,
  Check,
  ArrowUpRight,
  X,
  Play,
  ImageOff,
  Loader2,
  SlidersHorizontal,
  Tag,
  Link as LinkIcon,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import type { Bookmark, BookmarkList, BookmarkStatus } from '@/lib/bookmarks/types';

async function api<T>(path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/bookmarks${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json();
  if (!response.ok || !payload.success)
    throw new Error(payload.error || 'Could not load bookmarks.');
  return payload.data;
}
const button =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium transition hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const field =
  'rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400';
function PreviewImage({
  src,
  alt,
  className = '',
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  ) : (
    <div
      className={`flex min-h-32 items-center justify-center gap-2 bg-gray-100 text-xs text-gray-400 dark:bg-gray-800 ${className}`}
    >
      <ImageOff size={18} /> Preview unavailable
    </div>
  );
}
function Author({ item }: { item: Bookmark }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-50 text-xs font-semibold text-indigo-500 dark:bg-indigo-950">
        {item.author.avatar ? (
          <img
            src={item.author.avatar}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          item.author.name.slice(0, 1)
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
          {item.author.name}
        </p>
        <p className="truncate text-[11px] text-gray-400">
          {item.author.username ? `@${item.author.username}` : 'Saved from X'}
        </p>
      </div>
    </div>
  );
}
export default function BookmarksPage() {
  const [items, setItems] = useState<Bookmark[]>([]),
    [total, setTotal] = useState(0),
    [tags, setTags] = useState<string[]>([]);
  const [next, setNext] = useState<number | null>(null),
    [status, setStatus] = useState<BookmarkStatus | null>(null);
  const [query, setQuery] = useState(''),
    [debounced, setDebounced] = useState(''),
    [unread, setUnread] = useState(false),
    [favorite, setFavorite] = useState(false),
    [tag, setTag] = useState(''),
    [media, setMedia] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false),
    [selected, setSelected] = useState<Bookmark | null>(null),
    [tagText, setTagText] = useState('');
  const searchInput = useRef<HTMLInputElement | null>(null);
  const opener = useRef<HTMLElement | null>(null),
    generation = useRef(0);
  const active = status?.job && ['queued', 'running'].includes(status.job.status);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);
  const params = useCallback(
    () =>
      new URLSearchParams({
        q: debounced,
        unread: String(unread),
        favorite: String(favorite),
        tag,
        media,
      }),
    [debounced, unread, favorite, tag, media],
  );
  const load = useCallback(
    async (offset = 0) => {
      const seq = ++generation.current;
      try {
        const p = params();
        p.set('offset', String(offset));
        const data = await api<BookmarkList>(`?${p}`);
        if (seq !== generation.current) return;
        setItems((old) => (offset ? [...old, ...data.items] : data.items));
        setTotal(data.total);
        setNext(data.nextOffset);
        setTags(data.tags);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (seq === generation.current) setLoading(false);
      }
    },
    [params],
  );
  const refreshStatus = useCallback(async () => {
    const data = await api<BookmarkStatus>('/status');
    setStatus(data);
    return data;
  }, []);
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);
  useEffect(() => {
    const url = new URL(location.href);
    refreshStatus()
      .then((data) => {
        if (url.searchParams.has('connection_error'))
          setError(
            data.lastConnectionError?.message ||
              'X connection failed. Open settings and connect again.',
          );
      })
      .catch((e) => setError(e.message));
    if (url.searchParams.has('connection_error')) setSettingsOpen(true);
    if (url.searchParams.has('connected')) setSettingsOpen(true);
    const key = url.searchParams.get('item');
    if (key)
      api<Bookmark>(`/item?key=${encodeURIComponent(key)}`)
        .then((v) => {
          setSelected(v);
          setTagText(v.tags.join(', '));
        })
        .catch((e) => setError(e.message));
  }, [refreshStatus]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      refreshStatus()
        .then(() => load())
        .catch((e) => setError(e.message));
    }, 2500);
    return () => clearInterval(timer);
  }, [active, refreshStatus, load]);
  async function action(path: string, body: unknown = {}) {
    setBusy(true);
    setError('');
    try {
      await api(path, body);
      await refreshStatus();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function update(
    item: Bookmark,
    patch: Partial<Pick<Bookmark, 'favorite' | 'read' | 'tags'>>,
  ) {
    setError('');
    try {
      const saved = await api<Bookmark>('/item', { key: item.key, ...patch });
      setSelected((old) => (old?.key === saved.key ? saved : old));
      setItems((old) => old.map((i) => (i.key === saved.key ? saved : i)));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function open(item: Bookmark, element: HTMLElement) {
    opener.current = element;
    setSelected(item);
    setTagText(item.tags.join(', '));
    const url = new URL(location.href);
    url.searchParams.set('item', item.key);
    history.replaceState(null, '', url);
  }
  function closeReader() {
    setSelected(null);
    const url = new URL(location.href);
    url.searchParams.delete('item');
    history.replaceState(null, '', url);
  }
  const filtered = !!(query || unread || favorite || tag || media);
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-gray-900 dark:bg-[#0d111b] dark:text-gray-100">
      <AppHeader title="Agentic Journal" />
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8 lg:px-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-500">
              <BookmarkIcon size={13} /> Your corner of the internet
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Saved for later<span className="text-indigo-400">.</span>
            </h1>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              Ideas worth keeping. A little room to explore them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={button}
              aria-label="Bookmark connection and settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={17} />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button
              disabled={busy || !!active}
              className={`${button} bg-indigo-600 text-white shadow-sm hover:!bg-indigo-500`}
              onClick={() => (status?.connected ? void action('/sync') : setSettingsOpen(true))}
            >
              {active ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {active
                ? 'Syncing'
                : status?.connected
                  ? 'Sync now'
                  : status?.configured
                    ? 'Connect X'
                    : 'Set up X API'}
            </button>
          </div>
        </div>
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200/70 bg-white/80 p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 text-gray-400" size={18} />
            <input
              ref={searchInput}
              aria-label="Search bookmarks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find an idea, a person, a link…"
              className="w-full rounded-xl bg-transparent py-2.5 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            aria-pressed={unread}
            className={`${button} ${unread ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950' : 'text-gray-500'}`}
            onClick={() => setUnread((v) => !v)}
          >
            Unread
          </button>
          <button
            aria-pressed={favorite}
            className={`${button} ${favorite ? 'bg-amber-50 text-amber-600 dark:bg-amber-950' : 'text-gray-500'}`}
            onClick={() => setFavorite((v) => !v)}
          >
            <Star size={15} /> Favorites
          </button>
          <label className="sr-only" htmlFor="bookmark-media">
            Media type
          </label>
          <select
            id="bookmark-media"
            value={media}
            onChange={(e) => setMedia(e.target.value)}
            className={`${field} !border-0`}
          >
            <option value="">All types</option>
            <option value="photo">Images</option>
            <option value="video">Video / GIF</option>
            <option value="link">Links</option>
            <option value="text">Text</option>
          </select>
          {tags.length > 0 && (
            <>
              <label className="sr-only" htmlFor="bookmark-tag">
                Tag
              </label>
              <select
                id="bookmark-tag"
                className={`${field} !border-0`}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              >
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </>
          )}
        </div>
        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {status?.job &&
          ['queued', 'running', 'paused', 'cancelled'].includes(status.job.status) && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200/70 bg-indigo-50/70 px-4 py-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/40">
              <div>
                <p className="font-medium">
                  {active
                    ? 'Bringing your saved ideas home'
                    : status.job.status === 'cancelled'
                      ? 'Import cancelled'
                      : 'Import paused'}{' '}
                  <span className="font-normal text-gray-500">
                    · {status.job.imported} added · {status.job.pages} pages
                  </span>
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {active
                    ? 'You can leave this page. Your import will continue.'
                    : status.job.reason}
                </p>
                {!status.workerAvailable && active && (
                  <p className="mt-1 text-xs text-amber-600">
                    Worker is offline. Start the bookmark worker service to process this request.
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {!active && (
                  <button className={button} disabled={busy} onClick={() => void action('/resume')}>
                    <Play size={14} /> Resume
                  </button>
                )}
                {status.job.status !== 'cancelled' && (
                  <button className={button} disabled={busy} onClick={() => void action('/cancel')}>
                    <X size={14} /> Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        <div className="mb-4 flex items-center justify-between text-xs text-gray-400">
          <span>
            {total.toLocaleString()} {filtered ? 'matching' : 'saved'}{' '}
            {total === 1 ? 'idea' : 'ideas'}
            {filtered && (
              <button
                className="ml-3 text-indigo-500"
                onClick={() => {
                  setQuery('');
                  setUnread(false);
                  setFavorite(false);
                  setTag('');
                  setMedia('');
                }}
              >
                Clear filters
              </button>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal size={12} /> Newest imported
          </span>
        </div>
        {loading ? (
          <div
            aria-label="Loading bookmarks"
            className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4"
          >
            {[240, 340, 200, 300, 260, 320, 220, 280].map((h, i) => (
              <div
                key={i}
                style={{ height: h }}
                className="mb-5 break-inside-avoid animate-pulse rounded-2xl bg-gray-200/60 dark:bg-gray-800/60"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-[390px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 px-6 text-center dark:border-gray-700">
            <div className="mb-5 rotate-[-8deg] rounded-2xl bg-white p-6 shadow-lg shadow-indigo-100 dark:bg-gray-800 dark:shadow-none">
              <BookmarkIcon size={36} strokeWidth={1.3} className="text-indigo-400" />
            </div>
            <h2 className="text-xl font-semibold">
              {filtered ? 'No ideas found here yet' : 'Make space for your next rabbit hole'}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
              {filtered
                ? 'Try another word or loosen your filters.'
                : 'Connect X and bring your bookmarks into a collection you can browse, tag, and revisit.'}
            </p>
            {!filtered && (
              <button
                className={`${button} mt-5 text-indigo-600`}
                onClick={() => setSettingsOpen(true)}
              >
                Set up your collection <ArrowUpRight size={15} />
              </button>
            )}
            <p className="mt-6 text-xs text-gray-400">
              Sync only when you choose. Browsing uses your local collection.
            </p>
          </div>
        ) : (
          <div className="columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4">
            {items.map((item) => {
              const cover = item.media[0],
                image =
                  cover?.type === 'photo'
                    ? cover.url
                    : cover?.preview || item.links.find((l) => l.image)?.image;
              return (
                <article
                  key={item.key}
                  className="group mb-5 break-inside-avoid overflow-hidden rounded-2xl border border-gray-200/60 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/60 dark:border-gray-800 dark:bg-gray-900 dark:hover:shadow-black/20"
                >
                  <button
                    onClick={(e) => open(item, e.currentTarget)}
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                    aria-label={`Read bookmark by ${item.author.name}`}
                  >
                    {image && (
                      <div className="relative overflow-hidden">
                        <PreviewImage
                          src={image}
                          alt={cover?.alt || item.links[0]?.title || 'Saved post image'}
                          className="max-h-[420px] w-full object-cover transition duration-500 group-hover:scale-[1.025]"
                        />
                        {cover && cover.type !== 'photo' && (
                          <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white backdrop-blur">
                            <Play size={11} fill="currentColor" /> Watch on X
                          </span>
                        )}
                        {item.media.length > 1 && (
                          <span className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white">
                            +{item.media.length - 1}
                          </span>
                        )}
                      </div>
                    )}
                    <div className={`p-5 ${!image ? 'pt-6' : ''}`}>
                      <Author item={item} />
                      <p
                        className={`mt-4 whitespace-pre-wrap break-words leading-relaxed ${image ? 'line-clamp-5 text-sm text-gray-700 dark:text-gray-300' : 'line-clamp-9 text-[17px] font-medium tracking-[-0.02em]'}`}
                      >
                        {item.text}
                      </p>
                      {item.links[0] && (
                        <div className="mt-4 flex items-center gap-1.5 truncate text-[11px] text-gray-400">
                          <LinkIcon size={12} className="shrink-0" /> {item.links[0].domain}
                        </div>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center justify-between gap-2 px-5 pb-4">
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {item.tags.slice(0, 2).map((t) => (
                        <button
                          key={t}
                          onClick={() => setTag(t)}
                          className="max-w-24 truncate rounded-md bg-gray-100 px-2 py-1 text-[10px] text-gray-500 dark:bg-gray-800"
                        >
                          {t}
                        </button>
                      ))}
                      {!item.tags.length && (
                        <span className="text-[10px] text-gray-400">
                          {item.read ? 'Read' : 'Unread'}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        aria-label={item.favorite ? 'Remove favorite' : 'Favorite bookmark'}
                        aria-pressed={item.favorite}
                        onClick={() => void update(item, { favorite: !item.favorite })}
                        className={`rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 ${item.favorite ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}
                      >
                        <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        aria-label={item.read ? 'Mark unread' : 'Mark read'}
                        aria-pressed={item.read}
                        onClick={() => void update(item, { read: !item.read })}
                        className={`rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 ${item.read ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'}`}
                      >
                        <Check size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {next !== null && !loading && (
          <div className="py-6 text-center">
            <button
              className={`${button} border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900`}
              onClick={() => void load(next)}
            >
              Show more ideas
            </button>
          </div>
        )}
        <p className="mt-8 text-center text-[11px] text-gray-400">
          A local collection · Syncs only on request
          {status?.lastSyncAt
            ? ` · Last synced ${new Date(status.lastSyncAt).toLocaleString()}`
            : ''}
        </p>
      </main>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) closeReader();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
              else searchInput.current?.focus();
            }}
            className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white shadow-2xl sm:max-w-2xl dark:bg-gray-900"
          >
            <Dialog.Title className="sr-only">Saved post by {selected?.author.name}</Dialog.Title>
            <Dialog.Description className="sr-only">
              Read and organize this locally saved bookmark.
            </Dialog.Description>
            {selected && (
              <>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 px-6 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
                  <Author item={selected} />
                  <Dialog.Close className={button} aria-label="Close reader">
                    <X size={20} />
                  </Dialog.Close>
                </div>
                <div className="space-y-6 px-6 py-7 sm:px-9">
                  {error && (
                    <p
                      role="alert"
                      className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
                    >
                      {error}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-lg leading-8">
                    {selected.text}
                  </p>
                  {selected.media.map((m, i) => (
                    <div key={i} className="overflow-hidden rounded-2xl">
                      {m.type === 'photo' ? (
                        <PreviewImage src={m.url} alt={m.alt || 'Post image'} className="w-full" />
                      ) : (
                        <a
                          href={selected.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative block"
                        >
                          <PreviewImage
                            src={m.preview}
                            alt={m.alt || 'Video preview'}
                            className="w-full"
                          />
                          <span className="absolute inset-0 flex items-center justify-center">
                            <span className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-3 text-sm text-white">
                              <Play size={18} /> Watch on X
                            </span>
                          </span>
                        </a>
                      )}
                    </div>
                  ))}
                  {selected.links.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700"
                    >
                      {l.image && (
                        <PreviewImage
                          src={l.image}
                          alt={l.title || 'Link preview'}
                          className="max-h-60 w-full object-cover"
                        />
                      )}
                      <div className="p-4">
                        <p className="text-xs text-indigo-500">{l.domain} ↗</p>
                        {l.title && <p className="mt-1 font-medium">{l.title}</p>}
                        {l.description && (
                          <p className="mt-1 text-sm text-gray-500">{l.description}</p>
                        )}
                      </div>
                    </a>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={button}
                      onClick={() => void update(selected, { favorite: !selected.favorite })}
                    >
                      <Star
                        size={16}
                        className={selected.favorite ? 'fill-amber-400 text-amber-400' : ''}
                      />
                      {selected.favorite ? 'Favorited' : 'Favorite'}
                    </button>
                    <button
                      className={button}
                      onClick={() => void update(selected, { read: !selected.read })}
                    >
                      <Check size={16} />
                      {selected.read ? 'Mark unread' : 'Mark read'}
                    </button>
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${button} text-indigo-500`}
                    >
                      Open on X <ArrowUpRight size={16} />
                    </a>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void update(selected, {
                        tags: tagText
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      });
                    }}
                  >
                    <label
                      htmlFor="reader-tags"
                      className="mb-2 flex items-center gap-2 text-sm font-medium"
                    >
                      <Tag size={14} /> Personal tags
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="reader-tags"
                        className={`${field} min-w-0 flex-1`}
                        value={tagText}
                        onChange={(e) => setTagText(e.target.value)}
                        placeholder="design, research, weekend reading"
                      />
                      <button
                        className={`${button} bg-indigo-50 text-indigo-600 dark:bg-indigo-950`}
                      >
                        Save
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">
                      Separate tags with commas. Tags stay in Journal.
                    </p>
                  </form>
                  <p className="border-t border-gray-100 pt-4 text-xs leading-6 text-gray-400 dark:border-gray-800">
                    Imported {new Date(selected.importedAt).toLocaleString()}
                    {selected.publishedAt && (
                      <>
                        <br />
                        Published {new Date(selected.publishedAt).toLocaleString()}
                      </>
                    )}
                  </p>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">
                Your collection settings
              </Dialog.Title>
              <Dialog.Close className={button} aria-label="Close settings">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-1 text-sm text-gray-500">
              Connect once. Import only when you choose.
            </Dialog.Description>
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
              >
                {error}
              </p>
            )}
            {status && (
              <div className="mt-6 space-y-6">
                <section>
                  <p className="text-sm font-medium">
                    {status.connected
                      ? `Connected as @${status.username}`
                      : 'Connect your X account'}
                  </p>
                  {!status.configured && (
                    <div className="mt-3 rounded-xl bg-indigo-50 p-4 dark:bg-indigo-950/40">
                      <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
                        First create your developer account and app in X. Then configure its OAuth
                        Client ID and Client Secret on the Journal server. Connect X becomes
                        available once those credentials are configured.
                      </p>
                      <a
                        href="https://console.x.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${button} mt-3 bg-indigo-600 text-white hover:bg-indigo-500`}
                      >
                        Set up X API <ArrowUpRight size={14} />
                      </a>
                    </div>
                  )}
                  {!status.connected && status.lastConnectionError && (
                    <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                      Last attempt ({new Date(status.lastConnectionError.at).toLocaleString()}):{' '}
                      {status.lastConnectionError.message}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">
                    Register this callback in your X developer app:
                  </p>
                  <code className="mt-1 block break-all rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800">
                    {status.callbackUrl}
                  </code>
                  <button
                    disabled={!status.configured || busy || !!active}
                    title={
                      !status.configured
                        ? 'Configure your X app credentials before connecting your account.'
                        : undefined
                    }
                    className={`${button} mt-3 bg-gray-100 dark:bg-gray-800`}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const data = await api<{ url: string }>('/oauth/start', {});
                        location.assign(data.url);
                      } catch (e) {
                        setError((e as Error).message);
                        setBusy(false);
                        setSettingsOpen(false);
                      }
                    }}
                  >
                    {status.connected ? 'Reconnect X' : 'Connect X'} <ArrowUpRight size={14} />
                  </button>
                </section>
                <section className="border-t border-gray-100 pt-5 dark:border-gray-800">
                  <div className="flex justify-between text-sm">
                    <span>Estimated usage this calendar month</span>
                    <strong>${status.estimate.toFixed(2)} / $5</strong>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${Math.min(100, (status.estimate / 5) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs leading-5 text-gray-500">
                    Estimates include a conservative media allowance and failed-request
                    reservations. The X Developer Console is the source of truth for charges and
                    billing-cycle limits.
                  </p>
                  <a
                    href="https://console.x.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm text-indigo-500"
                  >
                    Open X billing ↗
                  </a>
                  <label className="mt-4 flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={status.budgetConfirmed}
                      disabled={busy}
                      onChange={(e) =>
                        void action('/settings', { budgetConfirmed: e.target.checked })
                      }
                      className="mt-1 accent-indigo-600"
                    />
                    <span>I set a $5 spending limit in X and disabled auto-recharge.</span>
                  </label>
                  {status.pilotComplete && (
                    <label className="mt-4 flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={status.pilotReviewed}
                        disabled={busy}
                        onChange={(e) =>
                          void action('/settings', { pilotReviewed: e.target.checked })
                        }
                        className="mt-1 accent-indigo-600"
                      />
                      <span>
                        I checked the pilot charge, including author/media data. Continue importing
                        history when I press Resume.
                      </span>
                    </label>
                  )}
                  {!status.pilotComplete && (
                    <p className="mt-3 text-xs text-gray-400">
                      Your first sync imports up to five posts, then pauses for a billing check.
                    </p>
                  )}
                </section>
                <section className="border-t border-gray-100 pt-5 dark:border-gray-800">
                  <p className="text-sm font-medium">Sync history</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Worker {status.workerAvailable ? 'online' : 'offline'} · Manual requests only
                  </p>
                  {status.history.length ? (
                    <ul className="mt-3 space-y-3">
                      {status.history.slice(0, 5).map((j) => (
                        <li
                          key={j.id}
                          className="rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-800"
                        >
                          <div className="flex justify-between">
                            <span className="capitalize">{j.status}</span>
                            <span>{j.imported} added</span>
                          </div>
                          <p className="mt-1 text-gray-400">
                            {new Date(j.updatedAt).toLocaleString()}
                          </p>
                          <p className="mt-1 text-gray-500">{j.reason}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-gray-400">No imports yet.</p>
                  )}
                </section>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
