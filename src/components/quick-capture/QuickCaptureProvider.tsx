'use client';

import React from 'react';
import { useRefresh } from '@/lib/RefreshContext';
import type { CaptureListType, CaptureResponse } from '@/lib/capture/types';
import { QuickCaptureOverlay } from './QuickCaptureOverlay';
import { CaptureToastStack } from './CaptureToastStack';

export interface CaptureToastItem {
  id: string;
  phase: 'saving' | 'done' | 'fallback' | 'error';
  /** The original fragment as typed. */
  text: string;
  /** The text actually stored (may be cleaned by the classifier). */
  storedText?: string;
  taskId?: string;
  listType?: CaptureListType;
  projects?: string[];
  dueDate?: string;
  isDaily?: boolean;
  undone?: boolean;
}

interface QuickCaptureContextValue {
  submitCapture: (text: string) => void;
  openOverlay: () => void;
}

const QuickCaptureContext = React.createContext<QuickCaptureContextValue | null>(null);

export function useQuickCapture(): QuickCaptureContextValue {
  const context = React.useContext(QuickCaptureContext);
  if (!context) {
    throw new Error('useQuickCapture must be used within QuickCaptureProvider');
  }
  return context;
}

export function QuickCaptureProvider({ children }: { children: React.ReactNode }) {
  const { refreshTasks } = useRefresh();
  const [toasts, setToasts] = React.useState<CaptureToastItem[]>([]);
  const [overlayOpen, setOverlayOpen] = React.useState(false);
  const refreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Each refresh signal triggers six list GETs in TaskLists, so rapid
  // multi-capture coalesces into one trailing signal.
  const scheduleRefresh = React.useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshTasks();
    }, 500);
  }, [refreshTasks]);

  const updateToast = React.useCallback((id: string, patch: Partial<CaptureToastItem>) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)),
    );
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const submitCapture = React.useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      const toastId = crypto.randomUUID();
      setToasts((current) => [...current, { id: toastId, phase: 'saving', text: trimmed }]);

      void (async () => {
        try {
          const response = await fetch('/api/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: trimmed }),
          });
          const data = (await response.json()) as CaptureResponse;
          if (!response.ok || !data.success || !data.taskId) {
            throw new Error(data.error || 'Capture failed');
          }
          updateToast(toastId, {
            phase: data.classified ? 'done' : 'fallback',
            storedText: data.task?.text ?? trimmed,
            taskId: data.taskId,
            listType: data.listType,
            projects: data.projects,
            dueDate: data.dueDate,
            isDaily: data.isDaily,
          });
          scheduleRefresh();
          if (data.prioritizationRequested) {
            // The UI is pull-only; one delayed refresh catches the OpenClaw
            // agent's Current-queue placement without polling.
            setTimeout(() => refreshTasks(), 90_000);
          }
        } catch (error) {
          console.error('Quick capture failed:', error);
          updateToast(toastId, { phase: 'error' });
        }
      })();
    },
    [refreshTasks, scheduleRefresh, updateToast],
  );

  const undoCapture = React.useCallback(
    async (toast: CaptureToastItem) => {
      if (!toast.taskId || !toast.listType) {
        return;
      }
      const endpoint =
        toast.listType === 'misc-notes' ? '/api/tasks/misc/remove' : '/api/tasks/remove';
      const body =
        toast.listType === 'misc-notes'
          ? { taskId: toast.taskId }
          : { taskId: toast.taskId, listType: toast.listType };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Undo failed');
      }
      updateToast(toast.id, { undone: true });
      scheduleRefresh();
    },
    [scheduleRefresh, updateToast],
  );

  const retryCapture = React.useCallback(
    (toast: CaptureToastItem) => {
      dismissToast(toast.id);
      submitCapture(toast.text);
    },
    [dismissToast, submitCapture],
  );

  const openOverlay = React.useCallback(() => setOverlayOpen(true), []);

  // Global capture hotkey. Fires even while typing elsewhere — it's an interrupt.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.repeat) {
        event.preventDefault();
        setOverlayOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const contextValue = React.useMemo(
    () => ({ submitCapture, openOverlay }),
    [submitCapture, openOverlay],
  );

  return (
    <QuickCaptureContext.Provider value={contextValue}>
      {children}
      <QuickCaptureOverlay open={overlayOpen} onClose={() => setOverlayOpen(false)} />
      <CaptureToastStack
        toasts={toasts}
        onUndo={undoCapture}
        onRetry={retryCapture}
        onDismiss={dismissToast}
      />
    </QuickCaptureContext.Provider>
  );
}
