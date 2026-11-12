import type { JobApplicationCategory, JobEmployerStage } from '@/lib/types';

// Mission hues for job data, as CSS variables of the .mi/.cb roots.
// Amber always means "waiting on you"; the employer stages match the casebook.

export const EMPLOYER_STAGE_COLOR: Record<JobEmployerStage, string> = {
  received: 'var(--c-tech)',
  assessment: 'var(--now)',
  interview: 'var(--c-screen)',
  offer: 'var(--c-offer)',
  rejected: 'var(--c-reject)',
};

export const CATEGORY_COLOR: Record<JobApplicationCategory, string> = {
  'new-grad': 'var(--c-fit)',
  'fall-internship': 'var(--c-ml)',
  'spring-internship': 'var(--c-behav)',
  'summer-internship': 'var(--c-onsite)',
};
