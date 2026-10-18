// Action cards: things to act on that live on the far side of Horizon Dawn. Some come from posts
// Adamya saves to the Openclaw folder on X, the rest are things OpenClaw noticed in the Journal
// (Jobs, the inbox, the compass, tasks). Each one ends in Agree or Dismiss, always with a reason.

export const CARD_SOURCES = ['x', 'jobs', 'inbox', 'compass', 'tasks', 'other'] as const;
export type CardSource = (typeof CARD_SOURCES)[number];

// Which ring of the far side it sits on: how soon it fits the compass. Closer to the sun is sooner.
export const CARD_WHENS = ['now', 'period', 'after', 'someday'] as const;
export type CardWhen = (typeof CARD_WHENS)[number];

// 'withdrawn' is OpenClaw taking a card back because its signal went away; it is never one of Adamya's answers.
export type CardStatus = 'open' | 'handed' | 'agreed' | 'snoozed' | 'dismissed' | 'withdrawn';
export type OutcomeKind = 'task' | 'hand' | 'move';

export interface CardOutcome {
  kind: OutcomeKind;
  label: string;            // "Make it a task", "OpenClaw drafts the email", "Move to the Dec 23 list"
  detail?: string;          // "Wed Oct 21", "draft waits in Gmail for you"
  due?: string;             // YYYY-MM-DD, for a task
  listType?: 'have-to-do' | 'want-to-do';
}

export interface CardPost {
  author: string;
  handle: string;
  avatar?: string;
  text: string;
  url: string;
  publishedAt?: string;
  image?: string;
}

export interface CardEvidence {
  source: CardSource;
  text: string;
}

export interface CardDecision {
  verdict: 'agree' | 'dismiss';
  reason: string;
  outcome?: OutcomeKind;
  at: string;
  taskId?: string;
  taskListType?: 'have-to-do' | 'want-to-do';
  snoozeUntil?: string;     // YYYY-MM-DD
  undone?: string;          // when it was taken back
}

export interface ActionCard {
  id: string;               // ac_ + 8 hex
  key: string;              // stable identity from the writer, so a rerun updates instead of duplicating
  source: CardSource;
  bookmarkKey?: string;     // account:postId, for saved posts
  post?: CardPost;
  evidence: CardEvidence[]; // what OpenClaw saw, for cards it noticed itself
  kind: string;             // "Read", "Try", "Assessment", "Follow up"
  short: string;            // pill label
  title: string;
  what: string;
  why: { tone: 'bet' | 'park'; label: string; text: string };
  next: string;
  estimate: string;
  bet: string;              // the far side's slice: a compass bet key, or 'learning' / 'life'
  betLabel: string;
  when: CardWhen;
  weight: number;           // 0..1, how worth doing now
  reasons: { agree: string[]; dismiss: string[] };
  outcomes: CardOutcome[];
  ask?: string;             // a question OpenClaw needs answered
  link?: string;
  snoozeUntil?: string;     // where a "not now" dismissal snoozes it to, YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
  status: CardStatus;
  decision?: CardDecision;
  history: CardDecision[];
  withdrawn?: { at: string; why: string };
}

export interface CardAnswer {
  id: string;
  short: string;
  verdict: 'agree' | 'dismiss';
  reason: string;
  outcome?: OutcomeKind;
  at: string;
  source: CardSource;
  bet: string;
}

export interface FarSideView {
  cards: ActionCard[];      // open and handed (and snoozed ones whose date has come)
  answers: CardAnswer[];    // newest first
}
