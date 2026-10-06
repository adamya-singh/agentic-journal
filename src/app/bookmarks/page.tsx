'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Tag,
  Link as LinkIcon,
  Folder,
  FolderOpen,
  FolderDown,
  Inbox,
  Library,
  CircleDot,
  LayoutGrid,
  List as ListIcon,
  ArrowDownUp,
  AtSign,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import type {
  Bookmark,
  BookmarkFolder,
  BookmarkList,
  BookmarkSort,
  BookmarkStatus,
} from '@/lib/bookmarks/types';

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
const SORTS: { value: BookmarkSort; label: string }[] = [
  { value: 'saved', label: 'Recently saved' },
  { value: 'saved-oldest', label: 'Oldest saved' },
  { value: 'posted', label: 'Newest posts' },
  { value: 'posted-oldest', label: 'Oldest posts' },
  { value: 'author', label: 'Author A–Z' },
];
const TYPES = [
  { value: '', label: 'All' },
  { value: 'photo', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'link', label: 'Links' },
  { value: 'text', label: 'Text' },
];
type View = 'grid' | 'list';
interface Filters {
  q: string;
  folder: string;
  author: string;
  tag: string;
  media: string;
  sort: BookmarkSort;
  unread: boolean;
  favorite: boolean;
}
const emptyFilters: Filters = {
  q: '',
  folder: '',
  author: '',
  tag: '',
  media: '',
  sort: 'saved',
  unread: false,
  favorite: false,
};
// Filters live in the URL so a view (a folder, a sort) can be bookmarked or shared.
function filtersFromUrl(): Filters {
  const p = new URLSearchParams(location.search);
  const sort = p.get('sort') as BookmarkSort;
  return {
    q: p.get('q') || '',
    folder: p.get('folder') || '',
    author: p.get('author') || '',
    tag: p.get('tag') || '',
    media: p.get('media') || '',
    sort: SORTS.some((s) => s.value === sort) ? sort : 'saved',
    unread: p.get('unread') === 'true',
    favorite: p.get('favorite') === 'true',
  };
}
function writeFiltersToUrl(f: Filters) {
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(f)) {
    const isDefault = value === emptyFilters[key as keyof Filters];
    if (isDefault) url.searchParams.delete(key);
    else url.searchParams.set(key, String(value));
  }
  history.replaceState(null, '', url);
}
function shortDate(value?: string) {
  if (!value) return '';
  const d = new Date(value),
    days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 1) return 'Today';
  if (days < 7) return `${Math.floor(days)}d`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
// X returns HTML-escaped text and trailing t.co links for media and cards shown separately.
function displayText(text: string) {
  return text
    .replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '')
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!,
    );
}
// Masonry that keeps reading order left to right: item i goes to column i % n.
function useColumnCount() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const measure = () => {
      const w = window.innerWidth;
      setCount(w < 640 ? 1 : w < 1280 ? 2 : w < 1536 ? 3 : 4);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return count;
}
function coverImage(item: Bookmark) {
  const cover = item.media[0];
  return cover?.type === 'photo'
    ? cover.url
    : cover?.preview || item.links.find((l) => l.image)?.image;
}
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
function Avatar({ item, size = 'h-8 w-8' }: { item: Bookmark; size?: string }) {
  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-50 text-xs font-semibold text-indigo-500 dark:bg-indigo-950`}
    >
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
  );
}
function Author({ item, onAuthor }: { item: Bookmark; onAuthor?: (username: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar item={item} />
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">
          {item.author.name}
        </p>
        {item.author.username && onAuthor ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAuthor(item.author.username);
            }}
            className="truncate text-[11px] text-gray-400 hover:text-indigo-500 hover:underline"
            title={`More from @${item.author.username}`}
          >
            @{item.author.username}
          </button>
        ) : (
          <p className="truncate text-[11px] text-gray-400">
            {item.author.username ? `@${item.author.username}` : 'Saved from X'}
          </p>
        )}
      </div>
    </div>
  );
}
function NavItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        active
          ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800/70'
      }`}
    >
      <span className={active ? 'text-indigo-500' : 'text-gray-400'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="text-xs tabular-nums text-gray-400">{count.toLocaleString()}</span>
      )}
    </button>
  );
}
function Pill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? 'border-indigo-500 bg-indigo-600 text-white'
          : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
      }`}
    >
      {label}
      {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
    </button>
  );
}
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-3 pr-1 text-xs text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
      {label}
      <button
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="rounded-full p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-900"
      >
        <X size={12} />
      </button>
    </span>
  );
}
function ItemActions({
  item,
  onUpdate,
}: {
  item: Bookmark;
  onUpdate: (item: Bookmark, patch: Partial<Pick<Bookmark, 'favorite' | 'read'>>) => void;
}) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <button
        aria-label={item.favorite ? 'Remove favorite' : 'Favorite bookmark'}
        aria-pressed={item.favorite}
        onClick={() => onUpdate(item, { favorite: !item.favorite })}
        className={`rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 ${item.favorite ? 'text-amber-500' : 'text-gray-300 dark:text-gray-600'}`}
      >
        <Star size={15} fill={item.favorite ? 'currentColor' : 'none'} />
      </button>
      <button
        aria-label={item.read ? 'Mark unread' : 'Mark read'}
        aria-pressed={item.read}
        onClick={() => onUpdate(item, { read: !item.read })}
        className={`rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-gray-800 ${item.read ? 'text-indigo-500' : 'text-gray-300 dark:text-gray-600'}`}
      >
        <Check size={16} />
      </button>
    </div>
  );
}
export default function BookmarksPage() {
  const [items, setItems] = useState<Bookmark[]>([]),
    [total, setTotal] = useState(0),
    [collectionTotal, setCollectionTotal] = useState(0),
    [tags, setTags] = useState<string[]>([]),
    [folders, setFolders] = useState<BookmarkFolder[]>([]),
    [unsortedCount, setUnsortedCount] = useState(0),
    [folderSyncedAt, setFolderSyncedAt] = useState<string | undefined>();
  const [next, setNext] = useState<number | null>(null),
    [status, setStatus] = useState<BookmarkStatus | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters),
    [ready, setReady] = useState(false),
    [debouncedQ, setDebouncedQ] = useState(''),
    [view, setView] = useState<View>('grid');
  const [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [busy, setBusy] = useState(false),
    [foldersBusy, setFoldersBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false),
    [selected, setSelected] = useState<Bookmark | null>(null),
    [tagText, setTagText] = useState('');
  const searchInput = useRef<HTMLInputElement | null>(null),
    sentinel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null),
    generation = useRef(0);
  const active = status?.job && ['queued', 'running'].includes(status.job.status);
  const columnCount = useColumnCount();
  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const set = useCallback(
    (patch: Partial<Filters>) => setFilters((old) => ({ ...old, ...patch })),
    [],
  );
  useEffect(() => {
    setFilters(filtersFromUrl());
    setDebouncedQ(filtersFromUrl().q);
    try {
      if (localStorage.getItem('bookmarks.view') === 'list') setView('list');
    } catch {
      /* Storage unavailable; default view. */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) writeFiltersToUrl(filters);
  }, [filters, ready]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 200);
    return () => clearTimeout(t);
  }, [filters.q]);
  const params = useCallback(() => {
    const { q: _q, unread, favorite, ...rest } = filters;
    void _q;
    return new URLSearchParams({
      ...rest,
      q: debouncedQ,
      unread: String(unread),
      favorite: String(favorite),
    });
  }, [filters, debouncedQ]);
  const load = useCallback(
    async (offset = 0) => {
      const seq = ++generation.current;
      if (offset) setLoadingMore(true);
      try {
        const p = params();
        p.set('offset', String(offset));
        const data = await api<BookmarkList>(`?${p}`);
        if (seq !== generation.current) return;
        setItems((old) => (offset ? [...old, ...data.items] : data.items));
        setTotal(data.total);
        setCollectionTotal(data.collectionTotal);
        setNext(data.nextOffset);
        setTags(data.tags);
        setFolders(data.folders);
        setUnsortedCount(data.unsortedCount);
        setFolderSyncedAt(data.folderSyncedAt);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (seq === generation.current) {
          setLoading(false);
          setLoadingMore(false);
        }
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
    if (!ready) return;
    setLoading(true);
    void load();
  }, [load, ready]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) void load(next);
      },
      { rootMargin: '800px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [next, loading, loadingMore, load]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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
  async function syncFolders() {
    setFoldersBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ folders: number; assigned: number }>('/folders', {});
      setNotice(
        result.folders
          ? `Imported ${result.folders} ${result.folders === 1 ? 'folder' : 'folders'} covering ${result.assigned.toLocaleString()} bookmarks.`
          : 'No bookmark folders found on X.',
      );
      await Promise.all([refreshStatus(), load()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFoldersBusy(false);
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
    if (!item.read) void update(item, { read: true });
  }
  function closeReader() {
    setSelected(null);
    const url = new URL(location.href);
    url.searchParams.delete('item');
    history.replaceState(null, '', url);
  }
  function changeView(v: View) {
    setView(v);
    try {
      localStorage.setItem('bookmarks.view', v);
    } catch {
      /* Storage unavailable; view resets next visit. */
    }
  }
  const showAuthor = (author: string) => {
    set({ author });
    closeReader();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const collection = { folder: '', unread: false, favorite: false };
  const isAll = !filters.folder && !filters.unread && !filters.favorite;
  const heading = filters.favorite
    ? 'Favorites'
    : filters.unread
      ? 'Unread'
      : filters.folder === 'none'
        ? 'Not in a folder'
        : filters.folder
          ? folderNames.get(filters.folder) || 'Folder'
          : 'All bookmarks';
  const refined = !!(filters.q || filters.author || filters.tag || filters.media);
  const hasFolders = folders.length > 0;
  const folderButtonLabel = hasFolders ? 'Refresh folders from X' : 'Import folders from X';
  return (
    <div className="min-h-screen bg-[#f7f8fa] text-gray-900 dark:bg-[#0d111b] dark:text-gray-100">
      <AppHeader title="Agentic Journal" />
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:py-8">
        <aside className="hidden lg:block" aria-label="Bookmark collections">
          <div className="sticky top-6 space-y-6">
            <nav className="space-y-0.5">
              <NavItem
                active={isAll}
                icon={<Library size={16} />}
                label="All bookmarks"
                count={collectionTotal}
                onClick={() => set(collection)}
              />
              <NavItem
                active={filters.unread}
                icon={<CircleDot size={16} />}
                label="Unread"
                onClick={() => set({ ...collection, unread: true })}
              />
              <NavItem
                active={filters.favorite}
                icon={<Star size={16} />}
                label="Favorites"
                onClick={() => set({ ...collection, favorite: true })}
              />
            </nav>
            <div>
              <div className="mb-1.5 flex items-center justify-between px-2.5">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Folders
                </h2>
                {hasFolders && status?.connected && (
                  <button
                    onClick={() => void syncFolders()}
                    disabled={foldersBusy}
                    aria-label={folderButtonLabel}
                    title={`${folderButtonLabel}${folderSyncedAt ? ` · last ${new Date(folderSyncedAt).toLocaleString()}` : ''}`}
                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800"
                  >
                    {foldersBusy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                  </button>
                )}
              </div>
              {hasFolders ? (
                <nav className="max-h-[50vh] space-y-0.5 overflow-y-auto pr-1">
                  {folders.map((f) => (
                    <NavItem
                      key={f.id}
                      active={filters.folder === f.id}
                      icon={
                        filters.folder === f.id ? <FolderOpen size={16} /> : <Folder size={16} />
                      }
                      label={f.name}
                      count={f.count}
                      onClick={() => set({ ...collection, folder: f.id })}
                    />
                  ))}
                  <NavItem
                    active={filters.folder === 'none'}
                    icon={<Inbox size={16} />}
                    label="Not in a folder"
                    count={unsortedCount}
                    onClick={() => set({ ...collection, folder: 'none' })}
                  />
                </nav>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 p-3.5 text-xs leading-5 text-gray-500 dark:border-gray-700">
                  Bring in the folders you made on X to browse by them here.
                  <button
                    onClick={() => void syncFolders()}
                    disabled={foldersBusy || !status?.connected}
                    className={`${button} mt-2.5 w-full !px-3 !py-2 bg-white text-indigo-600 shadow-sm dark:bg-gray-900`}
                  >
                    {foldersBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FolderDown size={14} />
                    )}
                    {foldersBusy ? 'Importing…' : 'Import folders'}
                  </button>
                  <p className="mt-2 text-[11px] text-gray-400">
                    About $0.001 per bookmark in a folder. Reads only; nothing changes on X.
                  </p>
                </div>
              )}
            </div>
            {tags.length > 0 && (
              <div>
                <h2 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Tags
                </h2>
                <div className="flex flex-wrap gap-1.5 px-1.5">
                  {tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => set({ tag: filters.tag === t ? '' : t })}
                      aria-pressed={filters.tag === t}
                      className={`rounded-md px-2 py-1 text-xs ${filters.tag === t ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'}`}
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
        <main className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-500">
                <BookmarkIcon size={12} /> Bookmarks
              </p>
              <h1 className="truncate text-3xl font-semibold tracking-tight sm:text-4xl">
                {heading}
              </h1>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {loading
                  ? 'Loading…'
                  : `${total.toLocaleString()} ${refined ? 'matching' : total === 1 ? 'post' : 'posts'}`}
                {status?.lastSyncAt && !loading && (
                  <span className="text-gray-400">
                    {' '}
                    · synced {shortDate(status.lastSyncAt).toLowerCase()}
                  </span>
                )}
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
          <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
            <Pill
              active={isAll}
              label="All"
              count={collectionTotal}
              onClick={() => set(collection)}
            />
            <Pill
              active={filters.unread}
              label="Unread"
              onClick={() => set({ ...collection, unread: true })}
            />
            <Pill
              active={filters.favorite}
              label="Favorites"
              onClick={() => set({ ...collection, favorite: true })}
            />
            {folders.map((f) => (
              <Pill
                key={f.id}
                active={filters.folder === f.id}
                label={f.name}
                count={f.count}
                onClick={() => set({ ...collection, folder: f.id })}
              />
            ))}
            {hasFolders ? (
              <Pill
                active={filters.folder === 'none'}
                label="Not in a folder"
                count={unsortedCount}
                onClick={() => set({ ...collection, folder: 'none' })}
              />
            ) : (
              status?.connected && (
                <Pill
                  active={false}
                  label={foldersBusy ? 'Importing folders…' : '+ Import folders'}
                  onClick={() => void syncFolders()}
                />
              )
            )}
          </div>
          <div className="sticky top-0 z-20 -mx-4 mb-4 bg-[#f7f8fa]/90 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:px-0 dark:bg-[#0d111b]/90">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200/70 bg-white p-1.5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="relative min-w-48 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  size={17}
                />
                <input
                  ref={searchInput}
                  aria-label="Search bookmarks"
                  value={filters.q}
                  onChange={(e) => set({ q: e.target.value })}
                  placeholder="Search posts, people, links…"
                  className="w-full rounded-xl bg-transparent py-2 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-gray-200 px-1.5 text-[10px] text-gray-400 sm:block dark:border-gray-700">
                  /
                </kbd>
              </div>
              <div
                role="group"
                aria-label="Post type"
                className="flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800"
              >
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    aria-pressed={filters.media === t.value}
                    onClick={() => set({ media: t.value })}
                    className={`rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition ${filters.media === t.value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-100' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <label className="relative flex items-center">
                <span className="sr-only">Sort by</span>
                <ArrowDownUp
                  size={14}
                  className="pointer-events-none absolute left-3 text-gray-400"
                />
                <select
                  value={filters.sort}
                  onChange={(e) => set({ sort: e.target.value as BookmarkSort })}
                  className={`${field} !border-0 !bg-gray-100 !py-2 pl-8 text-xs font-medium dark:!bg-gray-800`}
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <div
                role="group"
                aria-label="Layout"
                className="flex rounded-xl bg-gray-100 p-0.5 dark:bg-gray-800"
              >
                {(
                  [
                    ['grid', <LayoutGrid key="g" size={15} />, 'Grid'],
                    ['list', <ListIcon key="l" size={15} />, 'List'],
                  ] as const
                ).map(([v, icon, label]) => (
                  <button
                    key={v}
                    aria-label={`${label} layout`}
                    aria-pressed={view === v}
                    onClick={() => changeView(v)}
                    className={`rounded-[10px] p-1.5 transition ${view === v ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-100' : 'text-gray-400 hover:text-gray-700'}`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
            {(refined || tags.length > 0) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
                {filters.author && (
                  <Chip label={`@${filters.author}`} onClear={() => set({ author: '' })} />
                )}
                {filters.tag && <Chip label={`#${filters.tag}`} onClear={() => set({ tag: '' })} />}
                {filters.media && (
                  <Chip
                    label={TYPES.find((t) => t.value === filters.media)?.label || filters.media}
                    onClear={() => set({ media: '' })}
                  />
                )}
                {filters.q && <Chip label={`“${filters.q}”`} onClear={() => set({ q: '' })} />}
                {refined && (
                  <button
                    className="ml-1 text-xs text-gray-400 hover:text-indigo-500"
                    onClick={() => set({ q: '', author: '', tag: '', media: '' })}
                  >
                    Clear all
                  </button>
                )}
                {!filters.tag && tags.length > 0 && (
                  <select
                    aria-label="Filter by tag"
                    value=""
                    onChange={(e) => set({ tag: e.target.value })}
                    className="rounded-full border-0 bg-transparent py-0.5 text-xs text-gray-400 lg:hidden"
                  >
                    <option value="">+ Tag</option>
                    {tags.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          {notice && (
            <div
              role="status"
              className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            >
              {notice}
              <button aria-label="Dismiss" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
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
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void action('/resume')}
                    >
                      <Play size={14} /> Resume
                    </button>
                  )}
                  {status.job.status !== 'cancelled' && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void action('/cancel')}
                    >
                      <X size={14} /> Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
          {loading ? (
            <div
              aria-label="Loading bookmarks"
              className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4"
            >
              {[240, 340, 200, 300, 260, 320, 220, 280].map((h, i) => (
                <div
                  key={i}
                  style={{ height: h }}
                  className="mb-4 break-inside-avoid animate-pulse rounded-2xl bg-gray-200/60 dark:bg-gray-800/60"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[390px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-300 px-6 text-center dark:border-gray-700">
              <div className="mb-5 rotate-[-8deg] rounded-2xl bg-white p-6 shadow-lg shadow-indigo-100 dark:bg-gray-800 dark:shadow-none">
                <BookmarkIcon size={36} strokeWidth={1.3} className="text-indigo-400" />
              </div>
              <h2 className="text-xl font-semibold">
                {collectionTotal ? 'Nothing here' : 'Make space for your next rabbit hole'}
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
                {collectionTotal
                  ? 'Try another search, or loosen your filters.'
                  : 'Connect X and bring your bookmarks into a collection you can browse, tag, and revisit.'}
              </p>
              {collectionTotal ? (
                <button
                  className={`${button} mt-5 text-indigo-600`}
                  onClick={() => setFilters({ ...emptyFilters, sort: filters.sort })}
                >
                  Show all bookmarks
                </button>
              ) : (
                <button
                  className={`${button} mt-5 text-indigo-600`}
                  onClick={() => setSettingsOpen(true)}
                >
                  Set up your collection <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          ) : view === 'grid' ? (
            <div className="flex items-start gap-4">
              {Array.from({ length: columnCount }, (_, column) => (
                <div key={column} className="flex min-w-0 flex-1 flex-col gap-4">
                  {items
                    .filter((_, i) => i % columnCount === column)
                    .map((item) => {
                      const image = coverImage(item),
                        cover = item.media[0];
                      return (
                        <article
                          key={item.key}
                          className="group overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/60 dark:border-gray-800 dark:bg-gray-900 dark:hover:shadow-black/20"
                        >
                          <div className="flex items-start justify-between gap-2 px-4 pt-4">
                            <Author item={item} onAuthor={showAuthor} />
                            <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-gray-400">
                              {!item.read && (
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-indigo-500"
                                  title="Unread"
                                />
                              )}
                              {shortDate(item.publishedAt)}
                            </span>
                          </div>
                          <button
                            onClick={(e) => open(item, e.currentTarget)}
                            className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                            aria-label={`Read bookmark by ${item.author.name}`}
                          >
                            <p
                              className={`whitespace-pre-wrap break-words px-4 pt-3 leading-relaxed ${image ? 'line-clamp-4 text-sm text-gray-700 dark:text-gray-300' : 'line-clamp-8 text-[15px] text-gray-800 dark:text-gray-200'}`}
                            >
                              {displayText(item.text)}
                            </p>
                            {image && (
                              <div className="relative mx-4 mt-3 overflow-hidden rounded-xl">
                                <PreviewImage
                                  src={image}
                                  alt={cover?.alt || item.links[0]?.title || 'Saved post image'}
                                  className="max-h-[380px] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                                />
                                {cover && cover.type !== 'photo' && (
                                  <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white backdrop-blur">
                                    <Play size={11} fill="currentColor" /> Video
                                  </span>
                                )}
                                {item.media.length > 1 && (
                                  <span className="absolute right-2.5 top-2.5 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white">
                                    +{item.media.length - 1}
                                  </span>
                                )}
                              </div>
                            )}
                            {item.links[0] &&
                              !item.links[0].domain.match(/(^|\.)(x|twitter)\.com$/) && (
                                <div className="mx-4 mt-3 flex items-center gap-1.5 truncate text-[11px] text-gray-400">
                                  <LinkIcon size={12} className="shrink-0" /> {item.links[0].domain}
                                </div>
                              )}
                          </button>
                          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-2">
                            <div className="flex min-w-0 flex-wrap gap-1">
                              {item.folders.slice(0, 2).map((id) => (
                                <button
                                  key={id}
                                  onClick={() => set({ ...collection, folder: id })}
                                  className="flex max-w-32 items-center gap-1 truncate rounded-md bg-gray-100 px-2 py-1 text-[10px] text-gray-500 hover:bg-gray-200 dark:bg-gray-800"
                                >
                                  <Folder size={10} className="shrink-0" />
                                  <span className="truncate">{folderNames.get(id)}</span>
                                </button>
                              ))}
                              {item.tags.slice(0, 2).map((t) => (
                                <button
                                  key={t}
                                  onClick={() => set({ tag: t })}
                                  className="max-w-24 truncate rounded-md bg-indigo-50 px-2 py-1 text-[10px] text-indigo-600 dark:bg-indigo-950"
                                >
                                  #{t}
                                </button>
                              ))}
                            </div>
                            <ItemActions item={item} onUpdate={(i, p) => void update(i, p)} />
                          </div>
                        </article>
                      );
                    })}
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-sm dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {items.map((item) => {
                const image = coverImage(item);
                return (
                  <li
                    key={item.key}
                    className="group flex items-start gap-3 px-4 py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <Avatar item={item} size="h-9 w-9 mt-0.5" />
                    <button
                      onClick={(e) => open(item, e.currentTarget)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      aria-label={`Read bookmark by ${item.author.name}`}
                    >
                      <p className="flex min-w-0 items-center gap-1.5 text-xs">
                        {!item.read && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                        )}
                        <span className="truncate font-semibold text-gray-800 dark:text-gray-200">
                          {item.author.name}
                        </span>
                        {item.author.username && (
                          <span className="truncate text-gray-400">@{item.author.username}</span>
                        )}
                        <span className="shrink-0 text-gray-400">
                          · {shortDate(item.publishedAt)}
                        </span>
                      </p>
                      <p className="mt-0.5 line-clamp-2 break-words text-sm text-gray-700 dark:text-gray-300">
                        {displayText(item.text)}
                      </p>
                      {(item.folders.length > 0 || item.tags.length > 0) && (
                        <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-gray-400">
                          {item.folders.map((id) => (
                            <span key={id} className="inline-flex items-center gap-1">
                              <Folder size={10} /> {folderNames.get(id)}
                            </span>
                          ))}
                          {item.tags.map((t) => (
                            <span key={t} className="text-indigo-500">
                              #{t}
                            </span>
                          ))}
                        </p>
                      )}
                    </button>
                    {image && (
                      <PreviewImage
                        src={image}
                        alt=""
                        className="hidden h-14 w-20 shrink-0 rounded-lg object-cover !min-h-0 sm:block"
                      />
                    )}
                    <ItemActions item={item} onUpdate={(i, p) => void update(i, p)} />
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={sentinel} aria-hidden className="h-1" />
          {next !== null && !loading && (
            <div className="py-6 text-center">
              <button
                className={`${button} border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900`}
                disabled={loadingMore}
                onClick={() => void load(next)}
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                Show more
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
      </div>
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
                  <Author item={selected} onAuthor={showAuthor} />
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
                  {selected.folders.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selected.folders.map((id) => (
                        <button
                          key={id}
                          onClick={() => {
                            set({ folder: id, unread: false, favorite: false });
                            closeReader();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <Folder size={12} /> {folderNames.get(id) || 'Folder'}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-lg leading-8">
                    {displayText(selected.text)}
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
                    {selected.author.username && (
                      <button
                        className={button}
                        onClick={() => showAuthor(selected.author.username)}
                      >
                        <AtSign size={15} /> More from @{selected.author.username}
                      </button>
                    )}
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
                    Estimates use X&apos;s billed rate of about $0.001 per post, plus reservations
                    held for failed requests. The X Developer Console is the source of truth for
                    charges and billing-cycle limits.
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
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Bookmark folders</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {folderSyncedAt
                          ? `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} · updated ${new Date(folderSyncedAt).toLocaleString()}`
                          : 'Not imported yet. About $0.001 per bookmark in a folder.'}
                      </p>
                    </div>
                    <button
                      className={`${button} bg-gray-100 dark:bg-gray-800`}
                      disabled={foldersBusy || !status.connected}
                      onClick={() => void syncFolders()}
                    >
                      {foldersBusy ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <FolderDown size={14} />
                      )}
                      {folderSyncedAt ? 'Refresh' : 'Import'}
                    </button>
                  </div>
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
