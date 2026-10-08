'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Info, Loader2, MinusSquare, PlusSquare, RefreshCw } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import type { BarLevel, ComponentStatus, DayBar } from '@/lib/uptime/history';
import type { UptimeComponentView, UptimeGroupView, UptimeView } from '@/lib/uptime/monitor';

const REFRESH_MS = 60_000;
/** Rows are ranked by use, so show them; the long automation list starts folded. */
const DEFAULT_EXPANDED = (groupId: string) => groupId !== 'automations';
/** Phones show the last 30 days so each bar stays tappable, like Statuspage does. */
const MOBILE_DAYS = 30;

const BAR_COLORS: Record<BarLevel, string> = {
  none: 'bg-[#b3bac5] dark:bg-gray-700',
  ok: 'bg-[#2fcc66]',
  minor: 'bg-[#bfc72f]',
  partial: 'bg-[#e67e22]',
  major: 'bg-[#e74c3c]',
};

const STATUS_TEXT: Record<ComponentStatus, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'text-[#2fcc66]' },
  degraded: { label: 'Degraded Performance', className: 'text-[#d4ac0d]' },
  partial: { label: 'Partial Outage', className: 'text-[#e67e22]' },
  major: { label: 'Major Outage', className: 'text-[#e74c3c]' },
  paused: { label: 'Paused', className: 'text-[#3498db]' },
  unknown: { label: 'No Data', className: 'text-gray-400' },
};

const BANNER: Record<ComponentStatus, { label: string; className: string }> = {
  operational: { label: 'All Systems Operational', className: 'bg-[#2fcc66] border-[#28b85b]' },
  degraded: { label: 'Degraded Performance', className: 'bg-[#f1c40f] border-[#d4ac0d]' },
  partial: { label: 'Partial System Outage', className: 'bg-[#e67e22] border-[#cf6d17]' },
  major: { label: 'Major System Outage', className: 'bg-[#e74c3c] border-[#cf3f30]' },
  paused: { label: 'All Systems Operational', className: 'bg-[#2fcc66] border-[#28b85b]' },
  unknown: { label: 'Checking Systems…', className: 'bg-gray-400 border-gray-500' },
};

function formatUptime(uptime: number | null): string {
  if (uptime === null) return 'No data';
  const percent = uptime * 100;
  const text = percent === 100 ? '100.0' : (Math.floor(percent * 100) / 100).toFixed(2);
  return `${text} % uptime`;
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatAgo(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
}

function UptimeBars({ bars, label }: { bars: DayBar[]; label: string }) {
  const total = bars.length;
  return (
    <div className="flex h-[34px] gap-[2px] sm:gap-[3px]" role="img" aria-label={`${label}: daily uptime for the past ${total} days`}>
      {bars.map((bar, index) => {
        const align = index < total * 0.2 ? 'left-0' : index > total * 0.8 ? 'right-0' : 'left-1/2 -translate-x-1/2';
        return (
          <div
            key={bar.date}
            tabIndex={0}
            className={`group/bar relative flex-1 rounded-[1px] outline-none ${BAR_COLORS[bar.level]} hover:opacity-70 focus:opacity-70 ${
              index < total - MOBILE_DAYS ? 'hidden sm:block' : ''
            }`}
          >
            <div
              className={`pointer-events-none absolute bottom-full z-20 mb-2 hidden w-64 rounded-md border border-gray-200 bg-white p-3 text-left shadow-lg group-hover/bar:block group-focus/bar:block dark:border-gray-700 dark:bg-gray-900 ${align}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatDay(bar.date)}</p>
                {bar.uptime !== null && (
                  <p className="text-xs text-gray-500">{(bar.uptime * 100).toFixed(2)}%</p>
                )}
              </div>
              {bar.summary && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{bar.summary}</p>}
              {bar.notes.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">
                  {bar.notes.map((note) => (
                    <li key={note} className="text-xs text-gray-600 dark:text-gray-400">
                      {note}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UptimeFooter({ uptime, days }: { uptime: number | null; days: number }) {
  return (
    <div className="mt-2 flex items-center gap-4 text-sm text-gray-400 dark:text-gray-500">
      <span className="shrink-0">
        <span className="sm:hidden">{MOBILE_DAYS} days ago</span>
        <span className="hidden sm:inline">{days} days ago</span>
      </span>
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      <span className="shrink-0 text-gray-500 dark:text-gray-400">{formatUptime(uptime)}</span>
      <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      <span className="shrink-0">Today</span>
    </div>
  );
}

function StatusLabel({ status }: { status: ComponentStatus }) {
  const text = STATUS_TEXT[status];
  return <span className={`shrink-0 text-sm sm:text-base ${text.className}`}>{text.label}</span>;
}

function ComponentRow({ component, days }: { component: UptimeComponentView; days: number }) {
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-gray-800 dark:text-gray-200">{component.name}</span>
          <span className="group/info relative">
            <Info className="h-3.5 w-3.5 text-gray-400" aria-hidden />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1.5 text-xs text-white shadow group-hover/info:block">
              {component.description}
            </span>
          </span>
        </div>
        <StatusLabel status={component.status} />
      </div>
      <p className="-mt-1 mb-2 truncate text-xs text-gray-400 dark:text-gray-500">{component.detail}</p>
      <UptimeBars bars={component.bars} label={component.name} />
      <UptimeFooter uptime={component.uptime} days={days} />
    </div>
  );
}

function GroupRow({
  group,
  days,
  expanded,
  onToggle,
}: {
  group: UptimeGroupView;
  days: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Toggle = expanded ? MinusSquare : PlusSquare;
  return (
    <section className="border-b border-gray-200 px-4 py-6 last:border-b-0 sm:px-8 dark:border-gray-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        >
          <Toggle className="h-4 w-4 shrink-0 text-gray-400" strokeWidth={1.5} aria-hidden />
          <span className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{group.name}</span>
          <span className="text-sm text-gray-400">{group.components.length}</span>
        </button>
        <StatusLabel status={group.status} />
      </div>
      {expanded ? (
        <div className="ml-1.5 divide-y divide-gray-100 border-l border-gray-200 pl-4 sm:pl-6 dark:divide-gray-800 dark:border-gray-800">
          {group.components.map((component) => (
            <ComponentRow key={component.id} component={component} days={days} />
          ))}
        </div>
      ) : (
        <>
          <UptimeBars bars={group.bars} label={group.name} />
          <UptimeFooter uptime={group.uptime} days={days} />
        </>
      )}
    </section>
  );
}

export default function UptimePage() {
  const [view, setView] = useState<UptimeView>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/uptime', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Uptime could not be loaded.');
      setView(payload.data);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Uptime could not be loaded.');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const issues = view?.groups.flatMap((group) =>
    group.components.filter((c) => c.status !== 'operational' && c.status !== 'paused' && c.status !== 'unknown'),
  ) ?? [];
  const banner = BANNER[view?.overall ?? 'unknown'];

  return (
    <div className="min-h-screen bg-[#f7f8f9] dark:bg-gray-950">
      <AppHeader title="Status" subtitle="Uptime for everything that runs the journal" />
      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:pt-12">
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-5 py-5 text-white shadow-sm sm:px-8 sm:py-6 ${banner.className}`}
        >
          <h2 className="text-xl font-semibold sm:text-2xl">{view ? banner.label : 'Checking Systems…'}</h2>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm text-white/90 hover:bg-white/15 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Checked {formatAgo(view?.checkedAt ?? null, now)}
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}

        {issues.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <h3 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 sm:px-8 dark:border-gray-800 dark:text-gray-300">
              Current issues
            </h3>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {issues.map((component) => (
                <li key={component.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3 sm:px-8">
                  <span className="text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{component.name}</span>
                    <span className="text-gray-500 dark:text-gray-400"> — {component.detail}</span>
                  </span>
                  <StatusLabel status={component.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mb-2 mt-10 text-right text-sm text-gray-500 sm:mt-14 dark:text-gray-400">
          Uptime over the past <span className="sm:hidden">{MOBILE_DAYS}</span>
          <span className="hidden sm:inline">{view?.windowDays ?? 90}</span> days.
        </p>
        <div className="overflow-visible rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {!view && !error && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Running checks…
            </div>
          )}
          {view?.groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              days={view.windowDays}
              expanded={expanded[group.id] ?? DEFAULT_EXPANDED(group.id)}
              onToggle={() =>
                setExpanded((current) => ({ ...current, [group.id]: !(current[group.id] ?? DEFAULT_EXPANDED(group.id)) }))
              }
            />
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Checked every 5 minutes. Services use systemd history; automations use their OpenClaw run log.
        </p>
      </main>
    </div>
  );
}
