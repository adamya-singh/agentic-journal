import type { WideNetPlace } from '@/lib/job-wide-net';

/**
 * The job search's judge, the pure part: the prompt that asks OpenClaw which search each posting
 * belongs in (North Star, the wide net, or neither), and the reading of its reply. The turn itself is run from
 * src/app/api/jobs/wide-net/judge.ts.
 */

export const JUDGE_BATCH_SIZE = 8;
/** A batch means opening up to eight postings. */
export const JUDGE_TURN_TIMEOUT_MS = 10 * 60_000;
const REASON_MAX = 200;
const ABOUT_MAX = 200;
const PROS_CONS_MAX = 400;

export interface JudgeItem {
  /** The posting's link key. */
  key: string;
  company: string;
  title: string;
  location: string;
  link: string;
  place: WideNetPlace;
  /** Where it was found, when a search handed it in. */
  source?: string;
}

export interface JudgeBatch {
  /** alias (p1…p8) → link key. The reply is read through this map only. */
  aliases: Record<string, string>;
  items: (JudgeItem & { alias: string })[];
}

export interface JudgeVerdict {
  /** `focus` is the North Star search, `wide` the wide net, `skip` neither. */
  verdict: 'focus' | 'wide' | 'skip';
  reason: string;
  /** For a North Star posting: what speaks for it and against it. */
  pros?: string;
  cons?: string;
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
      place: PLACE_LABEL[item.place], link: item.link, ...(item.source ? { found: item.source } : {}),
    }));
  const guidance = opts.forAgents?.trim();
  return `Agentic Journal is sorting job postings that its searches found for Adamya, a new grad (January 2027). It runs two searches, and its application worker applies to every posting you put in either one, with no one checking after you. Put each posting below in one of them, or in neither.

1. "focus", the North Star search. His selective search, applied to first. Put a posting here only when it is clearly this:
- AI/ML engineering with real model, eval, agent, retrieval, inference, training or AI infrastructure work; or GPU, compiler, systems or performance work that builds depth for AI infrastructure.
- At a strong company for it: an AI lab, a frontier-model-adjacent or well-regarded startup, or an elite technical team at a larger company.
A generic software role does not belong here, even at a great company. When unsure between "focus" and "wide", choose "wide".

2. "wide", the wide net. Broader, applied to after the North Star postings. What he wants from it: to work as a software engineer in New York or the San Francisco Bay Area, and good software engineering roles at very good companies wherever they are. Put a posting here only when both hold:
- The work is real software engineering (or ML engineering): building software is the core of the job.
- The employer is a credible technology company or has a strong engineering organisation: its product is technology, or it is known for its engineering.
Place changes the wide net's bar:
- New York or Bay Area: the two tests above are enough.
- Remote or elsewhere in the US: only when the company is very good, one a strong engineer would be glad to have on a resume (major tech companies, well-known engineering organisations, notable well-funded startups). Decide on the company first; if it does not clear that bar and the role is not North Star work, skip it without opening the posting.

3. "skip", neither:
- Maintenance, site upkeep, content administration, IT, support, QA-only, reporting and BI, SQL-only work.
- Defense contractors and roles that need a security clearance.
- Data annotation, AI tutoring, evaluation gigs, part-time and contract work.
- Employers whose business is not technology and whose engineering is not notable (utilities, insurers, hospitals, real estate, manufacturers, local agencies, sports teams).
- Jobs that are not software at all, whatever the title says.
- Roles he cannot take: internships, or ones that need more experience or a later graduation than his.

How to judge: open the posting link with web fetch and read what the job is. Do not use the browser: the application worker is using it. If a page cannot be read, judge from the company, title and place and set "read" to false. Change nothing anywhere and message no one. Your reply is the only thing you produce.
${guidance ? `
Adamya's guidance for agents in this period of his life (it sharpens the North Star search; the wide net is deliberately broader, so do not skip a good software role for not being AI):
${guidance}
` : ''}
Postings, one JSON object per line:
${lines.join('\n')}

Reply with ONLY one JSON object, no prose, no code fence, with one key for every id above. A "focus" verdict needs "pros" and "cons":
{"p1":{"verdict":"wide","reason":"<one line: what the job is and why it passes>","about":"<one line: what the company does>","read":true},"p2":{"verdict":"focus","reason":"<one line>","pros":"<what speaks for it>","cons":"<what speaks against it>","about":"<one line>","read":true},"p3":{"verdict":"skip","reason":"<one line: why not>","about":"<one line>","read":false}}`;
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
    if (verdict !== 'focus' && verdict !== 'wide' && verdict !== 'skip') {
      problems.push(`${alias}: verdict ${clip(String(item?.verdict ?? 'missing'), 20)}`);
      continue;
    }
    const reason = typeof item!.reason === 'string' ? clip(oneLine(item!.reason), REASON_MAX) : '';
    if (!reason) {
      problems.push(`${alias}: no reason`);
      continue;
    }
    const about = typeof item!.about === 'string' ? clip(oneLine(item!.about), ABOUT_MAX) : '';
    const pros = typeof item!.pros === 'string' ? clip(oneLine(item!.pros), PROS_CONS_MAX) : '';
    const cons = typeof item!.cons === 'string' ? clip(oneLine(item!.cons), PROS_CONS_MAX) : '';
    if (verdict === 'focus' && (!pros || !cons)) {
      problems.push(`${alias}: North Star without pros and cons`);
      continue;
    }
    verdicts[key] = {
      verdict, reason, ...(verdict === 'focus' ? { pros, cons } : {}), ...(about ? { about } : {}), read: item!.read === true,
    };
  }
  const missing = Object.values(aliases).filter((key) => !verdicts[key]);
  return { verdicts, missing, problems };
}
