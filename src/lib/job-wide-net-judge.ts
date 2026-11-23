import type { WideNetPlace } from '@/lib/job-wide-net';

/**
 * The wide net's judge, the pure part: the prompt that asks OpenClaw whether each posting is worth
 * an application, and the reading of its reply. The turn itself is run from
 * src/app/api/jobs/wide-net/judge.ts.
 */

export const JUDGE_BATCH_SIZE = 8;
/** A batch means opening up to eight postings. */
export const JUDGE_TURN_TIMEOUT_MS = 10 * 60_000;
const REASON_MAX = 200;
const ABOUT_MAX = 200;

export interface JudgeItem {
  /** The posting's link key. */
  key: string;
  company: string;
  title: string;
  location: string;
  link: string;
  place: WideNetPlace;
}

export interface JudgeBatch {
  /** alias (p1…p8) → link key. The reply is read through this map only. */
  aliases: Record<string, string>;
  items: (JudgeItem & { alias: string })[];
}

export interface JudgeVerdict {
  verdict: 'apply' | 'skip';
  reason: string;
  /** One line about the company. */
  about?: string;
  read: boolean;
}

export interface JudgeReplyCheck {
  /** By link key. */
  verdicts: Record<string, JudgeVerdict>;
  /** Link keys sent and not given a usable verdict. */
  missing: string[];
  problems: string[];
}

export function buildJudgeBatches(items: JudgeItem[]): JudgeBatch[] {
  const batches: JudgeBatch[] = [];
  for (let start = 0; start < items.length; start += JUDGE_BATCH_SIZE) {
    const picked = items.slice(start, start + JUDGE_BATCH_SIZE).map((item, index) => ({ ...item, alias: `p${index + 1}` }));
    batches.push({ aliases: Object.fromEntries(picked.map((item) => [item.alias, item.key])), items: picked });
  }
  return batches;
}

const PLACE_LABEL: Record<WideNetPlace, string> = {
  hub: 'New York or Bay Area',
  remote: 'remote',
  elsewhere: 'elsewhere in the US',
};

export function buildJudgePrompt(batch: JudgeBatch, opts: { forAgents?: string } = {}): string {
  const lines = batch.items.map((item) =>
    JSON.stringify({
      id: item.alias, company: item.company, title: item.title, location: item.location,
      place: PLACE_LABEL[item.place], link: item.link,
    }));
  const guidance = opts.forAgents?.trim();
  return `Agentic Journal is filling Adamya's "wide net": new-grad software jobs outside his selective AI/ML search that are still good enough to apply to. Its application worker applies to every posting you pass, with no one checking after you, so judge each one below.

What he wants from the wide net: to work as a software engineer in New York or the San Francisco Bay Area, and good software engineering roles at very good companies wherever they are.

Pass ("apply") a posting only when both hold:
1. The work is real software engineering (or ML engineering): building software is the core of the job.
2. The employer is a credible technology company or has a strong engineering organisation: its product is technology, or it is known for its engineering.

Turn down ("skip"):
- Maintenance, site upkeep, content administration, IT, support, QA-only, reporting and BI, SQL-only work.
- Defense contractors and roles that need a security clearance.
- Data annotation, AI tutoring, evaluation gigs, part-time and contract work.
- Employers whose business is not technology and whose engineering is not notable (utilities, insurers, hospitals, real estate, manufacturers, local agencies, sports teams).
- Jobs that are not software at all, whatever the title says.

Place changes the bar:
- New York or Bay Area: the two tests above are enough.
- Remote or elsewhere in the US: pass only when the company is very good, one a strong engineer would be glad to have on a resume (major tech companies, well-known engineering organisations, notable well-funded startups). Decide on the company first; if it does not clear that bar, skip it without opening the posting.

How to judge: open the posting link with web fetch and read what the job is. Do not use the browser: the application worker is using it. If a page cannot be read, judge from the company, title and place and set "read" to false. Change nothing anywhere and message no one. Your reply is the only thing you produce.
${guidance ? `
Adamya's guidance for agents in this period of his life (use it as judgment guidance; the wide net is deliberately broader than his AI/ML focus, so do not skip a good software role for not being AI):
${guidance}
` : ''}
Postings, one JSON object per line:
${lines.join('\n')}

Reply with ONLY one JSON object, no prose, no code fence, with one key for every id above:
{"p1":{"verdict":"apply","reason":"<one line: what the job is and why it passes>","about":"<one line: what the company does>","read":true},"p2":{"verdict":"skip","reason":"<one line: why not>","about":"<one line>","read":false}}`;
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/**
 * Reads OpenClaw's reply item by item: unknown aliases are dropped, an item without a usable
 * verdict and reason counts as missing, and an unreadable reply leaves every posting missing.
 */
export function validateJudgeReply(raw: unknown, aliases: Record<string, string>): JudgeReplyCheck {
  const verdicts: Record<string, JudgeVerdict> = {};
  const problems: string[] = [];
  const reply = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!reply) problems.push('reply was not a JSON object');
  for (const [name, value] of Object.entries(reply ?? {})) {
    const alias = name.trim().toLowerCase();
    const key = Object.prototype.hasOwnProperty.call(aliases, alias) ? aliases[alias] : undefined;
    if (!key) {
      problems.push(`unknown id ${clip(name, 20)}`);
      continue;
    }
    const item = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const verdict = typeof item?.verdict === 'string' ? item.verdict.trim().toLowerCase() : '';
    if (verdict !== 'apply' && verdict !== 'skip') {
      problems.push(`${alias}: verdict ${clip(String(item?.verdict ?? 'missing'), 20)}`);
      continue;
    }
    const reason = typeof item!.reason === 'string' ? clip(oneLine(item!.reason), REASON_MAX) : '';
    if (!reason) {
      problems.push(`${alias}: no reason`);
      continue;
    }
    const about = typeof item!.about === 'string' ? clip(oneLine(item!.about), ABOUT_MAX) : '';
    verdicts[key] = { verdict, reason, ...(about ? { about } : {}), read: item!.read === true };
  }
  const missing = Object.values(aliases).filter((key) => !verdicts[key]);
  return { verdicts, missing, problems };
}
