'use client';

import React from 'react';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { JobApplicationAnswerBankEntry } from '@/lib/types';

// Self-contained browser for the saved-answer bank. Fetches lazily on first
// expand; mutations go through /api/jobs/applications/answer-bank.
export function AnswerBankPanel() {
  const [open, setOpen] = React.useState(false);
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

  return (
    <div className="border-b border-slate-200 px-4 py-2 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
      >
        {open ? '▾' : '▸'} Saved answers{entries ? ` (${entries.length})` : ''}
      </button>
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
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-700 dark:text-slate-200">{entry.prompt}</p>
                    {editingId === entry.id ? (
                      <textarea
                        value={editValue}
                        onChange={(event) => setEditValue(event.target.value)}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                        autoFocus
                      />
                    ) : (
                      <p className="mt-0.5 text-sm font-medium text-teal-700 dark:text-teal-300">
                        {Array.isArray(entry.answer) ? entry.answer.join(', ') : entry.answer}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {entry.kind} · confirmed {entry.confirmedAt.slice(0, 10)}
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
                          onClick={() => startEdit(entry)}
                          className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded dark:hover:text-slate-200 dark:hover:bg-slate-800"
                          title="Edit answer"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
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
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
