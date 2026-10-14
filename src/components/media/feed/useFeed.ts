'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { feedApi, type CompassKind, type FeedCard, type FeedFilter, type FeedPage, type FeedSource, type FeedSummary, type FeedView } from './api';

export interface FeedQuery {
  compass: CompassKind;
  filter: FeedFilter;
  source?: FeedSource;
}
// Loads the feed page by page. The queue is re-ranked on every request, so the
// next page excludes everything already on screen instead of using an offset.
export function useFeed(q: FeedQuery) {
  const [view, setView] = useState<FeedView>();
  const [items, setItems] = useState<FeedCard[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const itemsRef = useRef<FeedCard[]>([]);
  itemsRef.current = items;

  const reload = useCallback(async () => {
    const seq = ++generation.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ compass: q.compass, filter: q.filter });
      if (q.source) p.set('source', q.source);
      const data = await feedApi<FeedView>(`feed?${p}`);
      if (seq !== generation.current) return;
      setView(data);
      setItems(data.items);
      setNext(data.nextOffset);
      setHasMore(data.nextOffset !== null);
      setError('');
    } catch (e) {
      if (seq === generation.current) setError((e as Error).message);
    } finally {
      if (seq === generation.current) setLoading(false);
    }
  }, [q.compass, q.filter, q.source]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    const seq = generation.current;
    setLoadingMore(true);
    try {
      const shown = itemsRef.current.map((i) => i.id);
      const data = await feedApi<FeedPage>('feed/page', {
        compass: q.compass,
        filter: q.filter,
        ...(q.source ? { source: q.source } : {}),
        ...(q.filter === 'queue' ? { exclude: shown.slice(-3000) } : { offset: next ?? shown.length }),
        limit: 12,
      });
      if (seq !== generation.current) return;
      setItems((old) => {
        const have = new Set(old.map((i) => i.id));
        return [...old, ...data.items.filter((i) => !have.has(i.id))];
      });
      setNext(data.nextOffset);
      setHasMore(data.nextOffset !== null && data.items.length > 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, next, q.compass, q.filter, q.source]);

  const setSummary = useCallback(
    (summary: FeedSummary) => setView((v) => (v ? { ...v, summary } : v)),
    [],
  );
  const patch = useCallback(
    (id: string, change: Partial<FeedCard>) =>
      setItems((old) => old.map((i) => (i.id === id ? { ...i, ...change } : i))),
    [],
  );

  // Seen = on screen as the active item for a moment. Sent in small batches.
  const seenQueue = useRef(new Set<string>());
  const seenSent = useRef(new Set<string>());
  const markSeen = useCallback((id: string) => {
    if (seenSent.current.has(id)) return;
    seenSent.current.add(id);
    seenQueue.current.add(id);
  }, []);
  useEffect(() => {
    const flush = () => {
      const ids = [...seenQueue.current].slice(0, 100);
      if (!ids.length) return;
      for (const id of ids) seenQueue.current.delete(id);
      void feedApi('feed/seen', { ids, compass: q.compass }).catch(() => {
        /* Not worth interrupting you for. */
      });
    };
    const t = setInterval(flush, 3000);
    return () => {
      clearInterval(t);
      flush();
    };
  }, [q.compass]);

  return { view, items, loading, loadingMore, hasMore, error, setError, reload, loadMore, setSummary, patch, markSeen };
}
