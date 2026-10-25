'use client';

import React from 'react';
import { Timer } from 'lucide-react';
import { elapsed } from '@/lib/job-overview';
import { listOf, type TimingRow } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip } from './primitives';

const KEY: Record<string, string> = {
  assessment: 'var(--now)',
  interview: 'var(--c-screen)',
  rejected: 'var(--c-reject)',
  'assessment-next': 'var(--c-tech)',
};
const DAY = 86400000;

/**
 * How long employers took, as day rulers: the dot is the median, the band the
 * middle half once there are enough observations. Shown only where there is
 * something to measure.
 */
export function ResponseTimes({ rows }: { rows: TimingRow[] }) {
  const measured = rows.filter((r) => r.n > 0);
  const empty = rows.filter((r) => r.n === 0);
  // One shared scale whose quarter ticks land on whole days.
  const longest = Math.max(1, ...measured.map((r) => (r.q3 ?? r.median ?? 0) / DAY));
  const span = Math.max(4, Math.ceil(longest / 4) * 4);
  const at = (ms: number) => `${Math.min(100, (ms / DAY / span) * 100)}%`;
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
              everyone. The dot is the median; the band shows the middle half once there are five
              observations.
            </InfoTip>
          </span>
        }
        subtitle="Conditional on getting a reply"
      />
      <div className="px-4 pb-4 pt-2 sm:px-5">
        {measured.length === 0 && <EmptyLine>No employer responses with usable timing yet.</EmptyLine>}
        {measured.map((r) => (
          <div key={r.key} className="ov-rul" style={{ ['--k' as string]: KEY[r.key] ?? 'var(--em)' }}>
            <span className="text-sm font-semibold text-slate-100">{r.label}</span>
            <span className="mono text-xs tabular-nums text-slate-300">
              median {elapsed(r.median)}
              <span className="text-slate-500"> · n {r.n}</span>
            </span>
            <span
              className="track"
              role="img"
              aria-label={`${r.label}: median ${elapsed(r.median)}${r.q1 !== null && r.q3 !== null ? `, typically ${elapsed(r.q1)} to ${elapsed(r.q3)}` : ''}, ${r.n} observed`}
            >
              {r.q1 !== null && r.q3 !== null && (
                <span className="rng" style={{ left: at(r.q1), width: `max(4px, calc(${at(r.q3)} - ${at(r.q1)}))` }} />
              )}
              {r.median !== null && <span className="med" style={{ left: at(r.median) }} />}
            </span>
            {r.q1 !== null && r.q3 !== null && (
              <span className="mono col-span-2 text-xs tabular-nums text-slate-500">
                typically {elapsed(r.q1)} – {elapsed(r.q3)}
              </span>
            )}
          </div>
        ))}
        {measured.length > 0 && (
          <div className="ov-scale" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i}>{(span * i) / 4} d</span>
            ))}
          </div>
        )}
        {empty.length > 0 && (
          <div className="mt-3">
            <EmptyLine>No {listOf(empty.map((r) => r.emptyLabel))} recorded yet.</EmptyLine>
          </div>
        )}
      </div>
    </Card>
  );
}
