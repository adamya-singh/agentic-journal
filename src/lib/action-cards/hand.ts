// An action card handed to OpenClaw becomes work on a task: what the task worker is told he agreed to, and the
// notes of the task that agreeing makes when the card names none. Pure, shared by the route and the card's buttons.
import type { ActionCard } from './types';

const SOURCE: Record<ActionCard['source'], string> = { x: 'the Openclaw folder on X', jobs: 'Jobs', inbox: 'the inbox', compass: 'the compass', tasks: 'tasks', other: 'the Journal' };

const where = (card: ActionCard) => card.post?.url ?? card.link ?? '';

/** One paragraph for the worker's claim: the hand-off he agreed to, the card it came from, and his reason. */
export function cardHandText(card: ActionCard, reason: string): string {
  const o = card.outcomes.find((x) => x.kind === 'hand');
  const agreed = o ? `${o.label}${o.detail ? ` (${o.detail})` : ''}` : 'Hand to OpenClaw';
  return [
    `Adamya agreed on an action card: ${agreed}.`,
    `Card: ${card.title}. ${card.what}`.trim(),
    card.next ? `Next step named on the card: ${card.next}` : '',
    where(card) ? `Link: ${where(card)}` : '',
    reason.trim() ? `His reason: ${reason.trim()}` : '',
  ].filter(Boolean).join('\n').slice(0, 2000);
}

/** The task that agreeing to a hand-off makes when the card names none: its text, list and notes. */
export function cardHandTask(card: ActionCard, reason: string): { task: string; listType: 'have-to-do' | 'want-to-do'; notesMarkdown: string } {
  const o = card.outcomes.find((x) => x.kind === 'hand');
  const notes = [
    `From an action card OpenClaw ${card.source === 'x' ? 'made from a post in' : 'noticed in'} ${SOURCE[card.source]}, handed to OpenClaw.`,
    '',
    card.what,
    o ? `\nAgreed: ${o.label}${o.detail ? ` (${o.detail})` : ''}` : '',
    where(card) ? `\n${where(card)}` : '',
    '',
    `Why: ${reason}`,
  ].join('\n');
  return { task: card.title, listType: o?.listType ?? 'want-to-do', notesMarkdown: notes };
}
