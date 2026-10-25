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
const HEAT: Record<string, string> = {
  assessment: '#ffb547',
  interview: '#b59cff',
  offer: '#7dffb2',
  rejected: '#ff6b6b',
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** How much of the outcome's color a cell gets: none at 0%, then brighter with the rate. */
const heat = (rate: number) => (rate > 0 ? `${Math.min(62, 10 + rate * 150)}%` : '0%');

/**
 * Outcome rates by resume, role family, and so on, as heat cells, rendered
 * only where two groups are large enough to compare. Rows that pass the
 * pattern threshold are marked and spelled out with their interval so the
 * comparison carries its own caveat.
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
      <div className="space-y-5 px-4 pb-5 pt-2 sm:px-5">
        {cards.length === 0 && <EmptyLine>{emptyState}</EmptyLine>}
        {cards.length > 0 && <p className="sub">Brighter cell = higher rate.</p>}
        {cards.map((card) => {
          const flagged = new Set(card.patterns.flatMap((p) => [p.a.value, p.b.value]));
          return (
            <div key={card.dimension}>
              <div className="overflow-x-auto">
                <table className="ov-heat">
                  <thead>
                    <tr>
                      <th scope="col">{card.label}</th>
                      <th scope="col" className="text-right">n</th>
                      {card.outcomes.map((k) => (
                        <th key={k} scope="col">
                          {OUTCOME_LABEL[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {card.groups.map((g) => (
                      <tr
                        key={g.value}
                        className={flagged.has(g.value) ? 'flag' : g.eligible ? '' : 'thin'}
                        title={flagged.has(g.value) ? 'Part of a pattern that meets the threshold' : undefined}
                      >
                        <td className="max-w-[14rem] truncate">
                          <LinkButton
                            onClick={() => onCite(`${card.label}: ${g.value}`, g.ids)}
                            title={g.eligible ? 'Show these applications' : 'Fewer than ten applications; shown for completeness'}
                          >
                            {g.value}
                          </LinkButton>
                        </td>
                        <td className="mono text-right text-xs tabular-nums text-slate-400">{g.n}</td>
                        {card.outcomes.map((k) => (
                          <td
                            key={k}
                            className="c tabular-nums"
                            style={{ ['--k' as string]: HEAT[k], ['--p' as string]: heat(g.hits[k] / g.n) }}
                          >
                            {g.hits[k]}/{g.n} · {pct(g.hits[k] / g.n)}
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
                  className="mt-2 text-xs text-slate-300"
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
