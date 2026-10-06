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

/** Generated eligibility decisions must be reviewed; time cannot grant consent. */
export function needsEligibilityReview(question: JobApplicationQuestion): boolean {
  return isEligibilityQuestion(question)
    && (question.resolution === 'auto-resolved' || Boolean(question.generatedAnswer))
    && question.resolution !== 'pending'
    && JSON.stringify(question.eligibilityReviewedAnswer) !== JSON.stringify(question.answer);
}

export function hasStaleGraduationContext(question: Pick<JobApplicationQuestion, 'prompt' | 'answer' | 'generatedAnswer'>): boolean {
  if (!/graduat|degree|bachelor|enroll/i.test(question.prompt)) return false;
  const evidence = JSON.stringify([question.answer, question.generatedAnswer?.assumptions]);
  return /(?:May|Spring)\s*2027|2027-05|05\/\d{1,2}\/(?:2027|27)\b/i.test(evidence);
}
