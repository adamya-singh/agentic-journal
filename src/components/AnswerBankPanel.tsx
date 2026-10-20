'use client';

import React from 'react';
import { Building2, Check, Globe, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { JobApplicationAnswerBankEntry, JobApplicationAnswerScope } from '@/lib/types';

const FILE_ANSWER_PATTERN =
  /^file:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([A-Za-z0-9._-]{1,100})$/i;

function fileRef(answer: string | string[]): { uploadId: string; fileName: string } | null {
  if (typeof answer !== 'string') return null;
  const match = FILE_ANSWER_PATTERN.exec(answer);
  return match ? { uploadId: match[1], fileName: match[2] } : null;
}

// Self-contained browser for the saved-answer bank. Fetches lazily on first
// expand; mutations go through /api/jobs/applications/answer-bank. With
// onClose it renders already open, as a section the caller dismisses.
export function AnswerBankPanel({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = React.useState(Boolean(onClose));
  const [entries, setEntries] = React.useState<JobApplicationAnswerBankEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const fetchEntries = React.useCallback(async () => {
    try {
      const response = await fetch('/api/jobs/applications/answer-bank');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to load saved answers');
      }
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved answers');
    }
  }, []);

  React.useEffect(() => {
    if (open && entries === null) {
      fetchEntries();
    }
  }, [open, entries, fetchEntries]);

  const startEdit = (entry: JobApplicationAnswerBankEntry) => {
    setEditingId(entry.id);
    setEditValue(Array.isArray(entry.answer) ? entry.answer.join(', ') : entry.answer);
  };

  const saveEdit = async (entry: JobApplicationAnswerBankEntry) => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setBusyId(entry.id);
    try {
      const answer = Array.isArray(entry.answer)
        ? trimmed.split(',').map((item) => item.trim()).filter(Boolean)
        : trimmed;
      const response = await fetch('/api/jobs/applications/answer-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: entry.id, answer }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update answer');
      }
      setEditingId(null);
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update answer');
    } finally {
      setBusyId(null);
    }
  };

  const deleteEntry = async (entry: JobApplicationAnswerBankEntry) => {
    if (!window.confirm(`Delete the saved answer for "${entry.prompt}"?`)) return;
    setBusyId(entry.id);
    try {
      const response = await fetch('/api/jobs/applications/answer-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: entry.id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete answer');
      }
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete answer');
    } finally {
      setBusyId(null);
    }
  };

  const changeScope = async (entry: JobApplicationAnswerBankEntry, scope: JobApplicationAnswerScope) => {
    setBusyId(entry.id);
    try {
      const response = await fetch('/api/jobs/applications/answer-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scope', id: entry.id, scope }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to move answer');
      }
      await fetchEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move answer');
    } finally {
      setBusyId(null);
    }
  };

  const contextEntries = entries?.filter((entry) => entry.scope === 'context') ?? [];
  const generalEntries = entries?.filter((entry) => entry.scope !== 'context') ?? [];

  const renderEntry = (entry: JobApplicationAnswerBankEntry) => (
    <li key={entry.id} className="flex items-start gap-3 py-2">
      <div className="min-w-0 flex-1">
        {entry.scope === 'context' && entry.context && (
        <p className="mb-0.5 truncate text-[11px] font-medium text-sky-700 dark:text-sky-300">
          {entry.context.company}{entry.context.role ? ` · ${entry.context.role}` : ''}
        </p>
      )}
      <p className="text-sm text-slate-700 dark:text-slate-200">{entry.prompt}</p>
        {editingId === entry.id ? (
          <textarea
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            autoFocus
          />
        ) : entry.kind === 'file' && fileRef(entry.answer) ? (
          <p className="mt-0.5 text-sm font-medium text-teal-700 dark:text-teal-300">
            {fileRef(entry.answer)!.fileName}{' '}
            <a
              href={`/api/jobs/applications/files/${encodeURIComponent(fileRef(entry.answer)!.uploadId)}/${encodeURIComponent(fileRef(entry.answer)!.fileName)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-normal text-indigo-600 hover:underline dark:text-indigo-300"
            >
              view
            </a>
          </p>
        ) : (
          <p className="mt-0.5 text-sm font-medium text-teal-700 dark:text-teal-300">
            {Array.isArray(entry.answer) ? entry.answer.join(', ') : entry.answer}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-400">
          {entry.kind} · confirmed {entry.confirmedAt.slice(0, 10)}
        {entry.scope !== 'context' && entry.context ? ` · first given for ${entry.context.company}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editingId === entry.id ? (
          <>
            <button
              onClick={() => saveEdit(entry)}
              disabled={busyId === entry.id}
              className="p-1 text-green-600 hover:bg-green-50 rounded dark:hover:bg-green-900/30"
              title="Save"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="p-1 text-slate-400 hover:bg-slate-100 rounded dark:hover:bg-slate-800"
              title="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => changeScope(entry, entry.scope === 'context' ? 'general' : 'context')}
              disabled={busyId === entry.id}
              className="p-1 text-slate-400 hover:text-sky-700 hover:bg-sky-50 rounded dark:hover:text-sky-300 dark:hover:bg-sky-900/30"
              title={entry.scope === 'context'
                ? 'Reuse on every application'
                : `Keep for ${entry.context?.company ?? 'that job'} only (OpenClaw treats it as a hint elsewhere)`}
            >
              {entry.scope === 'context' ? <Globe className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            </button>
            {entry.kind !== 'file' && (
              <button
                onClick={() => startEdit(entry)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded dark:hover:text-slate-200 dark:hover:bg-slate-800"
                title="Edit answer"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => deleteEntry(entry)}
              disabled={busyId === entry.id}
              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded dark:hover:text-red-400 dark:hover:bg-red-900/30"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className={onClose ? 'rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700' : 'border-b border-slate-200 px-4 py-2 dark:border-slate-700'}>
      {onClose ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Saved answers{entries ? <span className="ml-1 text-sm font-normal text-slate-500"> {entries.length}</span> : ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          {open ? '▾' : '▸'} Saved answers{entries ? ` (${entries.length})` : ''}
        </button>
      )}
      {open && (
        <div className="mt-2">
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
          {entries === null && !error && (
            <p className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          )}
          {entries && entries.length === 0 && (
            <p className="text-sm text-slate-400">
              No saved answers yet — answers you give in applications are remembered here.
            </p>
          )}
          {entries && entries.length > 0 && (
            <>
              <AnswerSection
                title="Depends on the job"
                count={contextEntries.length}
                note="Answers you gave for one company, like how you heard about it or why you want to work there. OpenClaw only treats them as hints and decides whether they fit the next application; they’re never filled in on their own."
              >
                {contextEntries.map(renderEntry)}
              </AnswerSection>
              <AnswerSection
                title="Every application"
                count={generalEntries.length}
                note="Filled in wherever the same question comes up again."
              >
                {generalEntries.map(renderEntry)}
              </AnswerSection>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerSection({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count: number;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title} <span className="font-normal tabular-nums">{count}</span>
      </h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note}</p>
      {count > 0 && <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">{children}</ul>}
    </section>
  );
}
