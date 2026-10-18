// Everything OpenClaw needs for one action-card pass, in one read: the cards it already wrote and
// their state, Adamya's recent reasons, the posts in his Openclaw folder, and whether the (paid)
// X refresh of that folder is due. Plain Node, like the CLI that prints it.
import { answers, readCards } from './store.ts';
import { folderMembership, readFolders, readSources, readState } from '../bookmarks/store.ts';
import { MONTHLY_LIMIT } from '../bookmarks/sync.ts';

export const OPENCLAW_FOLDER_NAME = 'openclaw';
export const X_REFRESH_EVERY_DAYS = 3;     // Adamya: refresh bookmarks from X every 3 days, not daily
export const X_REFRESH_MIN_BUDGET = 0.5;   // dollars left this month before a refresh is allowed
export const NEW_NOTICED_PER_PASS = 3;

const billingMonth = (d: Date) => d.toISOString().slice(0, 7);

export function digest(now = new Date()) {
  const cards = readCards();
  const folders = readFolders();
  const folder = folders.folders.find((f) => f.name.trim().toLowerCase() === OPENCLAW_FOLDER_NAME) ?? null;
  const state = readState();
  const sources = readSources();
  const membership = folderMembership(folders, state.accountId);
  const posts = folder
    ? Object.entries(sources)
      .filter(([, s]) => (membership[s.id] ?? []).includes(folder.id))
      .map(([key, s]) => {
        const card = cards.find((c) => c.bookmarkKey === key);
        const image = s.media.find((m) => m.preview || m.url);
        return {
          key,
          author: s.author.name,
          handle: s.author.username,
          avatar: s.author.avatar?.replace('_normal', '_bigger'),
          publishedAt: s.publishedAt,
          url: s.url,
          text: s.text,
          links: s.links.map((l) => l.url).slice(0, 3),
          image: image?.preview ?? image?.url,
          card: card ? { key: card.key, status: card.status } : null,
        };
      })
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    : [];
  const lastRefresh = folder ? folders.folderSyncedAt?.[folder.id] ?? folders.syncedAt ?? null : null;
  const used = state.usage[billingMonth(now)] || 0;
  const remaining = Math.max(0, MONTHLY_LIMIT - used);
  const ageDays = lastRefresh ? (now.getTime() - Date.parse(lastRefresh)) / 864e5 : Infinity;
  return {
    now: now.toISOString(),
    cards: cards.map((c) => ({
      key: c.key, id: c.id, short: c.short, title: c.title, source: c.source, status: c.status, when: c.when, weight: c.weight,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
      ...(c.decision ? { answer: { verdict: c.decision.verdict, reason: c.decision.reason, at: c.decision.at } } : {}),
      ...(c.withdrawn ? { withdrawn: c.withdrawn } : {}),
    })),
    reasons: answers(cards, 30),
    openclawFolder: folder ? { id: folder.id, name: folder.name, lastRefresh, posts } : null,
    xRefresh: {
      due: !!folder && ageDays >= X_REFRESH_EVERY_DAYS && remaining >= X_REFRESH_MIN_BUDGET,
      everyDays: X_REFRESH_EVERY_DAYS,
      lastRefresh,
      budget: { usedThisMonth: Math.round(used * 1000) / 1000, limit: MONTHLY_LIMIT, remaining: Math.round(remaining * 1000) / 1000 },
    },
    limits: { newNoticedPerPass: NEW_NOTICED_PER_PASS },
  };
}
