'use client';

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { JobsNavigation } from '@/components/JobsNavigation';
import { ActivityChart } from '@/components/overview/ActivityChart';
import { AiReportCard } from '@/components/overview/AiReportCard';
import { ApplicationDetailModal } from '@/components/overview/ApplicationDetailModal';
import { ApplicationsTable } from '@/components/overview/ApplicationsTable';
import { AssessmentsCard } from '@/components/overview/AssessmentsCard';
import { AttentionStrip } from '@/components/overview/AttentionStrip';
import { ComparisonsCard } from '@/components/overview/ComparisonsCard';
import { HowToRead } from '@/components/overview/HowToRead';
import { OverviewFilterBar } from '@/components/overview/OverviewFilterBar';
import { RejectionReasonsCard } from '@/components/overview/RejectionReasonsCard';
import { ResponseTimes } from '@/components/overview/ResponseTimes';
import { StatusTiles } from '@/components/overview/StatusTiles';
import { Band, Card, CardHeader } from '@/components/overview/primitives';
import { observedPatterns, summarize, type OverviewRow } from '@/lib/job-overview';
import {
  activeChips,
  activitySeries,
  attentionItems,
  chipPatch,
  comparisonCards,
  comparisonEmptyState,
  deriveView,
  periodBounds,
  sortRows,
  stageDistribution,
  tileCounts,
  timingRows,
} from '@/lib/job-overview-view';
import { useOverviewData } from '@/lib/useOverviewData';
import { useOverviewFilters } from '@/lib/useOverviewFilters';

const PAGE_SIZE = 50;
const EMPTY_ROWS: OverviewRow[] = [];
const EMPTY_GROUPS: { id: string; listingIds: string[] }[] = [];
const unique = (values: string[]) => [...new Set(values)].sort();

export default function JobsOverview() {
  const { data, error, updatedAt, loading, reload, saveMilestone, group, ungroup, analyze } =
    useOverviewData();
  const f = useOverviewFilters();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  React.useEffect(() => setLimit(PAGE_SIZE), [f.filters, f.cited, f.sort]);

  const rows = data?.rows ?? EMPTY_ROWS;
  const groups = data?.groups ?? EMPTY_GROUPS;
  const view = React.useMemo(
    () => deriveView(rows, groups, f.filters, f.cited, now),
    [rows, groups, f.filters, f.cited, now],
  );
  const stats = React.useMemo(
    () => summarize(view.cohort, f.windowDays, now),
    [view.cohort, f.windowDays, now],
  );
  const patterns = React.useMemo(() => observedPatterns(stats), [stats]);
  const cards = React.useMemo(() => comparisonCards(stats, patterns), [stats, patterns]);
  const counts = React.useMemo(() => tileCounts(view.cohort, stats), [view.cohort, stats]);
  const distribution = React.useMemo(() => stageDistribution(view.cohort), [view.cohort]);
  const series = React.useMemo(() => {
    const { from, to } = periodBounds(f.filters, now);
    return activitySeries(view.focus, from, to, now);
  }, [view.focus, f.filters, now]);
  const rowsById = React.useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const attention = React.useMemo(() => (data ? attentionItems(data, now) : []), [data, now]);
  const sorted = React.useMemo(() => sortRows(view.table, f.sort), [view.table, f.sort]);
  const options = React.useMemo(
    () => ({
      resumes: unique(rows.map((r) => r.resume)),
      families: unique(rows.map((r) => r.family)),
      categories: unique(rows.flatMap((r) => r.categories)),
    }),
    [rows],
  );
  const chips = activeChips(f.filters, f.cited);
  const active = f.selectedId ? rowsById.get(f.selectedId) : undefined;
  const open = React.useCallback(
    (id: string, kind?: Parameters<typeof f.select>[1]) => f.select(id, kind),
    [f],
  );
  const close = React.useCallback(() => f.select(null), [f]);
  const cite = React.useCallback(
    (label: string, ids: string[]) => {
      f.setCited({ label, ids });
      document.getElementById('applications')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [f],
  );

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader title="Jobs" subtitle="Employer responses, timing, and evidence" />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
        <JobsNavigation />
        <Card>
          <CardHeader
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            title="Outcomes"
            subtitle="What employers did with the applications OpenClaw sent"
            className="border-b-0"
          />
          <OverviewFilterBar
            filters={f.filters}
            onChange={f.set}
            onClear={f.clear}
            options={options}
            scope={{ submitted: view.cohort.length, records: view.records.length, merged: view.merged }}
            chips={chips}
            onRemoveChip={(key) => (key === 'cited' ? f.setCited(null) : f.set(chipPatch(key)))}
            updatedAt={updatedAt}
            onRefresh={() => void reload()}
            now={now}
          />
          {error && (
            <Band tone="red" className="px-4 py-3 text-sm text-red-700 dark:text-red-300 sm:px-5" role="alert">
              {error}
            </Band>
          )}
          {loading && (
            <p role="status" className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading application data…
            </p>
          )}
          {data && (
            <>
              <AttentionStrip items={attention} onOpen={open} onAnalyze={analyze} />
              <StatusTiles
                counts={counts}
                distribution={distribution}
                selected={f.filters.outcome}
                onSelect={(outcome) => f.set({ outcome })}
                closedBeforeSubmit={view.closedBeforeSubmit}
                coverage={{ unknownTiming: stats.unknownTiming, reconstructed: stats.reconstructed }}
              />
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <ActivityChart
                  series={series}
                  selectedDay={f.filters.day}
                  onSelectDay={(day) => f.set({ day: f.filters.day === day ? '' : day })}
                />
                <ResponseTimes rows={timingRows(stats.times)} />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-2">
                <AssessmentsCard rows={view.focus} onOpen={open} />
                <RejectionReasonsCard rows={view.focus} onOpen={open} />
                <ComparisonsCard
                  cards={cards}
                  windowDays={f.windowDays}
                  onWindowChange={f.setWindowDays}
                  eligible={stats.eligible}
                  emptyState={comparisonEmptyState(stats)}
                  onCite={cite}
                />
                <AiReportCard
                  analysis={data.analysis}
                  rowsById={rowsById}
                  onOpen={open}
                  onCite={cite}
                  onAnalyze={analyze}
                  now={now}
                />
              </div>
              <div id="applications" className="scroll-mt-24">
                <ApplicationsTable
                  rows={sorted}
                  status={f.filters.status}
                  onStatus={(status) => f.set({ status })}
                  sort={f.sort}
                  onSort={f.setSort}
                  limit={limit}
                  onMore={() => setLimit((l) => l + PAGE_SIZE)}
                  onOpen={open}
                  now={now}
                  duplicates={{
                    candidates: data.duplicateCandidates,
                    groups,
                    rowsById,
                    merge: f.filters.merge,
                    onMerge: (merge) => f.set({ merge }),
                    onGroup: group,
                    onUngroup: ungroup,
                  }}
                />
              </div>
              <div className="border-t border-slate-200 dark:border-slate-700">
                <HowToRead />
              </div>
            </>
          )}
        </Card>
      </main>
      {active && (
        <ApplicationDetailModal
          key={active.id}
          row={active}
          initialMilestoneKind={f.initialMilestoneKind}
          onClose={close}
          onSaveMilestone={saveMilestone}
          now={now}
        />
      )}
    </div>
  );
}
