import { eligibilityConflict, type CandidateFacts } from './candidate-facts';
import type { JobApplicationQuestion } from './types';

// Explicitly corrected by Adamya on October 3, 2026. This context accompanies
// every claim so old resumes, generated answers and writing samples cannot win.
export const JOB_APPLICATION_CANDIDATE_CONTEXT = {
  confirmedAt: '2026-10-03',
  source: 'Adamya explicitly confirmed in chat',
  expectedGraduation: '2027-01',
  graduationNote: 'Graduating one semester early, in January 2027, not May 2027.',
  targetCategories: ['spring-internship', 'new-grad'],
  eligibilityPolicy: 'Evaluate degree-by-start requirements using January 2027. Do not equate current enrollment with ineligibility for a future new-grad start. Already completed a degree and no longer enrolled are different requirements; escalate conflicts before submitting. Never invent a completed degree.',
} as const;

export function isEligibilityQuestion(question: Pick<JobApplicationQuestion, 'prompt' | 'section'>): boolean {
  const text = `${question.section ?? ''} ${question.prompt}`;
  return /eligib|only open|must (?:have|be)|minimum requirement|graduat|degree|bachelor|master['’]?s|enroll|student status|work authoriz|authorized to work|sponsor|visa|citizen|security clearance|able to (?:start|work)|available to (?:start|work)|willing to (?:relocate|work)|open to working|at least .{0,25}(?:years|experience)/i.test(text);
}

/**
 * A generated eligibility answer that the review deadline cannot send for him. Without standing
 * facts that is every one of them. With them (candidate-facts.ts) it is only an answer that
 * contradicts a fact; the rest go out with the ordinary drafts.
 */
export function needsEligibilityReview(question: JobApplicationQuestion, facts?: CandidateFacts): boolean {
  return isEligibilityQuestion(question)
    && (question.resolution === 'auto-resolved' || Boolean(question.generatedAnswer))
    && question.resolution !== 'pending'
    && JSON.stringify(question.eligibilityReviewedAnswer) !== JSON.stringify(question.answer)
    && (!facts || eligibilityConflict(question, facts) !== null);
}

/** A draft Adamya sent back for a redo waits for his review; the deadline cannot waive it. */
export function needsRedoReview(question: JobApplicationQuestion): boolean {
  return Boolean(question.redoRequest)
    && question.resolution !== 'pending'
    && JSON.stringify(question.eligibilityReviewedAnswer) !== JSON.stringify(question.answer);
}

export function needsExplicitReview(question: JobApplicationQuestion, facts?: CandidateFacts): boolean {
  return needsEligibilityReview(question, facts) || needsRedoReview(question);
}

export function hasStaleGraduationContext(question: Pick<JobApplicationQuestion, 'prompt' | 'answer' | 'generatedAnswer'>): boolean {
  if (!/graduat|degree|bachelor|enroll/i.test(question.prompt)) return false;
  const evidence = JSON.stringify([question.answer, question.generatedAnswer?.assumptions]);
  return /(?:May|Spring)\s*2027|2027-05|05\/\d{1,2}\/(?:2027|27)\b/i.test(evidence);
}
