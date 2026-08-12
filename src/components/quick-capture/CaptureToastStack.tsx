'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { formatProjectTag } from '@/lib/projects';
import type { CaptureListType } from '@/lib/capture/types';
import type { CaptureToastItem } from './QuickCaptureProvider';

const MAX_VISIBLE_TOASTS = 4;
const DISMISS_MS = 6000;
const ERROR_DISMISS_MS = 10000;

interface CaptureToastStackProps {
  toasts: CaptureToastItem[];
  onUndo: (toast: CaptureToastItem) => Promise<void>;
  onRetry: (toast: CaptureToastItem) => void;
  onDismiss: (id: string) => void;
}

function listLabel(listType?: CaptureListType): string {
  if (listType === 'have-to-do') return 'Have to Do';
  if (listType === 'want-to-do') return 'Want to Do';
  return 'Misc Notes';
}

function formatDueDate(dueDate: string): string {
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dueDate;
  }
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function CaptureToastStack({ toasts, onUndo, onRetry, onDismiss }: CaptureToastStackProps) {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);

  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {visible.map((toast) => (
          <CaptureToast
            key={toast.id}
            toast={toast}
            onUndo={onUndo}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function CaptureToast({
  toast,
  onUndo,
  onRetry,
  onDismiss,
}: {
  toast: CaptureToastItem;
  onUndo: (toast: CaptureToastItem) => Promise<void>;
  onRetry: (toast: CaptureToastItem) => void;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = React.useState(false);
  const [undoing, setUndoing] = React.useState(false);

  const terminal = toast.phase !== 'saving';
  const dismissAfter = toast.phase === 'error' ? ERROR_DISMISS_MS : DISMISS_MS;

  React.useEffect(() => {
    if (!terminal || paused) {
      return;
    }
    const shortened = toast.undone ? 1500 : dismissAfter;
    const timer = setTimeout(() => onDismiss(toast.id), shortened);
    return () => clearTimeout(timer);
  }, [terminal, paused, dismissAfter, toast.id, toast.undone, onDismiss]);

  const handleUndo = async () => {
    setUndoing(true);
    try {
      await onUndo(toast);
    } catch (error) {
      console.error('Undo failed:', error);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg px-3.5 py-2.5 text-sm"
    >
      {toast.phase === 'saving' && (
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">{toast.text}</span>
        </div>
      )}

      {(toast.phase === 'done' || toast.phase === 'fallback') && (
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-gray-900 dark:text-gray-100">
              {toast.undone ? 'Undone' : toast.storedText ?? toast.text}
            </div>
            {!toast.undone && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {toast.phase === 'fallback' ? (
                  <>Saved to Misc Notes (unclassified)</>
                ) : (
                  <>
                    → {listLabel(toast.listType)}
                    {toast.projects?.map((slug) => (
                      <span key={slug} className="ml-1 text-teal-600 dark:text-teal-400">
                        {formatProjectTag(slug)}
                      </span>
                    ))}
                    {toast.dueDate && <> · due {formatDueDate(toast.dueDate)}</>}
                    {toast.isDaily && <> · daily</>}
                  </>
                )}
              </div>
            )}
          </div>
          {!toast.undone && (
            <button
              onClick={handleUndo}
              disabled={undoing}
              className="ml-auto shrink-0 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 disabled:opacity-50"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {toast.phase === 'error' && (
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-gray-900 dark:text-gray-100">{toast.text}</div>
            <div className="text-xs text-red-500">Couldn&apos;t save</div>
          </div>
          <button
            onClick={() => onRetry(toast)}
            className="ml-auto shrink-0 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300"
          >
            Retry
          </button>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
