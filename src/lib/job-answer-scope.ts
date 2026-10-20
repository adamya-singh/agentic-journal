import type { JobApplicationAnswer, JobApplicationAnswerScope } from './types';

/**
 * Whether a confirmed answer is Adamya's answer everywhere ("general": work
 * authorization, contact details, demographics) or one he gave for a specific
 * job ("context": how he heard about it, why that company). Context answers
 * are kept with the company and role they were given for and are only ever a
 * hint for another application, never filled in on their own.
 *
 * Pure and dependency-free: the review panel and the answer bank use it too.
 */

// "How did you hear about us?", "Where did you find this opportunity?", "Referral source".
const SOURCE_PATTERN =
  /\b(how|where) (did|have) you (first )?(hear|heard|learn|learned|find|found|come across|discover|discovered)\b|\bhow you (heard|found|learned)\b|\b(referral|application|candidate|lead) source\b|\bsource of (your )?(application|referral)\b/;

// "Why do you want to work at Notion?", "Why are you interested in this role?".
const MOTIVATION_PATTERN =
  /\bwhy\b[^?.]*\b(interested|interest|excite|excites|excited|want to (work|join)|join(ing)?|work (at|for|with|here)|apply(ing)?|this (role|position|job|team|company|opportunity|posting|internship|program)|our (company|team|mission|product)|us)\b/;

// "What excites you about Serval?", "What draws you to this role?".
const ATTRACTION_PATTERN =
  /\bwhat (excites you about|interests you (about|in)|draws you to|attracts you to|appeals to you about)\b|\b(excited|interested) (about|in) (this|our|the) (role|position|company|team|opportunity|mission)\b/;

// "Which location are you applying for?", "What job(s) are you applying for?".
// Not "apply to": "Does this apply to you?" is about Adamya.
const APPLYING_FOR_PATTERN = /\bapplying (for|to)\b|\bwhich (role|position|team|location|office)s? (are you|would you like to be) (applying|considered)\b/;

const COMPANY_SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|company|technologies|labs|ai|hq)\b\.?/g;

export function normalizeCompanyName(company: string): string {
  return company.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The names a prompt or answer might use for the company ("Shield AI" → "shield ai", "shield"). */
function companyNames(company: string | undefined): string[] {
  if (!company) return [];
  const full = normalizeCompanyName(company);
  const core = full.replace(COMPANY_SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([full, core])].filter((name) => name.length >= 3);
}

function mentions(text: string, names: string[]): boolean {
  const haystack = ` ${normalizeCompanyName(text)} `;
  return names.some((name) => haystack.includes(` ${name} `));
}

export interface AnswerScopeInput {
  prompt: string;
  answer?: JobApplicationAnswer;
  /** The company the answer was given for. */
  company?: string;
}

/** Why a question was sorted as context-dependent, or null when it is general. */
export function contextReason(input: AnswerScopeInput): string | null {
  const prompt = input.prompt.toLowerCase().replace(/\s+/g, ' ');
  if (SOURCE_PATTERN.test(prompt)) return 'Where you heard about a job changes from job to job';
  if (MOTIVATION_PATTERN.test(prompt) || ATTRACTION_PATTERN.test(prompt)) return 'Written for this company';
  if (APPLYING_FOR_PATTERN.test(prompt)) return 'About this posting';
  // A prompt that names the company ("Have you worked at Snowflake?") only
  // ever matches that company's forms, so it can stay general, unless it asks
  // why ("Why Applied Intuition?").
  const names = companyNames(input.company);
  if (names.length > 0) {
    if (/\bwhy\b/.test(prompt) && mentions(input.prompt, names)) return 'Written for this company';
    const answers = input.answer === undefined ? [] : Array.isArray(input.answer) ? input.answer : [input.answer];
    if (answers.some((answer) => mentions(answer, names))) return 'The answer names the company';
  }
  return null;
}

export function defaultAnswerScope(input: AnswerScopeInput): JobApplicationAnswerScope {
  return contextReason(input) ? 'context' : 'general';
}
