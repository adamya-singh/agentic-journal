'use client';

import React from 'react';
import type { Milestone } from './job-overview';
import type { OverviewData } from './job-overview-view';

export type MilestoneInput = {
  listingId: string;
  kind: Milestone['kind'];
  occurredAt: string;
  note: string;
  supersedes?: string;
};

/**
 * Overview data with a quiet 60 s poll. Reloads never clear the current data,
 * stale responses are dropped, and mutations return their own errors instead
 * of sharing one page-wide message.
 */
export function useOverviewData() {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const sequence = React.useRef(0);
  const mutating = React.useRef(false);
  const controller = React.useRef<AbortController | null>(null);

  const reload = React.useCallback(async () => {
    const id = ++sequence.current;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    try {
      const response = await fetch('/api/jobs/overview', {
        cache: 'no-store',
        signal: current.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Could not load the overview');
      if (id !== sequence.current) return;
      setData(body as OverviewData);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (caught) {
      if (current.signal.aborted || id !== sequence.current) return;
      setError(caught instanceof Error ? caught.message : 'Could not load the overview');
    }
  }, []);

  React.useEffect(() => {
    void reload();
    const tick = () => {
      if (document.visibilityState === 'visible' && !mutating.current) void reload();
    };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    const interval = window.setInterval(tick, 60_000);
    return () => {
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
      window.clearInterval(interval);
      controller.current?.abort();
    };
  }, [reload]);

  const post = React.useCallback(
    async (url: string, body: unknown) => {
      mutating.current = true;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result?.error || 'The request failed');
      } finally {
        mutating.current = false;
      }
      await reload();
    },
    [reload],
  );

  const saveMilestone = React.useCallback(
    (input: MilestoneInput) => post('/api/jobs/overview', { action: 'milestone', ...input }),
    [post],
  );
  const group = React.useCallback(
    (listingIds: string[]) => post('/api/jobs/overview', { action: 'group', listingIds }),
    [post],
  );
  const ungroup = React.useCallback(
    (id: string) => post('/api/jobs/overview', { action: 'ungroup', id }),
    [post],
  );
  const analyze = React.useCallback(
    () => post('/api/jobs/overview/analysis', { force: true }),
    [post],
  );

  return {
    data,
    error,
    updatedAt,
    loading: !data && !error,
    reload,
    saveMilestone,
    group,
    ungroup,
    analyze,
  };
}
