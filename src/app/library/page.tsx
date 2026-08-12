'use client';

import React from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CheckCircle2,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { EditTaskModal } from '@/components/EditTaskModal';
import { TaskNotesPreview } from '@/components/TaskNotesPreview';
import { formatProjectTag, normalizeProjectList } from '@/lib/projects';
import { formatDueTimeRangeForDisplay } from '@/lib/due-time';
import { scoreMatch } from '@/lib/search-score';
import { useCurrentDateISO } from '@/lib/current-date';
import { useRefresh } from '@/lib/RefreshContext';
import type { LibraryJournalUnit, LibraryListResponse, LibraryTaskRow } from '@/lib/library/types';
import type { ListType, Task } from '@/lib/types';

const HOUR_ORDER = [
  '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm',
  '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am',
];

const PAGE_SIZE = 50;
const SHOW_MORE = 150;

type TaskStatusFilter = 'open' | 'current' | 'completed' | 'misc';
type JournalStatusFilter = 'planned' | 'logged' | 'missed' | 'completed';
type TypeFilter = 'all' | 'tasks' | 'journal';

function currentHourLabel(): string {
  const hours = new Date().getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  return `${hours % 12 || 12}${ampm}`;
}

function journalUnitStatus(unit: LibraryJournalUnit): JournalStatusFilter {
  if (unit.completed || unit.planStatus === 'completed') return 'completed';
  if (unit.planStatus === 'missed') return 'missed';
  if (unit.entryMode === 'planned') return 'planned';
  return 'logged';
}

function journalTextClass(unit: LibraryJournalUnit): string {
  const status = journalUnitStatus(unit);
  if (status === 'completed') return 'text-green-600 dark:text-green-400 line-through';
  if (status === 'missed') return 'text-amber-700 dark:text-amber-300';
  if (unit.planStatus === 'rescheduled') return 'text-slate-600 dark:text-slate-300';
  if (status === 'planned') return 'text-teal-700 dark:text-teal-300';
  return 'text-gray-700 dark:text-gray-300';
}

function journalSuffix(unit: LibraryJournalUnit): string | null {
  const status = journalUnitStatus(unit);
  if (status === 'completed') return '(done)';
  if (status === 'missed') return '(missed)';
  if (unit.planStatus === 'rescheduled') return '(replanned)';
  return null;
}

function taskRecency(row: LibraryTaskRow): string {
  return row.completedAt ?? row.sourceDate ?? '';
}

function formatDayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.toLocaleDateString('en-US', { weekday: 'short' })} ${date}`;
}

function checkIfTaskLogged(journal: Record<string, unknown> | null | undefined, taskId: string): boolean {
  if (!journal) return false;
  const isLoggedRef = (entry: unknown): boolean =>
    !!entry &&
    typeof entry === 'object' &&
    (entry as { taskId?: unknown }).taskId === taskId &&
    (entry as { entryMode?: unknown }).entryMode === 'logged';
  for (const hour of HOUR_ORDER) {
    const slot = (journal as Record<string, unknown>)[hour];
    if (!slot) continue;
    const entries = Array.isArray(slot) ? slot : [slot];
    if (entries.some(isLoggedRef)) return true;
  }
  const ranges = (journal as { ranges?: unknown }).ranges;
  if (Array.isArray(ranges) && ranges.some(isLoggedRef)) return true;
  return false;
}

export default function LibraryPage() {
  const currentDate = useCurrentDateISO();
  const { taskRefreshCounter, refreshTasks, refreshJournal } = useRefresh();

  const [data, setData] = React.useState<LibraryListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [query, setQuery] = React.useState('');
  const [debouncedQuery, setDebouncedQuery] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>('all');
  const [taskStatuses, setTaskStatuses] = React.useState<Set<TaskStatusFilter>>(new Set());
  const [journalStatuses, setJournalStatuses] = React.useState<Set<JournalStatusFilter>>(new Set());
  const [projectFilter, setProjectFilter] = React.useState<string | null>(null);
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [taskLimit, setTaskLimit] = React.useState(PAGE_SIZE);
  const [journalLimit, setJournalLimit] = React.useState(PAGE_SIZE);
  const [expandedNotes, setExpandedNotes] = React.useState<Set<string>>(new Set());
  const [menuTaskId, setMenuTaskId] = React.useState<string | null>(null);
  const [editRow, setEditRow] = React.useState<LibraryTaskRow | null>(null);
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    try {
      const response = await fetch('/api/library/list');
      const payload = (await response.json()) as LibraryListResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Failed to load library');
      }
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData, taskRefreshCounter]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 100);
    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    setTaskLimit(PAGE_SIZE);
    setJournalLimit(PAGE_SIZE);
  }, [debouncedQuery, typeFilter, taskStatuses, journalStatuses, projectFilter, dateFrom, dateTo]);

  // Close the kebab menu on any outside click.
  React.useEffect(() => {
    if (!menuTaskId) return;
    const close = () => setMenuTaskId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuTaskId]);

  const taskHaystacks = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.tasks ?? []) {
      map.set(
        row.id,
        `${row.text} ${row.notesMarkdown ?? ''} ${(row.projects ?? []).join(' ')}`.toLowerCase(),
      );
    }
    return map;
  }, [data?.tasks]);

  const journalHaystacks = React.useMemo(
    () => (data?.journal ?? []).map((unit) => unit.text.toLowerCase()),
    [data?.journal],
  );

  const filteredTasks = React.useMemo(() => {
    if (!data || typeFilter === 'journal') return [];
    let rows = data.tasks;
    if (taskStatuses.size > 0) {
      rows = rows.filter((row) => {
        if (taskStatuses.has('completed') && row.completed) return true;
        if (taskStatuses.has('misc') && row.source === 'misc') return true;
        if (taskStatuses.has('current') && row.currentRank !== undefined && !row.completed) return true;
        if (taskStatuses.has('open') && row.source === 'general' && !row.completed) return true;
        return false;
      });
    }
    if (projectFilter) {
      rows = rows.filter((row) => normalizeProjectList(row.projects).includes(projectFilter));
    }
    if (dateFrom || dateTo) {
      rows = rows.filter((row) => {
        const day = (row.completedAt ?? '').slice(0, 10) || row.sourceDate || '';
        if (!day) return false;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        return true;
      });
    }
    if (debouncedQuery) {
      return rows
        .map((row) => ({ row, score: scoreMatch(debouncedQuery, taskHaystacks.get(row.id) ?? '') }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => item.row);
    }
    return [...rows].sort((a, b) => {
      const aCurrent = a.currentRank !== undefined && !a.completed;
      const bCurrent = b.currentRank !== undefined && !b.completed;
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      if (aCurrent && bCurrent) return (a.currentRank ?? 0) - (b.currentRank ?? 0);
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return taskRecency(b).localeCompare(taskRecency(a));
    });
  }, [data, typeFilter, taskStatuses, projectFilter, dateFrom, dateTo, debouncedQuery, taskHaystacks]);

  const filteredJournal = React.useMemo(() => {
    if (!data || typeFilter === 'tasks' || projectFilter) return [];
    let indices = data.journal.map((_, index) => index);
    if (journalStatuses.size > 0) {
      indices = indices.filter((i) => journalStatuses.has(journalUnitStatus(data.journal[i])));
    }
    if (dateFrom || dateTo) {
      indices = indices.filter((i) => {
        const day = data.journal[i].date;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        return true;
      });
    }
    if (debouncedQuery) {
      return indices
        .map((i) => ({ i, score: scoreMatch(debouncedQuery, journalHaystacks[i]) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((item) => data.journal[item.i]);
    }
    return indices
      .map((i) => data.journal[i])
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        const aHour = HOUR_ORDER.indexOf(a.hour ?? a.range?.start ?? '7am');
        const bHour = HOUR_ORDER.indexOf(b.hour ?? b.range?.start ?? '7am');
        return bHour - aHour;
      });
  }, [data, typeFilter, journalStatuses, projectFilter, dateFrom, dateTo, debouncedQuery, journalHaystacks]);

  const afterAction = React.useCallback(async () => {
    await fetchData();
    refreshTasks();
  }, [fetchData, refreshTasks]);

  const toggleComplete = async (row: LibraryTaskRow) => {
    if (row.listType === 'misc-notes') return;
    setBusyTaskId(row.id);
    try {
      const wasCompleted = row.completed;
      const response = await fetch('/api/tasks/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: row.id, listType: row.listType, date: currentDate }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        if (result.blockedByOpenSubtasks) {
          window.alert('This task has open subtasks — complete those first.');
          return;
        }
        throw new Error(result.error || 'Failed to toggle completion');
      }
      if (!wasCompleted) {
        try {
          const journalRes = await fetch('/api/journal/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dates: [currentDate], resolve: false }),
          });
          const journalData = await journalRes.json();
          if (!checkIfTaskLogged(journalData.journals?.[currentDate], row.id)) {
            await fetch('/api/journal/append', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                date: currentDate,
                hour: currentHourLabel(),
                taskId: row.id,
                listType: row.listType,
                entryMode: 'logged',
              }),
            });
          }
          refreshJournal();
        } catch (logError) {
          console.error('Failed to log completion to journal:', logError);
        }
      }
      await afterAction();
    } catch (err) {
      console.error('Toggle completion failed:', err);
      window.alert(err instanceof Error ? err.message : 'Failed to toggle completion');
    } finally {
      setBusyTaskId(null);
    }
  };

  const deleteTask = async (row: LibraryTaskRow) => {
    setBusyTaskId(row.id);
    try {
      if (row.source === 'misc') {
        await fetch('/api/tasks/misc/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: row.id }),
        });
        await afterAction();
        return;
      }
      if (!window.confirm(`Delete "${row.text}"?`)) return;
      const response = await fetch('/api/tasks/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: row.id, listType: row.listType }),
      });
      const result = await response.json();
      if (result.requiresRecursiveDelete) {
        if (
          window.confirm(
            `"${row.text}" has ${result.descendantCount} subtask(s). Delete them too?`,
          )
        ) {
          await fetch('/api/tasks/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: row.id, listType: row.listType, recursive: true }),
          });
        } else {
          return;
        }
      }
      await afterAction();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusyTaskId(null);
    }
  };

  const promoteMisc = async (row: LibraryTaskRow, listType: ListType) => {
    setBusyTaskId(row.id);
    try {
      await fetch('/api/tasks/misc/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: row.id, listType }),
      });
      await afterAction();
    } finally {
      setBusyTaskId(null);
    }
  };

  const toggleSetItem = <T,>(set: Set<T>, item: T): Set<T> => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  };

  const clearFilters = () => {
    setQuery('');
    setTypeFilter('all');
    setTaskStatuses(new Set());
    setJournalStatuses(new Set());
    setProjectFilter(null);
    setDateFrom('');
    setDateTo('');
  };

  const chipClass = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-500 text-white'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
    }`;

  const showTasks = typeFilter !== 'journal';
  const showJournal = typeFilter !== 'tasks' && !projectFilter;

  const editTaskForModal: Task | null = editRow
    ? {
        id: editRow.id,
        text: editRow.text,
        notesMarkdown: editRow.notesMarkdown,
        projects: editRow.projects,
        parentTaskId: editRow.parentTaskId,
        dueDate: editRow.dueDate,
        dueTimeStart: editRow.dueTimeStart,
        dueTimeEnd: editRow.dueTimeEnd,
        isDaily: editRow.isDaily,
      }
    : null;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <AppHeader title="Library" subtitle="Search everything you've ever captured or logged" />

      <div className="max-w-4xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks, notes, and journal entries…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(['all', 'tasks', 'journal'] as TypeFilter[]).map((type) => (
            <button key={type} onClick={() => setTypeFilter(type)} className={chipClass(typeFilter === type)}>
              {type === 'all' ? 'All' : type === 'tasks' ? 'Tasks' : 'Journal'}
            </button>
          ))}
          <span className="mx-1 text-gray-300 dark:text-gray-600">·</span>
          {showTasks &&
            (['open', 'current', 'completed', 'misc'] as TaskStatusFilter[]).map((status) => (
              <button
                key={status}
                onClick={() => setTaskStatuses((prev) => toggleSetItem(prev, status))}
                className={chipClass(taskStatuses.has(status))}
              >
                {status === 'open' ? 'Open' : status === 'current' ? 'In Current' : status === 'completed' ? 'Completed' : 'Misc'}
              </button>
            ))}
          {showJournal &&
            (['planned', 'logged', 'missed', 'completed'] as JournalStatusFilter[]).map((status) => (
              <button
                key={`j-${status}`}
                onClick={() => setJournalStatuses((prev) => toggleSetItem(prev, status))}
                className={chipClass(journalStatuses.has(status))}
              >
                {status[0].toUpperCase() + status.slice(1)}
                <span className="ml-1 opacity-60 text-[10px]">journal</span>
              </button>
            ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(data?.projects ?? []).map((slug) => (
            <button
              key={slug}
              onClick={() => setProjectFilter((prev) => (prev === slug ? null : slug))}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                projectFilter === slug
                  ? 'bg-teal-600 text-white'
                  : 'bg-teal-100/90 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/70'
              }`}
            >
              {formatProjectTag(slug)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-gray-500 dark:text-gray-400">
          <label className="flex items-center gap-1">
            from
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            />
          </label>
          <label className="flex items-center gap-1">
            to
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
            />
          </label>
          {(query || projectFilter || taskStatuses.size > 0 || journalStatuses.size > 0 || dateFrom || dateTo || typeFilter !== 'all') && (
            <button onClick={clearFilters} className="underline underline-offset-2 hover:text-gray-800 dark:hover:text-gray-200">
              Clear filters
            </button>
          )}
        </div>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        )}
        {error && !loading && <p className="text-sm text-red-500">{error}</p>}

        {!loading && !error && data && (
          <>
            {/* Tasks */}
            {showTasks && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Tasks ({filteredTasks.length})
                </h2>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                  {filteredTasks.slice(0, taskLimit).map((row) => (
                    <li key={`${row.source}-${row.id}`} className="px-3 py-2">
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={() => toggleComplete(row)}
                          disabled={busyTaskId === row.id || row.listType === 'misc-notes'}
                          className="mt-0.5 shrink-0 text-gray-300 hover:text-green-500 dark:text-gray-600 dark:hover:text-green-400 disabled:opacity-40"
                          title={row.completed ? 'Uncomplete' : 'Complete'}
                        >
                          {row.completed ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500 dark:text-green-400" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            {normalizeProjectList(row.projects).map((slug) => (
                              <button
                                key={slug}
                                onClick={() => setProjectFilter(slug)}
                                className="inline-flex items-center px-1.5 py-0.5 rounded bg-teal-100/90 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-[11px] font-medium hover:bg-teal-200 dark:hover:bg-teal-900/70"
                              >
                                {formatProjectTag(slug)}
                              </button>
                            ))}
                            <span
                              className={`text-sm ${
                                row.completed
                                  ? 'text-gray-400 dark:text-gray-500 line-through'
                                  : 'text-gray-800 dark:text-gray-100'
                              }`}
                            >
                              {row.text}
                            </span>
                            {row.isDaily && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                                Daily
                              </span>
                            )}
                            {row.currentRank !== undefined && !row.completed && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                Current #{row.currentRank + 1}
                              </span>
                            )}
                            {row.source === 'misc' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                                Misc
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400 dark:text-gray-500">
                            {row.dueDate && (
                              <span>
                                due: {row.dueDate}
                                {row.dueTimeStart &&
                                  ` @ ${formatDueTimeRangeForDisplay(row.dueTimeStart, row.dueTimeEnd)}`}
                              </span>
                            )}
                            {row.completedAt && <span>completed {row.completedAt.slice(0, 10)}</span>}
                            {row.notesMarkdown && (
                              <button
                                onClick={() =>
                                  setExpandedNotes((prev) => toggleSetItem(prev, row.id))
                                }
                                className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
                              >
                                {expandedNotes.has(row.id) ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                                notes
                              </button>
                            )}
                          </div>
                          {expandedNotes.has(row.id) && row.notesMarkdown && (
                            <div className="mt-1 rounded bg-gray-50 dark:bg-gray-800/60 px-2 py-1.5">
                              <TaskNotesPreview markdown={row.notesMarkdown} />
                            </div>
                          )}
                        </div>
                        {(row.source === 'general' || row.source === 'misc') && (
                          <div className="relative shrink-0">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setMenuTaskId((prev) => (prev === row.id ? null : row.id));
                              }}
                              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {menuTaskId === row.id && (
                              <div className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 text-sm">
                                {row.source === 'general' && (
                                  <button
                                    onClick={() => setEditRow(row)}
                                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                                  >
                                    Edit
                                  </button>
                                )}
                                {row.source === 'misc' && (
                                  <>
                                    <button
                                      onClick={() => promoteMisc(row, 'have-to-do')}
                                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                                    >
                                      Promote → Have to Do
                                    </button>
                                    <button
                                      onClick={() => promoteMisc(row, 'want-to-do')}
                                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                                    >
                                      Promote → Want to Do
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => deleteTask(row)}
                                  className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-red-600 dark:text-red-400"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {filteredTasks.length > taskLimit && (
                  <button
                    onClick={() => setTaskLimit((prev) => prev + SHOW_MORE)}
                    className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Show {Math.min(SHOW_MORE, filteredTasks.length - taskLimit)} more
                  </button>
                )}
                {filteredTasks.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 px-1 py-2">No matching tasks.</p>
                )}
              </section>
            )}

            {/* Journal */}
            {showJournal && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Journal ({filteredJournal.length})
                </h2>
                <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-100 dark:border-gray-800">
                  {filteredJournal.slice(0, journalLimit).map((unit, index) => (
                    <li key={`${unit.date}-${unit.hour ?? unit.range?.start}-${index}`} className="px-3 py-2 flex items-baseline gap-3">
                      <span className="shrink-0 w-40 text-[11px] text-gray-400 dark:text-gray-500">
                        {formatDayLabel(unit.date)} ·{' '}
                        {unit.range ? `${unit.range.start}–${unit.range.end}` : unit.hour}
                      </span>
                      <span className={`text-sm min-w-0 ${journalTextClass(unit)} ${unit.text === '[Task not found]' ? 'italic opacity-60' : ''}`}>
                        {unit.text}
                        {journalSuffix(unit) && (
                          <span className="ml-1 text-[11px] italic opacity-70">{journalSuffix(unit)}</span>
                        )}
                      </span>
                      {unit.omiRefs && unit.omiRefs.length > 0 && (
                        <Link
                          href={`/omi-transcripts?date=${unit.omiRefs[0].transcriptDate}&segment=${unit.omiRefs[0].segmentId}`}
                          className="shrink-0 text-[11px] text-blue-500 hover:underline"
                        >
                          transcript
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                {filteredJournal.length > journalLimit && (
                  <button
                    onClick={() => setJournalLimit((prev) => prev + SHOW_MORE)}
                    className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Show {Math.min(SHOW_MORE, filteredJournal.length - journalLimit)} more
                  </button>
                )}
                {filteredJournal.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 px-1 py-2">No matching journal entries.</p>
                )}
              </section>
            )}

            {debouncedQuery &&
              showTasks &&
              showJournal &&
              filteredTasks.length === 0 &&
              filteredJournal.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No results for &ldquo;{debouncedQuery}&rdquo;
                  </p>
                  <button onClick={clearFilters} className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    Clear filters
                  </button>
                </div>
              )}
          </>
        )}
      </div>

      <EditTaskModal
        isOpen={editRow !== null}
        onClose={() => setEditRow(null)}
        onTaskUpdated={() => {
          setEditRow(null);
          afterAction();
        }}
        onResortRequested={() => {
          setEditRow(null);
          afterAction();
        }}
        task={editTaskForModal}
        listType={(editRow?.listType === 'want-to-do' ? 'want-to-do' : 'have-to-do') as ListType}
        existingProjectSuggestions={data?.projects}
      />
    </div>
  );
}
