'use client';

import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import { EmployerStageBadge } from '@/components/EmployerStageBadge';
import { epoch, type Milestone, type OverviewRow } from '@/lib/job-overview';
import { AUTOMATION_LABELS, MILESTONE_LABELS, formatEastern, sinceSubmission } from '@/lib/job-overview-view';
import type { JobEmployerStage } from '@/lib/types';
import { Button, Card, CardHeader, EmptyLine, InfoTip, LinkButton, Pill, type PillTone } from './primitives';

const TONE: Record<OverviewRow['automation'], PillTone> = {
  'likely automated': 'amber',
  'rapid response': 'blue',
  'explicitly automated': 'neutral',
  unknown: 'neutral',
};

/** Assessment invitations: how fast they came, what they are, and whether completion is on record. */
export function AssessmentsCard({
  rows,
  onOpen,
}: {
  rows: OverviewRow[];
  onOpen: (id: string, kind?: Milestone['kind']) => void;
}) {
  const invited = rows.filter((r) => r.first.assessment);
  return (
    <Card>
      <CardHeader
        as="h3"
        icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            Assessments
            <InfoTip label="About assessment timing">
              Timing is invitation receipt minus verified submission. Up to five minutes suggests
              an automatic invitation; five to sixty minutes is rapid but uncertain. Slower
              invitations do not establish human review. Within two minutes is shown as
              “around submission”.
            </InfoTip>
          </span>
        }
        subtitle={`${invited.length} invitation${invited.length === 1 ? '' : 's'} in this view`}
      />
      {invited.length === 0 ? (
        <div className="px-4 py-4 sm:px-5">
          <EmptyLine>No assessment invitations in this view.</EmptyLine>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {invited.map((r) => {
            const invite = r.first.assessment!;
            const at = epoch(invite.receivedAt) ?? 0;
            const next = (['interview', 'offer', 'rejected'] as JobEmployerStage[]).find(
              (k) => (epoch(r.first[k]?.receivedAt) ?? -Infinity) >= at,
            );
            const done = r.milestones
              .filter((m) => m.kind.startsWith('assessment-'))
              .sort((a, b) => (epoch(b.occurredAt) ?? 0) - (epoch(a.occurredAt) ?? 0))[0];
            const details = [
              invite.provider,
              invite.assessmentType,
              invite.deadline ? `due ${formatEastern(invite.deadline)}` : '',
            ].filter(Boolean);
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <LinkButton onClick={() => onOpen(r.id)} className="block">
                    <span className="block text-sm text-slate-900 dark:text-slate-100">{r.company}</span>
                    <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                      {r.role}
                    </span>
                  </LinkButton>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <Pill tone={TONE[r.automation]}>{AUTOMATION_LABELS[r.automation]}</Pill>
                    <span className="tabular-nums">{sinceSubmission(r.assessmentMs)}</span>
                    <span className="text-slate-400 dark:text-slate-500">
                      {formatEastern(invite.receivedAt)}
                    </span>
                  </div>
                  {details.length > 0 && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{details.join(' · ')}</p>
                  )}
                  {next && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                      Then <EmployerStageBadge stage={next} />
                    </p>
                  )}
                </div>
                {done ? (
                  <Pill tone="violet" title={formatEastern(done.occurredAt)}>
                    {MILESTONE_LABELS[done.kind]} · {formatEastern(done.occurredAt, 'date')}
                  </Pill>
                ) : (
                  <Button variant="ghost" onClick={() => onOpen(r.id, 'assessment-completed')}>
                    Record completion
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
