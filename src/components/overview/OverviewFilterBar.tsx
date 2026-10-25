'use client';

import React from 'react';
import { RefreshCw, Search } from 'lucide-react';
import {
  relativeTime,
  type Chip as ChipModel,
  type OverviewFilters,
  type Period,
} from '@/lib/job-overview-view';
import { Button, Chip, SegmentedControl } from './primitives';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The one place filters live, as the strip under the HUD title (sticky on wide
 * screens). Every number below the bar follows it, except
 * the AI report, which says so on its own card.
 */
export function OverviewFilterBar({
  filters,
  onChange,
  onClear,
  options,
  scope,
  chips,
  onRemoveChip,
  updatedAt,
  onRefresh,
  now,
}: {
  filters: OverviewFilters;
  onChange: (patch: Partial<OverviewFilters>) => void;
  onClear: () => void;
  options: { resumes: string[]; families: string[]; categories: string[] };
  scope: { submitted: number; records: number; merged: number };
  chips: ChipModel[];
  onRemoveChip: (key: ChipModel['key']) => void;
  updatedAt: number | null;
  onRefresh: () => void;
  now: number;
}) {
  const optional = (label: string, key: 'resume' | 'family' | 'category', values: string[]) =>
    values.length > 1 ? (
      <label className="ov-pf">
        {label}
        <select value={filters[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
          <option value="">All</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return (
    <div className="ov-filters">
      <div className="ov-frow">
        <SegmentedControl
          label="Submission period"
          size="sm"
          options={PERIODS}
          value={filters.period}
          onChange={(period) =>
            onChange(period === 'custom' ? { period } : { period, start: '', end: '' })
          }
        />
        {filters.period === 'custom' && (
          <>
            <label className="ov-pf">
              From
              <input
                type="date"
                value={filters.start}
                max={filters.end || undefined}
                onChange={(e) => onChange({ start: e.target.value })}
              />
            </label>
            <label className="ov-pf">
              Through
              <input
                type="date"
                value={filters.end}
                min={filters.start || undefined}
                onChange={(e) => onChange({ end: e.target.value })}
              />
            </label>
          </>
        )}
        {optional('Resume', 'resume', options.resumes)}
        {optional('Family', 'family', options.families)}
        {optional('Category', 'category', options.categories)}
        <label className="ov-pf ov-q">
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={filters.search}
            placeholder="Company or role"
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={onRefresh}
          title="Refreshes on its own every minute; click to refresh now"
          className="ov-refresh ml-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString(), now)}` : 'Loading…'}
        </button>
      </div>
      <div className="ov-frow">
        <span className="ov-scope">
          <b>{scope.submitted}</b> submitted · <b>{scope.records}</b> records
          {scope.merged > 0 && ` · ${scope.merged} merged`}
          {filters.period !== 'all' && ' · the period applies to submitted applications'}
        </span>
        {chips.map((chip) => (
          <Chip key={chip.key} onRemove={() => onRemoveChip(chip.key)}>
            {chip.label}
          </Chip>
        ))}
        {chips.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            Clear all
          </Button>
        )}
      </div>
    </div>
  );
}
