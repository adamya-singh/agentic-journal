'use client';

import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { OverviewRow } from '@/lib/job-overview';
import { formatEastern, relativeTime, type AnalysisState } from '@/lib/job-overview-view';
import { Button, Card, CardHeader, EmptyLine, InfoTip, LinkButton, Pill } from './primitives';

/**
 * The daily report of hypotheses and experiments. It reads all records, not
 * the current filters, and every insight cites the applications behind it.
 */
export function AiReportCard({
  analysis,
  rowsById,
  onOpen,
  onCite,
  onAnalyze,
  now,
}: {
  analysis: AnalysisState;
  rowsById: Map<string, OverviewRow>;
  onOpen: (id: string) => void;
  onCite: (label: string, ids: string[]) => void;
  onAnalyze: () => Promise<void>;
  now: number;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const report = analysis.report;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onAnalyze();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analysis failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        as="h3"
        icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="inline-flex items-center gap-1">
            What the data suggests
            <InfoTip label="About the AI report">
              Generated daily at 9 AM Eastern when the evidence changes, from calculated statistics,
              employer-stated reasons, milestones, and an allowlist of job-related answers. It may
              only suggest hypotheses and experiments to test; numbers and causes are never generated. It
              reads every record, regardless of the filters above.
            </InfoTip>
          </span>
        }
        subtitle={
          report
            ? `Generated ${relativeTime(report.generatedAt, now)} · evidence through ${formatEastern(report.cutoff)} · covers all records`
            : 'No report yet · covers all records'
        }
        right={
          <>
            {report &&
              (analysis.stale ? (
                <Pill tone="amber" title="Evidence changed since this report; the scheduled run refreshes it">
                  Evidence changed
                </Pill>
              ) : (
                <Pill tone="emerald">Current</Pill>
              ))}
            <Button variant="secondary" disabled={busy} onClick={() => void run()} className="text-xs">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {busy ? 'Analyzing…' : 'Analyze now'}
            </Button>
          </>
        }
      />
      <div className="grid gap-7 px-4 pb-5 pt-2 sm:px-5">
        {(error || analysis.error) && (
          <p role="alert" className="err">
            {error ?? analysis.error?.message}
            {!error && analysis.error?.at && <span className="text-xs opacity-70"> · {formatEastern(analysis.error.at)}</span>}
          </p>
        )}
        {!report && <EmptyLine>Run the analysis once to get tentative hypotheses and suggested experiments.</EmptyLine>}
        {report?.insights.map((insight, index) => {
          const cited = insight.applicationIds
            .map((id) => ({ id, row: rowsById.get(id) }))
            .filter((c) => c.row);
          return (
            <article key={index}>
              <Pill tone={insight.kind === 'experiment' ? 'emerald' : 'violet'}>
                {insight.kind === 'experiment' ? 'Experiment' : 'Hypothesis'}
              </Pill>
              <div className="ov-lesson">
                {insight.text}
                <small>{insight.limitations}</small>
                {cited.length > 0 && (
                  <small style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
                    <span>Cites</span>
                    {cited.map(({ id, row }) => (
                      <LinkButton key={id} className="text-xs" onClick={() => onOpen(id)}>
                        {row!.company}
                      </LinkButton>
                    ))}
                    {cited.length > 1 && (
                      <LinkButton
                        className="text-xs"
                        onClick={() =>
                          onCite(
                            `Cited by ${insight.kind}`,
                            cited.map((c) => c.id),
                          )
                        }
                      >
                        Show all cited
                      </LinkButton>
                    )}
                  </small>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
