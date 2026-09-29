'use client';

import React from 'react';
import type { Milestone } from './job-overview';
import {
  DEFAULT_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  type Cited,
  type OverviewFilters,
  type SortKey,
} from './job-overview-view';

const WINDOWS = [7, 14, 30] as const;
export type WindowDays = (typeof WINDOWS)[number];
const SORTS: SortKey[] = ['submitted', 'company', 'activity'];

/**
 * Filter, sort, and selection state for the overview, mirrored into the URL
 * with `history.replaceState` so a view can be reloaded or shared. Reads the
 * URL once after mount (this is a client page; the server render has no
 * `window`) and only starts writing after that read has been applied.
 */
export function useOverviewFilters() {
  const [filters, setFilters] = React.useState<OverviewFilters>(DEFAULT_FILTERS);
  const [cited, setCited] = React.useState<Cited>(null);
  const [windowDays, setWindowDays] = React.useState<WindowDays>(14);
  const [sort, setSort] = React.useState<SortKey>('submitted');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [initialMilestoneKind, setInitialMilestoneKind] = React.useState<
    Milestone['kind'] | undefined
  >(undefined);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters(filtersFromQuery(params));
    const w = Number(params.get('w'));
    if (WINDOWS.includes(w as WindowDays)) setWindowDays(w as WindowDays);
    const s = params.get('sort');
    if (s && SORTS.includes(s as SortKey)) setSort(s as SortKey);
    const application = params.get('application');
    if (application) setSelectedId(application);
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const query = filtersToQuery(filters, {
        w: windowDays === 14 ? '' : String(windowDays),
        sort: sort === 'submitted' ? '' : sort,
        application: selectedId ?? '',
      });
      const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== current) window.history.replaceState(window.history.state, '', next);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, filters, windowDays, sort, selectedId]);

  const set = React.useCallback((patch: Partial<OverviewFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);
  const clear = React.useCallback(() => {
    setFilters((current) => ({ ...DEFAULT_FILTERS, status: current.status, merge: current.merge }));
    setCited(null);
  }, []);
  const select = React.useCallback((id: string | null, kind?: Milestone['kind']) => {
    setSelectedId(id);
    setInitialMilestoneKind(id ? kind : undefined);
  }, []);

  return {
    filters,
    set,
    clear,
    cited,
    setCited,
    windowDays,
    setWindowDays,
    sort,
    setSort,
    selectedId,
    initialMilestoneKind,
    select,
  };
}
