// Your feed: content judged to align with who you want to be, voted up or down.
// Stored in media/feed.json (not state.json, which /media polls every 4 s).

export type FeedSource = 'youtube' | 'x' | 'imdb';
export const FEED_SOURCES: FeedSource[] = ['youtube', 'x', 'imdb'];
// Which compass an item was judged against: OpenClaw's long-term North Star or
// the current short-term compass.
export type CompassKind = 'long' | 'short';
export const COMPASS_KINDS: CompassKind[] = ['long', 'short'];
// candidate = judged aligned but held back; new = in the queue, unseen;
// seen = shown without a vote; skipped = passed over twice or skipped by you.
export type FeedItemState = 'candidate' | 'new' | 'seen' | 'up' | 'down' | 'skipped';
export type Vote = 'up' | 'down';

export interface Alignment {
  confidence: number; // 0–1
  tags: string[];
  why: string; // one specific sentence, in Adamya's terms
  judgedAt: string;
  judgedBy: string; // 'gemini-2.5-flash' | 'openclaw' | 'claude'
}
export interface FeedCreator {
  key: string; // '@dwarkeshpatel' | 'x:@sailaunderscore' | 'imdb'
  name: string;
  handle?: string;
}
export interface FeedItem {
  id: string; // 'yt:<videoId>' | 'x:<postId>' | 'tt…'
  source: FeedSource;
  title: string;
  url: string;
  creator: FeedCreator;
  publishedAt?: string;
  alignment: Partial<Record<CompassKind, Alignment>>;
  addedBy: string; // 'claude:seed' | 'openclaw' | 'you'
  addedAt: string;
  state: FeedItemState;
  seenCount: number;
  seenAt?: string;
  votedAt?: string;
  // YouTube uploads found outside your history (OpenClaw's RSS pass) carry their own facts.
  durationSec?: number;
  channelId?: string;
}
export interface CuratorRun {
  at: string;
  by: string;
  added: number;
  promoted: number;
  note?: string;
}
export interface FeedState {
  version: 1;
  vocabulary: string[];
  items: Record<string, FeedItem>;
  // Judged not aligned under that compass; never re-judged under it.
  rejected: Record<string, { at: string; compass: CompassKind }[]>;
  curator: { runs: CuratorRun[] };
  // The short-term compass period the `short` judgments belong to. A new period id wipes them.
  shortJudged?: { period: string; version?: number; at: string };
}

// Seed vocabulary. OpenClaw may add tags with `media.ts feed-vocab --add`.
export const DEFAULT_VOCABULARY: Record<string, string> = {
  'frontier AI': 'labs, models, scaling, where the field is going',
  'ML fundamentals': 'how models actually work: math, architectures, training, from scratch',
  'research papers': 'specific papers and results explained',
  'agents & tooling': 'agentic systems, coding agents, AI products being built',
  'founder mode': 'starting and running companies, startup strategy, fundraising',
  building: 'shipping things, engineering craft, making over consuming',
  'compute & leverage': 'chips, data centers, capital, power, where leverage sits',
  'tech strategy': 'business and strategy of tech companies and markets',
  'great engineers': 'interviews and talks with exceptional builders and researchers',
  discipline: 'focus, work ethic, avoiding distraction, self-control',
  'mindset & courage': 'ambition, risk-taking, conviction, mental toughness',
  'good advice': 'compact life or career wisdom',
  'health & energy': 'sleep, fitness, energy, physical performance',
  'science & engineering': 'physics, hardware, robotics, space, electronics',
  'history & big ideas': 'history, philosophy, civilization-scale thinking',
  aesthetics: 'design, craft and beauty that raises your taste',
  'stories of persistence': 'films and stories about grinding through adversity to excellence',
  'deep work': 'long-form, demanding content worth full attention',
  'tech news': 'news and recaps of the tech week',
  humor: 'funny, light, still worth it',
};
