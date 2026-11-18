import type { JobApplicationAnswer, JobApplicationQuestion } from './types';

/**
 * Standing facts about Adamya that decide eligibility questions on job applications. He confirmed
 * them once (2026-11-18); since then an eligibility answer OpenClaw drafts is sent without waiting
 * for his Confirm unless it contradicts one of these. They also travel with every claim, so the
 * worker drafts from them instead of guessing.
 */
export interface CandidateFacts {
  workAuthorization: 'any-employer' | 'restricted' | 'none';
  sponsorship: 'never' | 'later' | 'now';
  citizenship: 'us-citizen' | 'us-citizen-dual' | 'permanent-resident' | 'other';
  clearance: 'none-willing' | 'none-unwilling' | 'held';
  onsite: 'any' | 'hybrid' | 'remote';
  relocation: 'anywhere-us' | 'major-hubs' | 'local';
  /** Earliest full-time start, YYYY-MM. */
  earliestStart: string;
  /** Debarment, embargoed-country ties, or needing an export license. */
  restrictions: 'none' | 'some';
  confirmedAt: string;
}

type FactKey = Exclude<keyof CandidateFacts, 'confirmedAt' | 'earliestStart'>;

/** Each fact's label and choices, in plain words: the Saved answers panel and the worker's claim both read this. */
export const CANDIDATE_FACT_CHOICES: { [K in FactKey]: { label: string; choices: Record<CandidateFacts[K], string> } } = {
  workAuthorization: {
    label: 'Authorized to work in the US',
    choices: { 'any-employer': 'Yes, for any employer', restricted: 'Yes, tied to a permit (OPT, CPT)', none: 'No' },
  },
  sponsorship: {
    label: 'Visa sponsorship',
    choices: { never: 'Never needed, now or in the future', later: 'Not now, needed later', now: 'Needed now' },
  },
  citizenship: {
    label: 'Citizenship',
    choices: {
      'us-citizen': 'US citizen, no other citizenship',
      'us-citizen-dual': 'US citizen with another citizenship',
      'permanent-resident': 'US permanent resident',
      other: 'Neither a US citizen nor a permanent resident',
    },
  },
  clearance: {
    label: 'Security clearance',
    choices: {
      'none-willing': 'None held; willing and eligible to get one',
      'none-unwilling': 'None held; not seeking roles that need one',
      held: 'Holds an active clearance',
    },
  },
  onsite: {
    label: 'On-site work',
    choices: { any: 'Any schedule, up to five days a week in the office', hybrid: 'Hybrid only, up to three days', remote: 'Remote only' },
  },
  relocation: {
    label: 'Relocation',
    choices: { 'anywhere-us': 'Anywhere in the US', 'major-hubs': 'Major tech hubs only', local: 'New York / New Jersey area only' },
  },
  restrictions: {
    label: 'Debarment, embargoed countries, export license',
    choices: { none: 'None apply', some: 'Something applies' },
  },
};

export const CANDIDATE_FACT_KEYS = Object.keys(CANDIDATE_FACT_CHOICES) as FactKey[];

/** The facts as sentences, for the worker's claim payload. */
export function describeCandidateFacts(facts: CandidateFacts): string[] {
  return [
    ...CANDIDATE_FACT_KEYS.map((key) => {
      const { label, choices } = CANDIDATE_FACT_CHOICES[key];
      return `${label}: ${(choices as Record<string, string>)[facts[key]]}.`;
    }),
    `Earliest full-time start: ${facts.earliestStart}.`,
  ];
}

export function normalizeCandidateFacts(value: unknown): CandidateFacts | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const facts: Record<string, unknown> = {};
  for (const key of CANDIDATE_FACT_KEYS) {
    if (typeof record[key] !== 'string' || !(record[key] in CANDIDATE_FACT_CHOICES[key].choices)) return undefined;
    facts[key] = record[key];
  }
  if (typeof record.earliestStart !== 'string' || !/^\d{4}-\d{2}$/.test(record.earliestStart)) return undefined;
  if (typeof record.confirmedAt !== 'string' || !record.confirmedAt) return undefined;
  return { ...(facts as Omit<CandidateFacts, 'earliestStart' | 'confirmedAt'>), earliestStart: record.earliestStart, confirmedAt: record.confirmedAt };
}

type Polarity = 'yes' | 'no' | 'unclear';

/** Whether an answer says yes or no. Long option labels ("I will not require sponsorship…") count by their negation. */
export function answerPolarity(answer: JobApplicationAnswer | undefined): Polarity {
  const text = (Array.isArray(answer) ? answer.join(' ') : answer ?? '').trim().toLowerCase();
  if (/^(?:yes|yep|y|true)\b/.test(text)) return 'yes';
  if (/^(?:no|n|none|false|n\/?a|not applicable)\b/.test(text)) return 'no';
  if (/\b(?:not|never|no|cannot|can't|won't|don't|without|unable)\b/.test(text)) return 'no';
  return 'unclear';
}

interface Topic {
  name: string;
  /** Matches the question. The first matching topic decides, so narrower ones come first. */
  asks: RegExp;
  /** The answer his facts imply, or null when his facts make this a question only he should answer. */
  expects: (facts: CandidateFacts) => 'yes' | 'no' | null;
}

const TOPICS: Topic[] = [
  {
    name: 'embargoed countries or debarment',
    asks: /\b(?:cuba|iran|north korea|syria|crimea|donetsk|luhansk|embargo|debar|suspended)/i,
    expects: (facts) => (facts.restrictions === 'none' ? 'no' : null),
  },
  {
    name: 'export license',
    asks: /\b(?:require|need)\b.{0,40}\bexport licen[cs]e/i,
    expects: (facts) => (facts.restrictions === 'none' && facts.citizenship.startsWith('us-citizen') ? 'no' : null),
  },
  {
    name: 'visa sponsorship',
    asks: /sponsor|\bvisa\b/i,
    expects: (facts) => (facts.sponsorship === 'never' ? 'no' : null),
  },
  {
    name: 'holding a security clearance',
    asks: /(?:do you|currently) (?:hold|have|possess).{0,40}clearance|active.{0,20}clearance/i,
    expects: (facts) => (facts.clearance === 'held' ? 'yes' : 'no'),
  },
  {
    name: 'getting a security clearance',
    asks: /clearance/i,
    expects: (facts) => (facts.clearance === 'none-unwilling' ? null : 'yes'),
  },
  {
    name: 'work authorization',
    asks: /authori[sz]ed to work|work authori[sz]ation|(?:legally|lawfully) (?:eligible|able|entitled|permitted|authori[sz]ed) to work|eligible to work/i,
    expects: (facts) => (facts.workAuthorization === 'any-employer' ? 'yes' : null),
  },
  {
    name: 'US citizenship',
    asks: /\b(?:u\.?s\.?|united states) (?:citizen|person)\b/i,
    expects: (facts) => (facts.citizenship.startsWith('us-citizen') ? 'yes' : facts.citizenship === 'permanent-resident' ? null : 'no'),
  },
  {
    name: 'a graduate degree',
    asks: /\b(?:graduate degree|master['’]?s degree|ph\.?d)\b/i,
    expects: () => 'no',
  },
  {
    name: 'relocation',
    asks: /relocat/i,
    expects: (facts) => (facts.relocation === 'anywhere-us' ? 'yes' : null),
  },
  {
    name: 'on-site work',
    asks: /on-?site|in[- ]person|in[- ]office|\boffice\b.{0,40}\b(?:days?|week)|\b(?:days?|week)\b.{0,40}\boffice\b|hybrid/i,
    expects: (facts) => (facts.onsite === 'any' ? 'yes' : null),
  },
];

/**
 * Why a drafted answer to an eligibility question must wait for Adamya, or null when it agrees
 * with his standing facts (or touches none of them). A fact that says "no" (sponsorship, debarment,
 * a graduate degree) must be answered with a clear no: an unclear answer there waits, because a
 * wrong yes is the costly mistake. A fact that says "yes" only objects to a clear no.
 */
export function eligibilityConflict(
  question: Pick<JobApplicationQuestion, 'prompt' | 'section' | 'answer'>,
  facts: CandidateFacts,
): string | null {
  const text = `${question.section ?? ''} ${question.prompt}`;
  const topic = TOPICS.find((candidate) => candidate.asks.test(text));
  if (!topic) return null;
  const expected = topic.expects(facts);
  if (expected === null) return `Your standing facts leave ${topic.name} for you to answer each time.`;
  const said = answerPolarity(question.answer);
  if (expected === 'no' ? said !== 'no' : said === 'no') {
    return `This answer on ${topic.name} does not match your standing facts, which say ${expected}.`;
  }
  return null;
}
