'use client';

import React from 'react';
import { Check, ClipboardCheck, Code2, X } from 'lucide-react';
import { CompanyLogo } from '@/components/mission/CompanyLogo';
import { EmployerStageBadge } from '@/components/EmployerStageBadge';
import { epoch, type Milestone, type OverviewRow } from '@/lib/job-overview';
import { AUTOMATION_LABELS, MILESTONE_LABELS, formatEastern, sinceSubmission } from '@/lib/job-overview-view';
import type { JobEmployerStage } from '@/lib/types';
import { Button, Card, CardHeader, EmptyLine, InfoTip, Pill, type PillTone } from './primitives';

const TONE: Record<OverviewRow['automation'], PillTone> = {
  'likely automated': 'amber',
  'rapid response': 'blue',
  'explicitly automated': 'neutral',
  unknown: 'neutral',
};

/**
 * Assessment invitations drawn like interview rounds: how fast they came, what
 * they are, and whether completion is on record.
 */
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
        <ol className="ov-rnds px-4 pb-4 pt-2 sm:px-5">
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
            ].filter((d): d is string => Boolean(d));
            const node = !done
              ? { k: 'var(--now)', icon: <Code2 className="h-4 w-4" aria-hidden="true" /> }
              : done.kind === 'assessment-failed'
                ? { k: 'var(--c-reject)', icon: <X className="h-4 w-4" aria-hidden="true" /> }
                : { k: 'var(--c-tech)', icon: <Check className="h-4 w-4" aria-hidden="true" /> };
            return (
              <li key={r.id} className="ov-rd" style={{ ['--k' as string]: node.k }}>
                <span className="nd">{node.icon}</span>
                <div className="bx">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpen(r.id)} className="flex min-w-0 items-center gap-2.5 text-left">
                      <CompanyLogo company={r.company} link={r.url} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-100">{r.company}</span>
                        <span className="block text-xs text-slate-400">{r.role}</span>
                      </span>
                    </button>
                    {done ? (
                      <Pill tone={done.kind === 'assessment-failed' ? 'red' : 'emerald'} title={formatEastern(done.occurredAt)}>
                        {MILESTONE_LABELS[done.kind]} · {formatEastern(done.occurredAt, 'date')}
                      </Pill>
                    ) : (
                      <Button variant="amber" onClick={() => onOpen(r.id, 'assessment-completed')}>
                        Record completion
                      </Button>
                    )}
                  </div>
                  {details.length > 0 && (
                    <div className="ov-meta">
                      {details.map((d) => (
                        <span key={d} style={d.startsWith('due ') && !done ? { color: 'var(--now)' } : undefined}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ov-meta">
                    <Pill tone={TONE[r.automation]}>{AUTOMATION_LABELS[r.automation]}</Pill>
                    <span>{sinceSubmission(r.assessmentMs)}</span>
                    <span className="text-slate-500">{formatEastern(invite.receivedAt)}</span>
                  </div>
                  {next && (
                    <div className="ov-meta">
                      Then <EmployerStageBadge stage={next} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
