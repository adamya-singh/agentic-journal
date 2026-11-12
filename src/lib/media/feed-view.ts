import { readCompass, excerpt, type Compass } from './compass.ts';
import { addItems, idFromUrl, page, readFeed, summarize, type FeedPage, type FeedSummary, type PageQuery } from './feed-store.ts';
import { lensesOf, type CompassKind, type Lens, type Track } from './feed-types.ts';
import { readUnwind, tasteTarget } from './unwind-store.ts';

// What /media/feed loads: the first page, what your votes taught it, and both compasses.
export interface CompassView {
  kind: Lens;
  available: boolean;
  usable: boolean; // available and at least one item judged under it
  title?: string;
  excerpt: string;
  text: string;
  relation?: string;
  period?: Compass['period'];
  updatedAt?: string;
  source: string;
}
export interface FeedView extends FeedPage {
  summary: FeedSummary;
  compass: Lens;
  compasses: Record<Lens, CompassView>;
}
export function compassView(kind: CompassKind, judged: number): CompassView {
  const c = readCompass(kind);
  return {
    kind,
    available: c.available,
    usable: c.available && judged > 0,
    title: c.title,
    excerpt: excerpt(c.text),
    text: c.text.slice(0, 8000),
    relation: c.relation ? excerpt(c.relation, 400) : undefined,
    period: c.period,
    updatedAt: c.updatedAt,
    source: c.source,
  };
}
// Unwind's "compass" is your taste card.
export function tasteView(judged: number): CompassView {
  const u = readUnwind();
  return {
    kind: 'taste',
    available: true,
    usable: judged > 0,
    title: 'Taste card',
    excerpt: excerpt(u.taste.summary),
    text: tasteTarget(u).text,
    updatedAt: u.taste.updatedAt,
    source: '/media/unwind/taste',
  };
}
export function feedView(q: PageQuery): FeedView {
  const f = readFeed();
  const summary = summarize(f, q.compass);
  return {
    ...page(q, f),
    summary,
    compass: q.compass,
    compasses: {
      long: compassView('long', summary.judged.long),
      short: compassView('short', summary.judged.short),
      taste: tasteView(summary.judged.taste),
    },
  };
}

// Paste a link into the feed. YouTube videos outside your history get their title from oEmbed.
export async function addLink(url: string, track: Track = 'pretrain') {
  const id = idFromUrl(url);
  if (!id) throw new Error('Paste a YouTube, X or IMDb link.');
  let title: string | undefined, creator: { key: string; name: string; handle?: string } | undefined;
  if (id.startsWith('yt:')) {
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id.slice(3)}`)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (r.ok) {
        const o = (await r.json()) as { title?: string; author_name?: string; author_url?: string };
        const handle = o.author_url?.match(/\/(@[\w.-]+)/)?.[1];
        title = o.title;
        if (o.author_name)
          creator = { key: handle?.toLowerCase() || `name:${o.author_name}`, name: o.author_name, handle };
      }
    } catch {
      /* Fall back to what the history knows, if anything. */
    }
  }
  const you = { confidence: 0.85, tags: [], why: 'You added this yourself.', judgedBy: 'you' };
  const alignment = Object.fromEntries(lensesOf(track).map((l) => [l, you]));
  const res = await addItems([{ id, url, title, creator, alignment }], 'you');
  if (res.unknown.length) throw new Error(res.unknown[0].reason);
  return { id, added: res.added.length > 0 };
}

// The /media entry card: counts plus a peek at the top of the queue.
export function feedTeaser(track: Track = 'pretrain') {
  const f = readFeed();
  const lens: Lens = track === 'unwind' ? 'taste' : 'long';
  const top = page({ compass: lens, filter: 'queue', limit: 4 }, f).items;
  return {
    summary: summarize(f, lens),
    preview: top.map((c) => ({
      id: c.id,
      source: c.source,
      title: c.title,
      image:
        c.youtube?.thumbnail.replace('hqdefault', 'mqdefault') ||
        c.imdb?.poster ||
        c.x?.media.find((m) => m.preview || m.url)?.preview ||
        c.x?.media.find((m) => m.url)?.url ||
        c.x?.author.avatar?.replace('_normal.', '_bigger.'),
    })),
  };
}
