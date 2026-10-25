'use client';

import React from 'react';
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
import { missionSerif } from '@/components/mission/fonts';
import { MISSION_JOBS_CSS } from '@/components/mission/jobs-css';
import { OVERVIEW_CSS } from '@/components/mission/overview-css';
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
    <div className={`min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 ${missionSerif.variable}`}>
      <AppHeader title="Jobs" subtitle="Employer responses, timing, and evidence" />
      <main className="mx-auto max-w-[1480px] px-3 py-4 sm:px-4 sm:py-6">
        <JobsNavigation />
        <div className="mi ov dark">
          <style>{MISSION_JOBS_CSS + OVERVIEW_CSS}</style>
          <div className="mi-top">
            <h1 className="mi-title" style={{ margin: 0 }}>
              Outcomes <i>overview</i>
            </h1>
            <span className="sub">What employers did with the applications OpenClaw sent</span>
          </div>
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
          <div className="mi-body">
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            {loading && (
              <p role="status" className="empty">
                Loading application data…
              </p>
            )}
            {data && (
              <>
                <section className="glass hero ov-hero" aria-label="Readout">
                  <StatusTiles
                    counts={counts}
                    distribution={distribution}
                    selected={f.filters.outcome}
                    onSelect={(outcome) => f.set({ outcome })}
                    closedBeforeSubmit={view.closedBeforeSubmit}
                    coverage={{ unknownTiming: stats.unknownTiming, reconstructed: stats.reconstructed }}
                  />
                  <AttentionStrip items={attention} rowsById={rowsById} onOpen={open} onAnalyze={analyze} />
                </section>
                <ActivityChart
                  series={series}
                  selectedDay={f.filters.day}
                  onSelectDay={(day) => f.set({ day: f.filters.day === day ? '' : day })}
                />
                <div className="ov-grid3">
                  <ResponseTimes rows={timingRows(stats.times)} />
                  <AssessmentsCard rows={view.focus} onOpen={open} />
                  <RejectionReasonsCard rows={view.focus} onOpen={open} />
                </div>
                <div className="ov-grid2">
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
                <HowToRead />
              </>
            )}
          </div>
        </div>
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
