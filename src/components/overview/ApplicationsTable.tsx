'use client';

import React from 'react';
import { ChevronDown, Copy } from 'lucide-react';
import { EmployerStageBadge } from '@/components/EmployerStageBadge';
import { elapsed, type Overview, type OverviewRow } from '@/lib/job-overview';
import {
  AUTOMATION_LABELS,
  MILESTONE_LABELS,
  SORT_LABELS,
  ageDays,
  currentStage,
  formatEastern,
  lastActivityAt,
  relativeTime,
  type SortKey,
  type TableStatus,
} from '@/lib/job-overview-view';
import { Band, Button, LinkButton, Pill, SegmentedControl, Select } from './primitives';

const STATUS_OPTIONS: { value: TableStatus; label: string }[] = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'all', label: 'All' },
  { value: 'unsubmitted', label: 'Not submitted' },
  { value: 'closed', label: 'Closed' },
];
const RECORD_STATUS: Record<OverviewRow['status'], string> = {
  unstarted: 'Unstarted',
  'in-progress': 'In progress',
  'awaiting-user-input': 'Needs input',
  submitted: 'Submitted',
  closed: 'Closed',
};
const TH =
  'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:px-5';
const TD = 'px-4 py-3 align-top text-sm text-slate-700 dark:text-slate-200 sm:px-5';

function StageCell({ row, now }: { row: OverviewRow; now: number }) {
  if (!row.submitted) return <Pill>{RECORD_STATUS[row.status]}</Pill>;
  const stage = currentStage(row);
  const age = ageDays(row.submittedAt, now);
  if (stage === 'withdrawn') return <Pill>Withdrawn</Pill>;
  if (stage === 'none')
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">
        No reply{age !== null && ` · ${age} d`}
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <EmployerStageBadge stage={stage} />
      {stage === 'received' && age !== null && (
        <span className="text-xs text-slate-500 dark:text-slate-400">no decision · {age} d</span>
      )}
    </span>
  );
}
function submittedLabel(row: OverviewRow) {
  if (row.submitted) return formatEastern(row.submittedAt);
  return row.status === 'closed' ? 'Closed before submission' : 'Not submitted';
}

export function ApplicationsTable({
  rows,
  status,
  onStatus,
  sort,
  onSort,
  limit,
  onMore,
  onOpen,
  now,
  duplicates,
}: {
  rows: OverviewRow[];
  status: TableStatus;
  onStatus: (status: TableStatus) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  limit: number;
  onMore: () => void;
  onOpen: (id: string) => void;
  now: number;
  duplicates: {
    candidates: string[][];
    groups: Overview['groups'];
    rowsById: Map<string, OverviewRow>;
    merge: boolean;
    onMerge: (merge: boolean) => void;
    onGroup: (ids: string[]) => Promise<void>;
    onUngroup: (id: string) => Promise<void>;
  };
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const visible = rows.slice(0, limit);
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The update failed');
    } finally {
      setBusy(null);
    }
  };
  const name = (id: string) => duplicates.rowsById.get(id);
  const grouped = (ids: string[]) =>
    duplicates.groups.some((g) => g.listingIds.some((id) => ids.includes(id)));
  const openCandidates = duplicates.candidates.filter((ids) => !grouped(ids));
  return (
    <section aria-label="Applications">
      <div className="flex flex-col gap-3 border-b border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Applications <span className="font-normal text-slate-500 dark:text-slate-400">· {rows.length}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl label="Record status" size="sm" options={STATUS_OPTIONS} value={status} onChange={onStatus} />
          <Select
            aria-label="Sort"
            value={sort}
            onChange={(e) => onSort(e.target.value as SortKey)}
            className="min-h-8 py-0.5 text-xs"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {(openCandidates.length > 0 || duplicates.groups.length > 0) && (
        <Band tone="sky" className="px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Copy className="h-4 w-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-200">
              {openCandidates.length > 0
                ? `${openCandidates.length} possible duplicate opportunit${openCandidates.length === 1 ? 'y' : 'ies'}`
                : 'Confirmed duplicate opportunities'}
            </h3>
            <span className="text-xs text-sky-800/70 dark:text-sky-300/70">
              — same application URL; confirming counts them once
            </span>
            {duplicates.groups.length > 0 && (
              <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-sky-900 dark:text-sky-200">
                <input
                  type="checkbox"
                  checked={duplicates.merge}
                  onChange={(e) => duplicates.onMerge(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Merge confirmed groups into one row
              </label>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {openCandidates.map((ids) => (
              <li
                key={ids.join('+')}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm dark:border-sky-900 dark:bg-slate-900"
              >
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {name(ids[0])?.company ?? 'Unknown company'}
                </span>
                {ids.map((id) => (
                  <LinkButton key={id} onClick={() => onOpen(id)} className="text-xs">
                    {name(id)?.role ?? id} · {formatEastern(name(id)?.submittedAt, 'date')}
                  </LinkButton>
                ))}
                <Button
                  variant="sky"
                  className="ml-auto"
                  disabled={busy !== null}
                  onClick={() => void run(ids.join('+'), () => duplicates.onGroup(ids))}
                >
                  {busy === ids.join('+') ? 'Saving…' : 'Same opportunity'}
                </Button>
              </li>
            ))}
            {duplicates.groups.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-slate-200"
              >
                <span className="font-medium">Confirmed:</span>
                <span>
                  {g.listingIds
                    .map((id) => `${name(id)?.company ?? '?'} · ${name(id)?.role ?? id}`)
                    .join('  /  ')}
                </span>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void run(g.id, () => duplicates.onUngroup(g.id))}
                >
                  {busy === g.id ? 'Undoing…' : 'Undo'}
                </Button>
              </li>
            ))}
          </ul>
        </Band>
      )}
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400 sm:px-5">
          No applications match these filters.
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="min-w-full">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr>
                  {['Application', 'Submitted', 'Resume', 'Stage', 'Last activity', 'Assessment timing', 'Milestones'].map(
                    (h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {visible.map((row) => {
                  const last = lastActivityAt(row);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => onOpen(row.id)}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className={`${TD} max-w-xs`}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(row.id);
                          }}
                          className="block text-left"
                        >
                          <span className="block break-words font-semibold text-slate-900 dark:text-slate-100">
                            {row.company}
                          </span>
                          <span className="mt-0.5 block break-words text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {row.role}
                          </span>
                        </button>
                      </td>
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>{submittedLabel(row)}</td>
                      <td className={TD}>
                        {row.resume}
                        {row.submitted && row.reconstructed && (
                          <span className="block text-xs text-slate-400 dark:text-slate-500">
                            reconstructed
                          </span>
                        )}
                      </td>
                      <td className={TD}>
                        <StageCell row={row} now={now} />
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs text-slate-500 dark:text-slate-400`}>
                        {last ? (
                          <time dateTime={last} title={formatEastern(last)}>
                            {relativeTime(last, now)}
                          </time>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs`}>
                        {row.first.assessment ? (
                          <span title={AUTOMATION_LABELS[row.automation]}>
                            {elapsed(row.assessmentMs)}
                            <span className="block text-slate-400 dark:text-slate-500">
                              {AUTOMATION_LABELS[row.automation]}
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600">—</span>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="flex flex-wrap gap-1">
                          {row.milestones.length === 0 ? (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          ) : (
                            row.milestones.map((m) => (
                              <Pill key={m.id} tone="violet" title={formatEastern(m.occurredAt)}>
                                {MILESTONE_LABELS[m.kind]}
                              </Pill>
                            ))
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 sm:hidden">
            {visible.map((row) => {
              const last = lastActivityAt(row);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="block w-full space-y-2 px-4 py-3 text-left"
                  >
                    <span className="block">
                      <span className="block break-words text-base font-semibold text-slate-900 dark:text-slate-100">
                        {row.company}
                      </span>
                      <span className="mt-0.5 block break-words text-sm text-slate-700 dark:text-slate-200">
                        {row.role}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <StageCell row={row} now={now} />
                      <span className="tabular-nums">{submittedLabel(row)}</span>
                      <span>· {row.resume}</span>
                      {last && <span>· active {relativeTime(last, now)}</span>}
                    </span>
                    {row.milestones.length > 0 && (
                      <span className="flex flex-wrap gap-1">
                        {row.milestones.map((m) => (
                          <Pill key={m.id} tone="violet">
                            {MILESTONE_LABELS[m.kind]}
                          </Pill>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {rows.length > visible.length && (
            <button
              type="button"
              onClick={onMore}
              className="flex w-full items-center justify-center gap-1 border-t border-slate-200 px-4 py-3 text-xs font-medium text-indigo-600 hover:bg-slate-50 dark:border-slate-700 dark:text-indigo-300 dark:hover:bg-slate-800/40"
            >
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              Show {Math.min(50, rows.length - visible.length)} more of {rows.length - visible.length} remaining
            </button>
          )}
        </>
      )}
    </section>
  );
}
