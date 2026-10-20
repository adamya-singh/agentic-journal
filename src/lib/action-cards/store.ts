import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { backendDataDir, writeJsonFileAtomic } from '../backend-data.ts';
import { isGenericLink } from '../deep-link.ts';
import {
  CARD_SOURCES,
  CARD_WHENS,
  type ActionCard,
  type CardAnswer,
  type CardDecision,
  type FarSideView,
} from './types.ts';

// Every function here is synchronous on purpose: Node runs each to completion, so two requests in
// this process can't interleave a read-modify-write of cards.json. The CLI writes through the API.

export class ActionCardError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface StoreFile {
  version: 1;
  cards: ActionCard[];
}

export const actionCardsDir = () => path.join(backendDataDir(), 'action-cards');
const cardsFile = () => path.join(actionCardsDir(), 'cards.json');
const ID_RE = /^ac_[0-9a-f]{8}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ANSWERS_MAX = 12;
const DEFAULT_SNOOZE_DAYS = 14;

export function readCards(): ActionCard[] {
  try {
    return (JSON.parse(fs.readFileSync(cardsFile(), 'utf8')) as StoreFile).cards;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new ActionCardError('Action card storage could not be read. Check action-cards/cards.json.', 500);
  }
}

function writeCards(cards: ActionCard[]) {
  writeJsonFileAtomic(cardsFile(), { version: 1, cards } satisfies StoreFile);
}

const text = (max: number) => z.string().trim().min(1).max(max);
const day = z.string().regex(DAY_RE, 'Use YYYY-MM-DD.');
const outcome = z.object({
  kind: z.enum(['task', 'hand', 'move']),
  label: text(120),
  detail: z.string().trim().max(160).optional(),
  due: day.optional(),
  listType: z.enum(['have-to-do', 'want-to-do']).optional(),
}).strict();

// What a writer (OpenClaw, the CLI) sends. Status and decisions are the Journal's, never the writer's.
export const cardInput = z.object({
  key: text(200),
  source: z.enum(CARD_SOURCES),
  bookmarkKey: z.string().trim().max(120).optional(),
  post: z.object({
    author: text(120),
    handle: text(80),
    avatar: z.string().url().optional(),
    text: z.string().max(4000),
    url: z.string().url(),
    publishedAt: z.string().optional(),
    image: z.string().url().optional(),
  }).strict().optional(),
  evidence: z.array(z.object({ source: z.enum(CARD_SOURCES), text: text(400) }).strict()).max(6).default([]),
  kind: text(40),
  short: text(48),
  title: text(160),
  what: text(1200),
  why: z.object({ tone: z.enum(['bet', 'park']), label: text(80), text: text(600) }).strict(),
  next: text(240),
  estimate: text(40),
  bet: text(40),
  betLabel: text(60),
  when: z.enum(CARD_WHENS),
  weight: z.number().min(0).max(1),
  reasons: z.object({
    agree: z.array(text(60)).min(1).max(5),
    dismiss: z.array(text(60)).min(1).max(5),
  }).strict(),
  outcomes: z.array(outcome).min(1).max(3),
  ask: z.string().trim().max(300).optional(),
  link: z.string().url().optional(),
  snoozeUntil: day.optional(),
}).strict();
export type CardInput = z.input<typeof cardInput>;

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new ActionCardError(`${issue.path.join('.') || 'card'}: ${issue.message}`);
  }
  return r.data;
}

/**
 * Add a card, or update the one with the same key. A card that was already decided keeps its
 * decision: OpenClaw rewording a card never reopens something Adamya answered.
 */
export function upsertCard(value: unknown, now = new Date()): ActionCard {
  const input = parse(cardInput, value);
  checkBet(input);
  const cards = readCards();
  // One slice, one name: a bet keeps the label it was first written with.
  const named = cards.find((c) => c.bet === input.bet && c.key !== input.key);
  if (named) input.betLabel = named.betLabel;
  const at = now.toISOString();
  const i = cards.findIndex((c) => c.key === input.key);
  let card: ActionCard;
  if (i >= 0) {
    card = { ...cards[i], ...input, id: cards[i].id, createdAt: cards[i].createdAt, updatedAt: at };
    // A withdrawn card whose signal came back is open again; anything Adamya answered stays answered.
    if (card.status === 'withdrawn') { card.status = 'open'; delete card.withdrawn; }
    cards[i] = card;
  } else {
    let id: string;
    do id = `ac_${randomBytes(4).toString('hex')}`; while (cards.some((c) => c.id === id));
    card = { ...input, id, createdAt: at, updatedAt: at, status: 'open', history: [] };
    cards.push(card);
  }
  writeCards(cards);
  return card;
}

// Only the compass Focus bets (bet1, bet2, ...) can claim to serve a bet; learning and life cards are parked.
function checkBet(input: { bet: string; why: { tone: string } }) {
  if (input.why.tone === 'bet' && !/^bet\d$/.test(input.bet)) {
    throw new ActionCardError(`why.tone is "bet" but the card sits in "${input.bet}": use a bet1..bet3 slice, or tone "park".`);
  }
}

// A card's link should open the thing to act on; a course home or a front page is a warning, not an error,
// since sometimes nothing more direct exists.
function linkWarning(input: { link?: string }): string | undefined {
  if (!isGenericLink(input.link)) return undefined;
  return `link ${input.link} is a home or list page. Use the page for the thing itself (the assignment, form, posting or doc) if you can find it.`;
}

/**
 * What upserting these would do, without writing: add, update, reopen (was withdrawn) or keep (already answered).
 * `warning` marks something worth fixing that doesn't block the upsert.
 */
export function validateCards(values: unknown[]): { key: string; action: 'add' | 'update' | 'reopen' | 'keep-answered' | 'invalid'; error?: string; warning?: string }[] {
  const cards = readCards();
  return values.map((v) => {
    try {
      const input = parse(cardInput, v);
      checkBet(input);
      const c = cards.find((x) => x.key === input.key);
      const action = !c ? 'add' : c.status === 'withdrawn' ? 'reopen' : c.status === 'open' || c.status === 'handed' ? 'update' : 'keep-answered';
      const warning = linkWarning(input);
      return { key: input.key, action, ...(warning ? { warning } : {}) };
    } catch (e) {
      const key = v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string' ? (v as { key: string }).key : '?';
      return { key, action: 'invalid' as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** OpenClaw takes back a card it wrote because the thing it noticed is resolved. Answered cards are left alone. */
export function withdraw(key: string, why: string, now = new Date()): ActionCard {
  const cards = readCards();
  const i = cards.findIndex((c) => c.key === key);
  if (i < 0) throw new ActionCardError('No card has that key.', 404);
  if (!why.trim()) throw new ActionCardError('Say why it is being withdrawn.');
  const card = cards[i];
  if (card.status !== 'open' && card.status !== 'handed') return card;
  cards[i] = { ...card, status: 'withdrawn', withdrawn: { at: now.toISOString(), why: why.trim().slice(0, 300) }, updatedAt: now.toISOString() };
  writeCards(cards);
  return cards[i];
}

function findIndex(cards: ActionCard[], id: string): number {
  const i = ID_RE.test(id) ? cards.findIndex((c) => c.id === id) : -1;
  if (i < 0) throw new ActionCardError('That card no longer exists.', 404);
  return i;
}

export const decisionInput = z.object({
  id: z.string(),
  verdict: z.enum(['agree', 'dismiss']),
  reason: text(300),
  outcome: z.enum(['task', 'hand', 'move']).optional(),
  taskId: z.string().max(80).optional(),
  taskListType: z.enum(['have-to-do', 'want-to-do']).optional(),
  snooze: z.boolean().optional(),
}).strict();

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Agree or dismiss, with the reason. Agreeing to a task records the task it made, so Undo can remove it. */
export function decide(value: unknown, now = new Date()): ActionCard {
  const d = parse(decisionInput, value);
  const cards = readCards();
  const i = findIndex(cards, d.id);
  const card = cards[i];
  if (card.status !== 'open' && card.status !== 'handed' && !(card.status === 'snoozed' && isDue(card, now))) {
    throw new ActionCardError('This card already has an answer. Undo it first.', 409);
  }
  if (d.verdict === 'agree' && !d.outcome) throw new ActionCardError('Say what agreeing does: a task, a hand-off or a move.');
  if (d.outcome === 'task' && !d.taskId) throw new ActionCardError('A task outcome needs the task it created.');
  const decision: CardDecision = {
    verdict: d.verdict,
    reason: d.reason,
    at: now.toISOString(),
    ...(d.verdict === 'agree' ? { outcome: d.outcome } : {}),
    ...(d.taskId ? { taskId: d.taskId, taskListType: d.taskListType ?? 'want-to-do' } : {}),
    ...(d.verdict === 'dismiss' && d.snooze ? { snoozeUntil: card.snoozeUntil ?? ymd(addDays(now, DEFAULT_SNOOZE_DAYS)) } : {}),
  };
  const status = d.verdict === 'agree' ? (d.outcome === 'hand' ? 'handed' : 'agreed') : d.snooze ? 'snoozed' : 'dismissed';
  cards[i] = { ...card, status, decision, history: [...card.history, decision], updatedAt: decision.at };
  writeCards(cards);
  return cards[i];
}

/** Take the last answer back. Returns the card and the task to remove, if agreeing made one. */
export function undo(id: string, now = new Date()): { card: ActionCard; removeTask?: { id: string; listType: 'have-to-do' | 'want-to-do' } } {
  const cards = readCards();
  const i = findIndex(cards, id);
  const card = cards[i];
  if (!card.decision) throw new ActionCardError('There is nothing to undo on this card.', 409);
  const at = now.toISOString();
  const history = card.history.map((h, j) => (j === card.history.length - 1 ? { ...h, undone: at } : h));
  const { decision } = card;
  cards[i] = { ...card, status: 'open', decision: undefined, history, updatedAt: at };
  writeCards(cards);
  return {
    card: cards[i],
    ...(decision.taskId ? { removeTask: { id: decision.taskId, listType: decision.taskListType ?? 'want-to-do' } } : {}),
  };
}

function isDue(card: ActionCard, now: Date): boolean {
  return card.status === 'snoozed' && !!card.decision?.snoozeUntil && card.decision.snoozeUntil <= ymd(now);
}

/** What the far side shows: cards still waiting, plus the latest answers. */
export function farSideView(now = new Date()): FarSideView {
  const cards = readCards();
  const live = cards
    .filter((c) => c.status === 'open' || c.status === 'handed' || isDue(c, now))
    .map((c) => (isDue(c, now) ? { ...c, status: 'open' as const, decision: undefined } : c));
  return { cards: live, answers: answers(cards) };
}

export function answers(cards = readCards(), limit = ANSWERS_MAX): CardAnswer[] {
  const out: CardAnswer[] = [];
  for (const c of cards) {
    for (const h of c.history) {
      if (h.undone) continue;
      out.push({ id: c.id, short: c.short, verdict: h.verdict, reason: h.reason, outcome: h.outcome, at: h.at, source: c.source, bet: c.bet });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export function getCard(id: string): ActionCard {
  const cards = readCards();
  return cards[findIndex(cards, id)];
}
