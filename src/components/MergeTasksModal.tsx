'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';

export interface MergeSide { id: string; title: string }

interface MergeTasksModalProps {
  /** The task he dragged and the task he dropped it on; the modal is open while this is set. */
  ask: { from: MergeSide; into: MergeSide } | null;
  onCancel: () => void;
  /** Resolves with an error message to show, or nothing when the tasks were merged. */
  onConfirm: (fromId: string, intoId: string, note: string) => Promise<string | void>;
}

const NOTE_MAX = 2000;

/**
 * One task was dropped on another: this asks whether to merge them, which of the two stays, and for a note to
 * OpenClaw, which makes one task of the two afterwards.
 */
export function MergeTasksModal({ ask, onCancel, onConfirm }: MergeTasksModalProps) {
  const [note, setNote] = useState('');
  const [swapped, setSwapped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const isOpen = ask !== null;
  const key = ask ? `${ask.from.id}>${ask.into.id}` : '';

  useEffect(() => {
    if (!isOpen) return;
    setNote('');
    setSwapped(false);
    setError(null);
    setSaving(false);
    const timer = window.setTimeout(() => fieldRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, key]);

  const from = ask ? (swapped ? ask.into : ask.from) : null;
  const into = ask ? (swapped ? ask.from : ask.into) : null;
  const submit = async () => {
    if (!from || !into || saving) return;
    setSaving(true);
    setError(null);
    try {
      const message = await onConfirm(from.id, into.id, note.trim());
      if (message) setError(message);
    } catch {
      setError('Could not merge the tasks. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell isOpen={isOpen} onClose={() => { if (!saving) onCancel(); }} maxWidth="md">
      {from && into && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <ModalShell.Header>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Merge these two tasks?</h3>
          </ModalShell.Header>
          <ModalShell.Body>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">This task is folded in and leaves your lists</p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 mb-3">
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">{from.title}</p>
            </div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Into this task, which stays</p>
              <button
                type="button"
                onClick={() => setSwapped((s) => !s)}
                disabled={saving}
                className="text-xs font-medium text-slate-700 dark:text-slate-200 underline underline-offset-2 hover:text-slate-900 dark:hover:text-white"
              >
                Swap them
              </button>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 mb-3 ring-1 ring-slate-300 dark:ring-slate-500">
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">{into.title}</p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              The task that stays keeps its place and gets the other’s notes, work, web tabs and chats with OpenClaw.
              OpenClaw then makes one task of the two and says what it did in a new chat there. You can undo right after.
            </p>
            <label htmlFor="merge-note" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              A note for OpenClaw <span className="font-normal text-gray-500 dark:text-gray-400">(optional)</span>
            </label>
            <textarea
              id="merge-note"
              ref={fieldRef}
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={3}
              placeholder="e.g. These are the same assignment. Keep the earlier date."
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            {error && <p className="text-xs text-red-500 dark:text-red-400 mt-2" role="alert">{error}</p>}
          </ModalShell.Body>
          <ModalShell.Footer>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Merging…' : 'Yes, merge them'}
            </button>
          </ModalShell.Footer>
        </form>
      )}
    </ModalShell>
  );
}
