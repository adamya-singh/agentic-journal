'use client';

import React from 'react';
import { Scale } from 'lucide-react';
import type { ComparisonCard as ComparisonModel } from '@/lib/job-overview-view';
import { Card, CardHeader, EmptyLine, InfoTip, LinkButton, SegmentedControl } from './primitives';

const OUTCOME_LABEL: Record<string, string> = {
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};
const BAR: Record<string, string> = {
  assessment: 'bg-amber-400 dark:bg-amber-500',
  interview: 'bg-violet-400 dark:bg-violet-500',
  offer: 'bg-teal-400 dark:bg-teal-500',
  rejected: 'bg-red-400 dark:bg-red-500',
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Outcome rates by resume, role family, and so on, rendered only where two
 * groups are large enough to compare. Rows that pass the pattern threshold
 * are highlighted with their interval so the comparison carries its own caveat.
 */
export function ComparisonsCard({
  cards,
  windowDays,
  onWindowChange,
  eligible,
  emptyState,
  onCite,
}: {
  cards: ComparisonModel[];
  windowDays: 7 | 14 | 30;
  onWindowChange: (days: 7 | 14 | 30) => void;
  eligible: number;
  emptyState: string;
  onCite: (label: string, ids: string[]) => void;
}) {
  return (
    <Card>
      <CardHeader
        as="h3"
        icon={<Scale className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            Outcome comparisons
            <InfoTip label="About comparisons">
              Each rate is outcomes within the window divided by applications observed for at
              least that long. Associations are not causes: role, company, timing, and resume
              selection can all explain a difference. Highlighted rows meet the pattern threshold
              (ten per group, five outcomes); their 95% intervals show sampling uncertainty only.
            </InfoTip>
          </span>
        }
        subtitle={`${eligible} application${eligible === 1 ? '' : 's'} observed for at least ${windowDays} days`}
        right={
          <SegmentedControl
            label="Observation window"
            size="sm"
            value={windowDays}
            onChange={onWindowChange}
            options={[
              { value: 7, label: '7 d' },
              { value: 14, label: '14 d' },
              { value: 30, label: '30 d' },
            ]}
          />
        }
      />
      <div className="space-y-5 px-4 py-4 sm:px-5">
        {cards.length === 0 && <EmptyLine>{emptyState}</EmptyLine>}
        {cards.map((card) => {
          const flagged = new Set(card.patterns.flatMap((p) => [p.a.value, p.b.value]));
          return (
            <div key={card.dimension}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 dark:text-slate-400">
                      <th scope="col" className="py-1 pr-3 text-left font-medium">
                        Group
                      </th>
                      <th scope="col" className="py-1 pr-3 text-right font-medium">
                        n
                      </th>
                      {card.outcomes.map((k) => (
                        <th key={k} scope="col" className="min-w-32 py-1 pr-3 text-left font-medium">
                          {OUTCOME_LABEL[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.groups.map((g) => (
                      <tr
                        key={g.value}
                        className={
                          flagged.has(g.value)
                            ? 'bg-indigo-50/60 dark:bg-indigo-950/20'
                            : g.eligible
                              ? ''
                              : 'text-slate-400 dark:text-slate-500'
                        }
                      >
                        <td className="py-1.5 pr-3">
                          <LinkButton
                            onClick={() => onCite(`${card.label}: ${g.value}`, g.ids)}
                            className={g.eligible ? '' : 'text-slate-400 dark:text-slate-500'}
                            title={g.eligible ? 'Show these applications' : 'Fewer than ten applications; shown for completeness'}
                          >
                            {g.value}
                          </LinkButton>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{g.n}</td>
                        {card.outcomes.map((k) => (
                          <td key={k} className="py-1.5 pr-3">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className={`h-full ${BAR[k]}`}
                                  style={{ width: `${(g.hits[k] / g.n) * 100}%` }}
                                />
                              </div>
                              <span className="whitespace-nowrap text-xs tabular-nums">
                                {g.hits[k]}/{g.n} · {pct(g.hits[k] / g.n)}
                              </span>
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {card.patterns.map((p) => (
                <p
                  key={`${p.outcome}-${p.a.value}-${p.b.value}`}
                  className="mt-2 text-xs text-slate-600 dark:text-slate-300"
                >
                  <span className="font-medium">{OUTCOME_LABEL[p.outcome]}:</span> {p.a.value}{' '}
                  {pct(p.aInterval[0])}–{pct(p.aInterval[1])} versus {p.b.value}{' '}
                  {pct(p.bInterval[0])}–{pct(p.bInterval[1])} (95% intervals).{' '}
                  <LinkButton
                    className="text-xs"
                    onClick={() =>
                      onCite(`${card.label}: ${p.a.value} vs ${p.b.value}`, [...p.a.ids, ...p.b.ids])
                    }
                  >
                    Show these applications
                  </LinkButton>
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
