'use client';

import React from 'react';
import { AlertCircle, CalendarClock, Loader2, Mail, Sparkles } from 'lucide-react';
import type { Milestone } from '@/lib/job-overview';
import type { AttentionItem } from '@/lib/job-overview-view';
import { Band, Button } from './primitives';

const ICON: Record<AttentionItem['kind'], React.ReactNode> = {
  'assessment-open': <AlertCircle className="h-4 w-4" aria-hidden="true" />,
  'interview-upcoming': <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  'interview-unrecorded': <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  'emails-pending': <Mail className="h-4 w-4" aria-hidden="true" />,
  'email-error': <Mail className="h-4 w-4" aria-hidden="true" />,
  'analysis-error': <Sparkles className="h-4 w-4" aria-hidden="true" />,
  'analysis-overdue': <Sparkles className="h-4 w-4" aria-hidden="true" />,
};

/** Employer-side items that need a human. Renders nothing when there are none. */
export function AttentionStrip({
  items,
  onOpen,
  onAnalyze,
}: {
  items: AttentionItem[];
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
            className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
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
    <Band tone="amber" aria-label="Needs your attention">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3 sm:px-5">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Needs you ({items.length})
        </h3>
        <span className="text-xs text-amber-700/70 dark:text-amber-400/70">
          — employer-side follow-ups the agents cannot do for you
        </span>
      </div>
      {error && (
        <p role="alert" className="px-4 pb-1 text-sm text-red-700 dark:text-red-300 sm:px-5">
          {error}
        </p>
      )}
      <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
        {items.map((item, index) => (
          <li
            key={`${item.kind}-${item.id ?? index}`}
            className="flex items-center gap-3 px-4 py-2 hover:bg-amber-100/60 dark:hover:bg-amber-900/20 sm:px-5"
          >
            <span className="shrink-0 text-amber-600 dark:text-amber-400">{ICON[item.kind]}</span>
            {item.id ? (
              <button
                type="button"
                onClick={() => onOpen(item.id!)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block break-words text-sm font-medium text-slate-800 dark:text-slate-100 sm:truncate">
                  {item.title}
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-300">
                  {item.detail}
                </span>
              </button>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  {item.title}
                </span>
                <span className="block text-xs text-slate-600 dark:text-slate-300">
                  {item.detail}
                </span>
              </span>
            )}
            {action(item)}
          </li>
        ))}
      </ul>
    </Band>
  );
}
