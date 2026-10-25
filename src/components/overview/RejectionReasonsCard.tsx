'use client';

import React from 'react';
import { MessageSquareText } from 'lucide-react';
import { CompanyLogo } from '@/components/mission/CompanyLogo';
import type { OverviewRow } from '@/lib/job-overview';
import { formatEastern } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip } from './primitives';

/** Employer-stated rejection reasons only. Generic rejections say nothing, and this card says so once. */
export function RejectionReasonsCard({
  rows,
  onOpen,
}: {
  rows: OverviewRow[];
  onOpen: (id: string) => void;
}) {
  const rejected = rows.filter((r) => r.first.rejected);
  const stated = rejected.filter(
    (r) => r.first.rejected?.outcomeReason || r.first.rejected?.supportingParaphrase,
  );
  return (
    <Card>
      <CardHeader
        as="h3"
        icon={<MessageSquareText className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            Rejection reasons
            <InfoTip label="About rejection reasons">
              Only reasons the employer actually wrote are shown, paraphrased from the email.
              Most rejections are generic and carry no reason; those are counted but not listed.
            </InfoTip>
          </span>
        }
        subtitle={`${rejected.length} rejection${rejected.length === 1 ? '' : 's'} in this view`}
      />
      <div className="px-4 pb-5 pt-2 sm:px-5">
        {rejected.length === 0 ? (
          <EmptyLine>No rejections in this view.</EmptyLine>
        ) : stated.length === 0 ? (
          <EmptyLine>
            {rejected.length === 1 ? 'The one rejection' : `All ${rejected.length} rejections`} were
            generic and gave no reason.
          </EmptyLine>
        ) : (
          <div className="grid gap-6">
            {stated.map((r) => (
              <figure key={r.id} className="m-0 grid gap-3">
                <blockquote className="ov-quote">
                  “{r.first.rejected?.supportingParaphrase ?? r.first.rejected?.outcomeReason}”
                </blockquote>
                <figcaption className="grid gap-1">
                  <button type="button" onClick={() => onOpen(r.id)} className="flex min-w-0 items-center gap-2.5 text-left">
                    <CompanyLogo company={r.company} link={r.url} size="sm" />
                    <span className="mono min-w-0 text-xs text-slate-300">
                      <span className="text-slate-100">{r.company}</span> · {r.role} ·{' '}
                      {formatEastern(r.first.rejected?.receivedAt, 'date')}
                    </span>
                  </button>
                  {r.first.rejected?.supportingParaphrase && (
                    <span className="mono text-xs text-slate-500">
                      Reason: {r.first.rejected?.outcomeReason ?? 'not stated'}
                    </span>
                  )}
                </figcaption>
              </figure>
            ))}
            {stated.length < rejected.length && (
              <div className="ov-nobig">
                <b>{rejected.length - stated.length}</b>
                <span>more gave no reason</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
