'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';

interface LetGoReasonModalProps {
  /** The task being let go; the modal is open while this is set. */
  taskText: string | null;
  onCancel: () => void;
  /** Resolves with an error message to show, or nothing when the task was let go. */
  onConfirm: (reason: string) => Promise<string | void>;
}

/**
 * Letting a task go always records why: the reason is required before the task leaves the lists.
 */
export function LetGoReasonModal({ taskText, onCancel, onConfirm }: LetGoReasonModalProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const isOpen = taskText !== null;

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setError(null);
    setSaving(false);
    const timer = window.setTimeout(() => fieldRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, taskText]);

  const trimmed = reason.trim();
  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const message = await onConfirm(trimmed);
      if (message) setError(message);
    } catch {
      setError('Could not let the task go. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell isOpen={isOpen} onClose={() => { if (!saving) onCancel(); }} maxWidth="md">
      {isOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <ModalShell.Header>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Let this task go?</h3>
          </ModalShell.Header>
          <ModalShell.Body>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
              It leaves your lists without counting as done. You can restore it from Undo right after.
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 mb-4">
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">{taskText}</p>
            </div>
            <label htmlFor="let-go-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Why are you letting it go?
            </label>
            <textarea
              id="let-go-reason"
              ref={fieldRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={3}
              required
              placeholder="e.g. The deadline passed and it no longer counts"
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p className="text-xs text-red-500 dark:text-red-400 mt-2">{error}</p>}
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
              disabled={!trimmed || saving}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Letting go…' : 'Let go'}
            </button>
          </ModalShell.Footer>
        </form>
      )}
    </ModalShell>
  );
}
