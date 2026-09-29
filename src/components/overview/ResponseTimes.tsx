'use client';

import React from 'react';
import { Timer } from 'lucide-react';
import { elapsed } from '@/lib/job-overview';
import { listOf, type TimingRow } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip, Pill } from './primitives';

/** How long employers took, shown only where there is something to measure. */
export function ResponseTimes({ rows }: { rows: TimingRow[] }) {
  const measured = rows.filter((r) => r.n > 0);
  const empty = rows.filter((r) => r.n === 0);
  return (
    <Card className="h-full">
      <CardHeader
        as="h3"
        icon={<Timer className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            Response times
            <InfoTip label="About response times">
              Measured from the verified submission time to when the employer’s email arrived,
              for applications with a reliable baseline and an observed response. Applications
              that never heard back are not in these numbers, so they describe responders, not
              everyone. A spread appears once there are five observations.
            </InfoTip>
          </span>
        }
        subtitle="Conditional on getting a reply"
      />
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {measured.length === 0 && <EmptyLine>No employer responses with usable timing yet.</EmptyLine>}
        {measured.map((r) => (
          <div key={r.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.label}</span>
            <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">
              median {elapsed(r.median)}
            </span>
            {r.q1 !== null && r.q3 !== null && (
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                typically {elapsed(r.q1)} – {elapsed(r.q3)}
              </span>
            )}
            <Pill title="Observed responses">n = {r.n}</Pill>
          </div>
        ))}
        {empty.length > 0 && (
          <EmptyLine>No {listOf(empty.map((r) => r.emptyLabel))} recorded yet.</EmptyLine>
        )}
      </div>
    </Card>
  );
}
