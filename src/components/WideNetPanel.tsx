'use client';

import React from 'react';
import { Radar } from 'lucide-react';
import type { WideNetRun, WideNetTurnedDown } from '@/lib/job-wide-net';

interface WideNetView {
  enabled: boolean;
  lastRun?: WideNetRun;
  /** A check is under way: the feed is being read or OpenClaw is judging. */
  running: boolean;
  /** Postings searches handed in that are waiting to be judged. */
  offeredCount: number;
  turnedDownCount: number;
  turnedDown: (WideNetTurnedDown & { key: string })[];
  waiting: number;
  queueTarget: number;
}

const RUNNING_POLL_MS = 5000;

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

/** The wide net's finder: when it last looked, what it saved and turned down, and the switch that stops it. */
export function WideNetPanel({ onListingsChanged, onError }: { onListingsChanged?: () => void; onError: (message: string | null) => void }) {
  const [view, setView] = React.useState<WideNetView | null>(null);
  const [busy, setBusy] = React.useState<'run' | 'toggle' | 'add' | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await (await fetch('/api/jobs/wide-net', { cache: 'no-store' })).json();
      if (data.success) setView(data.wideNet);
    } catch {
      // The strip stays on "Checking…"; the board itself still works.
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  // OpenClaw judges for a few minutes. Ask again until the check is over, then show what it saved.
  const running = view?.running ?? false;
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) onListingsChanged?.();
    wasRunning.current = running;
    if (!running) return;
    const timer = setInterval(() => { void load(); }, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [running, load, onListingsChanged]);

  const post = async (body: { action: 'run' } | { action: 'set-enabled'; enabled: boolean } | { action: 'add'; key: string }) => {
    setBusy(body.action === 'set-enabled' ? 'toggle' : body.action);
    onError(null);
    try {
      const response = await fetch('/api/jobs/wide-net', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'The wide net did not respond');
      setView(data.wideNet);
      if (body.action === 'add') onListingsChanged?.();
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
    const declined = run?.turnedDown ? `, turned down ${run.turnedDown}` : '';
    if (view.running) status = 'Looking: OpenClaw is reading the new postings. This takes a few minutes.';
    else if (!run) status = view.enabled ? 'Has not looked yet. The first check runs a few minutes after the Journal starts.' : 'Has not looked yet.';
    else if (run.error) status = `Last check ${ago(run.at, Date.now())} failed: ${run.error}`;
    else if (run.added > 0 || run.addedToFocus) {
      const toFocus = run.addedToFocus ? `${run.added > 0 ? ' and ' : ''}${run.addedToFocus} to North Star` : '';
      const toWide = run.added > 0 ? `${run.added} new posting${run.added === 1 ? '' : 's'}` : '';
      status = `Saved ${toWide}${toFocus}${declined} ${ago(run.at, Date.now())}.`;
    }
    else if (run.turnedDown) status = `Checked ${ago(run.at, Date.now())}. Turned down ${run.turnedDown}, saved none.`;
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
      <button type="button" className="btn sm" disabled={!view || busy !== null || view.running} onClick={() => post({ action: 'run' })}>
        {busy === 'run' || view?.running ? 'Looking…' : 'Find more now'}
      </button>
      <span className="hint" style={{ fontSize: 12.5 }}>{status}</span>
      {view && (
        <span className="hint" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {view.offeredCount > 0 ? `${view.offeredCount} waiting to be judged · ` : ''}
          {view.waiting} of {view.queueTarget} waiting for the worker
        </span>
      )}
      <p className="hint" style={{ flexBasis: '100%', margin: 0, fontSize: 12.5 }}>
        Every new-grad software and ML posting the searches find (the SimplifyJobs feed, and what the daily search
        turns up on Jobright, SpeedyApply and company boards) is judged by OpenClaw for both searches. The wide net
        keeps real software engineering at a credible tech company, in New York or the Bay Area, or anywhere for a
        very good company. The worker applies to North Star postings first and to these when it has nothing else to do.
      </p>
      {view && view.turnedDownCount > 0 && (
        <details style={{ flexBasis: '100%', fontSize: 12.5 }}>
          <summary className="hint" style={{ cursor: 'pointer' }}>
            Turned down ({view.turnedDownCount})
          </summary>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 8 }}>
            {view.turnedDown.map((entry) => (
              <li key={entry.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <a href={entry.link} target="_blank" rel="noreferrer">
                    {entry.company}: {entry.title}
                  </a>
                  <span className="hint"> · {entry.location}{entry.source ? ` · ${entry.source}` : ''}</span>
                  <br />
                  <span className="hint">
                    {entry.reason}
                    {entry.read ? '' : ' (Judged without reading the posting.)'}
                  </span>
                </span>
                <button type="button" className="btn sm" disabled={busy !== null} onClick={() => post({ action: 'add', key: entry.key })}>
                  Add anyway
                </button>
              </li>
            ))}
          </ul>
          {view.turnedDownCount > view.turnedDown.length && (
            <p className="hint" style={{ margin: '8px 0 0' }}>Showing the latest {view.turnedDown.length}.</p>
          )}
        </details>
      )}
    </div>
  );
}
