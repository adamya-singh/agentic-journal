'use client';

import React from 'react';
import { MessageSquareText } from 'lucide-react';
import type { OverviewRow } from '@/lib/job-overview';
import { formatEastern } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip, LinkButton } from './primitives';

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
      <div className="px-4 py-4 sm:px-5">
        {rejected.length === 0 ? (
          <EmptyLine>No rejections in this view.</EmptyLine>
        ) : stated.length === 0 ? (
          <EmptyLine>
            {rejected.length === 1 ? 'The one rejection' : `All ${rejected.length} rejections`} were
            generic and gave no reason.
          </EmptyLine>
        ) : (
          <ul className="space-y-3">
            {stated.map((r) => (
              <li key={r.id} className="text-sm">
                <LinkButton onClick={() => onOpen(r.id)}>
                  {r.company} · {r.role}
                </LinkButton>
                <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                  {formatEastern(r.first.rejected?.receivedAt, 'date')}
                </span>
                <p className="mt-0.5 text-slate-700 dark:text-slate-200">
                  {r.first.rejected?.outcomeReason ?? 'Reason not stated'}
                </p>
                {r.first.rejected?.supportingParaphrase && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    “{r.first.rejected.supportingParaphrase}”
                  </p>
                )}
              </li>
            ))}
            {stated.length < rejected.length && (
              <li>
                <EmptyLine>
                  {rejected.length - stated.length} more gave no reason.
                </EmptyLine>
              </li>
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
