'use client';

import React from 'react';
import { AlertCircle, CalendarClock, Loader2, Mail, Sparkles } from 'lucide-react';
import { CompanyLogo } from '@/components/mission/CompanyLogo';
import type { Milestone, OverviewRow } from '@/lib/job-overview';
import type { AttentionItem } from '@/lib/job-overview-view';
import { Button } from './primitives';

const ICON: Record<AttentionItem['kind'], React.ReactNode> = {
  'assessment-open': <AlertCircle className="h-4 w-4" aria-hidden="true" />,
  'interview-unscheduled': <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  'interview-upcoming': <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  'interview-unrecorded': <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  'emails-pending': <Mail className="h-4 w-4" aria-hidden="true" />,
  'email-error': <Mail className="h-4 w-4" aria-hidden="true" />,
  'analysis-error': <Sparkles className="h-4 w-4" aria-hidden="true" />,
  'analysis-overdue': <Sparkles className="h-4 w-4" aria-hidden="true" />,
};

/**
 * Employer-side items that need a human, as the amber box in the Readout hero.
 * Renders nothing when there are none.
 */
export function AttentionStrip({
  items,
  rowsById,
  onOpen,
  onAnalyze,
}: {
  items: AttentionItem[];
  rowsById: Map<string, OverviewRow>;
  onOpen: (id: string, kind?: Milestone['kind']) => void;
  onAnalyze: () => Promise<void>;
}) {
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (items.length === 0) return null;
  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      await onAnalyze();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };
  const action = (item: AttentionItem) => {
    switch (item.kind) {
      case 'assessment-open':
      case 'interview-unrecorded':
        return (
          <Button variant="amber" onClick={() => onOpen(item.id!, item.milestoneKind)}>
            {item.kind === 'assessment-open' ? 'Record completion' : 'Record outcome'}
          </Button>
        );
      case 'interview-unscheduled':
        return (
          <Button variant="amber" onClick={() => onOpen(item.id!, item.milestoneKind)}>
            Record time
          </Button>
        );
      case 'interview-upcoming':
        return (
          <Button variant="amber" onClick={() => onOpen(item.id!)}>
            Open
          </Button>
        );
      case 'emails-pending':
        return (
          <a
            href="/jobs#email-updates"
            className="ov-btn ov-btn-amber"
          >
            Confirm on Board
          </a>
        );
      case 'analysis-error':
      case 'analysis-overdue':
        return (
          <Button variant="amber" disabled={analyzing} onClick={() => void analyze()}>
            {analyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {analyzing ? 'Analyzing…' : 'Analyze now'}
          </Button>
        );
      default:
        return null;
    }
  };
  return (
    <section className="cap ov-cap" aria-label="Needs your attention">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="pulse" aria-hidden="true" />
        <h3 className="lab" style={{ color: 'var(--now)', margin: 0 }}>Needs you · {items.length}</h3>
        <span className="sub">follow-ups the agents can’t do for you</span>
      </div>
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {items.map((item, index) => {
        const row = item.id ? rowsById.get(item.id) : undefined;
        const body = (
          <>
            <span className="w">{item.title}</span>
            <span className="d">{item.detail}</span>
          </>
        );
        return (
          <div key={`${item.kind}-${item.id ?? index}`} className="ov-act">
            <span style={{ gridRow: 'span 3', alignSelf: 'start', color: 'var(--now)' }}>
              {row ? <CompanyLogo company={row.company} link={row.url} size="sm" /> : ICON[item.kind]}
            </span>
            {item.id ? (
              <button type="button" onClick={() => onOpen(item.id!)} style={{ display: 'grid', gap: 2, textAlign: 'left', minWidth: 0 }}>
                {body}
              </button>
            ) : (
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>{body}</span>
            )}
            <span className="a">{action(item)}</span>
          </div>
        );
      })}
    </section>
  );
}
