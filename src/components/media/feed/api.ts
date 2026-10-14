import type { FeedCard, FeedFilter, FeedPage, FeedSummary } from '@/lib/media/feed-store';
import type { FeedView, CompassView } from '@/lib/media/feed-view';
import type { CompassKind, FeedSource } from '@/lib/media/feed-types';

export type { FeedCard, FeedFilter, FeedPage, FeedSummary, FeedView, CompassView, CompassKind, FeedSource };

export async function feedApi<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/media/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const p = await r.json().catch(() => ({}));
  if (!r.ok || !p.success) throw new Error(p.error || 'Your feed could not be loaded.');
  return p.data;
}

export const clock = (sec?: number) => {
  if (!sec) return '';
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
};
export const ago = (iso?: string) => {
  if (!iso) return '';
  const d = (Date.now() - Date.parse(iso)) / 86400_000;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
};
export const shortDate = (iso?: string) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
export const addedByLabel = (by: string) =>
  by === 'you' ? 'Added by you' : by.startsWith('claude') ? 'From your first pass' : 'Added by OpenClaw';
