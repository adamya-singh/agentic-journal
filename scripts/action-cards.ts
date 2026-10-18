#!/usr/bin/env node
// OpenClaw's way in to action cards: read the digest (cards, Adamya's reasons, the Openclaw folder,
// whether an X refresh is due), validate, add or update cards by key, and withdraw ones whose signal
// went away. Writes go straight to the Journal's files, so this works while the web server is down.
import fs from 'node:fs';
import { answers, farSideView, readCards, upsertCard, validateCards, withdraw } from '../src/lib/action-cards/store.ts';
import { digest } from '../src/lib/action-cards/digest.ts';

const [command = 'help', ...args] = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));
const readFileCards = () => {
  const file = opt('file');
  if (!file) throw new Error(`${command} needs --file path/to/cards.json (one card, or an array of cards).`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [parsed];
};
try {
  if (command === 'digest') out(digest());
  else if (command === 'list') out(opt('all') === 'true' ? readCards() : farSideView().cards);
  else if (command === 'reasons') out(answers(readCards(), Number(opt('limit') ?? 30)));
  else if (command === 'validate') out(validateCards(readFileCards()));
  else if (command === 'upsert') {
    const cards = readFileCards();
    const bad = validateCards(cards).filter((r) => r.action === 'invalid');
    if (bad.length) throw new Error(`Nothing written. Invalid: ${bad.map((b) => `${b.key}: ${b.error}`).join('; ')}`);
    out(cards.map((c) => upsertCard(c)).map((c) => ({ id: c.id, key: c.key, status: c.status })));
  } else if (command === 'withdraw') {
    const key = opt('key'), why = opt('why');
    if (!key || !why) throw new Error('withdraw needs --key <card key> --why "<what resolved it>".');
    const c = withdraw(key, why);
    out({ key: c.key, status: c.status });
  } else {
    console.log(JSON.stringify({
      commands: ['digest', 'list [--all true]', 'reasons [--limit N]', 'validate --file cards.json', 'upsert --file cards.json', 'withdraw --key KEY --why "..."'],
      note: 'Cards appear on the far side of Horizon Dawn. Status and answers belong to Adamya: upsert never reopens a card he answered.',
    }, null, 2));
  }
} catch (e) {
  console.error(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
