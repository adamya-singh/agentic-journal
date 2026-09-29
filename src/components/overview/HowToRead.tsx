'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';

/** The methodology in one place, out of the way of the numbers. */
export function HowToRead() {
  return (
    <details className="group px-4 py-3 text-sm text-slate-600 dark:text-slate-300 sm:px-5">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition group-open:rotate-90" aria-hidden="true" />
        How to read these numbers
      </summary>
      <div className="mt-2 max-w-3xl space-y-2 text-xs leading-5">
        <p>
          Outcomes mean “ever reached”, not a linear funnel: an application can be acknowledged,
          invited to an assessment, and later rejected, and it counts in each. A posting that
          closed before submission is not a rejection. Silence is not rejection either; unanswered
          applications stay unanswered.
        </p>
        <p>
          Timing uses the verified submission attempt and the employer’s receipt time, never the
          time the email was read into the system. Intervals earlier than two minutes before
          submission are excluded. Up to five minutes suggests an automatic invitation; five to
          sixty minutes is rapid but uncertain. These labels do not prove human or automated
          decisions.
        </p>
        <p>
          Comparisons only include applications observed for at least the selected window and
          count outcomes inside that window. Unknown groups stay visible. A pattern needs at least
          ten applications in each compared group and five outcomes across them; the intervals are
          95% Wilson intervals and describe sampling uncertainty only, not selection bias or
          multiple comparisons. Associations are not causes: role, company, timing, and resume
          choice all confound them.
        </p>
        <p>
          The AI report receives calculated statistics, cited employer reasons, milestones, and a
          short allowlist of job-related answers with provenance. It never receives demographic
          prompts, credentials, private links, notes, or the answer bank, and it may only propose
          hypotheses and experiments, never numbers or causes. Unconfirmed email matches are left
          out of every number until you resolve them on the Board. All times are Eastern.
        </p>
      </div>
    </details>
  );
}
