'use client';

import React from 'react';
import { Radar } from 'lucide-react';
import type { WideNetState } from '@/lib/job-wide-net';

type WideNetView = WideNetState & { waiting: number; queueTarget: number };

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** The wide net's finder: when it last looked, what it saved, and the switch that stops it. */
export function WideNetPanel({ onListingsChanged, onError }: { onListingsChanged?: () => void; onError: (message: string | null) => void }) {
  const [view, setView] = React.useState<WideNetView | null>(null);
  const [busy, setBusy] = React.useState<'run' | 'toggle' | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await (await fetch('/api/jobs/wide-net', { cache: 'no-store' })).json();
      if (data.success) setView(data.wideNet);
    } catch {
      // The strip stays on "Checking…"; the board itself still works.
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const post = async (body: { action: 'run' } | { action: 'set-enabled'; enabled: boolean }) => {
    setBusy(body.action === 'run' ? 'run' : 'toggle');
    onError(null);
    try {
      const response = await fetch('/api/jobs/wide-net', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'The wide net did not respond');
      setView(data.wideNet);
      if (body.action === 'run') onListingsChanged?.();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The wide net did not respond');
    } finally {
      setBusy(null);
    }
  };

  const run = view?.lastRun;
  const full = view ? view.waiting >= view.queueTarget : false;
  let status = 'Checking…';
  if (view) {
    if (!run) status = view.enabled ? 'Has not looked yet. The first check runs a few minutes after the Journal starts.' : 'Has not looked yet.';
    else if (run.error) status = `Last check ${ago(run.at, Date.now())} failed: ${run.error}`;
    else if (run.added > 0) status = `Saved ${run.added} new posting${run.added === 1 ? '' : 's'} ${ago(run.at, Date.now())}.`;
    else if (full) status = `Checked ${ago(run.at, Date.now())}. The queue is full, so nothing was added.`;
    else status = `Checked ${ago(run.at, Date.now())}. Nothing new in the feed.`;
  }

  return (
    <div className="applyto" role="group" aria-label="Wide net finder">
      <span className="lab" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <Radar className="i s" aria-hidden="true" /> Finder
      </span>
      <button
        type="button"
        className="chip"
        aria-pressed={view?.enabled ?? false}
        disabled={!view || busy !== null}
        onClick={() => view && post({ action: 'set-enabled', enabled: !view.enabled })}
      >
        <span className="dot" aria-hidden="true" />
        {view?.enabled ? 'Finding postings' : 'Finder off'}
      </button>
      <button type="button" className="btn sm" disabled={!view || busy !== null} onClick={() => post({ action: 'run' })}>
        {busy === 'run' ? 'Looking…' : 'Find more now'}
      </button>
      <span className="hint" style={{ fontSize: 12.5 }}>{status}</span>
      {view && (
        <span className="hint" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {view.waiting} of {view.queueTarget} waiting for the worker
        </span>
      )}
      <p className="hint" style={{ flexBasis: '100%', margin: 0, fontSize: 12.5 }}>
        Every new-grad software and ML posting in the SimplifyJobs feed from the last two weeks, in the US, not judged
        for fit. The worker applies to North Star postings first and to these when it has nothing else to do.
      </p>
    </div>
  );
}
