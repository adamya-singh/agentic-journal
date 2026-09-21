import React from 'react';
import { JOB_EMPLOYER_STAGE_LABELS } from '@/lib/job-email-updates';
import type { JobEmployerStage } from '@/lib/types';

export const EMPLOYER_STAGE_STYLES: Record<JobEmployerStage, string> = {
  received:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800',
  assessment:
    'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800',
  interview:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800',
  offer:
    'bg-teal-50 text-teal-800 ring-teal-300 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-700',
  rejected:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-800',
};

export function EmployerStageBadge({ stage, className = '' }: { stage: JobEmployerStage; className?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${EMPLOYER_STAGE_STYLES[stage]} ${className}`}>
      {JOB_EMPLOYER_STAGE_LABELS[stage]}
    </span>
  );
}
