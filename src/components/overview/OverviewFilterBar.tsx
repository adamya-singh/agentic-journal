'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  relativeTime,
  type Chip as ChipModel,
  type OverviewFilters,
  type Period,
} from '@/lib/job-overview-view';
import { Button, Chip, Field, SegmentedControl, Select, TextInput } from './primitives';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: 'custom', label: 'Custom' },
];

/**
 * The one place filters live. Every number below the bar follows it, except
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
      <Field label={label}>
        <Select value={filters[key]} onChange={(e) => onChange({ [key]: e.target.value })}>
          <option value="">All</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
    ) : null;
  return (
    <div className="z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 md:sticky md:top-0">
      <div className="flex flex-wrap items-end gap-3 px-4 pt-3 sm:px-5">
        <Field label="Submitted">
          <SegmentedControl
            label="Submission period"
            options={PERIODS}
            value={filters.period}
            onChange={(period) =>
              onChange(period === 'custom' ? { period } : { period, start: '', end: '' })
            }
          />
        </Field>
        {filters.period === 'custom' && (
          <>
            <Field label="From">
              <TextInput
                type="date"
                value={filters.start}
                max={filters.end || undefined}
                onChange={(e) => onChange({ start: e.target.value })}
              />
            </Field>
            <Field label="Through">
              <TextInput
                type="date"
                value={filters.end}
                min={filters.start || undefined}
                onChange={(e) => onChange({ end: e.target.value })}
              />
            </Field>
          </>
        )}
        {optional('Resume', 'resume', options.resumes)}
        {optional('Role family', 'family', options.families)}
        {optional('Category', 'category', options.categories)}
        <Field label="Search" className="min-w-40 max-w-xs flex-1">
          <TextInput
            type="search"
            value={filters.search}
            placeholder="Company or role"
            onChange={(e) => onChange({ search: e.target.value })}
          />
        </Field>
        <button
          type="button"
          onClick={onRefresh}
          title="Refreshes on its own every minute; click to refresh now"
          className="ml-auto inline-flex min-h-9 items-center gap-1 self-end rounded px-2 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {updatedAt ? `Updated ${relativeTime(new Date(updatedAt).toISOString(), now)}` : 'Loading…'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-600 dark:text-slate-300 sm:px-5">
        <span className="font-medium tabular-nums">
          {scope.submitted} submitted · {scope.records} records
          {scope.merged > 0 && ` · ${scope.merged} merged`}
        </span>
        {filters.period !== 'all' && (
          <span className="text-slate-400 dark:text-slate-500">
            (period applies to submitted applications)
          </span>
        )}
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
